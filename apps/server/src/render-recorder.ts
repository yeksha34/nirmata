import { createHash } from "node:crypto";
import type { Db } from "@nirmata/db";
import { type AssetKind, pngSize, type RunSettings, recordRender } from "@nirmata/gen";
import type { Stores } from "@nirmata/storage";
import { STORED_PART, sanitizeSlug } from "./files";
import { slugFor } from "./lore-rows";

export interface GeneratedImage {
  worldName: string;
  /** The visual novel's slug (or `_shared`): where the dataset keeps this run. */
  scope: string;
  /** The dataset folder's name for this run (a timestamp). */
  run: string;
  type: AssetKind;
  name: string;
  /** The generation's job (in memory), so its render is linked to the job recorded for it. */
  jobKey?: string | undefined;
  image: Buffer;
  positive: string;
  negative: string;
  steps?: number | undefined;
  cfg?: number | undefined;
  sampler?: string | undefined;
  scheduler?: string | undefined;
  seed?: number | undefined;
  /** What the run used, read from the workflow that was sent. */
  runSettings?: RunSettings | undefined;
}

const sha256Of = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Keeps a new generation in the database as well as on disk. */
export interface RenderRecorder {
  /** Where the file was kept, or undefined when it was not recorded (not imported, no store, quota). */
  record(image: GeneratedImage): Promise<"supabase" | "local" | undefined>;
}

/**
 * Records a new generation for an imported world, as the signed-in host: uploads the image to
 * Supabase storage (or the local store when Supabase is not set up or the quota says "block"), then
 * records the asset, spec and render with the same rows the importer writes. The caller has already
 * saved the file on disk, so a failure here costs nothing but the database copy.
 */
export class DbRecorder implements RenderRecorder {
  constructor(
    protected readonly db: Db,
    protected readonly stores: Stores,
    protected readonly userId: () => string | undefined,
    protected readonly log: (message: string) => void = () => undefined,
  ) {}

  /** The asset, spec and job already made for a generation, if any (see `DbGenerations`). */
  protected existing(
    _jobKey: string | undefined,
  ): { assetId: string; specId: string; jobId: string } | undefined {
    return undefined;
  }

  async record(g: GeneratedImage): Promise<"supabase" | "local" | undefined> {
    const user = this.userId();
    if (!user) return undefined;
    const world = (
      await this.db.asUser(
        user,
        async (q) =>
          (
            await q("select id from world_lore.worlds where slug = $1", [slugFor(g.worldName)])
          ).rows[0]?.id,
      )
    )?.toString();
    if (!world) return undefined; // the world is not in the database

    const bytes = g.image.byteLength;
    const sha256 = createHash("sha256").update(g.image).digest("hex");
    const known = await this.db.asUser(
      user,
      async (q) =>
        (
          await q("select 1 from assets.renders where world_id = $1 and sha256 = $2 limit 1", [
            world,
            sha256,
          ])
        ).rows,
    );
    if (known.length > 0) return undefined;

    let target: "supabase" | "local" | undefined;
    if (this.stores.supabase) {
      const status = await this.db.server(
        async (q) =>
          (await q("select level, used_pct from assets.storage_status($1)", [bytes])).rows[0],
      );
      if (status?.level === "block") {
        this.log(`Storage is full (${status.used_pct}%): a new image was not uploaded.`);
      } else {
        target = "supabase";
      }
    }
    if (!target && this.stores.local) target = "local";
    if (!target) return undefined;
    const store = this.stores[target];
    if (!store) return undefined;

    const scope = sanitizeSlug(g.scope);
    const name = sanitizeSlug(g.name);
    const run = STORED_PART.test(g.run) ? g.run : sanitizeSlug(g.run); // a time keeps its case
    const path = `${world}/${scope}/${name}/${run}.png`;
    const size = pngSize(g.image);
    const clamp = (n: number) => Math.min(4096, Math.max(64, n));
    await store.put(path, new Uint8Array(g.image), "image/png");
    let recorded: { assetId: string; renderId: string };
    try {
      const existing = this.existing(g.jobKey);
      const settings = g.runSettings;
      recorded = await this.db.asUser(user, (q) =>
        recordRender(
          q,
          {
            worldId: world,
            kind: g.type,
            name,
            path,
            positive: g.positive.slice(0, 8000),
            negative: g.negative.slice(0, 8000),
            width: clamp(size?.width ?? 512),
            height: clamp(size?.height ?? 768),
            seed: g.seed ?? settings?.seed,
            steps: g.steps ?? settings?.steps,
            cfg: g.cfg ?? settings?.cfg,
            sampler: g.sampler ?? settings?.sampler,
            scheduler: g.scheduler ?? settings?.scheduler,
            runSettings: settings,
            store: target,
            bytes,
            sha256,
          },
          existing,
        ),
      );
    } catch (e) {
      await store.remove(path).catch(() => undefined);
      throw e;
    }
    if (target === "supabase") {
      await this.db.server(async (q) => q("select * from assets.storage_status(0, true)")); // the daily alert, if due
    }
    // the new image is safe and current: only now do the older ones leave Supabase
    await this.moveOlderToLocal(user, recorded.assetId, recorded.renderId).catch((e) =>
      this.log(`Older images stayed in Supabase: ${e instanceof Error ? e.message : String(e)}`),
    );
    return target;
  }

  /**
   * Supabase holds what the game serves, the asset's current image; the history is the local dataset.
   * Each older image of the asset still in Supabase is copied to the local store, checked against the
   * hash the database holds, recorded as local, and only then removed from Supabase. Any step that
   * fails leaves that image where it was, so nothing is lost and the next generation tries again.
   * Without a local store or a recorded hash an image stays in Supabase.
   */
  protected async moveOlderToLocal(
    user: string,
    assetId: string,
    currentRenderId: string,
  ): Promise<void> {
    const { supabase, local } = this.stores;
    if (!supabase || !local) return;
    const older = await this.db.asUser(
      user,
      async (q) =>
        (
          await q(
            `select id, storage_path, sha256 from assets.renders
              where asset_id = $1 and id <> $2 and store = 'supabase'`,
            [assetId, currentRenderId],
          )
        ).rows,
    );
    for (const row of older) {
      const path = String(row.storage_path);
      try {
        const want = row.sha256 ? String(row.sha256) : undefined;
        if (!want) {
          this.log(`${path} has no recorded hash, so it stays in Supabase.`);
          continue;
        }
        const remote = await supabase.get(path);
        if (!remote) continue; // the file is not there to move
        if (sha256Of(remote.data) !== want) {
          this.log(`${path} in Supabase does not match its hash, so it was not moved.`);
          continue;
        }
        const have = await local.get(path);
        if (!have || sha256Of(have.data) !== want) {
          await local.put(path, remote.data, remote.contentType ?? "image/png");
          const back = await local.get(path);
          if (!back || sha256Of(back.data) !== want) {
            this.log(`${path} was not copied cleanly to the local store, so it stays in Supabase.`);
            continue;
          }
        }
        await this.db.asUser(user, (q) =>
          q("select assets.set_render_store($1, 'local')", [row.id]),
        );
        await supabase.remove(path).catch(() => undefined); // a leftover is only space
      } catch (e) {
        this.log(`${path} stayed in Supabase: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
