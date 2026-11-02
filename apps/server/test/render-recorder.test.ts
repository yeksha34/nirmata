import { type Client, Db, type Pool } from "@nirmata/db";
import type { AssetStore, Stores } from "@nirmata/storage";
import { describe, expect, it } from "vitest";
import { DbRecorder, type GeneratedImage } from "../src/render-recorder";

const USER = "22222222-2222-4222-8222-222222222222";
const WORLD = "11111111-1111-4111-8111-111111111111";

/** A PNG header 512 x 768, then a marker. */
function png(marker: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(512, 16);
  head.writeUInt32BE(768, 20);
  return Buffer.concat([head, Buffer.from(marker)]);
}

const image = (over: Partial<GeneratedImage> = {}): GeneratedImage => ({
  worldName: "sample",
  scope: "ch01",
  run: "2026-11-03T10-00-00-000Z",
  type: "sprite",
  name: "ada_neutral",
  image: png("a"),
  positive: "a figure",
  negative: "blur",
  steps: 25,
  seed: 7,
  ...over,
});

function fakeDb(
  opts: { world?: boolean; level?: string; known?: boolean; failRecord?: boolean } = {},
) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const client: Client = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (text.includes("from world_lore.worlds"))
        return { rows: opts.world === false ? [] : [{ id: WORLD }] };
      if (text.includes("from assets.renders where world_id"))
        return { rows: opts.known ? [{ one: 1 }] : [] };
      if (text.includes("storage_status"))
        return { rows: [{ level: opts.level ?? "ok", used_pct: "50" }] };
      if (text.includes("from assets.assets where")) return { rows: [] };
      if (text.includes("create_asset")) return { rows: [{ id: "asset-1" }] };
      if (text.includes("add_spec")) return { rows: [{ id: "spec-1" }] };
      if (text.includes("record_render")) {
        if (opts.failRecord) throw new Error("record refused");
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { db: new Db(pool), calls };
}

function fakeStore() {
  const put: string[] = [];
  const removed: string[] = [];
  const store = {
    put: async (path: string) => void put.push(path),
    remove: async (path: string) => void removed.push(path),
    get: async () => undefined,
  } as unknown as AssetStore;
  return { store, put, removed };
}

describe("recording a new generation", () => {
  it("uploads the image and records its asset, spec and render for an imported world", async () => {
    const f = fakeDb();
    const s = fakeStore();
    const where = await new DbRecorder(f.db, { supabase: s.store } as Stores, () => USER).record(
      image(),
    );
    expect(where).toBe("supabase");
    expect(s.put).toEqual([`${WORLD}/ch01/ada_neutral/2026-11-03T10-00-00-000Z.png`]);
    const spec = f.calls.find((c) => c.text.includes("add_spec"));
    expect(spec?.params).toEqual([
      "asset-1",
      "a figure",
      "blur",
      7,
      25,
      7,
      "euler",
      "normal",
      512,
      768,
    ]);
    const render = f.calls.find((c) => c.text.includes("record_render"));
    expect(render?.params.slice(2, 6)).toEqual([
      `${WORLD}/ch01/ada_neutral/2026-11-03T10-00-00-000Z.png`,
      null, // no job
      "supabase",
      png("a").byteLength,
    ]);
  });

  it("uses the local store when the quota is full, and nothing when there is none", async () => {
    const supabase = fakeStore();
    const local = fakeStore();
    const full = fakeDb({ level: "block" });
    expect(
      await new DbRecorder(
        full.db,
        { supabase: supabase.store, local: local.store } as Stores,
        () => USER,
      ).record(image()),
    ).toBe("local");
    expect(supabase.put).toEqual([]);
    expect(local.put).toHaveLength(1);

    const noneLeft = fakeDb({ level: "block" });
    expect(
      await new DbRecorder(
        noneLeft.db,
        { supabase: fakeStore().store } as Stores,
        () => USER,
      ).record(image()),
    ).toBeUndefined();
  });

  it("does nothing when nobody is signed in, the world is not imported, or the image is known", async () => {
    const s = fakeStore();
    const stores = { supabase: s.store } as Stores;
    expect(
      await new DbRecorder(fakeDb().db, stores, () => undefined).record(image()),
    ).toBeUndefined();
    expect(
      await new DbRecorder(fakeDb({ world: false }).db, stores, () => USER).record(image()),
    ).toBeUndefined();
    expect(
      await new DbRecorder(fakeDb({ known: true }).db, stores, () => USER).record(image()),
    ).toBeUndefined();
    expect(s.put).toEqual([]);
  });

  it("removes the uploaded file when the database refuses the record", async () => {
    const s = fakeStore();
    const rec = new DbRecorder(
      fakeDb({ failRecord: true }).db,
      { supabase: s.store } as Stores,
      () => USER,
    );
    await expect(rec.record(image())).rejects.toThrow("record refused");
    expect(s.removed).toEqual(s.put);
  });
});
