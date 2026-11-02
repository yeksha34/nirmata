import { type Db, getRenderFile } from "@nirmata/db";
import type { Stores } from "@nirmata/storage";
import type { DatasetImages } from "./files";
import { slugFor } from "./lore-rows";

/**
 * Dataset images of an imported world, read through the database and the file stores as the
 * signed-in host (row level security decides what they may see). Answers `undefined` when
 * nobody is signed in or the world has no such render, so the caller carries on with the
 * world's files. A render whose file was deleted answers `"gone"`, and the caller does not
 * bring it back from an old local copy.
 */
export class DbImages implements DatasetImages {
  constructor(
    private readonly db: Db,
    private readonly stores: Stores,
    private readonly userId: () => string | undefined,
  ) {}

  async read(
    worldName: string,
    scope: string,
    assetName: string,
    run: string,
  ): Promise<{ data: Buffer; contentType: string } | "gone" | undefined> {
    const user = this.userId();
    if (!user) return undefined;
    const found = await this.db.asUser(user, async (q) => {
      const world = (
        await q("select id from world_lore.worlds where slug = $1", [slugFor(worldName)])
      ).rows[0]?.id;
      if (!world) return undefined;
      const path = `${String(world)}/${scope}/${assetName}/${run}.png`;
      // exact first; an older dataset may have been named in another case
      const render = (
        await q(
          `select id from assets.renders where lower(storage_path) = lower($1)
            order by (storage_path = $1) desc limit 1`,
          [path],
        )
      ).rows[0]?.id;
      return render ? String(render) : undefined;
    });
    if (!found) return undefined;
    const file = await getRenderFile(this.db, found, user);
    if (!file) return undefined;
    if (file.store === "none") return "gone";
    const store = this.stores[file.store];
    if (!store) return undefined;
    const bytes = await store.get(file.storagePath);
    if (!bytes) return undefined;
    return {
      data: Buffer.from(bytes.data),
      contentType: file.contentType ?? bytes.contentType ?? "image/png",
    };
  }
}
