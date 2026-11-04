import type { Db, Query } from "@nirmata/db";

export class SceneStateError extends Error {}

export interface SceneCardAssignment {
  cardId: string;
  cardSlug: string;
  cardKind: string;
  cardName: string;
  characterState?: string;
  clothingState?: string;
  role?: string;
}

export interface SceneMatrixRow {
  sceneId: string;
  chapterSlug?: string;
  vnSlug?: string;
  cards: SceneCardAssignment[];
}

export interface SetSceneCardStateInput {
  chapterSlug?: string;
  vnSlug?: string;
  sceneId: string;
  cardId: string;
  characterState?: string;
  clothingState?: string;
  role?: string;
}

export interface RemoveSceneCardStateInput {
  chapterSlug?: string;
  vnSlug?: string;
  sceneId: string;
  cardId: string;
}

/**
 * Manages scene-by-scene card and state assignments across chapters and visual novels (ADR-0038).
 */
export class SceneStateStore {
  constructor(private readonly db: Db) {}

  async getMatrix(
    userId: string,
    worldSlug: string,
    opts: { chapterSlug?: string; vnSlug?: string },
  ): Promise<SceneMatrixRow[]> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]?.id;
      if (!world) return [];
      const chapter = opts.chapterSlug ?? null;
      const vn = opts.vnSlug ?? null;

      const rows = (
        await q(
          `select s.scene_id, s.chapter_slug, s.vn_slug, s.card_id,
                  s.character_state, s.clothing_state, s.role,
                  c.slug as card_slug, c.kind as card_kind,
                  coalesce(d.title, c.slug) as card_name
             from world_lore.scene_card_states s
             join world_lore.cards c on c.id = s.card_id
             left join world_lore.world_lines l on l.world_id = s.world_id and l.is_default
             left join world_lore.card_drafts d on d.card_id = c.id and d.line_id = l.id
            where s.world_id = $1
              and ($2::text is null or s.chapter_slug = $2)
              and ($3::text is null or s.vn_slug = $3)
            order by s.scene_id, c.kind, c.slug`,
          [world, chapter, vn],
        )
      ).rows;

      const byScene = new Map<string, SceneMatrixRow>();
      for (const r of rows) {
        const sceneId = String(r.scene_id);
        if (!byScene.has(sceneId)) {
          byScene.set(sceneId, {
            sceneId,
            chapterSlug: r.chapter_slug ? String(r.chapter_slug) : undefined,
            vnSlug: r.vn_slug ? String(r.vn_slug) : undefined,
            cards: [],
          });
        }
        byScene.get(sceneId)!.cards.push({
          cardId: String(r.card_id),
          cardSlug: String(r.card_slug),
          cardKind: String(r.card_kind),
          cardName: String(r.card_name),
          characterState: r.character_state ? String(r.character_state) : undefined,
          clothingState: r.clothing_state ? String(r.clothing_state) : undefined,
          role: r.role ? String(r.role) : undefined,
        });
      }

      return Array.from(byScene.values());
    });
  }

  private async resolveCardUuid(
    q: Query,
    worldId: string,
    cardIdOrSlug: string,
    scope?: { chapterSlug?: string; vnSlug?: string },
  ): Promise<string> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardIdOrSlug);
    if (isUuid) return cardIdOrSlug;

    const slug = cardIdOrSlug.replace(".", "-");
    const chapter = scope?.chapterSlug ?? null;
    const vn = scope?.vnSlug ?? null;

    const row = (
      await q(
        `select c.id from world_lore.cards c
          where c.world_id = $1
            and (c.slug = $2 or c.slug = $3)
            and (
              (c.chapter_slug is null and c.vn_slug is null)
              or ($4::text is not null and c.chapter_slug = $4)
              or ($5::text is not null and c.vn_slug = $5)
            )
          order by (case when ($4::text is not null and c.chapter_slug = $4) or ($5::text is not null and c.vn_slug = $5) then 0 else 1 end)
          limit 1`,
        [worldId, cardIdOrSlug, slug, chapter, vn],
      )
    ).rows[0];

    if (!row) {
      throw new SceneStateError(`Card "${cardIdOrSlug}" not found in world.`);
    }
    return String(row.id);
  }

  async setCardState(
    userId: string,
    worldSlug: string,
    input: SetSceneCardStateInput,
  ): Promise<string> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]?.id;
      if (!world) throw new SceneStateError(`World "${worldSlug}" not found.`);

      const cardId = await this.resolveCardUuid(q, String(world), input.cardId, {
        chapterSlug: input.chapterSlug,
        vnSlug: input.vnSlug,
      });

      const res = await q(
        `select world_lore.set_scene_card_state($1, $2, $3, $4, $5, $6, $7, $8) as id`,
        [
          world,
          input.chapterSlug ?? null,
          input.vnSlug ?? null,
          input.sceneId,
          cardId,
          input.characterState ?? null,
          input.clothingState ?? null,
          input.role ?? null,
        ],
      );
      return String(res.rows[0]?.id);
    });
  }

  async removeCardState(
    userId: string,
    worldSlug: string,
    input: RemoveSceneCardStateInput,
  ): Promise<void> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]?.id;
      if (!world) return;

      const cardId = await this.resolveCardUuid(q, String(world), input.cardId, {
        chapterSlug: input.chapterSlug,
        vnSlug: input.vnSlug,
      });

      await q(`select world_lore.remove_scene_card_state($1, $2, $3, $4, $5)`, [
        world,
        input.chapterSlug ?? null,
        input.vnSlug ?? null,
        input.sceneId,
        cardId,
      ]);
    });
  }
}
