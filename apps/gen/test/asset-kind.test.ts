import { describe, expect, it } from "vitest";
import { assetDir, assetSize, isAssetKind, isLinkedKind, kindOf, synthesizeLinkedPrompt, templateName } from "../src";

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
    expect(synthesizeLinkedPrompt("object", "skull_cup", "ana")).toContain("skull cup, for ana");
  });
});
