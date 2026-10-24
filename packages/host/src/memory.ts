import type { Turn } from "@nirmata/core";
import { generateText, type Provider, type SamplerParams } from "@nirmata/llm";

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
