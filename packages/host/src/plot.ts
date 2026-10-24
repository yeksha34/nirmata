import {
  type AdventureState,
  type BuiltContext,
  buildMatcher,
  type Card,
  type PlotPoint,
  type PlotPointInput,
  plotPointsOf,
  type Turn,
  turnsSincePlot,
} from "@nirmata/core";
import { generateText, type Provider } from "@nirmata/llm";
import { extractJson } from "./json";
import { HostError, type PlotSettings } from "./types";

const MAX_CANDIDATES = 40;
const MAX_POINT_LENGTH = 240;
const KNOWN_PER_CARD = 3;

/** Player turns written since the plot extraction last ran. */
export function playerTurnsSincePlot(state: AdventureState): number {
  return turnsSincePlot(state).filter((t) => t.role === "player").length;
}

export function plotDue(state: AdventureState, settings: PlotSettings): boolean {
  return (
    settings.enabled &&
    settings.everyPlayerTurns > 0 &&
    playerTurnsSincePlot(state) >= settings.everyPlayerTurns
  );
}

/**
 * Cards a plot point could attach to: those the recent turns mention (by name or keyword), those
 * that were in the last prompt, and every story arc. Rules and authored scene notes never get
 * points. Capped, and in a stable order.
 */
export function candidateCards(
  cards: readonly Card[],
  turns: readonly Turn[],
  context?: BuiltContext,
): Card[] {
  const eligible = cards.filter((c) => c.fm.kind !== "rule" && c.fm.kind !== "scene");
  const matcher = buildMatcher(
    eligible.map((c) => ({ cardId: c.fm.id, keywords: [c.fm.name, ...c.fm.keywords] })),
  );
  const mentioned = new Set(matcher.scan(turns.map((t) => t.text).join("\n")).map((h) => h.cardId));
  const inPrompt = new Set(
    (context?.included ?? [])
      .filter((i) => i.section === "canon" || i.section === "lore")
      .map((i) => i.id),
  );
  return eligible
    .filter((c) => c.fm.kind === "arc" || mentioned.has(c.fm.id) || inPrompt.has(c.fm.id))
    .sort((a, b) => (a.fm.id < b.fm.id ? -1 : 1))
    .slice(0, MAX_CANDIDATES);
}

const PLOT_SYSTEM = (max: number) =>
  [
    "You keep the plot log of an interactive adventure. Cards describe its people, places and story arcs.",
    "Read the log and list PLOT POINTS: things that have actually happened in the log and that change the situation of one of the listed cards.",
    "Each point is one sentence in the past tense saying who did what, and where. Use only facts stated in the log: no plans, guesses, or events that did not happen.",
    "Attach each point to the single card it affects most, using the card id exactly as listed.",
    `Give at most ${max} points, and skip anything already in <known_points>.`,
    'Answer with JSON only: {"points":[{"card":"<card id>","text":"<one sentence>"}]}. If nothing qualifies, answer {"points":[]}.',
  ].join("\n");

/**
 * The extractor is shown card ids, names and kinds only. Never summaries or bodies: those may
 * hold host-only secrets, and a plot point is written where the player can read it.
 */
export function plotMessages(
  turns: readonly Turn[],
  candidates: readonly Card[],
  known: readonly PlotPoint[],
  maxPoints: number,
) {
  const ids = new Set(candidates.map((c) => c.fm.id));
  const list = candidates.map((c) => `- ${c.fm.id}: ${c.fm.name} (${c.fm.kind})`).join("\n");
  const seen = new Map<string, number>();
  const recent = [...known]
    .reverse()
    .filter((p) => {
      if (!ids.has(p.card)) return false;
      const n = (seen.get(p.card) ?? 0) + 1;
      seen.set(p.card, n);
      return n <= KNOWN_PER_CARD;
    })
    .reverse()
    .map((p) => `- ${p.card}: ${p.text}`)
    .join("\n");
  const log = turns
    .map((t) => (t.role === "player" ? `Player (${t.mode ?? "do"}): ${t.text}` : `Host: ${t.text}`))
    .join("\n\n");
  return [
    { role: "system" as const, content: PLOT_SYSTEM(maxPoints) },
    {
      role: "user" as const,
      content: `<cards>\n${list}\n</cards>\n<known_points>\n${recent || "(none)"}\n</known_points>\n<log>\n${log}\n</log>`,
    },
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Reads the extractor's answer: keeps only points for the offered cards, trims them, drops
 * repeats of what is already known, and caps the count. Only unreadable JSON throws.
 */
export function parsePlot(
  raw: string,
  candidates: readonly Card[],
  known: readonly PlotPoint[],
  maxPoints: number,
): PlotPointInput[] {
  const root = extractJson(raw, "The plot tracker", "plot_failed") as { points?: unknown };
  if (!Array.isArray(root?.points)) {
    throw new HostError("plot_failed", 'The plot tracker answer had no "points" list.');
  }
  const allowed = new Set(candidates.map((c) => c.fm.id));
  const seen = new Set(known.map((p) => `${p.card}\u0000${norm(p.text)}`));
  const out: PlotPointInput[] = [];
  for (const item of root.points) {
    const card = (item as { card?: unknown })?.card;
    const text = (item as { text?: unknown })?.text;
    if (typeof card !== "string" || typeof text !== "string" || !allowed.has(card)) continue;
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_POINT_LENGTH);
    const key = `${card}\u0000${norm(clean)}`;
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push({ card, text: clean });
    if (out.length >= maxPoints) break;
  }
  return out;
}

export async function extractPlot(args: {
  provider: Provider;
  model: string;
  state: AdventureState;
  turns: readonly Turn[];
  candidates: readonly Card[];
  maxPoints: number;
  signal?: AbortSignal | undefined;
}): Promise<PlotPointInput[]> {
  const known = plotPointsOf(args.state);
  const { text } = await generateText(
    args.provider,
    {
      model: args.model,
      messages: plotMessages(args.turns, args.candidates, known, args.maxPoints),
      params: { temperature: 0.2, maxTokens: 500 },
    },
    args.signal,
  );
  return parsePlot(text, args.candidates, known, args.maxPoints);
}
