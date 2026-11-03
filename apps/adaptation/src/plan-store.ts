import type { Db } from "@nirmata/db";
import type { AssetKind } from "@nirmata/gen";
import { AssetPlanError, addToPlan, type PlannedAsset } from "./asset-plan";
import type { ExistingAsset } from "./asset-gap";
import { worldIdOf } from "./prep-store";

/** One asset of the plan, as the database lists it. */
export interface PlanRow {
  id: string;
  /** The visual novel it belongs to; null is the world's shared pool. */
  vnId: string | null;
  type: AssetKind;
  /** The full asset name the Studio lists: `<character>_<expression>` for a sprite. */
  name: string;
  status: string;
}

export interface PlanInput extends PlannedAsset {
  type: AssetKind;
  /** A visual novel's id; leave out for the world's shared pool, where the baseline lives. */
  vnId?: string | undefined;
}

const NO_BOOK = { backgrounds: [], characters: {}, cgs: [] };

/**
 * The asset plan, kept in the database (ADR-0035): an asset is a row with status `planned` until it is
 * generated. The rules for what may be planned are those of `asset-plan.ts`, so the database and
 * the manifest accept and refuse the same names.
 */
export class PlanStore {
  constructor(private readonly db: Db) {}

  /** The assets in the plan, without those that were retired. */
  async list(userId: string, worldSlug: string): Promise<PlanRow[]> {
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      const rows = (
        await q(
          `select asset_id, vn_id, kind_key, name, status_key from assets.v_asset_list
            where world_id = $1 and status_key <> 'retired' order by kind_key, name`,
          [world],
        )
      ).rows;
      return rows.map((r) => ({
        id: String(r.asset_id),
        vnId: r.vn_id === null ? null : String(r.vn_id),
        type: r.kind_key as AssetKind,
        name: String(r.name),
        status: String(r.status_key),
      }));
    });
  }

  /** The assets that already exist, for the gap check. */
  async existing(userId: string, worldSlug: string): Promise<ExistingAsset[]> {
    return (await this.list(userId, worldSlug)).map((r) => ({ type: r.type, name: r.name }));
  }

  /** Plan one asset. Returns its full name and id. Throws `AssetPlanError` for what the rules refuse. */
  async add(
    userId: string,
    worldSlug: string,
    input: PlanInput,
  ): Promise<{ id: string; name: string }> {
    const { name } = addToPlan(NO_BOOK, input.type, input);
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      let id: string;
      try {
        const made = await q("select assets.create_asset($1, $2, $3, $4) as id", [
          world,
          input.vnId ?? null,
          input.type,
          name,
        ]);
        id = String(made.rows[0]?.id);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new AssetPlanError(`"${name}" is already planned.`);
        }
        throw e;
      }
      if (input.owner && input.type !== "sprite" && input.type !== "cg" && input.type !== "bg") {
        await q("select assets.set_links($1, $2, $3)", [id, [input.owner], []]);
      }
      return { id, name };
    });
  }

  /** Take an asset out of the plan: deleted if it was never generated, retired if it was. */
  async remove(
    userId: string,
    worldSlug: string,
    type: AssetKind,
    name: string,
    vnId?: string,
  ): Promise<"deleted" | "retired"> {
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      const found = (
        await q(
          `select asset_id from assets.v_asset_list
            where world_id = $1 and kind_key = $2 and name = $3
              and vn_id is not distinct from $4 and status_key <> 'retired'`,
          [world, type, name, vnId ?? null],
        )
      ).rows[0];
      if (!found) throw new AssetPlanError(`"${name}" is not in the plan.`);
      const result = (await q("select assets.unplan_asset($1) as result", [found.asset_id])).rows[0]
        ?.result;
      return result === "deleted" ? "deleted" : "retired";
    });
  }
}
