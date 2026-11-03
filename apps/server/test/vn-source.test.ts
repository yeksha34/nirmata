import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VnParts, VnRecord, VnSource } from "@nirmata/adaptation";
import { afterEach, describe, expect, it } from "vitest";
import { WorldFiles } from "../src/files";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-vnsrc-"));
  dirs.push(root);
  writeFileSync(
    join(root, "world.json"),
    JSON.stringify({ name: "Sample World", title: "Sample" }),
  );
  return root;
}

/** The visual novels of one world in the database, kept in memory. `null` is a world that is not there. */
function memory(inDatabase = true) {
  const rows = new Map<string, VnRecord>();
  const source: VnSource = {
    list: async () =>
      inDatabase
        ? [...rows.values()].map((r) => ({
            slug: r.slug,
            manifest: r.manifest,
            adaptationMd: "",
            slideCount: r.slides ? (r.slides as { slides: unknown[] }).slides.length : undefined,
          }))
        : undefined,
    get: async (_w, slug) => rows.get(slug),
    save: async (_w, slug, parts: VnParts) => {
      if (!inDatabase) return false;
      const had = rows.get(slug);
      rows.set(slug, {
        slug,
        manifest: (parts.manifest ?? had?.manifest ?? {}) as Record<string, unknown>,
        adaptationMd: parts.adaptationMd ?? had?.adaptationMd ?? "",
        slides: parts.slides ?? had?.slides,
      });
      return true;
    },
  };
  return { rows, source };
}

const scaffold = { slug: "chapter-1", title: "Chapter 1", source: "chapters/1.md" };

describe("a world's visual novels in the database (ADR-0035)", () => {
  it("scaffolds into the database and writes no files", async () => {
    const m = memory();
    const root = folder();
    const world = new WorldFiles(root, undefined, undefined, m.source);
    const made = await world.scaffoldVn(scaffold);
    expect(made.slug).toBe("chapter-1");
    expect(m.rows.get("chapter-1")?.adaptationMd).toContain("Chapter 1");
    expect(existsSync(join(root, "vns"))).toBe(false);
    await expect(world.scaffoldVn(scaffold)).rejects.toThrow(/already exists/);
  });

  it("lists, reads, saves and compiles from the database", async () => {
    const m = memory();
    const world = new WorldFiles(folder(), undefined, undefined, m.source);
    await world.scaffoldVn(scaffold);
    await world.scaffoldVn({ ...scaffold, slug: "chapter-2", title: "Chapter 2" });

    const list = await world.vns();
    expect(list.map((v) => v.slug)).toEqual(["chapter-1", "chapter-2"]);
    expect(list[0]?.nextSlug).toBe("chapter-2");

    const one = await world.vn("chapter-1");
    expect(one.manifest.title).toBe("Chapter 1");
    expect(one.manifest.nextSlug).toBe("chapter-2");

    await world.saveVn("chapter-1", { adaptationMd: `${one.adaptationMd}\n` });
    const compiled = await world.compileVn("chapter-1");
    expect(compiled.slides.slides.length).toBeGreaterThan(0);
    expect(m.rows.get("chapter-1")?.slides).toEqual(compiled.slides);
    await expect(world.vn("nope")).rejects.toThrow(/no visual novel/);
  });

  it("uses the folder when the world is not in the database", async () => {
    const m = memory(false);
    const root = folder();
    const world = new WorldFiles(root, undefined, undefined, m.source);
    await world.scaffoldVn(scaffold);
    expect(existsSync(join(root, "vns", "chapter-1", "manifest.json"))).toBe(true);
    expect(m.rows.size).toBe(0);
    expect((await world.vns()).map((v) => v.slug)).toEqual(["chapter-1"]);
    mkdirSync(join(root, "vns", "_shared"), { recursive: true });
  });
});
