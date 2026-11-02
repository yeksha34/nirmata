import { createHash } from "node:crypto";
import type { Db } from "@nirmata/db";
import { pngSize, recordRender } from "@nirmata/gen";
import type { Stores } from "@nirmata/storage";
import { STORED_PART, sanitizeSlug } from "./files";
import { slugFor } from "./lore-rows";

export interface GeneratedImage {
  worldName: string;
  /** The visual novel's slug (or `_shared`): where the dataset keeps this run. */
  scope: string;
  /** The dataset folder's name for this run (a timestamp). */
  run: string;
  type: "sprite" | "cg" | "bg";
  name: string;
  image: Buffer;
  positive: string;
  negative: string;
  steps?: number | undefined;
  cfg?: number | undefined;
  sampler?: string | undefined;
  scheduler?: string | undefined;
  seed?: number | undefined;
}

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
    private readonly db: Db,
    private readonly stores: Stores,
    private readonly userId: () => string | undefined,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

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
    try {
      await this.db.asUser(user, (q) =>
        recordRender(q, {
          worldId: world,
          kind: g.type,
          name,
          path,
          positive: g.positive.slice(0, 8000),
          negative: g.negative.slice(0, 8000),
          width: clamp(size?.width ?? 512),
          height: clamp(size?.height ?? 768),
          seed: g.seed,
          steps: g.steps,
          cfg: g.cfg,
          sampler: g.sampler,
          scheduler: g.scheduler,
          store: target,
          bytes,
          sha256,
        }),
      );
    } catch (e) {
      await store.remove(path).catch(() => undefined);
      throw e;
    }
    if (target === "supabase") {
      await this.db.server(async (q) => q("select * from assets.storage_status(0, true)")); // the daily alert, if due
    }
    return target;
  }
}
