import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanSource, StudioRow } from "@nirmata/adaptation";
import { afterEach, describe, expect, it } from "vitest";
import { WorldFiles } from "../src/files";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-plansrc-"));
  dirs.push(root);
  writeFileSync(
    join(root, "world.json"),
    JSON.stringify({ name: "Sample World", title: "Sample" }),
  );
  return root;
}

/** The asset plan of one world in the database, kept in memory. */
function memory(inDatabase = true) {
  const rows: StudioRow[] = [];
  const source: PlanSource = {
    list: async () => (inDatabase ? rows : undefined),
    add: async (_w, _vn, type, input) => {
      if (!inDatabase) return undefined;
      const name = type === "sprite" ? `${input.owner}_${input.name}` : input.name;
      rows.push({ type, name, shared: false, owners: input.owner ? [input.owner] : [], cgs: [] });
      return { name };
    },
    remove: async (_w, _vn, type, name) => {
      if (!inDatabase) return false;
      const i = rows.findIndex((r) => r.type === type && r.name === name);
      if (i >= 0) rows.splice(i, 1);
      return true;
    },
  };
  return { rows, source };
}

const world = (plan: PlanSource) => new WorldFiles(folder(), undefined, undefined, undefined, plan);

describe("a world's asset plan in the database (ADR-0035)", () => {
  it("lists the planned assets by kind, with owners, links and the image the database holds", async () => {
    const m = memory();
    m.rows.push(
      { type: "sprite", name: "Mara_calm", shared: true, owners: [], cgs: [] },
      { type: "clothes", name: "Mara_robe", shared: true, owners: ["Mara"], cgs: [] },
      { type: "object", name: "lamp", shared: false, owners: ["Mara"], cgs: ["quay_night"] },
      { type: "cg", name: "quay_night", shared: false, owners: [], cgs: [], renderId: "r1" },
      { type: "bg", name: "quay", shared: true, owners: [], cgs: [], prompt: "a quay at dusk" },
    );
    const list = await world(m.source).listVnAssets("_shared", { prompts: false });

    expect(list.sprites.map((s) => s.name)).toContain("Mara_calm");
    expect(list.sprites.find((s) => s.name === "Mara_calm")?.isShared).toBe(true);
    expect(list.clothes[0]).toMatchObject({ name: "Mara_robe", lockedTo: ["Mara"] });
    expect(list.objects[0]).toMatchObject({
      name: "lamp",
      lockedTo: ["Mara"],
      linkedCgs: ["quay_night"],
    });
    const cg = list.cgs.find((c) => c.name === "quay_night");
    expect(cg).toMatchObject({ exists: true, url: "/api/assets/renders/r1/file" });
    expect(list.backgrounds.find((b) => b.name === "quay")).toMatchObject({
      exists: false,
      defaultPrompt: "a quay at dusk",
    });
  });

  it("plans and unplans an asset in the database, and writes no manifest", async () => {
    const m = memory();
    const w = world(m.source);
    expect(await w.addVnAsset("chapter-1", "bg", { name: "harbor" })).toEqual({
      ok: true,
      name: "harbor",
    });
    expect(m.rows.map((r) => r.name)).toEqual(["harbor"]);
    expect(await w.removeVnAsset("chapter-1", "bg", "harbor")).toMatchObject({ ok: true });
    expect(m.rows).toEqual([]);
  });

  it("refuses to plan in the shared pool or in all, as before", async () => {
    const w = world(memory().source);
    await expect(w.addVnAsset("_shared", "bg", { name: "x" })).rejects.toThrow(/one visual novel/);
  });

  it("falls back to the manifest when the world is not in the database", async () => {
    const m = memory(false);
    const root = folder();
    const w = new WorldFiles(root, undefined, undefined, undefined, m.source);
    await w.scaffoldVn({ slug: "chapter-1", title: "Chapter 1", source: "chapters/1.md" });
    await w.addVnAsset("chapter-1", "bg", { name: "harbor" });
    expect(m.rows).toEqual([]);
    const list = await w.listVnAssets("chapter-1", { prompts: false });
    expect(list.backgrounds.map((b) => b.name)).toContain("harbor");
  });
});
