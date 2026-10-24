import { type AdventureState, pathTo, type Turn } from "@nirmata/core";
import { generateText, type Provider, type SamplerParams } from "@nirmata/llm";

/** How many of the most recent exchanges a summary refresh reads, at most. */
const SUMMARY_WINDOW = 24;

/** Player turns on the current branch since the last summary (or since the start). */
export function playerTurnsSinceSummary(state: AdventureState): number {
  let count = 0;
  for (const ev of pathTo(state)) {
    if (ev.kind === "summary") count = 0;
    else if (ev.kind === "player") count++;
  }
  return count;
}

/** Turns written after the last summary on the current branch, capped to a recent window. */
export function turnsSinceSummary(state: AdventureState): Turn[] {
  const turns: Turn[] = [];
  for (const ev of pathTo(state)) {
    if (ev.kind === "summary") turns.length = 0;
    else if (ev.kind === "player")
      turns.push({ id: ev.id, role: "player", mode: ev.mode, text: ev.text });
    else if (ev.kind === "host") turns.push({ id: ev.id, role: "host", text: ev.text });
  }
  return turns.slice(-SUMMARY_WINDOW);
}

const SUMMARY_SYSTEM = [
  "You maintain the running memory of an interactive story.",
  "Update the summary so it stays accurate and short: under 150 words, past tense, plain facts.",
  "Keep names, places, promises made, items held, relationships, and unresolved threads. Drop atmosphere and repeated detail.",
  "Return only the updated summary, with no heading or commentary.",
].join("\n");

export function summaryMessages(previous: string, turns: readonly Turn[]) {
  const log = turns
    .map((t) => `${t.role === "player" ? "Player" : "Host"}: ${t.text}`)
    .join("\n\n");
  return [
    { role: "system" as const, content: SUMMARY_SYSTEM },
    {
      role: "user" as const,
      content: `<previous_summary>\n${previous || "(none yet)"}\n</previous_summary>\n<new_events>\n${log}\n</new_events>`,
    },
  ];
}

export async function refreshSummary(args: {
  provider: Provider;
  model: string;
  previous: string;
  turns: readonly Turn[];
  params?: SamplerParams;
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const { text } = await generateText(
    args.provider,
    {
      model: args.model,
      messages: summaryMessages(args.previous, args.turns),
      params: { temperature: 0.3, maxTokens: 300, ...args.params },
    },
    args.signal,
  );
  return text.trim();
}
