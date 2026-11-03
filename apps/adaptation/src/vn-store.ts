import type { Db } from "@nirmata/db";

/** A refusal the caller can read: the world is not published yet, or the visual novel is not valid. */
export class VnError extends Error {}

/** A visual novel's working copy as the database holds it: the three things the files held. */
export interface VnRecord {
  slug: string;
  /** manifest.json, as written. */
  manifest: Record<string, unknown>;
  /** adaptation.md. Empty in a listing. */
  adaptationMd: string;
  /** slides.json, the compiled deck. Left out of a listing, where `slideCount` stands in. */
  slides?: unknown;
  slideCount?: number | undefined;
}

export interface VnParts {
  manifest?: object | undefined;
  adaptationMd?: string | undefined;
  slides?: unknown;
}

/** What the library asks for an imported world's visual novels (ADR-0035). */
export interface VnSource {
  /** The world's visual novels without their text, or undefined when the world is not in the database. */
  list(worldSlug: string): Promise<VnRecord[] | undefined>;
  /** One visual novel in full, or undefined when there is none (or the world is not in the database). */
  get(worldSlug: string, vnSlug: string): Promise<VnRecord | undefined>;
  /** Save any of the three parts, making the visual novel if it is new. False when the world is not in the database. */
  save(worldSlug: string, vnSlug: string, parts: VnParts): Promise<boolean>;
}

/** The database keeps three tiers; the manifest keeps the finer one, so this only picks the nearest. */
export function tierKeyOf(tier: unknown): "short" | "medium" | "long" | undefined {
  switch (tier) {
    case "micro":
    case "short":
      return "short";
    case "mid":
      return "medium";
    case "large":
      return "long";
    default:
      return undefined;
  }
}

/**
 * Visual novels in the database (ADR-0035). Read and written as the author the caller stands for, so
 * only an author of the world gets through. The visual novel's text lives in its draft; publishing it
 * (routes, scenes, versions) is a later step.
 */
export class VnStore {
  constructor(private readonly db: Db) {}

  async list(userId: string, worldSlug: string): Promise<VnRecord[] | undefined> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]
        ?.id;
      if (!world) return undefined;
      const rows = (
        await q(
          `select v.slug, d.manifest,
                  case when d.slides is null then null else jsonb_array_length(coalesce(d.slides -> 'slides', '[]'::jsonb)) end as slide_count
             from vn_content.vns v join vn_content.vn_drafts d on d.vn_id = v.id
            where v.world_id = $1 order by v.slug`,
          [world],
        )
      ).rows;
      return rows.map((r) => ({
        slug: String(r.slug),
        manifest: r.manifest as Record<string, unknown>,
        adaptationMd: "",
        slideCount: r.slide_count === null ? undefined : Number(r.slide_count),
      }));
    });
  }

  async get(userId: string, worldSlug: string, vnSlug: string): Promise<VnRecord | undefined> {
    return this.db.asUser(userId, async (q) => {
      const row = (
        await q(
          `select v.slug, d.manifest, d.adaptation_md, d.slides
             from vn_content.vns v join vn_content.vn_drafts d on d.vn_id = v.id
             join world_lore.worlds w on w.id = v.world_id
            where w.slug = $1 and v.slug = $2`,
          [worldSlug, vnSlug],
        )
      ).rows[0];
      if (!row) return undefined;
      return {
        slug: String(row.slug),
        manifest: row.manifest as Record<string, unknown>,
        adaptationMd: String(row.adaptation_md),
        ...(row.slides ? { slides: row.slides } : {}),
      };
    });
  }

  async save(userId: string, worldSlug: string, vnSlug: string, parts: VnParts): Promise<boolean> {
    try {
      return await this.db.asUser(userId, async (q) => {
        const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]
          ?.id;
        if (!world) return false;
        const manifest = parts.manifest as Record<string, unknown> | undefined;
        const title = typeof manifest?.title === "string" ? manifest.title : null;
        await q("select vn_content.save_vn($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)", [
          world,
          vnSlug,
          title,
          tierKeyOf(manifest?.tier) ?? null,
          parts.manifest ? JSON.stringify(parts.manifest) : null,
          parts.adaptationMd ?? null,
          parts.slides ? JSON.stringify(parts.slides) : null,
        ]);
        return true;
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "23514" || code === "22023") throw new VnError((e as Error).message);
      throw e;
    }
  }

  /** What the library uses for the signed-in author. Nothing is found when nobody is signed in. */
  source(userOf: () => string | undefined): VnSource {
    return {
      list: async (world) => {
        const user = userOf();
        return user ? this.list(user, world) : undefined;
      },
      get: async (world, vn) => {
        const user = userOf();
        return user ? this.get(user, world, vn) : undefined;
      },
      save: async (world, vn, parts) => {
        const user = userOf();
        return user ? this.save(user, world, vn, parts) : false;
      },
    };
  }
}
