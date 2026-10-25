import { createFakeProvider } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import {
  checkQuestion,
  createLlmJudge,
  HostError,
  judgePrompt,
  parseVerdict,
  rulesToCheck,
} from "../src";
import { loadWorld, ruleCard } from "./helpers";

const must = ruleCard("rule.a", "must", "Is A respected?");
const should = ruleCard("rule.b", "should", "Is B respected?");

describe("rulesToCheck", () => {
  it("selects by severity and drops chapter-only rules", () => {
    const chapterOnly = {
      ...ruleCard("rule.c", "must", "?"),
      fm: { ...must.fm, id: "rule.c", scope: "chapter" as const },
    };
    const all = [should, must, chapterOnly];
    expect(rulesToCheck(all, "must").map((r) => r.fm.id)).toEqual(["rule.a"]);
    expect(rulesToCheck(all, "all").map((r) => r.fm.id)).toEqual(["rule.a", "rule.b"]);
    expect(rulesToCheck(all, "off")).toEqual([]);
  });

  it("finds the shipped example world's story rule", () => {
    const { cards } = loadWorld("example-world");
    expect(rulesToCheck(cards, "all").map((r) => r.fm.id)).toEqual(["rule.host-tone"]);
  });
});

describe("checkQuestion", () => {
  it("uses the Check line, then the summary, then the first paragraph", () => {
    expect(checkQuestion(must)).toBe("Is A respected?");
    const noCheck = { ...must, body: "# R\n\nFirst paragraph.\n\nSecond." };
    expect(checkQuestion({ ...noCheck, fm: { ...must.fm, summary: "From summary" } })).toBe(
      "From summary",
    );
    expect(checkQuestion(noCheck)).toBe("First paragraph.");
  });
});

describe("parseVerdict", () => {
  const rules = [must, should];

  it("reads plain JSON, fenced JSON, and JSON surrounded by chatter", () => {
    const json = '{"violations":[{"rule":"rule.a","reason":"Broke A."}]}';
    const expected = [{ ruleId: "rule.a", name: "rule.a", reason: "Broke A." }];
    expect(parseVerdict(json, rules)).toEqual(expected);
    expect(parseVerdict(`\`\`\`json\n${json}\n\`\`\``, rules)).toEqual(expected);
    expect(parseVerdict(`Sure! Here you go: ${json} Hope that helps.`, rules)).toEqual(expected);
  });

  it("ignores unknown rule ids and duplicates, and fills a missing reason from the check question", () => {
    const raw = JSON.stringify({
      violations: [
        { rule: "rule.zzz", reason: "?" },
        { rule: "rule.b" },
        { rule: "rule.b", reason: "again" },
      ],
    });
    expect(parseVerdict(raw, rules)).toEqual([
      { ruleId: "rule.b", name: "rule.b", reason: "Is B respected?" },
    ]);
  });

  it("accepts an empty list", () => {
    expect(parseVerdict('{"violations":[]}', rules)).toEqual([]);
  });

  it("throws a HostError when the answer is unusable", () => {
    for (const bad of ["no json here", "{not json}", '{"other":1}']) {
      expect(() => parseVerdict(bad, rules)).toThrow(HostError);
    }
  });
});

describe("createLlmJudge", () => {
  it("asks the model about the passage and rules, and returns its verdict", async () => {
    const provider = createFakeProvider({
      chunks: ['```json\n{"violations":[{"rule":"rule.a",', '"reason":"It does."}]}\n```'],
    });
    const judge = createLlmJudge(provider, { model: "judge-model" });
    const out = await judge({ text: "The passage.", rules: [must, should] });

    expect(out).toEqual([{ ruleId: "rule.a", name: "rule.a", reason: "It does." }]);
    const req = provider.requests[0];
    expect(req?.model).toBe("judge-model");
    expect(req?.params).toMatchObject({ temperature: 0, maxTokens: 300 });
    expect(req?.messages[1]?.content).toBe(judgePrompt("The passage.", [must, should]));
    expect(req?.messages[1]?.content).toContain("check: Is A respected?");
  });

  it("skips the model call when there is nothing to check", async () => {
    const provider = createFakeProvider({ chunks: [] });
    expect(await createLlmJudge(provider, { model: "m" })({ text: "x", rules: [] })).toEqual([]);
    expect(provider.requests).toHaveLength(0);
  });
});
