import { describe, expect, it } from "vitest";
import { baselineNeeds, type ExistingAsset, missingAssets, spriteNames } from "../src/asset-gap";
import { parsePrep } from "../src/character-prep";

const have = (...names: Array<[ExistingAsset["type"], string]>): ExistingAsset[] =>
  names.map(([type, name]) => ({ type, name }));

describe("which states an existing asset already expresses", () => {
  it("finds nothing missing when the exact sprite exists", () => {
    const m = missingAssets(
      [{ type: "sprite", character: "mara", expression: "calm" }],
      have(["sprite", "mara_calm"]),
    );
    expect(m).toEqual([]);
  });

  it("does not count the bare portrait as another expression", () => {
    const m = missingAssets(
      [{ type: "sprite", character: "mara", expression: "angry" }],
      have(["sprite", "mara"], ["sprite", "mara_neutral"]),
    );
    expect(m).toEqual([{ type: "sprite", name: "angry", owner: "mara", asset: "mara_angry" }]);
  });

  it("counts the bare portrait as the neutral look", () => {
    expect(
      missingAssets([{ type: "sprite", character: "mara" }], have(["sprite", "mara"])),
    ).toEqual([]);
    expect(
      missingAssets(
        [{ type: "sprite", character: "mara", expression: "neutral" }],
        have(["sprite", "mara_neutral"]),
      ),
    ).toEqual([]);
  });

  it("asks for an outfit state that no sprite has, and names it <state>_<expression>", () => {
    const m = missingAssets(
      [{ type: "sprite", character: "mara", state: "wet", expression: "calm" }],
      have(["sprite", "mara_calm"]),
    );
    expect(m).toEqual([{ type: "sprite", name: "wet_calm", owner: "mara", asset: "mara_wet_calm" }]);
    expect(spriteNames("mara", "calm", "wet")).toEqual(["mara_wet_calm"]);
  });

  it("checks clothes by their owner, and objects, cgs and backgrounds by name", () => {
    const m = missingAssets(
      [
        { type: "clothes", character: "mara", name: "robe" },
        { type: "adornment", character: "mara", name: "ring" },
        { type: "object", name: "lantern" },
        { type: "bg", name: "quay" },
        { type: "cg", name: "meeting" },
      ],
      have(["clothes", "mara_robe"], ["bg", "quay"]),
    );
    expect(m.map((x) => x.asset)).toEqual(["mara_ring", "lantern", "meeting"]);
  });

  it("matches the kind too: a cg is not a background of the same name", () => {
    expect(missingAssets([{ type: "cg", name: "quay" }], have(["bg", "quay"]))).toHaveLength(1);
  });

  it("lists a missing asset once however often the scenes need it", () => {
    const needs = Array.from({ length: 4 }, () => ({ type: "object" as const, name: "lantern" }));
    expect(missingAssets(needs, [])).toHaveLength(1);
  });

  it("gives the same answer for the same chapter every time", () => {
    const needs = [
      { type: "sprite" as const, character: "mara", expression: "calm" },
      { type: "object" as const, name: "lantern" },
    ];
    expect(missingAssets(needs, [])).toEqual(missingAssets(needs, []));
  });
});

describe("the first assets of a prepared character", () => {
  it("are the unclad base and each item the prep lists, not every expression", () => {
    const prep = parsePrep({
      expressions: [{ expression: "calm" }, { expression: "angry" }],
      outfits: [
        { kind: "clothes", name: "robe" },
        { kind: "adornment", name: "ring" },
      ],
    });
    expect(missingAssets(baselineNeeds("mara", prep), []).map((m) => m.asset)).toEqual([
      "mara_naked",
      "mara_robe",
      "mara_ring",
    ]);
  });
});
