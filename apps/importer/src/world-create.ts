import { CardFrontmatter } from "@nirmata/core";
import type { Db } from "@nirmata/db";
import { cardRow, SLUG, slugFor, upsertCard, writeDraft } from "./lore-rows";

export interface NewWorld {
  title: string;
  tagline: string;
  premise: string;
}

/** The person may not found worlds. */
export class WorldNotAllowed extends Error {}

/** The name a title gives a world, within what the database accepts. */
export function worldNameFor(title: string, n = 1): string {
  const base = slugFor(title).slice(0, 40).replace(/-+$/g, "") || "world";
  const padded = base.length < 2 ? `${base}0` : base;
  if (n === 1) return padded;
  const suffix = `-${n}`;
  return `${padded.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

const TRIES = 30;

/**
 * Makes a world in the database as the signed-in author: the world and its default line, the manifest
 * (what `world.json` held), and a premise card when there is a premise. The name follows the title and
 * is made unique. Nothing is written to a folder.
 */
export async function createWorldInDb(
  db: Db,
  userId: string,
  input: NewWorld,
): Promise<{ name: string; title: string; tagline: string }> {
  for (let n = 1; n <= TRIES; n++) {
    const name = worldNameFor(input.title, n);
    if (!SLUG.test(name)) continue;
    try {
      await db.asUser(userId, async (q) => {
        const world = String(
          (await q("select world_lore.create_world($1, $2) as id", [name, input.title])).rows[0]?.id,
        );
        const manifest = {
          name,
          title: input.title,
          tagline: input.tagline,
          genre: [],
          tone: [],
          perspective: "second-person",
          systems: { dice: "none", stats: [], inventory: true },
          createdWith: "nirmata",
        };
        await q("select world_lore.save_world_manifest($1, $2::jsonb)", [
          world,
          JSON.stringify(manifest),
        ]);
        const premise = input.premise.trim();
        if (premise) {
          const line = String(
            (
              await q("select id from world_lore.world_lines where world_id = $1 and is_default", [
                world,
              ])
            ).rows[0]?.id,
          );
          const row = cardRow({
            path: "lore/premise.md",
            fm: CardFrontmatter.parse({
              id: "lore.premise",
              kind: "lore",
              name: "Premise",
              always: true,
            }),
            body: premise,
          });
          const card = await upsertCard(q, world, row);
          await writeDraft(q, { worldId: world, line, card, userId }, row);
        }
      });
      return { name, title: input.title, tagline: input.tagline };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "23505") continue; // the name is taken (perhaps by a world this person cannot see)
      if (code === "42501") throw new WorldNotAllowed("This person may not found worlds.");
      throw e;
    }
  }
  throw new Error("No free name was found for that title.");
}
