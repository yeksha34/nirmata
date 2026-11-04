import type { AssetKind } from "./asset-kind";
export type JobState = "queued" | "running" | "saving" | "done" | "error" | "cancelled";
export type NodeState = "pending" | "active" | "done" | "cached";
export type StageId = "prepare" | "queue" | "render" | "save";

export interface JobStage {
  id: StageId;
  label: string;
  state: "pending" | "active" | "done" | "error";
}

export interface JobNode {
  id: string;
  title: string;
  state: NodeState;
}

export interface GenerationJob {
  id: string;
  world: string;
  slug: string;
  type: AssetKind;
  name: string;
  state: JobState;
  stages: JobStage[];
  /** The workflow's own steps, in graph order, as ComfyUI reports them. */
  nodes: JobNode[];
  /** Steps inside the node that is running (e.g. sampler step 12 of 22). */
  progress?: { value: number; max: number };
  /** Place in ComfyUI's queue while waiting (1 = next). */
  queuePosition?: number;
  promptId?: string;
  error?: string;
  result?: { assetUrl: string; positivePrompt: string; negativePrompt: string };
  startedAt: number;
  updatedAt: number;
}

const KEEP_FINISHED = 40;

const STAGES: Array<[StageId, string]> = [
  ["prepare", "Prepare prompt and archive previous"],
  ["queue", "Wait in ComfyUI queue"],
  ["render", "Render"],
  ["save", "Download and save"],
];

/** In-memory record of generations. The browser reads it, so a refreshed page shows the same truth. */
export class GenerationJobs {
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly listeners: Array<(job: GenerationJob) => void> = [];
  private readonly aborts = new Map<string, AbortController>();
  private counter = 0;

  create(meta: Pick<GenerationJob, "world" | "slug" | "type" | "name">): {
    job: GenerationJob;
    signal: AbortSignal;
  } {
    const now = Date.now();
    const job: GenerationJob = {
      id: `job-${now.toString(36)}-${++this.counter}`,
      ...meta,
      state: "queued",
      stages: STAGES.map(([id, label], i) => ({
        id,
        label,
        state: i === 0 ? "active" : "pending",
      })),
      nodes: [],
      startedAt: now,
      updatedAt: now,
    };
    const abort = new AbortController();
    this.jobs.set(job.id, job);
    this.aborts.set(job.id, abort);
    this.trim();
    return { job, signal: abort.signal };
  }

  /** Called after every change to a job, with the job as it now is. A listener's failure is its own. */
  subscribe(listener: (job: GenerationJob) => void): void {
    this.listeners.push(listener);
  }

  private changed(job: GenerationJob): void {
    for (const listener of this.listeners) {
      try {
        listener(job);
      } catch {
        // a listener (say, the database mirror) must never break a generation
      }
    }
  }

  get(id: string): GenerationJob | undefined {
    return this.jobs.get(id);
  }

  list(): GenerationJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  patch(id: string, change: Partial<GenerationJob>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, change, { updatedAt: Date.now() });
    this.changed(job);
  }

  /** Move to `stage`: earlier stages become done, later ones stay pending. */
  stage(id: string, stage: StageId): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const at = job.stages.findIndex((s) => s.id === stage);
    job.stages.forEach((s, i) => {
      s.state = i < at ? "done" : i === at ? "active" : "pending";
    });
    job.updatedAt = Date.now();
    this.changed(job);
  }

  /** `node` started: the one running before it is finished. */
  nodeActive(id: string, node: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    for (const n of job.nodes) {
      if (n.state === "active") n.state = "done";
      if (n.id === node) n.state = "active";
    }
    job.progress = undefined;
    job.updatedAt = Date.now();
    this.changed(job);
  }

  nodesCached(id: string, ids: string[]): void {
    const job = this.jobs.get(id);
    if (!job) return;
    for (const n of job.nodes) if (ids.includes(n.id)) n.state = "cached";
    job.updatedAt = Date.now();
    this.changed(job);
  }

  finish(id: string, change: Partial<GenerationJob>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    for (const n of job.nodes) if (n.state === "active") n.state = "done";
    this.patch(id, { ...change, progress: undefined, queuePosition: undefined });
    this.aborts.delete(id);
  }

  fail(id: string, state: "error" | "cancelled", message: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    for (const s of job.stages) if (s.state === "active") s.state = "error";
    this.finish(id, { state, error: message });
  }

  cancel(id: string): boolean {
    const abort = this.aborts.get(id);
    if (!abort) return false;
    abort.abort();
    return true;
  }

  private trim(): void {
    const finished = this.list().filter(
      (j) => j.state === "done" || j.state === "error" || j.state === "cancelled",
    );
    for (const old of finished.slice(KEEP_FINISHED)) this.jobs.delete(old.id);
  }
}
