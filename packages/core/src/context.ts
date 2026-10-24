import { type Card, plainLinks, stripTitle } from "./cards";
import { buildMatcher, type KeywordHit } from "./matcher";
import {
  type Memory,
  type PlayerMode,
  type Rating,
  ratingRank,
  type Turn,
  type WorldManifest,
} from "./schema";
import { estimateTokens, type TokenCounter } from "./tokens";

export type Section = "host" | "rules" | "canon" | "lore" | "memory" | "history" | "input";

export interface ContextInput {
  world: WorldManifest;
  /** Every card in the world, rules included. */
  cards: readonly Card[];
  memory: Memory;
  /** The visible story so far, oldest first, not including the pending player input. */
  turns: readonly Turn[];
  input: { mode: PlayerMode; text: string };
  budget: { maxTokens: number; reserveReply: number };
  counter?: TokenCounter;
  /** Defaults to the world's own rating. Cards above it are never loaded. */
  ratingCeiling?: Rating;
  /** How many of the most recent turns are scanned for keywords, in addition to the input. */
  scanTurns?: number;
  /** Cards to treat as always-on for this one turn only (an opening scene's arc, a manual pin). */
  pinnedCards?: readonly string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface IncludedItem {
  section: Section;
  id: string;
  label: string;
  /** Human-readable "why is this here", shown in the cards-in-context drawer. */
  reason: string;
  tokens: number;
}

export interface ExcludedItem {
  id: string;
  label: string;
  reason: "budget" | "rating";
}

export interface BuiltContext {
  messages: ChatMessage[];
  included: IncludedItem[];
  excluded: ExcludedItem[];
  tokens: { used: number; available: number; max: number };
}

export class ContextBudgetError extends Error {
  constructor(
    readonly needed: number,
    readonly available: number,
  ) {
    super(
      `Required context needs ${needed} tokens but only ${available} are available after reserving the reply. ` +
        "Raise the context size, lower the reply reserve, or shorten the rules marked must.",
    );
    this.name = "ContextBudgetError";
  }
}

/** Per chat message framing cost, matching typical chat-template overhead. */
const MESSAGE_OVERHEAD = 4;
/** Turns kept ahead of lore so the story never loses its immediate thread. */
const RECENT_TURNS = 2;

const byId = (a: Card, b: Card): number => (a.fm.id < b.fm.id ? -1 : a.fm.id > b.fm.id ? 1 : 0);

export function hostInstructions(world: WorldManifest, ceiling: Rating): string {
  const list = (xs: readonly string[]) => (xs.length ? xs.join(", ") : "unspecified");
  return [
    `You are the game master of "${world.title}"${world.tagline ? ` - ${world.tagline.replace(/[.\s]+$/, "")}` : ""}.`,
    `Genre: ${list(world.genre)}. Tone: ${list(world.tone)}. Narrate in the ${world.perspective} perspective.`,
    `Content rating: ${ceiling}. Never exceed it; steer the scene instead of refusing or lecturing.`,
    "Treat <rules>, <canon>, <lore_in_play> and <memory> as the truth of this world. They are for you to use, never to recite to the player.",
    "Anything marked Secrets is host-only. Let it shape events and foreshadowing, and reveal it only when the player earns it through action.",
    "Never decide what the player character thinks, feels or does. End on an open situation.",
    "Keep each reply to roughly 80-200 words unless asked for more.",
    'Player input arrives in <player_input mode="...">: "do" is the character acting, "say" is the character speaking, "story" is the player directing the narration directly.',
  ].join("\n");
}

export function formatPlayerInput(mode: PlayerMode, text: string): string {
  const trimmed = text.trim();
  const body = mode === "say" ? `"${trimmed.replace(/^["“]+|["”]+$/g, "")}"` : trimmed;
  return `<player_input mode="${mode}">${body}</player_input>`;
}

const cardText = (card: Card): string => plainLinks(stripTitle(card.body)) || card.fm.summary;

function renderCard(card: Card): string {
  return `### ${card.fm.name}\n${cardText(card)}`;
}

function renderRule(card: Card): string {
  return `### [${card.fm.severity}] ${card.fm.name}\n${cardText(card)}`;
}

interface Trigger {
  card: Card;
  /** 0 = the player's input, 1 = the newest scanned turn, and so on. */
  rank: number;
  keyword: string;
  source: string;
  index: number;
}

/**
 * Builds the exact prompt for one host turn. Pure and deterministic: the same input always
 * produces the same messages, the same inclusion list and the same exclusions, which is what lets
 * the "why is this card here" panel and the golden-prompt tests be trusted.
 *
 * Priority, highest first (lower tiers are dropped first when the budget runs out):
 *   host instructions, player input, `must` rules  (required: failure throws ContextBudgetError)
 *   `should` rules, always-on cards, the last two turns, keyword-triggered cards,
 *   pinned facts, memory summary, older turns (newest first, contiguous).
 */
export function buildContext(input: ContextInput): BuiltContext {
  const counter = input.counter ?? estimateTokens;
  const ceiling = input.ratingCeiling ?? input.world.contentRating;
  const scanTurns = input.scanTurns ?? 3;
  const available = input.budget.maxTokens - input.budget.reserveReply;
  const count = (text: string) => counter.count(text);

  const included: IncludedItem[] = [];
  const excluded: ExcludedItem[] = [];
  let used = 0;

  // Each XML-style section pays its wrapper cost once, when its first item is admitted.
  const sectionTag: Record<"rules" | "canon" | "lore" | "memory", string> = {
    rules: "rules",
    canon: "canon",
    lore: "lore_in_play",
    memory: "memory",
  };
  const opened = new Set<string>();
  const wrapperCost = (section: Section): number => {
    if (section === "host") return count("<host>\n</host>\n");
    if (section === "history" || section === "input") return 0;
    if (opened.has(section)) return 0;
    const tag = sectionTag[section];
    return count(`<${tag}>\n</${tag}>\n`);
  };

  /** Admits an item if it fits (or unconditionally when `force`). Returns whether it was admitted. */
  const admit = (
    section: Section,
    id: string,
    label: string,
    reason: string,
    text: string,
    force = false,
  ): boolean => {
    const tokens =
      count(text) + (section === "history" || section === "input" ? MESSAGE_OVERHEAD : 0);
    const cost = tokens + wrapperCost(section);
    if (!force && used + cost > available) {
      excluded.push({ id, label, reason: "budget" });
      return false;
    }
    used += cost;
    opened.add(section);
    included.push({ section, id, label, reason, tokens });
    return true;
  };

  // --- rating gate -------------------------------------------------------------------------
  const ceilingRank = ratingRank(ceiling);
  const cards: Card[] = [];
  for (const card of [...input.cards].sort(byId)) {
    // Authored scene cards are one-line beats for the writer; scenes recorded by play are not.
    if (card.fm.kind === "scene" && card.fm.origin !== "adventure") continue;
    if (ratingRank(card.fm.rating) > ceilingRank) {
      excluded.push({ id: card.fm.id, label: card.fm.name, reason: "rating" });
    } else {
      cards.push(card);
    }
  }

  // --- required tier ----------------------------------------------------------------------
  const hostText = hostInstructions(input.world, ceiling);
  admit("host", "host", "Host instructions", "always", hostText, true);

  const inputText = formatPlayerInput(input.input.mode, input.input.text);
  admit("input", "input", "Player input", "current turn", inputText, true);

  const rules = cards.filter((c) => c.fm.kind === "rule" && c.fm.scope !== "chapter");
  const renderedRules = new Map<string, string>();
  for (const rule of rules.filter((r) => r.fm.severity === "must")) {
    const text = renderRule(rule);
    renderedRules.set(rule.fm.id, text);
    admit("rules", rule.fm.id, rule.fm.name, "must rule", text, true);
  }
  if (used > available) throw new ContextBudgetError(used, available);

  // --- optional tiers, in priority order ---------------------------------------------------
  for (const rule of rules.filter((r) => r.fm.severity === "should")) {
    const text = renderRule(rule);
    if (admit("rules", rule.fm.id, rule.fm.name, "should rule", text)) {
      renderedRules.set(rule.fm.id, text);
    }
  }

  const renderedCanon = new Map<string, string>();
  const world = cards.filter((c) => c.fm.kind !== "rule");
  const forced = new Set(input.pinnedCards ?? []);
  for (const card of world.filter((c) => c.fm.always || forced.has(c.fm.id))) {
    const text = renderCard(card);
    const why = card.fm.always ? "always on" : "pinned for this turn";
    if (admit("canon", card.fm.id, card.fm.name, why, text)) {
      renderedCanon.set(card.fm.id, text);
    }
  }

  const keptTurns = new Set<string>();
  const turnLabel = (t: Turn) => (t.role === "player" ? "Player turn" : "Host turn");
  const admitTurn = (turn: Turn, reason: string): boolean => {
    const text =
      turn.role === "player" ? formatPlayerInput(turn.mode ?? "do", turn.text) : turn.text;
    if (!admit("history", turn.id, turnLabel(turn), reason, text)) return false;
    keptTurns.add(turn.id);
    return true;
  };

  const newestFirst = [...input.turns].reverse();
  let contiguous = true;
  for (const turn of newestFirst.slice(0, RECENT_TURNS)) {
    if (contiguous && !admitTurn(turn, "recent turn")) contiguous = false;
    else if (!contiguous) excluded.push({ id: turn.id, label: turnLabel(turn), reason: "budget" });
  }

  // Keyword-triggered cards, most recently triggered first.
  const triggerable = world.filter(
    (c) => !c.fm.always && !forced.has(c.fm.id) && c.fm.keywords.length > 0,
  );
  const matcher = buildMatcher(
    triggerable.map((c) => ({ cardId: c.fm.id, keywords: c.fm.keywords })),
  );
  const cardById = new Map(triggerable.map((c) => [c.fm.id, c] as const));
  const sources = [
    { rank: 0, source: "your input", text: input.input.text },
    ...newestFirst.slice(0, scanTurns).map((t, i) => ({
      rank: i + 1,
      source: `${t.role === "player" ? "player" : "host"} turn ${t.id}`,
      text: t.text,
    })),
  ];
  const best = new Map<string, Trigger>();
  for (const src of sources) {
    const hits: KeywordHit[] = matcher.scan(src.text);
    for (const hit of hits) {
      const prev = best.get(hit.cardId);
      const card = cardById.get(hit.cardId);
      if (!card) continue;
      if (!prev || src.rank < prev.rank) {
        best.set(hit.cardId, {
          card,
          rank: src.rank,
          keyword: hit.keyword,
          source: src.source,
          index: hit.index,
        });
      }
    }
  }
  const renderedLore = new Map<string, string>();
  const triggers = [...best.values()].sort(
    (a, b) => a.rank - b.rank || (a.card.fm.id < b.card.fm.id ? -1 : 1),
  );
  for (const t of triggers) {
    const text = renderCard(t.card);
    if (
      admit("lore", t.card.fm.id, t.card.fm.name, `keyword "${t.keyword}" in ${t.source}`, text)
    ) {
      renderedLore.set(t.card.fm.id, text);
    }
  }

  // Memory: pinned facts first (cheap and exact), then the rolling summary.
  const pinned: string[] = [];
  input.memory.pinned.forEach((fact, i) => {
    if (admit("memory", `pin-${i + 1}`, `Pinned fact ${i + 1}`, "pinned", `- ${fact}`)) {
      pinned.push(fact);
    }
  });
  let summary = "";
  if (input.memory.summary.trim()) {
    const text = `Summary so far: ${input.memory.summary.trim()}`;
    if (admit("memory", "summary", "Story summary", "summary", text)) summary = text;
  }

  // Older turns: newest first, stopping at the first one that does not fit so history stays contiguous.
  if (contiguous) {
    for (const turn of newestFirst.slice(RECENT_TURNS)) {
      if (contiguous && !admitTurn(turn, "older turn")) contiguous = false;
      else if (!contiguous)
        excluded.push({ id: turn.id, label: turnLabel(turn), reason: "budget" });
    }
  } else {
    for (const turn of newestFirst.slice(RECENT_TURNS)) {
      excluded.push({ id: turn.id, label: turnLabel(turn), reason: "budget" });
    }
  }

  // --- assemble ----------------------------------------------------------------------------
  const ruleOrder = rules
    .filter((r) => renderedRules.has(r.fm.id))
    .sort(
      (a, b) =>
        Number(b.fm.severity === "must") - Number(a.fm.severity === "must") ||
        (a.fm.id < b.fm.id ? -1 : 1),
    );
  const section = (tag: string, lines: string[]): string | null =>
    lines.length ? `<${tag}>\n${lines.join("\n\n")}\n</${tag}>` : null;

  const memoryLines: string[] = [];
  if (summary) memoryLines.push(summary);
  if (pinned.length) memoryLines.push(`Pinned facts:\n${pinned.map((p) => `- ${p}`).join("\n")}`);

  const system = [
    `<host>\n${hostText}\n</host>`,
    section(
      "rules",
      ruleOrder.map((r) => renderedRules.get(r.fm.id) as string),
    ),
    section("canon", [...renderedCanon.values()]),
    section("lore_in_play", [...renderedLore.values()]),
    section("memory", memoryLines),
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const turn of input.turns) {
    if (!keptTurns.has(turn.id)) continue;
    messages.push(
      turn.role === "player"
        ? { role: "user", content: formatPlayerInput(turn.mode ?? "do", turn.text) }
        : { role: "assistant", content: turn.text },
    );
  }
  messages.push({ role: "user", content: inputText });

  return {
    messages,
    included,
    excluded,
    tokens: { used, available, max: input.budget.maxTokens },
  };
}
