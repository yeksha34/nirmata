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

/** One asset of the plan as the Studio lists it. */
export interface StudioRow {
  type: AssetKind;
  /** The full name the Studio lists. */
  name: string;
  /** True for the world's shared pool, false for the visual novel's own. */
  shared: boolean;
  /** Clothes, adornments and objects: the characters it is locked or linked to. */
  owners: string[];
  /** Objects: the CGs it is linked to, by name. */
  cgs: string[];
  /** The image generated for it, when there is one. */
  renderId?: string | undefined;
  /** The prompt of its latest spec. */
  prompt?: string | undefined;
}

/** What the library asks for an imported world's asset plan (ADR-0035). */
export interface PlanSource {
  /** The plan for one visual novel (`_shared` for the pool alone), or undefined when the world is not in the database. */
  list(worldSlug: string, vnSlug: string): Promise<StudioRow[] | undefined>;
  /** Plan an asset. Undefined when the world is not in the database. */
  add(
    worldSlug: string,
    vnSlug: string,
    type: AssetKind,
    input: PlannedAsset,
  ): Promise<{ name: string } | undefined>;
  /** Take an asset out of the plan. False when the world is not in the database. */
  remove(worldSlug: string, vnSlug: string, type: AssetKind, name: string): Promise<boolean>;
}

export const SHARED_POOL = "_shared";

export class PlanViews {
  constructor(
    private readonly db: Db,
    private readonly plan: PlanStore,
  ) {}

  /** The plan for a visual novel, as the Studio lists it. Undefined when the world is not in the database. */
  async list(userId: string, worldSlug: string, vnSlug: string): Promise<StudioRow[] | undefined> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]
        ?.id;
      if (!world) return undefined;
      const rows = (
        await q(
          `select l.asset_id, l.vn_id, v.slug as vn_slug, l.kind_key, l.name, l.current_render_id,
                  l.link_characters, l.link_cgs, s.positive
             from assets.v_asset_list l
             left join vn_content.vns v on v.id = l.vn_id
             left join assets.asset_specs s on s.id = l.current_spec_id
            where l.world_id = $1 and l.status_key <> 'retired' order by l.kind_key, l.name`,
          [world],
        )
      ).rows;
      const nameOf = new Map(rows.map((r) => [String(r.asset_id), String(r.name)]));
      return rows
        .filter((r) => r.vn_id === null || (vnSlug !== SHARED_POOL && r.vn_slug === vnSlug))
        .map((r) => ({
          type: r.kind_key as AssetKind,
          name: String(r.name),
          shared: r.vn_id === null,
          owners: (r.link_characters as string[] | null) ?? [],
          cgs: ((r.link_cgs as string[] | null) ?? []).flatMap((id) => nameOf.get(String(id)) ?? []),
          renderId: r.current_render_id === null ? undefined : String(r.current_render_id),
          prompt: r.positive === null ? undefined : String(r.positive),
        }));
    });
  }

  private async vnId(userId: string, worldSlug: string, vnSlug: string): Promise<string | undefined> {
    if (vnSlug === SHARED_POOL) return undefined;
    return this.db.asUser(userId, async (q) => {
      const row = (
        await q(
          `select v.id from vn_content.vns v join world_lore.worlds w on w.id = v.world_id
            where w.slug = $1 and v.slug = $2`,
          [worldSlug, vnSlug],
        )
      ).rows[0];
      if (!row) throw new AssetPlanError(`There is no visual novel "${vnSlug}" in the database.`);
      return String(row.id);
    });
  }

  async add(
    userId: string,
    worldSlug: string,
    vnSlug: string,
    type: AssetKind,
    input: PlannedAsset,
  ): Promise<{ name: string }> {
    const vnId = await this.vnId(userId, worldSlug, vnSlug);
    const made = await this.plan.add(userId, worldSlug, { ...input, type, vnId });
    return { name: made.name };
  }

  async remove(
    userId: string,
    worldSlug: string,
    vnSlug: string,
    type: AssetKind,
    name: string,
  ): Promise<void> {
    const vnId = await this.vnId(userId, worldSlug, vnSlug);
    await this.plan.remove(userId, worldSlug, type, name, vnId);
  }

  /** What the library uses for the signed-in author. */
  source(userOf: () => string | undefined): PlanSource {
    const inDatabase = async (user: string, world: string) =>
      this.db.asUser(user, async (q) =>
        Boolean((await q("select id from world_lore.worlds where slug = $1", [world])).rows[0]),
      );
    return {
      list: async (world, vn) => {
        const user = userOf();
        return user ? this.list(user, world, vn) : undefined;
      },
      add: async (world, vn, type, input) => {
        const user = userOf();
        return user && (await inDatabase(user, world))
          ? this.add(user, world, vn, type, input)
          : undefined;
      },
      remove: async (world, vn, type, name) => {
        const user = userOf();
        if (!user || !(await inDatabase(user, world))) return false;
        await this.remove(user, world, vn, type, name);
        return true;
      },
    };
  }
}
