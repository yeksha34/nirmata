import { describe, expect, it } from "vitest";
import { assetDir, assetSize, composeLinkedPrompt, isAssetKind, isLinkedKind, kindOf, parseLinkedCard, synthesizeLinkedPrompt, templateName } from "../src";

describe("asset kinds", () => {
  it("maps kinds to folders, templates and canvases", () => {
    expect(assetDir("clothes")).toBe("clothes");
    expect(assetDir("adornment")).toBe("adornments");
    expect(templateName("bg")).toBe("background");
    expect(templateName("object")).toBe("object");
    expect(assetSize("sprite")).toEqual({ width: 512, height: 768 });
    expect(assetSize("object")).toEqual({ width: 768, height: 768 });
    expect(assetSize("cg")).toEqual({ width: 1024, height: 576 });
  });

  it("knows the character-linked kinds", () => {
    expect(isAssetKind("object")).toBe(true);
    expect(isAssetKind("music")).toBe(false);
    expect(isLinkedKind("sprite")).toBe(false);
    expect(isLinkedKind("adornment")).toBe(true);
  });

  it("names dataset entries by prefix and builds a generic prompt", () => {
    expect(kindOf("clothes_ana_uniform")).toBe("clothes");
    expect(kindOf("object_cup")).toBe("object");
    expect(synthesizeLinkedPrompt("object", "skull_cup", "ana")).toContain("skull cup for ana");
  });
});

describe("linked card prompts", () => {
  const card = `<card id="x" kind="adornment" name="A_ring" owner="char.a" type="pierced">
  <appearance>a thick ring of dull gold</appearance>
  <material>gold</material>
  <frames>left ear</frames>
  <prompt>thick dull gold hoop, heavy, hammered surface</prompt>
</card>`;

  it("reads the parts of a card", () => {
    expect(parseLinkedCard(card)).toMatchObject({ type: "pierced", material: "gold", frames: "left ear" });
  });

  it("describes the item from the card instead of naming it", () => {
    const text = composeLinkedPrompt("adornment", "A_ring", parseLinkedCard(card));
    expect(text).toContain("thick dull gold hoop, heavy, hammered surface");
    expect(text).toContain("worn on left ear");
    expect(text).toContain("no person");
  });

  it("falls back to the name when there is no card", () => {
    expect(composeLinkedPrompt("object", "brass_lamp", {}, "ana")).toContain("brass lamp for ana");
  });
});
