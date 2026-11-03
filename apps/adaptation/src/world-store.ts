import type { Db } from "@nirmata/db";

/** What the library asks for an imported world's manifest, what `world.json` held (ADR-0035). */
export interface WorldSource {
  /** The manifest as stored, or undefined when the world is not in the database or has none. */
  manifest(worldSlug: string): Promise<Record<string, unknown> | undefined>;
}

/** How long a manifest read is reused. The host reads it many times a request. */
const KEEP_MS = 5_000;

/** A world's manifest, kept in the database. Read as the signed-in author. */
export class WorldStore {
  constructor(private readonly db: Db) {}

  async manifest(userId: string, worldSlug: string): Promise<Record<string, unknown> | undefined> {
    return this.db.asUser(userId, async (q) => {
      const row = (
        await q("select manifest from world_lore.worlds where slug = $1", [worldSlug])
      ).rows[0];
      return row?.manifest ? (row.manifest as Record<string, unknown>) : undefined;
    });
  }

  source(userOf: () => string | undefined): WorldSource {
    const seen = new Map<string, { at: number; value: Record<string, unknown> | undefined }>();
    return {
      manifest: async (world) => {
        const user = userOf();
        if (!user) return undefined;
        const key = `${user}:${world}`;
        const hit = seen.get(key);
        if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
        const value = await this.manifest(user, world);
        seen.set(key, { at: Date.now(), value });
        return value;
      },
    };
  }
}
