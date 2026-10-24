import { describe, expect, it } from "vitest";
import { buildMatcher, normalize } from "../src";

const m = buildMatcher([
  { cardId: "lore.fog", keywords: ["fog", "mist"] },
  { cardId: "char.marrow", keywords: ["Marrow", "lighthouse keeper"] },
  { cardId: "place.light", keywords: ["fourth light", "light"] },
]);
const ids = (text: string) => m.scan(text).map((h) => `${h.cardId}:${h.keyword}`);

describe("normalize", () => {
  it("folds case, accents, quotes and whitespace", () => {
    expect(normalize("  Marrów’s   FOG ")).toBe("marrow's fog");
  });
});

describe("buildMatcher", () => {
  it("matches on word boundaries only", () => {
    expect(ids("A fogbound quay")).toEqual([]);
    expect(ids("The fog rolls in")).toEqual(["lore.fog:fog"]);
    expect(ids("fog.")).toEqual(["lore.fog:fog"]);
  });

  it("ignores case and accents", () => {
    expect(ids("MARRÓW waves")).toEqual(["char.marrow:Marrow"]);
  });

  it("matches multi-word keywords across irregular whitespace", () => {
    expect(ids("the lighthouse   keeper nods")).toEqual(["char.marrow:lighthouse keeper"]);
  });

  it("reports overlapping and nested keywords", () => {
    expect(ids("the fourth light")).toEqual(["place.light:fourth light", "place.light:light"]);
  });

  it("lets several cards share one keyword", () => {
    const shared = buildMatcher([
      { cardId: "a.one", keywords: ["tide"] },
      { cardId: "b.two", keywords: ["tide"] },
    ]);
    expect(shared.scan("high tide").map((h) => h.cardId)).toEqual(["a.one", "b.two"]);
  });

  it("returns hits in a stable order with their offsets", () => {
    const hits = m.scan("fog then mist then fog");
    expect(hits.map((h) => [h.keyword, h.index])).toEqual([
      ["fog", 0],
      ["mist", 9],
      ["fog", 19],
    ]);
    expect(m.scan("fog then mist then fog")).toEqual(hits);
  });

  it("copes with no keywords and empty text", () => {
    expect(buildMatcher([]).scan("anything")).toEqual([]);
    expect(buildMatcher([{ cardId: "a.b", keywords: ["", "   "] }]).scan("x")).toEqual([]);
    expect(m.scan("")).toEqual([]);
  });
});
