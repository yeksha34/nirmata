import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VnAssetsManifest } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { addToPlan, AssetPlanError, removeFromPlan } from "../src/asset-plan";
import { Client, HOST_KEY, rig } from "./helpers";

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

describe("planning assets through the server", () => {
  async function setup() {
    const r = await rig([]);
    const c = new Client(r.app);
    expect((await c.join("ignored", { hostKey: HOST_KEY })).status).toBe(201);
    await r.world.scaffoldVn({ slug: "ch01", title: "One", source: "chapters/01.md" });
    const base = "/api/worlds/example-world/vns/ch01";
    const names = async (key: "sprites" | "cgs" | "backgrounds") =>
      ((await c.get(`${base}/assets`)).body[key] as Array<{ name: string }>).map((a) => a.name);
    return { r, c, base, names };
  }

  it("adds an asset that then shows in the list, and removes it with its image", async () => {
    const { r, c, base, names } = await setup();
    const added = await c.post(`${base}/assets`, { type: "cg", name: "harbour_dusk" });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ ok: true, name: "harbour_dusk" });
    expect(await names("cgs")).toContain("harbour_dusk");

    const image = join(r.world.root, "vns", "ch01", "assets", "cgs", "harbour_dusk.png");
    await mkdir(join(image, ".."), { recursive: true });
    await writeFile(image, "x");

    const gone = await c.del(`${base}/assets/cg/harbour_dusk`);
    expect(gone.status).toBe(200);
    expect(await names("cgs")).not.toContain("harbour_dusk");
    await expect(stat(image)).rejects.toThrow();
  });

  it("plans a sprite as a character with an expression", async () => {
    const { c, base, names } = await setup();
    expect(
      (await c.post(`${base}/assets`, { type: "sprite", name: "calm", owner: "mara" })).status,
    ).toBe(201);
    expect(await names("sprites")).toContain("mara_calm");
  });

  it("refuses a repeat, a bad name and an all-assets view", async () => {
    const { c, base } = await setup();
    await c.post(`${base}/assets`, { type: "bg", name: "quay" });
    expect(
      (await c.post(`${base}/assets`, { type: "bg", name: "quay" })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await c.post(`${base}/assets`, { type: "bg", name: "No Good" })).status,
    ).toBeGreaterThanOrEqual(400);
    const all = "/api/worlds/example-world/vns/_all/assets";
    expect((await c.post(all, { type: "bg", name: "quay2" })).status).toBeGreaterThanOrEqual(400);
    expect((await c.del(`${base}/assets/nonsense/quay`)).status).toBe(400);
  });

  it("is for the host only", async () => {
    const { r, base } = await setup();
    const guest = new Client(r.app);
    await guest.join("guest");
    const res = await guest.post(`${base}/assets`, { type: "bg", name: "quay" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await guest.del(`${base}/assets/bg/quay`)).status).toBeGreaterThanOrEqual(400);
  });
});
