import type { Db, Query } from "@nirmata/db";
import { type CharacterPrep, PrepError } from "./character-prep";

/** A world's id from its name, as the signed-in author sees it. */
export async function worldIdOf(q: Query, slug: string): Promise<string> {
  const row = (await q("select id from world_lore.worlds where slug = $1", [slug])).rows[0];
  if (!row) throw new PrepError(`There is no world "${slug}" in the database.`);
  return String(row.id);
}

/**
 * Character prep, kept in the database (ADR-0035). Read and written as the author the agent acts
 * for, so row level security decides what is allowed: only an author of the world reads or writes it.
 */
export class PrepStore {
  constructor(private readonly db: Db) {}

  /** Every prepared character of a world, by the card's name. */
  async list(userId: string, worldSlug: string): Promise<Map<string, CharacterPrep>> {
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      const prep = (
        await q(
          `select character_name, base_positive, base_negative, notes, card_hash
             from assets.character_prep where world_id = $1`,
          [world],
        )
      ).rows;
      const expressions = (
        await q(
          `select character_name, expression, tags from assets.character_expressions
            where world_id = $1 order by position`,
          [world],
        )
      ).rows;
      const outfits = (
        await q(
          `select character_name, kind_key, name, tags from assets.character_outfits
            where world_id = $1 order by position`,
          [world],
        )
      ).rows;
      const out = new Map<string, CharacterPrep>();
      for (const p of prep) {
        const name = String(p.character_name);
        out.set(name, {
          basePositive: String(p.base_positive),
          baseNegative: String(p.base_negative),
          notes: String(p.notes),
          cardHash: p.card_hash === null ? null : String(p.card_hash),
          expressions: expressions
            .filter((e) => e.character_name === name)
            .map((e) => ({ expression: String(e.expression), tags: String(e.tags) })),
          outfits: outfits
            .filter((o) => o.character_name === name)
            .map((o) => ({
              kind: o.kind_key as "clothes" | "adornment",
              name: String(o.name),
              tags: String(o.tags),
            })),
        });
      }
      return out;
    });
  }

  /** Replace a character's prep. */
  async save(userId: string, worldSlug: string, name: string, prep: CharacterPrep): Promise<void> {
    await this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      await q("select assets.save_character_prep($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)", [
        world,
        name,
        prep.basePositive,
        prep.baseNegative,
        prep.notes,
        prep.cardHash,
        JSON.stringify(prep.expressions),
        JSON.stringify(prep.outfits),
      ]);
    });
  }

  async remove(userId: string, worldSlug: string, name: string): Promise<void> {
    await this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      await q("select assets.remove_character_prep($1, $2)", [world, name]);
    });
  }
}
