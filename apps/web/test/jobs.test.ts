import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { jobForAsset, jobsActions, makeJobsStore } from "../src/jobs/store";
import type { GenerationJob } from "../src/types";

const job = (over: Partial<GenerationJob> = {}): GenerationJob => ({
  id: "j1",
  world: "w",
  slug: "s",
  type: "sprite",
  name: "a",
  state: "running",
  stages: [],
  nodes: [],
  startedAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generation jobs store", () => {
  it("rebuilds a running job after a refresh and follows it until it ends", async () => {
    vi.spyOn(api, "vnJobs").mockResolvedValue([job()]);
    const polls = [
      job({
        nodes: [{ id: "1", title: "Sample", state: "active" }],
        progress: { value: 3, max: 22 },
      }),
      job({ state: "done" }),
    ];
    const vnJob = vi
      .spyOn(api, "vnJob")
      .mockImplementation(async () => polls.shift() ?? job({ state: "done" }));

    const store = makeJobsStore(); // a fresh page: nothing known yet
    store.dispatch(jobsActions.hydrate());
    await vi.advanceTimersByTimeAsync(10);
    // the hydrated job is followed at once: its first poll already carries node progress
    expect(store.getState().byId.j1?.progress).toEqual({ value: 3, max: 22 });
    expect(store.getState().byId.j1?.state).toBe("running");

    await vi.advanceTimersByTimeAsync(1100);
    expect(store.getState().byId.j1?.state).toBe("done");

    const calls = vnJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vnJob.mock.calls.length).toBe(calls); // stopped following once it ended
  });

  it("does not follow a job twice when hydrated while it is already followed", async () => {
    vi.spyOn(api, "vnJobs").mockResolvedValue([job()]);
    const vnJob = vi.spyOn(api, "vnJob").mockResolvedValue(job());
    const store = makeJobsStore();
    store.dispatch(jobsActions.hydrate());
    store.dispatch(jobsActions.hydrate());
    await vi.advanceTimersByTimeAsync(10);
    const first = vnJob.mock.calls.length;
    expect(first).toBe(1);
  });

  it("starts a generation and follows the job the server returns", async () => {
    vi.spyOn(api, "generateVnAsset").mockResolvedValue(job({ id: "j2", state: "queued" }));
    vi.spyOn(api, "vnJob").mockResolvedValue(job({ id: "j2", state: "done" }));
    const store = makeJobsStore();
    store.dispatch(jobsActions.start("w", "s", { type: "sprite", name: "a", positivePrompt: "x" }));
    expect(store.getState().starting).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().starting).toBe(false);
    expect(store.getState().byId.j2?.state).toBe("done");
  });

  it("shows a start that never reached the server", async () => {
    vi.spyOn(api, "generateVnAsset").mockRejectedValue(new Error("ComfyUI is offline"));
    const store = makeJobsStore();
    store.dispatch(jobsActions.start("w", "s", { type: "sprite", name: "a", positivePrompt: "x" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().startError).toBe("ComfyUI is offline");
    expect(store.getState().starting).toBe(false);
  });

  it("picks the newest job for an asset", () => {
    const store = makeJobsStore();
    store.dispatch({ type: "jobs/upsert", job: job({ id: "old", state: "done", startedAt: 1 }) });
    store.dispatch({ type: "jobs/upsert", job: job({ id: "new", startedAt: 5 }) });
    store.dispatch({ type: "jobs/upsert", job: job({ id: "other", name: "b", startedAt: 9 }) });
    expect(jobForAsset(store.getState(), "w", "sprite", "a")?.id).toBe("new");
    expect(jobForAsset(store.getState(), "w", "cg", "a")).toBeUndefined();
  });
});

describe("the queue panel's cleared jobs", () => {
  it("stay cleared when the server lists them again", () => {
    const store = makeJobsStore();
    store.dispatch({ type: "jobs/upsert", job: job({ id: "gone", state: "done" }) });
    store.dispatch(jobsActions.forget("gone"));
    store.dispatch({ type: "jobs/upsert", job: job({ id: "gone", state: "done" }) });
    expect(store.getState().byId.gone).toBeUndefined();
  });
});
