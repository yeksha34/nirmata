import { type Card, cardBody } from "@nirmata/core";
import { generateText, type Provider, type SamplerParams } from "@nirmata/llm";
import { extractJson } from "./json";
import { HostError, type RuleJudge, type Violation } from "./types";

/** Rule cards that apply to a play session, filtered to the severity being checked. */
export function rulesToCheck(cards: readonly Card[], mode: "off" | "must" | "all"): Card[] {
  if (mode === "off") return [];
  return cards
    .filter(
      (c) =>
        c.fm.kind === "rule" &&
        c.fm.scope !== "chapter" &&
        (mode === "all" || c.fm.severity === "must"),
    )
    .sort((a, b) => (a.fm.id < b.fm.id ? -1 : 1));
}

/** The yes/no question a judge answers, taken from the card's `**Check:**` line. */
export function checkQuestion(rule: Card): string {
  const text = cardBody(rule);
  const m = /\*\*Check:\*\*\s*(.+)/.exec(text);
  if (m?.[1]) return m[1].trim();
  return rule.fm.summary || text.split(/\n\s*\n/)[0]?.trim() || rule.fm.name;
}

const JUDGE_SYSTEM = [
  "You are a strict continuity editor for an interactive story.",
  "You are given a passage and a list of rules, each with a yes/no check question.",
  "A rule is violated when the honest answer to its check question shows the passage breaks it.",
  "Judge only what is written in the passage. Do not invent violations; when unsure, the rule is not violated.",
  'Answer with JSON only, in this exact shape: {"violations":[{"rule":"<rule id>","reason":"<one short sentence>"}]}',
  'If nothing is violated answer {"violations":[]}.',
].join("\n");

export function judgePrompt(text: string, rules: readonly Card[]): string {
  const list = rules
    .map((r) => `- id: ${r.fm.id}\n  name: ${r.fm.name}\n  check: ${checkQuestion(r)}`)
    .join("\n");
  return `<passage>\n${text}\n</passage>\n<rules>\n${list}\n</rules>`;
}

/**
 * Reads a judge's answer. Tolerates code fences and chatter around the JSON, ignores rule ids it
 * was not asked about, and throws a HostError when there is no usable JSON at all.
 */
export function parseVerdict(raw: string, rules: readonly Card[]): Violation[] {
  const parsed = extractJson(raw, "The rule checker", "judge_failed");
  const list = (parsed as { violations?: unknown })?.violations;
  if (!Array.isArray(list)) {
    throw new HostError("judge_failed", 'The rule checker answer had no "violations" list.');
  }
  const byId = new Map(rules.map((r) => [r.fm.id, r] as const));
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = (item as { rule?: unknown })?.rule;
    const rule = typeof id === "string" ? byId.get(id) : undefined;
    if (!rule || seen.has(rule.fm.id)) continue;
    seen.add(rule.fm.id);
    const reason = (item as { reason?: unknown }).reason;
    out.push({
      ruleId: rule.fm.id,
      name: rule.fm.name,
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : checkQuestion(rule),
    });
  }
  return out;
}

/** A judge that asks a model. Use a cheap, fast one; it runs after every reply. */
export function createLlmJudge(
  provider: Provider,
  options: { model: string; params?: SamplerParams },
): RuleJudge {
  return async ({ text, rules, signal }) => {
    if (!rules.length) return [];
    const { text: raw } = await generateText(
      provider,
      {
        model: options.model,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: judgePrompt(text, rules) },
        ],
        params: { temperature: 0, maxTokens: 300, ...options.params },
      },
      signal,
    );
    return parseVerdict(raw, rules);
  };
}
