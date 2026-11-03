import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileVn, createStarterAdaptationMd, createStarterManifest } from "@nirmata/core";
import { type Client, Db, type Pool } from "@nirmata/db";
import { afterEach, describe, expect, it } from "vitest";
import { importWorldVns } from "../src/vn-import";

const USER = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const manifest = createStarterManifest({ slug: "chapter-1", title: "Chapter 1", source: "chapters/1.md" });
const adaptationMd = createStarterAdaptationMd({ slug: "chapter-1", title: "Chapter 1", source: "chapters/1.md" });
const { deck } = compileVn(adaptationMd, { manifest });

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-vns-"));
  dirs.push(root);
  const dir = join(root, "vns", "chapter-1");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "vns", "_shared", "assets"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "adaptation.md"), adaptationMd);
  writeFileSync(join(dir, "slides.json"), JSON.stringify(deck));
  mkdirSync(join(root, "vns", "Bad_Name"), { recursive: true });
  writeFileSync(join(root, "vns", "Bad_Name", "manifest.json"), JSON.stringify(manifest));
  return root;
}

/** A tiny database that remembers the visual novels it was given. */
function fakeDb(options: { unpublished?: boolean } = {}) {
  const stored = new Map<string, Record<string, unknown>>();
  const client: Client = {
    async query(text: string, params: unknown[] = []) {
      if (text.includes("from world_lore.worlds where slug")) return { rows: [{ id: "w1" }] };
      if (text.includes("from vn_content.vns v join vn_content.vn_drafts")) {
        const had = stored.get(String(params[1]));
        return { rows: had ? [{ manifest: had.manifest, adaptation_md: had.md, slides: had.slides }] : [] };
      }
      if (text.includes("vn_content.save_vn")) {
        if (options.unpublished) {
          throw Object.assign(new Error("publish the world before adapting it"), { code: "23514" });
        }
        stored.set(String(params[1]), {
          manifest: JSON.parse(String(params[4])),
          md: params[5],
          slides: params[6] ? JSON.parse(String(params[6])) : null,
          tier: params[3],
        });
        return { rows: [{ save_vn: "v1" }] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as Client;
  const pool: Pool = { connect: async () => client as never, end: async () => undefined };
  return { db: new Db(pool), stored };
}

describe("importing a world's visual novels", () => {
  it("copies the manifest, script and slides, and skips what cannot be used", async () => {
    const f = fakeDb();
    const r = await importWorldVns({ db: f.db, folder: folder(), userId: USER, slug: "sample" });
    expect(r).toMatchObject({ found: 2, added: 1, updated: 0, unchanged: 0, conflicts: [] });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain("Bad_Name");
    const got = f.stored.get("chapter-1");
    expect(got?.md).toBe(adaptationMd);
    expect(got?.slides).toEqual(JSON.parse(JSON.stringify(deck)));
    expect(got?.tier).toBe("short"); // the starter manifest is a short one
  });

  it("leaves an unchanged visual novel alone, and keeps one edited in the database", async () => {
    const f = fakeDb();
    const root = folder();
    await importWorldVns({ db: f.db, folder: root, userId: USER, slug: "sample" });
    const again = await importWorldVns({ db: f.db, folder: root, userId: USER, slug: "sample" });
    expect(again).toMatchObject({ added: 0, unchanged: 1, conflicts: [] });

    const edited = f.stored.get("chapter-1");
    if (edited) edited.md = "edited in the app";
    const kept = await importWorldVns({ db: f.db, folder: root, userId: USER, slug: "sample" });
    expect(kept.conflicts).toEqual(["chapter-1"]);
    expect(f.stored.get("chapter-1")?.md).toBe("edited in the app");

    const forced = await importWorldVns({ db: f.db, folder: root, userId: USER, slug: "sample", force: true });
    expect(forced.updated).toBe(1);
    expect(f.stored.get("chapter-1")?.md).toBe(adaptationMd);
  });

  it("writes nothing on a dry run", async () => {
    const f = fakeDb();
    const r = await importWorldVns({ db: f.db, folder: folder(), userId: USER, slug: "sample", dryRun: true });
    expect(r.added).toBe(1);
    expect(f.stored.size).toBe(0);
  });

  it("says so when the world is not published yet", async () => {
    const f = fakeDb({ unpublished: true });
    const r = await importWorldVns({ db: f.db, folder: folder(), userId: USER, slug: "sample" });
    expect(r.added).toBe(0);
    expect(r.skipped.join(" ")).toContain("publish the world");
  });

  it("finds nothing in a world with no vns folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "nirmata-novns-"));
    dirs.push(root);
    const r = await importWorldVns({ db: fakeDb().db, folder: root, userId: USER, slug: "sample" });
    expect(r.found).toBe(0);
  });
});
