import { type Client, Db, type Pool } from "@nirmata/db";
import { GenerationJobs } from "@nirmata/gen";
import type { AssetStore, Stores } from "@nirmata/storage";
import { describe, expect, it } from "vitest";
import { type BeginJob, DbGenerations } from "../src/generation-ledger";

const USER = "22222222-2222-4222-8222-222222222222";
const WORLD = "11111111-1111-4111-8111-111111111111";

function png(marker: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(512, 16);
  head.writeUInt32BE(768, 20);
  return Buffer.concat([head, Buffer.from(marker)]);
}

function fakeDb(
  opts: {
    world?: boolean;
    failOn?: string;
    open?: string[];
    recent?: Array<Record<string, unknown>>;
  } = {},
) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const client: Client = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (opts.failOn && text.includes(opts.failOn)) throw new Error("db says no");
      if (text.includes("from world_lore.worlds"))
        return { rows: opts.world === false ? [] : [{ id: WORLD }] };
      if (text.includes("from assets.assets where")) return { rows: [] };
      if (text.includes("create_asset")) return { rows: [{ id: "asset-1" }] };
      if (text.includes("add_spec")) return { rows: [{ id: "spec-1" }] };
      if (text.includes("request_job")) return { rows: [{ id: "job-db-1" }] };
      if (text.includes("from generation.jobs where not is_terminal"))
        return { rows: (opts.open ?? []).map((id) => ({ id })) };
      if (text.includes("from generation.jobs j")) return { rows: opts.recent ?? [] };
      if (text.includes("from assets.renders where world_id")) return { rows: [] };
      if (text.includes("storage_status")) return { rows: [{ level: "ok", used_pct: "1" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { db: new Db(pool), calls };
}

const store = {
  put: async () => undefined,
  remove: async () => undefined,
  get: async () => undefined,
} as unknown as AssetStore;
const stores = { supabase: store } as Stores;

const begin = (key: string): BeginJob => ({
  key,
  worldName: "sample",
  scope: "ch01",
  type: "sprite",
  name: "ada_neutral",
  positive: "a figure",
  negative: "blur",
  width: 512,
  height: 768,
  steps: 25,
  seed: 7,
});

const settle = () => new Promise((r) => setTimeout(r, 20));
const names = (calls: Array<{ text: string }>) =>
  calls.map((c) => /select (generation|assets)\.(\w+)/.exec(c.text)?.[2]).filter(Boolean);

const meta = { world: "sample", slug: "ch01", type: "sprite", name: "ada_neutral" } as const;

describe("generation jobs in the database", () => {
  it("makes the asset, spec and job once, with the visual novel slug in the key", async () => {
    const f = fakeDb();
    const ledger = new DbGenerations(f.db, stores, () => USER);
    await ledger.begin(begin("job-1"));
    expect(names(f.calls)).toEqual(["create_asset", "add_spec", "request_job"]);
    const request = f.calls.find((c) => c.text.includes("request_job"));
    expect(request?.params).toEqual(["asset-1", "spec-1", "job-1:ch01"]);
  });

  it("follows the tracker: start, stages, nodes, then the render, then finish", async () => {
    const f = fakeDb();
    const ledger = new DbGenerations(f.db, stores, () => USER);
    const jobs = new GenerationJobs();
    ledger.watch(jobs);
    const { job } = jobs.create(meta);
    await ledger.begin(begin(job.id));
    f.calls.length = 0;

    jobs.patch(job.id, { nodes: [{ id: "3", title: "Sampler", state: "pending" }] });
    jobs.stage(job.id, "render");
    jobs.patch(job.id, { promptId: "p1", state: "running" });
    await settle();
    const seen = names(f.calls);
    expect(seen).toContain("start_job");
    expect(seen).toContain("set_stage");
    expect(seen).toContain("set_nodes");

    // the render is recorded against the job, then the job finishes
    await ledger.record({
      worldName: "sample",
      scope: "ch01",
      run: "2026-11-03T10-00-00-000Z",
      jobKey: job.id,
      type: "sprite",
      name: "ada_neutral",
      image: png("a"),
      positive: "a figure",
      negative: "blur",
    });
    jobs.finish(job.id, { state: "done" });
    await settle();
    const order = names(f.calls);
    expect(order.indexOf("record_render")).toBeLessThan(order.indexOf("finish_job"));
    expect(order).not.toContain("create_asset");
    const render = f.calls.find((c) => c.text.includes("record_render"));
    expect(render?.params.slice(0, 2)).toEqual(["asset-1", "spec-1"]);
    expect(render?.params[3]).toBe("job-db-1");
  });

  it("cancels the database job when the generation is cancelled", async () => {
    const f = fakeDb();
    const ledger = new DbGenerations(f.db, stores, () => USER);
    const jobs = new GenerationJobs();
    ledger.watch(jobs);
    const { job } = jobs.create(meta);
    await ledger.begin(begin(job.id));
    jobs.fail(job.id, "cancelled", "cancelled");
    await settle();
    expect(names(f.calls)).toContain("cancel_job");
  });

  it("goes on without a job when the database refuses, and never throws into the generation", async () => {
    const logs: string[] = [];
    const f = fakeDb({ failOn: "request_job" });
    const ledger = new DbGenerations(
      f.db,
      stores,
      () => USER,
      (m) => logs.push(m),
    );
    const jobs = new GenerationJobs();
    ledger.watch(jobs);
    const { job } = jobs.create(meta);
    await expect(ledger.begin(begin(job.id))).resolves.toBeUndefined();
    expect(logs[0]).toContain("not recorded as a job");
    jobs.finish(job.id, { state: "done" });
    await settle();
    expect(names(f.calls)).not.toContain("finish_job");

    const noWorld = fakeDb({ world: false });
    await new DbGenerations(noWorld.db, stores, () => USER).begin(begin("job-2"));
    expect(names(noWorld.calls)).toEqual([]);
    const nobody = fakeDb();
    await new DbGenerations(nobody.db, stores, () => undefined).begin(begin("job-3"));
    expect(nobody.calls).toEqual([]);
  });

  it("closes jobs a stopped server left open, and restores recent ones for the queue", async () => {
    const open = fakeDb({ open: ["a", "b"] });
    expect(await new DbGenerations(open.db, stores, () => USER).failOrphans()).toBe(2);
    expect(open.calls.filter((c) => c.text.includes("finish_job")).map((c) => c.params[0])).toEqual(
      ["a", "b"],
    );

    const recent = fakeDb({
      recent: [
        {
          idempotency_key: "job-old:ch01",
          status_key: "failed",
          error_code: "server_restarted",
          created_at: "2026-11-03T10:00:00Z",
          name: "ada_neutral",
          kind_key: "sprite",
          world: "sample",
          stages: { prepare: "done", queue: "failed" },
        },
        {
          idempotency_key: "job-live:ch01",
          status_key: "running",
          created_at: "2026-11-03T10:01:00Z",
          name: "x",
          kind_key: "cg",
          world: "sample",
          stages: {},
        },
      ],
    });
    const ledger = new DbGenerations(recent.db, stores, () => USER);
    const got = await ledger.recent(new Set(["job-live"]));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: "job-old",
      world: "sample",
      slug: "ch01",
      type: "sprite",
      name: "ada_neutral",
      state: "error",
      error: "The server restarted before this finished.",
    });
    expect(got[0]?.stages.map((s) => s.state)).toEqual(["done", "error", "pending", "pending"]);
  });
});
