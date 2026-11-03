import { type Db, isUuid } from "./db";

export type StoreName = "supabase" | "local" | "none";

export interface RenderFile {
  storagePath: string;
  store: StoreName;
  contentType: string | undefined;
  bytes: number | undefined;
}

/**
 * Where a render's file is. Undefined when there is no such render (or the caller may not see it).
 * With a user id the database checks that they belong to the render's world; without one the
 * backend is asking for itself and must already have checked who is asking.
 */
export async function getRenderFile(
  db: Db,
  renderId: string,
  userId?: string,
): Promise<RenderFile | undefined> {
  if (!isUuid(renderId)) return undefined;
  const read = (q: Parameters<Parameters<Db["server"]>[0]>[0]) =>
    q("select * from assets.render_file($1)", [renderId]);
  const result = userId ? await db.asUser(userId, read) : await db.server(read);
  const row = result.rows[0];
  if (!row) return undefined;
  const store = String(row.store);
  if (store !== "supabase" && store !== "local" && store !== "none") {
    throw new Error(`Unknown store "${store}" on render ${renderId}.`);
  }
  return {
    storagePath: String(row.storage_path),
    store,
    contentType: typeof row.content_type === "string" ? row.content_type : undefined,
    bytes: row.bytes === null || row.bytes === undefined ? undefined : Number(row.bytes),
  };
}
