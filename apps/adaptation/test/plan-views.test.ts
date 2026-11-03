import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { PlanStore, PlanViews } from "../src";

const USER = "22222222-2222-4222-8222-222222222222";

/** A tiny database: one world, its non-retired assets as the list view gives them. */
function fakeDb(inDatabase = true) {
  const rows = [
    { asset_id: "a1", vn_id: null, vn_slug: null, kind_key: "bg", name: "quay", current_render_id: null, link_characters: [], link_cgs: [], positive: null },
    { asset_id: "a2", vn_id: "v1", vn_slug: "chapter-1", kind_key: "cg", name: "night", current_render_id: "r1", link_characters: [], link_cgs: [], positive: "a night quay" },
    { asset_id: "a3", vn_id: "v1", vn_slug: "chapter-1", kind_key: "object", name: "lamp", current_render_id: null, link_characters: ["Mara"], link_cgs: ["a2"], positive: null },
    { asset_id: "a4", vn_id: "v2", vn_slug: "chapter-2", kind_key: "cg", name: "dawn", current_render_id: null, link_characters: [], link_cgs: [], positive: null },
  ];
  const pool: Pool = {
    connect: async () => ({
      query: async (text: string) => {
        if (text.includes("from world_lore.worlds where slug"))
          return { rows: inDatabase ? [{ id: "w1" }] : [] };
        if (text.includes("from assets.v_asset_list l")) return { rows };
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  } as unknown as Pool;
  const db = new Db(pool);
  return new PlanViews(db, new PlanStore(db));
}

describe("the plan as the Studio lists it", () => {
  it("gives a visual novel its own assets and the shared pool", async () => {
    const rows = await fakeDb().list(USER, "sample", "chapter-1");
    expect(rows?.map((r) => r.name)).toEqual(["quay", "night", "lamp"]);
    expect(rows?.find((r) => r.name === "quay")?.shared).toBe(true);
  });

  it("gives the shared pool alone for _shared", async () => {
    const rows = await fakeDb().list(USER, "sample", "_shared");
    expect(rows?.map((r) => r.name)).toEqual(["quay"]);
  });

  it("carries owners, linked CG names, the image and the prompt", async () => {
    const rows = await fakeDb().list(USER, "sample", "chapter-1");
    expect(rows?.find((r) => r.name === "lamp")).toMatchObject({ owners: ["Mara"], cgs: ["night"] });
    expect(rows?.find((r) => r.name === "night")).toMatchObject({
      renderId: "r1",
      prompt: "a night quay",
    });
  });

  it("says nothing for a world that is not in the database", async () => {
    expect(await fakeDb(false).list(USER, "sample", "chapter-1")).toBeUndefined();
  });
});
