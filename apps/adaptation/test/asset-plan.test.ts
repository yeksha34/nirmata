import type { VnAssetsManifest } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { addToPlan, AssetPlanError, removeFromPlan } from "../src/asset-plan";
const empty = (): VnAssetsManifest => ({ backgrounds: [], characters: {}, cgs: [] });

describe("planning assets in a manifest", () => {
  it("adds each kind under the name the Studio lists", () => {
    let a = empty();
    const add = (type: Parameters<typeof addToPlan>[1], name: string, owner?: string) => {
      const r = addToPlan(a, type, { name, owner });
      a = r.assets;
      return r.name;
    };
    expect(add("sprite", "happy", "ada")).toBe("ada_happy");
    expect(add("sprite", "sad", "ada")).toBe("ada_sad");
    expect(add("cg", "harbour_dusk")).toBe("harbour_dusk");
    expect(add("bg", "quay")).toBe("quay");
    expect(add("clothes", "coat", "ada")).toBe("ada_coat");
    expect(add("adornment", "ring", "ada")).toBe("ada_ring");
    expect(add("object", "lantern", "ada")).toBe("lantern");
    expect(a.characters).toEqual({ ada: ["happy", "sad"] });
    expect(a.clothes).toEqual({ ada: ["coat"] });
    expect(a.adornments).toEqual({ ada: ["ring"] });
    expect(a.objects).toEqual([{ name: "lantern", owners: ["ada"] }]);
  });

  it("does not change the plan it was given", () => {
    const before = empty();
    addToPlan(before, "cg", { name: "one" });
    expect(before.cgs).toEqual([]);
  });

  it("refuses a bad name, a missing character and a repeat", () => {
    expect(() => addToPlan(empty(), "cg", { name: "Has Space" })).toThrow(AssetPlanError);
    expect(() => addToPlan(empty(), "cg", { name: "../x" })).toThrow(AssetPlanError);
    expect(() => addToPlan(empty(), "sprite", { name: "happy" })).toThrow(/which character/);
    expect(() => addToPlan(empty(), "clothes", { name: "coat", owner: "  " })).toThrow(
      /which character/,
    );
    const once = addToPlan(empty(), "bg", { name: "quay" }).assets;
    expect(() => addToPlan(once, "bg", { name: "quay" })).toThrow(/already planned/);
  });

  it("takes an asset out, and a character with no expressions left", () => {
    const planned = addToPlan(
      addToPlan(empty(), "sprite", { name: "happy", owner: "ada" }).assets,
      "sprite",
      { name: "sad", owner: "ada" },
    ).assets;
    const one = removeFromPlan(planned, "sprite", "ada_happy");
    expect(one).toMatchObject({ removed: true, assets: { characters: { ada: ["sad"] } } });
    const none = removeFromPlan(one.assets, "sprite", "ada_sad");
    expect(none.assets.characters).toEqual({});
    expect(removeFromPlan(none.assets, "sprite", "ada_sad").removed).toBe(false);
  });

  it("removes an object by its name", () => {
    const withObject = addToPlan(empty(), "object", { name: "lantern" }).assets;
    expect(removeFromPlan(withObject, "object", "lantern")).toMatchObject({
      removed: true,
      assets: { objects: [] },
    });
  });
});
