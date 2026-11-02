import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyUiClient } from "../src/comfyui";
import { GenerationJobs } from "../src/generation-jobs";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const queueWith = (running: string[], pending: string[]) => ({
  queue_running: running.map((id) => [0, id, {}]),
  queue_pending: pending.map((id) => [1, id, {}]),
});

const doneHistory = (id: string) => ({
  [id]: {
    status: { status_str: "success", completed: true },
    outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } },
  },
});

afterEach(() => vi.restoreAllMocks());

describe("ComfyUiClient.waitForCompletion", () => {
  it("follows the prompt from queue to running to done, with no overall time limit", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);
    const seen: string[] = [];
    // many polls, far more than a fixed cap would allow at this interval
    const script: Array<() => Response> = [
      ...Array.from({ length: 5 }, () => () => json(queueWith([], ["p1"]))),
      ...Array.from({ length: 40 }, () => () => json(queueWith(["p1"], []))),
    ];
    let polls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/queue")) {
        const step = script[polls++];
        return step ? step() : json(queueWith([], []));
      }
      return json(doneHistory("p1"));
    });

    const result = await client.waitForCompletion("p1", {
      pollIntervalMs: 1,
      onEvent: (e) => {
        if (e.kind === "location") seen.push(e.where);
      },
    });
    expect(result.outputImages[0]?.filename).toBe("a.png");
    expect(seen[0]).toBe("pending");
    expect(seen).toContain("running");
    expect(polls).toBeGreaterThan(40);
  });

  it("reports ComfyUI's own failure", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/queue")
        ? json(queueWith([], []))
        : json({ p1: { status: { status_str: "error", completed: false, messages: ["boom"] } } }),
    );
    await expect(client.waitForCompletion("p1", { pollIntervalMs: 1 })).rejects.toMatchObject({
      code: "generation_failed",
    });
  });

  it("gives up when the prompt has vanished from queue and history", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/queue") ? json(queueWith([], [])) : json({}),
    );
    await expect(
      client.waitForCompletion("p1", { pollIntervalMs: 1, missingPolls: 3 }),
    ).rejects.toMatchObject({
      code: "comfyui_lost",
    });
  });

  it("gives up only after ComfyUI stays unreachable past lostMs", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("refused"));
    await expect(
      client.waitForCompletion("p1", { pollIntervalMs: 1, lostMs: 20 }),
    ).rejects.toMatchObject({
      code: "comfyui_offline",
    });
  });

  it("stops when cancelled", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(queueWith(["p1"], [])));
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 10);
    await expect(
      client.waitForCompletion("p1", { pollIntervalMs: 2, signal: abort.signal }),
    ).rejects.toMatchObject({
      code: "cancelled",
    });
  });
});

describe("GenerationJobs", () => {
  it("tracks stages and workflow nodes, and keeps the record after it ends", () => {
    const jobs = new GenerationJobs();
    const { job } = jobs.create({ world: "w", slug: "s", type: "sprite", name: "a" });
    jobs.patch(job.id, {
      nodes: [
        { id: "1", title: "Load", state: "pending" },
        { id: "2", title: "Sample", state: "pending" },
        { id: "3", title: "Save", state: "pending" },
      ],
    });
    jobs.stage(job.id, "render");
    jobs.nodesCached(job.id, ["1"]);
    jobs.nodeActive(job.id, "2");
    jobs.patch(job.id, { progress: { value: 5, max: 22 } });
    expect(jobs.get(job.id)?.nodes.map((n) => n.state)).toEqual(["cached", "active", "pending"]);
    expect(jobs.get(job.id)?.stages.map((s) => s.state)).toEqual([
      "done",
      "done",
      "active",
      "pending",
    ]);

    jobs.nodeActive(job.id, "3");
    expect(jobs.get(job.id)?.nodes.map((n) => n.state)).toEqual(["cached", "done", "active"]);
    expect(jobs.get(job.id)?.progress).toBeUndefined();

    jobs.fail(job.id, "error", "nope");
    const after = jobs.get(job.id);
    expect(after?.state).toBe("error");
    expect(after?.error).toBe("nope");
    expect(jobs.list()).toHaveLength(1);
  });

  it("cancel aborts only a running job", () => {
    const jobs = new GenerationJobs();
    const { job, signal } = jobs.create({ world: "w", slug: "s", type: "cg", name: "b" });
    expect(jobs.cancel(job.id)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(jobs.cancel("missing")).toBe(false);
  });
});
