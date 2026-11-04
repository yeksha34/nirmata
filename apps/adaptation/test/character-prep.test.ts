import { describe, expect, it } from "vitest";
import { cardHashOf, type CharacterPrep, parsePrep, PrepError, prepKey, prepStates, resolveCharacter } from "../src/character-prep";

describe("finding a character by part of its name", () => {
  const cards = [
    { name: "Evelyn Hart", id: "character.human-evelyn-hart" },
    { name: "Evelyn Hart (skin)", id: "character.skin-evelyn-hart" },
    { name: "Tina Marsh (skin)", id: "character.skin-tina-marsh" },
    { name: "Howard Thorpe", id: "character.human-howard-thorpe" },
    { name: "Carol Thorpe", id: "character.human-carol-thorpe" },
    { name: "Rani चूषिणी धारपंक", id: "character.deity-fellatia-gushmire" },
    { name: "Rani रगड़ी योनिकूप", id: "character.deity-grissel-cuntswell" },
  ];
  const pick = (q: string) => {
    const r = resolveCharacter(cards, q);
    return r.ok ? r.card.name : r.reason;
  };
  it("takes one word of a name", () => {
    expect(pick("Tina")).toBe("Tina Marsh (skin)");
    expect(pick("marsh")).toBe("Tina Marsh (skin)");
    expect(pick("Grissel")).toBe("Rani रगड़ी योनिकूप");
  });
  it("prefers the card with the shortest name, and an exact name", () => {
    expect(pick("Evelyn")).toBe("Evelyn Hart");
    expect(pick("Evelyn Hart (skin)")).toBe("Evelyn Hart (skin)");
  });
  it("says so when it cannot tell, or finds nothing", () => {
    expect(pick("Thorpe")).toBe("ambiguous");
    expect(pick("Rani")).toBe("ambiguous");
    expect(pick("Nobody")).toBe("none");
  });
});

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

describe("the key a prep is stored under", () => {
  it("has no whitespace, and prepStates finds it by the card's name", () => {
    expect(prepKey("Evelyn Hart")).toBe("Evelyn-Hart");
    expect(prepKey("Tina Marsh (skin)")).toBe("Tina-Marsh-(skin)");
    const prep = { basePositive: "", baseNegative: "", notes: "", cardHash: null, expressions: [], outfits: [] };
    const cards = [{ name: "Evelyn Hart", text: "x" }];
    const [s] = prepStates(cards, new Map([["Evelyn-Hart", { ...prep, cardHash: cardHashOf("x") }]]));
    expect(s?.state).toBe("current");
  });
});
