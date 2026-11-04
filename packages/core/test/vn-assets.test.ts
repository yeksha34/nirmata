import { describe, expect, it } from "vitest";
import { checkAssetLinks, VnAssetsManifestSchema } from "../src/vn";

describe("asset links", () => {
  it("locks clothes and adornments to an owner, except the unclad base", () => {
    const issues = checkAssetLinks({
      clothes: [{ name: "uniform" }, { name: "naked" }, { name: "ana_naked" }],
      adornments: [{ name: "collar", type: "worn", owner: "Ana" }, { name: "ring", type: "pierced" }],
    });
    expect(issues.map((i) => i.name)).toEqual(["uniform", "ring"]);
  });

  it("requires objects to link and explain their interaction", () => {
    const issues = checkAssetLinks({
      objects: [
        { name: "cup", type: "held", owners: ["Ana"], interaction: "drinks", whyCustom: "unique" },
        { name: "orphan", type: "held", interaction: "", whyCustom: "" },
      ],
    });
    expect(issues).toHaveLength(3);
  });

  it("keeps the new manifest fields optional", () => {
    expect(VnAssetsManifestSchema.safeParse({ backgrounds: [], characters: {}, cgs: [] }).success).toBe(true);
  });
});
