import {
  type AdventureState,
  type BuiltContext,
  type Card,
  type CardUpdate,
  chaptersOf,
  contextTurnsOf,
  pathTo,
  slugify,
  stripTitle,
  type Turn,
} from "@nirmata/core";
import { generateText, LlmError, type Provider, type SamplerParams } from "@nirmata/llm";
import { extractJson } from "./json";
import { refreshSummary } from "./memory";
import { type CompactionSettings, HostError } from "./types";

// ---- planning ---------------------------------------------------------------------------

export interface Segment {
  /** The turns to fold away, oldest first. */
  turns: Turn[];
  /** Id of the last of them. */
  covers: string;
}

/**
 * Decides which turns to compact: everything still in the prompt except the newest `keepRecent`,
 * moving the cut back so the kept tail begins at a player action (an action is never separated
 * from its reply). Returns undefined when fewer than `minTurns` would be compacted.
 */
export function planSegment(
  turns: readonly Turn[],
  keepRecent: number,
  minTurns: number,
): Segment | undefined {
  let tailStart = turns.length - Math.max(0, keepRecent);
  while (tailStart > 0 && turns[tailStart]?.role !== "player") tailStart--;
  if (tailStart < Math.max(1, minTurns)) return undefined;
  const segment = turns.slice(0, tailStart);
  const last = segment[segment.length - 1];
  return last ? { turns: segment, covers: last.id } : undefined;
}

/** Player turns written since the last compaction (or since the start). */
export function playerTurnsSinceCompaction(state: AdventureState): number {
  let count = 0;
  for (const ev of pathTo(state)) {
    if (ev.kind === "compact") count = 0;
    else if (ev.kind === "player") count++;
  }
  return count;
}

export function compactionDue(args: {
  state: AdventureState;
  settings: CompactionSettings;
  /** The prompt that was just used, for the budget-pressure trigger. */
  context?: BuiltContext | undefined;
}): boolean {
  const { state, settings, context } = args;
  if (!settings.enabled) return false;
  if (!planSegment(contextTurnsOf(state), settings.keepRecent, settings.minTurns)) return false;
  const byTurns =
    settings.everyPlayerTurns > 0 && playerTurnsSinceCompaction(state) >= settings.everyPlayerTurns;
  const byPressure =
    settings.pressure > 0 &&
    context !== undefined &&
    context.tokens.available > 0 &&
    context.tokens.used / context.tokens.available >= settings.pressure;
  return byTurns || byPressure;
}

// ---- prompts ----------------------------------------------------------------------------

function transcript(turns: readonly Turn[]): string {
  return turns
    .map((t) => (t.role === "player" ? `Player (${t.mode ?? "do"}): ${t.text}` : `Host: ${t.text}`))
    .join("\n\n");
}

const wordCount = (turns: readonly Turn[]) =>
  turns.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);

const CHAPTER_SYSTEM = (words: number) =>
  [
    "You turn the log of an interactive adventure into one chapter of a book.",
    'Write in past tense and third person. Call the player\'s character by name if the story gives one, otherwise "the protagonist".',
    "Retell every event, decision and consequence in order. Keep names, places and objects exactly as they appear.",
    `Add no events, no new facts and no commentary. Plain, vivid prose, about ${words} words.`,
    "Start with one line: Title: <a short chapter title>. Then a blank line, then the chapter.",
  ].join("\n");

export function chapterMessages(turns: readonly Turn[], previousEnding: string) {
  const words = Math.min(700, Math.max(150, Math.round(wordCount(turns) * 0.6)));
  const before = previousEnding
    ? `<previous_chapter_ending>\n${previousEnding}\n</previous_chapter_ending>\n`
    : "";
  return [
    { role: "system" as const, content: CHAPTER_SYSTEM(words) },
    {
      role: "user" as const,
      content: `${before}<adventure_log>\n${transcript(turns)}\n</adventure_log>`,
    },
  ];
}

/** Reads "Title: ..." then the prose. A missing title falls back to "Chapter N". */
export function parseChapter(raw: string, number: number): { title: string; text: string } {
  const lines = raw.trim().split(/\r?\n/);
  const first = lines[0]?.match(/^\W*title\W*:\s*(.+)$/i);
  const title = first?.[1]?.replace(/[*_#"`]+/g, "").trim() || `Chapter ${number}`;
  const text = (first ? lines.slice(1) : lines).join("\n").trim();
  if (text.length < 40) {
    throw new HostError("compaction_failed", "The model wrote an empty chapter.");
  }
  return { title, text };
}

const RECORD_SYSTEM = [
  "You keep the notes that track an interactive adventure. Read the log and update the notes.",
  "Use only facts stated in the log. Never invent. Update an entity in <existing_state> under the same name instead of creating a duplicate.",
  "Only list entities whose condition changed or who matter right now (at most 8). Each status is its complete current condition in 1-5 short plain lines.",
  "Keywords are words a player would type to bring the note back (names, nicknames, places), lowercase.",
  "Answer with JSON only, in exactly this shape:",
  '{"scene":{"title":"","location":"","time":"","participants":[""],"keywords":[""],"events":"2-4 sentences","outcome":"1 sentence"},',
  ' "state":[{"name":"","entity":"character|place|item|quest|relationship|other","keywords":[""],"status":""}],',
  ' "now":{"location":"","time":"","present":[""],"goals":[""],"open_threads":[""]}}',
].join("\n");

export function recordMessages(turns: readonly Turn[], existing: readonly Card[]) {
  const state = existing
    .filter((c) => c.fm.kind === "state" && c.fm.id !== "state.now")
    .map((c) => ({
      name: c.fm.name.replace(/ \(now\)$/, ""),
      entity: typeof c.fm.entity === "string" ? c.fm.entity : "other",
      status: stripTitle(c.body),
    }));
  const now = existing.find((c) => c.fm.id === "state.now");
  return [
    { role: "system" as const, content: RECORD_SYSTEM },
    {
      role: "user" as const,
      content: `<existing_state>\n${JSON.stringify(state)}\n</existing_state>\n<existing_now>\n${now ? stripTitle(now.body) : "(none)"}\n</existing_now>\n<adventure_log>\n${transcript(turns)}\n</adventure_log>`,
    },
  ];
}

// ---- reading the record -----------------------------------------------------------------

export interface CompactionRecord {
  scene: {
    title: string;
    location: string;
    time: string;
    participants: string[];
    keywords: string[];
    events: string;
    outcome: string;
  };
  state: Array<{ name: string; entity: string; keywords: string[]; status: string }>;
  now: {
    location: string;
    time: string;
    present: string[];
    goals: string[];
    openThreads: string[];
  };
}

const str = (x: unknown): string => (typeof x === "string" ? x.trim() : "");
const strs = (x: unknown): string[] =>
  Array.isArray(x)
    ? x.map(str).filter(Boolean)
    : typeof x === "string"
      ? x
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

/** Lenient: small models drop fields and use strings for lists. Only unreadable JSON throws. */
export function parseRecord(raw: string): CompactionRecord {
  const root = obj(extractJson(raw, "The compactor", "compaction_failed"));
  const scene = obj(root.scene);
  const now = obj(root.now);
  const state = (Array.isArray(root.state) ? root.state : [])
    .map((item) => {
      const s = obj(item);
      return {
        name: str(s.name),
        entity: str(s.entity) || "other",
        keywords: strs(s.keywords),
        status: Array.isArray(s.status) ? strs(s.status).join("\n") : str(s.status),
      };
    })
    .filter((s) => s.name && s.status);
  return {
    scene: {
      title: str(scene.title),
      location: str(scene.location),
      time: str(scene.time),
      participants: strs(scene.participants),
      keywords: strs(scene.keywords),
      events: str(scene.events),
      outcome: str(scene.outcome),
    },
    state,
    now: {
      location: str(now.location),
      time: str(now.time),
      present: strs(now.present),
      goals: strs(now.goals),
      openThreads: strs(now.open_threads ?? now.openThreads),
    },
  };
}

// ---- turning the record into cards -------------------------------------------------------

const MAX_STATE_CARDS = 8;
const unique = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()).filter(Boolean))];
const bullets = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-*]\s/.test(l) ? l : `- ${l}`))
    .join("\n");

export function buildCardUpdates(
  record: CompactionRecord,
  chapter: { number: number; title: string },
): CardUpdate[] {
  const out: CardUpdate[] = [];
  const { scene, now } = record;

  if (scene.events || scene.outcome) {
    const lines = [
      scene.location && `- **Where:** ${scene.location}`,
      scene.time && `- **When:** ${scene.time}`,
      scene.participants.length && `- **Who:** ${scene.participants.join(", ")}`,
      scene.events && `- **What happened:** ${scene.events}`,
      scene.outcome && `- **Outcome:** ${scene.outcome}`,
      `- **Chapter ${chapter.number}:** ${chapter.title}`,
    ].filter(Boolean);
    out.push({
      id: `scene.ch-${String(chapter.number).padStart(2, "0")}`,
      kind: "scene",
      name: scene.title || chapter.title,
      keywords: unique([...scene.keywords, ...scene.participants, scene.location]),
      summary: scene.outcome || scene.events.split(/(?<=[.!?])\s/)[0] || "",
      body: lines.join("\n"),
      always: false,
    });
  }

  const seen = new Set<string>();
  for (const s of record.state.slice(0, MAX_STATE_CARDS)) {
    const slug = slugify(s.name, 30);
    if (slug === "now" || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      id: `state.${slug}`,
      kind: "state",
      name: `${s.name} (now)`,
      keywords: unique([s.name, ...s.keywords]),
      summary: s.status.split(/\r?\n/)[0] ?? "",
      body: bullets(s.status),
      always: false,
      entity: s.entity,
    });
  }

  const nowLines = [
    now.location && `- **Where:** ${now.location}`,
    now.time && `- **When:** ${now.time}`,
    now.present.length && `- **Present:** ${now.present.join(", ")}`,
    now.goals.length && `- **Goals:** ${now.goals.join("; ")}`,
    now.openThreads.length && `- **Open threads:** ${now.openThreads.join("; ")}`,
  ].filter(Boolean);
  if (nowLines.length) {
    out.push({
      id: "state.now",
      kind: "state",
      name: "Current situation",
      keywords: [],
      summary: now.location,
      body: nowLines.join("\n"),
      always: true,
    });
  }
  return out;
}

// ---- running a compaction ---------------------------------------------------------------

export interface CompactionResult {
  summary: string;
  chapter: { number: number; title: string; text: string };
  cardUpdates: CardUpdate[];
  /** Plain-language notes for the player (for example, card tracking was skipped). */
  warnings: string[];
}

export async function runCompaction(args: {
  provider: Provider;
  model: string;
  state: AdventureState;
  segment: readonly Turn[];
  previousSummary: string;
  liveCards: readonly Card[];
  signal?: AbortSignal | undefined;
}): Promise<CompactionResult> {
  const { provider, model, segment, signal } = args;
  const number = chaptersOf(args.state).length + 1;
  const previousEnding = chaptersOf(args.state).at(-1)?.text.slice(-600) ?? "";
  const call = async (messages: ReturnType<typeof chapterMessages>, params: SamplerParams) =>
    (await generateText(provider, { model, messages, params }, signal)).text;

  // The two steps a chapter cannot do without. If either fails, nothing is committed.
  const summary = await refreshSummary({
    provider,
    model,
    previous: args.previousSummary,
    turns: segment,
    signal,
  });
  if (!summary) throw new HostError("compaction_failed", "The model wrote an empty summary.");

  const written = parseChapter(
    await call(chapterMessages(segment, previousEnding), { temperature: 0.5, maxTokens: 1000 }),
    number,
  );

  // The card record is best effort: one retry, then continue without it.
  const warnings: string[] = [];
  let cardUpdates: CardUpdate[] = [];
  const messages = recordMessages(segment, args.liveCards);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const record = parseRecord(await call(messages, { temperature: 0.2, maxTokens: 900 }));
      cardUpdates = buildCardUpdates(record, { number, title: written.title });
      break;
    } catch (e) {
      if (e instanceof LlmError && e.code === "aborted") throw e;
      if (!(e instanceof HostError || e instanceof LlmError)) throw e;
      if (attempt === 2) {
        warnings.push(
          "The chapter was saved, but the scene and state cards could not be updated this time (the model did not return readable notes). The summary still carries the facts.",
        );
      }
    }
  }

  return { summary, chapter: { number, ...written }, cardUpdates, warnings };
}
