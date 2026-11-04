import type { AssetKind } from "./asset-kind";
import type { Query } from "@nirmata/db";
import type { RunSettings } from "./run-settings";

export interface RenderToRecord {
  worldId: string;
  kind: AssetKind;
  name: string;
  /** The stored file's path: `<world id>/<scope>/<name>/<run>.png`. */
  path: string;
  positive: string;
  negative: string;
  width: number;
  height: number;
  seed?: number | undefined;
  steps?: number | undefined;
  cfg?: number | undefined;
  sampler?: string | undefined;
  scheduler?: string | undefined;
  /** What the run used (exact workflow, checkpoint, references); absent for an image of unknown origin. */
  runSettings?: RunSettings | undefined;
  store: "supabase" | "local";
  bytes: number;
  sha256: string;
}

/** The asset for a name in a world (shared by all visual novels), made when it does not exist. */
export async function ensureAsset(
  q: Query,
  worldId: string,
  kind: AssetKind,
  name: string,
): Promise<string> {
  const found = await q(
    "select id from assets.assets where world_id = $1 and vn_id is null and kind_key = $2 and name = $3",
    [worldId, kind, name],
  );
  const id =
    found.rows[0]?.id ??
    (await q("select assets.create_asset($1, null, $2, $3) as id", [worldId, kind, name])).rows[0]
      ?.id;
  return String(id);
}

/**
 * Adds the spec that describes an image to be (or that was) made: prompts, sampler settings, size, and
 * what the run used. A sampler setting that is not known is stored as unknown (null), never as a
 * made-up default; a run's settings are read from the workflow that was sent, so they are known.
 */
export async function addSpec(
  q: Query,
  assetId: string,
  r: Pick<
    RenderToRecord,
    | "positive"
    | "negative"
    | "width"
    | "height"
    | "seed"
    | "steps"
    | "cfg"
    | "sampler"
    | "scheduler"
    | "runSettings"
  >,
): Promise<string> {
  const spec = (
    await q("select assets.add_spec($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null, $11::jsonb) as id", [
      assetId,
      r.positive,
      r.negative,
      r.seed ?? null,
      r.steps ?? null,
      r.cfg ?? null,
      r.sampler ?? null,
      r.scheduler ?? null,
      r.width,
      r.height,
      JSON.stringify(r.runSettings ?? {}),
    ])
  ).rows[0]?.id;
  return String(spec);
}

/**
 * Records one image in the database, inside a transaction the caller opened as the host: finds or
 * makes the asset, adds the spec that made the image, and records the render with its store, size
 * and hash. Used by the importer and by a new generation, so both leave the same rows. A generation
 * that already made its asset, spec and job passes them in `existing`; the render is linked to the job.
 */
export async function recordRender(
  q: Query,
  r: RenderToRecord,
  existing?: { assetId: string; specId: string; jobId?: string | undefined },
): Promise<{ assetId: string; renderId: string }> {
  const assetId = existing?.assetId ?? (await ensureAsset(q, r.worldId, r.kind, r.name));
  const specId = existing?.specId ?? (await addSpec(q, assetId, r));
  const renderId = (
    await q("select assets.record_render($1, $2, $3, $4, $5, $6, $7, 'image/png') as id", [
      assetId,
      specId,
      r.path,
      existing?.jobId ?? null,
      r.store,
      r.bytes,
      r.sha256,
    ])
  ).rows[0]?.id;
  return { assetId, renderId: String(renderId) };
}
