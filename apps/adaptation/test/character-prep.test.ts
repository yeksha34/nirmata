import { describe, expect, it } from "vitest";
import { cardHashOf, type CharacterPrep, parsePrep, PrepError, prepStates } from "../src/character-prep";

describe("a character's prep", () => {
  it("keeps what is asked for and trims it", () => {
    const p = parsePrep({
      basePositive: "  tall, dark hair ",
      expressions: [{ expression: "calm", tags: "soft eyes" }],
      outfits: [{ kind: "clothes", name: "robe", tags: "grey" }],
    });
    expect(p.basePositive).toBe("tall, dark hair");
    expect(p.baseNegative).toBe("");
    expect(p.expressions).toEqual([{ expression: "calm", tags: "soft eyes" }]);
    expect(p.outfits).toEqual([{ kind: "clothes", name: "robe", tags: "grey" }]);
    expect(p.cardHash).toBeNull();
  });

  it("refuses what the asset names cannot hold", () => {
    expect(() => parsePrep({ expressions: [{ expression: "Very Angry" }] })).toThrow(PrepError);
    expect(() => parsePrep({ outfits: [{ kind: "weapon", name: "x" }] })).toThrow(PrepError);
    expect(() => parsePrep({ outfits: [{ kind: "clothes", name: "../x" }] })).toThrow(PrepError);
    expect(() => parsePrep("nope")).toThrow(PrepError);
    expect(() => parsePrep({ notes: 5 })).toThrow(PrepError);
  });

  it("refuses a name listed twice", () => {
    expect(() =>
      parsePrep({ expressions: [{ expression: "calm" }, { expression: "calm" }] }),
    ).toThrow(/twice/);
  });

  it("is current, stale or missing against the card as it is now", () => {
    const card = { name: "Mara", text: "Mara is tall." };
    const made: CharacterPrep = {
      ...parsePrep({}),
      cardHash: cardHashOf(card.text),
    };
    const stored = new Map([["Mara", made]]);
    expect(prepStates([card], stored)[0]?.state).toBe("current");
    expect(prepStates([{ ...card, text: "Mara is short." }], stored)[0]?.state).toBe("stale");
    expect(prepStates([{ name: "Ada", text: "x" }], stored)[0]?.state).toBe("none");
  });
});
