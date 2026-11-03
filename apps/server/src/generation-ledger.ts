import { addSpec, type AssetKind, ensureAsset, type GenerationJob, type GenerationJobs } from "@nirmata/gen";
import { slugFor } from "./lore-rows";
import { DbRecorder, type RenderRecorder } from "./render-recorder";

/** What the ledger needs to know when a generation's prompt is final and it is about to be queued. */
export interface BeginJob {
  /** The in-memory job's id. */
  key: string;
  worldName: string;
  /** The visual novel's slug (or `_shared`). Kept so a restored job can still be opened. */
  scope: string;
  type: AssetKind;
  name: string;
  positive: string;
  negative: string;
  width: number;
  height: number;
  steps?: number | undefined;
  cfg?: number | undefined;
  sampler?: string | undefined;
  scheduler?: string | undefined;
  seed?: number | undefined;
  /** Clothes, adornments and objects: the characters and CG names the asset is locked or linked to. */
  links?: { characters: string[]; cgs: string[] } | undefined;
}

/** Keeps generation jobs in the database as well as in memory, and keeps a new render linked to its job. */
export interface GenerationLedger extends RenderRecorder {
  /** Makes the database job (asset, spec, job). Never throws: without a job the generation goes on. */
  begin(job: BeginJob): Promise<void>;
  /** Follows every change to the in-memory jobs and writes it behind, in order, per job. */
  watch(jobs: GenerationJobs): void;
  /** Recent jobs of the signed-in host that are not in memory (after a restart), as the screens show them. */
  recent(known: ReadonlySet<string>): Promise<GenerationJob[]>;
  /** Closes jobs a stopped server left open. Returns how many. */
  failOrphans(): Promise<number>;
}

interface Entry {
  jobId: string;
  assetId: string;
  specId: string;
  user: string;
  started: boolean;
  state: string;
  stages: Map<string, string>;
  nodes: Map<string, string>;
  queue: number | undefined;
  /** Writes for one job run one after another. */
  chain: Promise<void>;
}

const STAGE_STATE: Record<string, string> = {
  pending: "pending",
  active: "active",
  done: "done",
  error: "failed",
};

const STATE_OF_STATUS: Record<string, GenerationJob["state"]> = {
  queued: "queued",
  running: "running",
  succeeded: "done",
  failed: "error",
  cancelled: "cancelled",
};

const STAGES: Array<[string, string]> = [
  ["prepare", "Prepare prompt and archive previous"],
  ["queue", "Wait in ComfyUI queue"],
  ["render", "Render"],
  ["save", "Download and save"],
];

/**
 * The database side of generation jobs (migration 011). The in-memory tracker stays the live truth the
 * screens read; this writes each change behind it (stage, node, start, finish, cancel), so a restart
 * does not lose the history. A write that fails is logged and nothing else: a generation never waits
 * for, or fails because of, the database.
 */
export class DbGenerations extends DbRecorder implements GenerationLedger {
  private readonly entries = new Map<string, Entry>();

  protected override existing(jobKey: string | undefined) {
    const e = jobKey ? this.entries.get(jobKey) : undefined;
    return e ? { assetId: e.assetId, specId: e.specId, jobId: e.jobId } : undefined;
  }

  async begin(job: BeginJob): Promise<void> {
    try {
      const user = this.userId();
      if (!user) return;
      const made = await this.db.asUser(user, async (q) => {
        const world = (
          await q("select id from world_lore.worlds where slug = $1", [slugFor(job.worldName)])
        ).rows[0]?.id;
        if (!world) return undefined; // the world is not in the database
        const assetId = await ensureAsset(q, String(world), job.type, job.name);
        const specId = await addSpec(q, assetId, job);
        if (job.links && (job.links.characters.length > 0 || job.links.cgs.length > 0)) {
          // a lock the database refuses must not stop the generation, so it is only logged
          try {
            const cgIds: string[] = [];
            for (const cg of job.links.cgs) cgIds.push(await ensureAsset(q, String(world), "cg", cg));
            await q("select assets.set_links($1, $2, $3)", [assetId, job.links.characters, cgIds]);
          } catch (err) {
            console.warn("asset links not recorded:", err instanceof Error ? err.message : err);
          }
        }
        // the key carries the visual novel's slug, which the job row has no column for
        const key = `${job.key}:${job.scope}`;
        const jobId = (
          await q("select generation.request_job($1, $2, $3) as id", [assetId, specId, key])
        ).rows[0]?.id;
        return { assetId, specId, jobId: String(jobId) };
      });
      if (!made) return;
      this.entries.set(job.key, {
        ...made,
        user,
        started: false,
        state: "queued",
        stages: new Map(),
        nodes: new Map(),
        queue: undefined,
        chain: Promise.resolve(),
      });
    } catch (e) {
      this.log(
        `This generation is not recorded as a job: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  watch(jobs: GenerationJobs): void {
    jobs.subscribe((job) => this.sync(job));
  }

  /** Queues the database writes this change needs, after the ones before it for the same job. */
  private sync(job: GenerationJob): void {
    const entry = this.entries.get(job.id);
    if (!entry) return;
    const snapshot = {
      state: job.state,
      promptId: job.promptId,
      stages: job.stages.map((s) => [s.id, s.state] as const),
      nodes: job.nodes.map((n) => ({ id: n.id, title: n.title, state: n.state })),
      queue: job.queuePosition,
      error: job.error,
    };
    entry.chain = entry.chain
      .then(() => this.write(entry, snapshot))
      .catch((e) =>
        this.log(
          `A generation job could not be written to the database: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }

  private async write(
    entry: Entry,
    s: {
      state: string;
      promptId: string | undefined;
      stages: ReadonlyArray<readonly [string, string]>;
      nodes: Array<{ id: string; title: string; state: string }>;
      queue: number | undefined;
      error: string | undefined;
    },
  ): Promise<void> {
    const finished = s.state === "done" || s.state === "error" || s.state === "cancelled";
    if (s.state === "cancelled") {
      await this.db.asUser(entry.user, (q) => q("select generation.cancel_job($1)", [entry.jobId]));
      return this.forget(entry);
    }
    const running = s.state === "running" || s.state === "saving" || finished;
    await this.db.server(async (q) => {
      if (running && !entry.started) {
        await q("select generation.start_job($1, $2)", [entry.jobId, s.promptId ?? null]);
        entry.started = true;
      }
      for (const [id, state] of s.stages) {
        const mapped = STAGE_STATE[state] ?? "pending";
        if (entry.stages.get(id) !== mapped) {
          await q("select generation.set_stage($1, $2, $3)", [entry.jobId, id, mapped]);
          entry.stages.set(id, mapped);
        }
      }
      const changed = s.nodes.some((n) => entry.nodes.get(n.id) !== n.state);
      if (changed && s.nodes.length > 0) {
        await q("select generation.set_nodes($1, $2::jsonb)", [
          entry.jobId,
          JSON.stringify(
            s.nodes.slice(0, 200).map((n) => ({ ...n, title: n.title.slice(0, 120) })),
          ),
        ]);
        for (const n of s.nodes) entry.nodes.set(n.id, n.state);
      }
      if (s.state === "queued" && s.queue !== undefined && s.queue !== entry.queue) {
        await q("select generation.set_queue_position($1, $2)", [entry.jobId, s.queue]);
        entry.queue = s.queue;
      }
      if (s.state === "done") await q("select generation.finish_job($1, true)", [entry.jobId]);
      if (s.state === "error")
        await q("select generation.finish_job($1, false, 'generation_failed')", [entry.jobId]);
    });
    if (finished) this.forget(entry);
  }

  private forget(entry: Entry): void {
    for (const [key, e] of this.entries) if (e === entry) this.entries.delete(key);
  }

  async recent(known: ReadonlySet<string>): Promise<GenerationJob[]> {
    const user = this.userId();
    if (!user) return [];
    try {
      const rows = await this.db.asUser(
        user,
        async (q) =>
          (
            await q(
              `select j.idempotency_key, j.status_key, j.comfy_prompt_id, j.error_code, j.created_at,
                    a.name, a.kind_key, w.slug as world,
                    (select jsonb_object_agg(st.stage_key, st.state_key) from generation.job_stages st where st.job_id = j.id) as stages
               from generation.jobs j
               join assets.assets a on a.id = j.asset_id
               join world_lore.worlds w on w.id = j.world_id
              where j.requested_by = $1
              order by j.created_at desc limit 40`,
              [user],
            )
          ).rows,
      );
      const out: GenerationJob[] = [];
      for (const r of rows) {
        const [id = "", ...rest] = String(r.idempotency_key).split(":");
        if (!id || known.has(id)) continue;
        const stages = (r.stages ?? {}) as Record<string, string>;
        const created = new Date(String(r.created_at)).getTime();
        const state = STATE_OF_STATUS[String(r.status_key)] ?? "error";
        out.push({
          id,
          world: String(r.world),
          slug: rest.join(":") || "_shared",
          type: String(r.kind_key) as GenerationJob["type"],
          name: String(r.name),
          state,
          stages: STAGES.map(([sid, label]) => ({
            id: sid as GenerationJob["stages"][number]["id"],
            label,
            state: (stages[sid] === "failed"
              ? "error"
              : (stages[sid] ?? "pending")) as GenerationJob["stages"][number]["state"],
          })),
          nodes: [],
          error:
            state === "error"
              ? r.error_code === "server_restarted"
                ? "The server restarted before this finished."
                : "The generation failed."
              : undefined,
          startedAt: created,
          updatedAt: created,
        });
      }
      return out;
    } catch (e) {
      this.log(
        `Earlier generation jobs could not be read: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }

  async failOrphans(): Promise<number> {
    const open = await this.db.server(
      async (q) => (await q("select id from generation.jobs where not is_terminal")).rows,
    );
    for (const row of open) {
      await this.db.server((q) =>
        q("select generation.finish_job($1, false, 'server_restarted')", [row.id]),
      );
    }
    return open.length;
  }
}
