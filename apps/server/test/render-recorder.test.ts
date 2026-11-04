import { createHash } from "node:crypto";
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
  opts: {
    world?: boolean;
    level?: string;
    known?: boolean;
    failRecord?: boolean;
    /** The asset's other renders still in Supabase. */
    older?: Array<{ id: string; storage_path: string; sha256: string | null }>;
    /** Shared with the stores, to check what happens in which order. */
    events?: string[];
  } = {},
) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const client: Client = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (text.includes("set_render_store")) opts.events?.push(`row ${String(params[0])} local`);
      if (text.includes("storage_path, sha256 from assets.renders"))
        return { rows: opts.older ?? [] };
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
    // what is not known stays unknown: no made-up cfg, sampler or scheduler
    expect(spec?.params).toEqual([
      "asset-1",
      "a figure",
      "blur",
      7,
      25,
      null,
      null,
      null,
      512,
      768,
      "{}",
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

  it("keeps what the run used in the spec, and takes the sampler values from it", async () => {
    const f = fakeDb();
    const settings = {
      version: 1 as const,
      seed: 99,
      steps: 30,
      cfg: 5.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      checkpoint: "base.safetensors",
      loras: [],
      references: [{ name: "naked", sha256: "abc" }],
      workflow: { "3": { class_type: "KSampler", inputs: {} } },
    };
    await new DbRecorder(f.db, { supabase: fakeStore().store } as Stores, () => USER).record(
      image({ steps: undefined, seed: undefined, runSettings: settings }),
    );
    const params = f.calls.find((c) => c.text.includes("add_spec"))?.params ?? [];
    expect(params.slice(3, 8)).toEqual([99, 30, 5.5, "dpmpp_2m", "karras"]);
    expect(JSON.parse(String(params[10]))).toEqual(settings);
  });
});

/** An in-memory store that logs what it is asked to do, in the order it happens. */
function memStore(name: string, events: string[], files: Record<string, Buffer> = {}, bad = false) {
  const map = new Map<string, Uint8Array>(
    Object.entries(files).map(([k, v]) => [k, new Uint8Array(v)]),
  );
  const store = {
    put: async (path: string, data: Uint8Array) => {
      events.push(`${name} put ${path}`);
      map.set(path, bad ? new Uint8Array([1, 2, 3]) : data);
    },
    remove: async (path: string) => {
      events.push(`${name} remove ${path}`);
      map.delete(path);
    },
    get: async (path: string) => {
      const data = map.get(path);
      return data ? { data, contentType: "image/png" } : undefined;
    },
  } as unknown as AssetStore;
  return { store, map };
}

describe("keeping only the current image in Supabase", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const OLD = `${WORLD}/ch01/ada_neutral/2026-11-02T10-00-00-000Z.png`;
  const row = (over: Partial<{ sha256: string | null }> = {}) => ({
    id: "render-old",
    storage_path: OLD,
    sha256: sha(png("old")),
    ...over,
  });

  it("copies the older image to the local store, checks it, records it, then frees Supabase", async () => {
    const events: string[] = [];
    const supabase = memStore("supabase", events, { [OLD]: png("old") });
    const local = memStore("local", events);
    const f = fakeDb({ older: [row()], events });
    const where = await new DbRecorder(
      f.db,
      { supabase: supabase.store, local: local.store } as Stores,
      () => USER,
    ).record(image());
    expect(where).toBe("supabase");
    const mine = `${WORLD}/ch01/ada_neutral/2026-11-03T10-00-00-000Z.png`;
    expect(events).toEqual([
      `supabase put ${mine}`, // the new image is up first
      `local put ${OLD}`,
      "row render-old local",
      `supabase remove ${OLD}`,
    ]);
    expect(local.map.get(OLD)).toEqual(new Uint8Array(png("old")));
  });

  it("leaves an older image alone when it does not match its hash, has none, or cannot be copied", async () => {
    for (const [older, bad] of [
      [row({ sha256: sha(png("different")) }), false],
      [row({ sha256: null }), false],
      [row(), true],
    ] as const) {
      const events: string[] = [];
      const supabase = memStore("supabase", events, { [OLD]: png("old") });
      const local = memStore("local", events, {}, bad);
      const f = fakeDb({ older: [older], events });
      await new DbRecorder(
        f.db,
        { supabase: supabase.store, local: local.store } as Stores,
        () => USER,
        () => undefined,
      ).record(image());
      expect(events.filter((e) => e.startsWith("row") || e.includes("remove"))).toEqual([]);
      expect(supabase.map.has(OLD)).toBe(true);
    }
  });

  it("moves nothing when there is no local store", async () => {
    const f = fakeDb({ older: [row()] });
    await new DbRecorder(f.db, { supabase: fakeStore().store } as Stores, () => USER).record(
      image(),
    );
    expect(f.calls.some((c) => c.text.includes("storage_path, sha256"))).toBe(false);
  });

  it("does not fail the generation when the move fails", async () => {
    const events: string[] = [];
    const logs: string[] = [];
    const supabase = memStore("supabase", events, { [OLD]: png("old") });
    const local = {
      put: async () => {
        throw new Error("disk full");
      },
      get: async () => undefined,
      remove: async () => undefined,
    } as unknown as AssetStore;
    const f = fakeDb({ older: [row()], events });
    const where = await new DbRecorder(
      f.db,
      { supabase: supabase.store, local } as Stores,
      () => USER,
      (m) => logs.push(m),
    ).record(image());
    expect(where).toBe("supabase");
    expect(logs.join(" ")).toContain("disk full");
    expect(supabase.map.has(OLD)).toBe(true);
  });
});
