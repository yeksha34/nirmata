import { describe, expect, it } from "vitest";
import { type PrepCharacter, spritePromptFromPrep } from "../src/prep-sprite-prompt";

const chars: PrepCharacter[] = [
  {
    name: "Tina-Marsh-(skin)",
    notes: "asset-id: tina",
    basePositive: "1girl, adult woman, small high breasts",
    expressions: [
      { expression: "neutral", tags: "polite smile" },
      { expression: "flustered", tags: "blushing, lip bitten" },
    ],
    outfits: [
      { kind: "clothes", name: "day-office-outfit", tags: "navy pleated skirt, blue blouse" },
      { kind: "clothes", name: "office-slut-uniform", tags: "sheer white crop top, black mini skirt" },
    ],
  },
  {
    name: "Rani-चूषिणी-धारपंक",
    notes: "asset-id: chushini",
    basePositive: "1girl, pale skin, red eyes",
    expressions: [{ expression: "in_pain", tags: "wincing" }, { expression: "neutral", tags: "half-lidded" }],
    outfits: [],
  },
];

describe("a sprite prompt written from the character prep", () => {
  it("joins the base look, the state's outfit and the expression", () => {
    const p = spritePromptFromPrep("tina_office_flustered", chars) ?? "";
    expect(p).toBe("masterpiece, best quality, 1girl, adult woman, small high breasts, navy pleated skirt, blue blouse, blushing, lip bitten");
    expect(spritePromptFromPrep("tina_uniform", chars)).toContain("sheer white crop top");
    expect(spritePromptFromPrep("tina_uniform", chars)).toContain("polite smile");
  });
  it("finds a character by its asset-id note, and an expression with an underscore", () => {
    expect(spritePromptFromPrep("chushini_in_pain", chars)).toContain("wincing");
    expect(spritePromptFromPrep("chushini_neutral", chars)).toContain("red eyes");
  });
  it("answers nothing for a character without prep", () => {
    expect(spritePromptFromPrep("nobody_neutral", chars)).toBeUndefined();
  });
});
