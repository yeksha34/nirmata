import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, Db, type Pool } from "@nirmata/db";
import type { AssetStore } from "@nirmata/storage";
import { afterEach, describe, expect, it } from "vitest";
import { type ImportOptions, importDataset, kindOf, pngSize, scanDataset } from "../src";

const WORLD = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A PNG header with the given size, then a marker so different files hash differently. */
function png(width: number, height: number, marker: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from(marker)]);
}

function dataset(files: Record<string, { image: Buffer; prompt?: object }>): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-ds-"));
  dirs.push(root);
  for (const [rel, f] of Object.entries(files)) {
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "generated_image.png"), f.image);
    writeFileSync(
      join(dir, "prompt.json"),
      JSON.stringify(f.prompt ?? { positive: "a figure", negative: "blur" }),
    );
  }
  return root;
}

interface Script {
  level?: string;
  knownHashes?: Set<string>;
  failRecord?: boolean;
}
function fakeDb(script: Script = {}) {
  const log: Array<{ text: string; params: unknown[] | undefined }> = [];
  let assets = 0;
  const client: Client = {
    async query(text, params) {
      log.push({ text, params });
      if (text.includes("from assets.renders where world_id")) {
        return { rows: script.knownHashes?.has(String(params?.[1])) ? [{ one: 1 }] : [] };
      }
      if (text.includes("storage_status")) {
        return { rows: [{ level: script.level ?? "ok", used_pct: "50.00" }] };
      }
      if (text.includes("from assets.assets where")) return { rows: [] };
      if (text.includes("create_asset")) return { rows: [{ id: `asset-${++assets}` }] };
      if (text.includes("add_spec")) return { rows: [{ id: "spec" }] };
      if (text.includes("record_render")) {
        if (script.failRecord) throw new Error("record refused");
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { db: new Db(pool), log };
}

function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const store: AssetStore = {
    get: async (p) =>
      files.has(p) ? { data: files.get(p) as Uint8Array, contentType: undefined } : undefined,
    put: async (p, d) => void files.set(p, d),
    remove: async (p) => void files.delete(p),
  };
  return { store, files };
}

const set = {
  "scope/hero/2026-11-01T10-00-00-000Z": { image: png(512, 768, "old") },
  "scope/hero/2026-11-02T10-00-00-000Z": { image: png(512, 768, "new") },
  "scope/cg_scene/2026-11-02T10-00-00-000Z": { image: png(1024, 576, "cg") },
};
const base = (extra: Pick<ImportOptions, "db" | "stores" | "datasetDir"> & Partial<ImportOptions>): ImportOptions => ({
  worldId: WORLD,
  userId: USER,
  target: "supabase",
  ...extra,
});

describe("scanDataset", () => {
  it("takes the newest attempt per name, or all of them", () => {
    const dir = dataset(set);
    const latest = scanDataset(dir, WORLD, "latest").candidates;
    expect(latest.map((c) => `${c.name}/${c.run.slice(0, 10)}`).sort()).toEqual([
      "cg_scene/2026-11-02",
      "hero/2026-11-02",
    ]);
    expect(scanDataset(dir, WORLD, "all").candidates).toHaveLength(3);
  });

  it("reads size, kind and prompt, and skips names a stored file cannot have", () => {
    const dir = dataset({
      ...set,
      "scope/bad name/2026-11-02T10-00-00-000Z": { image: png(512, 512, "x") },
    });
    const { candidates, skipped } = scanDataset(dir, WORLD);
    const cg = candidates.find((c) => c.name === "cg_scene");
    expect(cg).toMatchObject({ kind: "cg", width: 1024, height: 576, positive: "a figure", negative: "blur" });
    expect(cg?.path).toBe(`${WORLD}/scope/cg_scene/2026-11-02T10-00-00-000Z.png`);
    expect(skipped).toHaveLength(1);
  });

  it("helpers", () => {
    expect(kindOf("cg_x")).toBe("cg");
    expect(kindOf("bg_x")).toBe("bg");
    expect(kindOf("tina")).toBe("sprite");
    expect(pngSize(png(300, 400, ""))).toEqual({ width: 300, height: 400 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe("importDataset", () => {
  it("uploads each file, then records the asset, spec and render", async () => {
    const { db, log } = fakeDb();
    const { store, files } = memoryStore();
    const r = await importDataset(base({ db, stores: { supabase: store }, datasetDir: dataset(set) }));
    expect(r).toMatchObject({ found: 2, uploaded: 2, duplicates: 0, failed: 0, byKind: { sprite: 1, cg: 1, bg: 0 } });
    expect([...files.keys()].sort()).toEqual([
      `${WORLD}/scope/cg_scene/2026-11-02T10-00-00-000Z.png`,
      `${WORLD}/scope/hero/2026-11-02T10-00-00-000Z.png`,
    ]);
    const rec = log.filter((l) => l.text.includes("record_render"));
    expect(rec).toHaveLength(2);
    expect(rec[0]?.params?.[3]).toBeNull(); // an import has no job
    expect(rec[0]?.params?.[4]).toBe("supabase");
    expect(log.some((l) => l.text.includes("storage_status(0, true)"))).toBe(true);
    expect(log.some((l) => l.text === "set local role authenticated")).toBe(true);
  });

  it("skips content the world already has", async () => {
    const dir = dataset(set);
    const known = new Set(scanDataset(dir, WORLD).candidates.map((c) => c.sha256));
    const { db } = fakeDb({ knownHashes: known });
    const { store, files } = memoryStore();
    const r = await importDataset(base({ db, stores: { supabase: store }, datasetDir: dir }));
    expect(r).toMatchObject({ uploaded: 0, duplicates: 2 });
    expect(files.size).toBe(0);
  });

  it("stops when the quota says block", async () => {
    const { db } = fakeDb({ level: "block" });
    const { store, files } = memoryStore();
    const r = await importDataset(base({ db, stores: { supabase: store }, datasetDir: dataset(set) }));
    expect(r).toMatchObject({ uploaded: 0, blocked: 2 });
    expect(files.size).toBe(0);
  });

  it("a dry run writes nothing", async () => {
    const { db, log } = fakeDb();
    const { store, files } = memoryStore();
    const r = await importDataset(
      base({ db, stores: { supabase: store }, datasetDir: dataset(set), dryRun: true }),
    );
    expect(r.uploaded).toBe(2);
    expect(files.size).toBe(0);
    expect(log.some((l) => l.text.includes("record_render") || l.text.includes("create_asset"))).toBe(false);
  });

  it("removes the file it uploaded when the record fails, and reports it", async () => {
    const { db } = fakeDb({ failRecord: true });
    const { store, files } = memoryStore();
    const r = await importDataset(base({ db, stores: { supabase: store }, datasetDir: dataset(set) }));
    expect(r).toMatchObject({ uploaded: 0, failed: 2 });
    expect(r.failures[0]).toContain("record refused");
    expect(files.size).toBe(0);
  });

  it("refuses to run without the chosen store, and the local target skips the quota", async () => {
    const { db, log } = fakeDb();
    await expect(importDataset(base({ db, stores: {}, datasetDir: dataset(set) }))).rejects.toThrow(/not set up/);
    const { store } = memoryStore();
    const r = await importDataset({
      ...base({ db, stores: { local: store }, datasetDir: dataset(set) }),
      target: "local",
    });
    expect(r.uploaded).toBe(2);
    expect(log.some((l) => l.text.includes("storage_status"))).toBe(false);
  });
});
