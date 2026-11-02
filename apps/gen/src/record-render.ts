import type { Query } from "@nirmata/db";

export interface RenderToRecord {
  worldId: string;
  kind: "sprite" | "cg" | "bg";
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
  store: "supabase" | "local";
  bytes: number;
  sha256: string;
}

/**
 * Records one image in the database, inside a transaction the caller opened as the host: finds or
 * makes the asset, adds the spec that made the image, and records the render with its store, size
 * and hash. Used by the importer and by a new generation, so both leave the same rows.
 */
export async function recordRender(q: Query, r: RenderToRecord): Promise<void> {
  const found = await q(
    "select id from assets.assets where world_id = $1 and vn_id is null and kind_key = $2 and name = $3",
    [r.worldId, r.kind, r.name],
  );
  const assetId =
    found.rows[0]?.id ??
    (await q("select assets.create_asset($1, null, $2, $3) as id", [r.worldId, r.kind, r.name]))
      .rows[0]?.id;
  const spec = (
    await q("select assets.add_spec($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id", [
      assetId,
      r.positive,
      r.negative,
      r.seed ?? 0,
      r.steps ?? 20,
      r.cfg ?? 7,
      r.sampler ?? "euler",
      r.scheduler ?? "normal",
      r.width,
      r.height,
    ])
  ).rows[0]?.id;
  await q("select assets.record_render($1, $2, $3, null, $4, $5, $6, 'image/png')", [
    assetId,
    spec,
    r.path,
    r.store,
    r.bytes,
    r.sha256,
  ]);
}
