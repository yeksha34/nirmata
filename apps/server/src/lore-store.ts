import { type Card, CardFrontmatter, formatIssues, serializeCard } from "@nirmata/core";
import type { Db, Query } from "@nirmata/db";
import { HostError } from "@nirmata/host";
import type { CardFile, LoreCards } from "./files";
import { cardRow, SECRETS, upsertCard, withoutStamp, writeDraft } from "./lore-rows";

interface Place {
  worldId: string;
  line: string;
}

/**
 * A world's cards, read and written in the database as the signed-in author (row level security
 * decides what they may do). A world that is not in the database is not touched: the answer is
 * `undefined`/`false` and the caller carries on with the world's files. So the database wins
 * for a world that has been imported, and files are used for the rest.
 */
export class DbLore implements LoreCards {
  /**
   * Cards read a moment ago. Selecting an asset reads the cards for its prompt, and each read is a
   * round trip to the database, so a read is reused for a few seconds; any save or delete here drops it.
   * (A change made elsewhere, like another import, shows within that time.)
   */
  private readonly recent = new Map<string, { at: number; files: CardFile[] | undefined }>();

  /** `userId` is whoever is signed in as the table's host right now, if anyone is. */
  constructor(
    private readonly db: Db,
    private readonly userId: () => string | undefined,
    private readonly keepMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  private async within<T>(
    slug: string,
    work: (q: Query, place: Place, userId: string) => Promise<T>,
  ): Promise<T | undefined> {
    const user = this.userId();
    if (!user) return undefined;
    try {
      return await this.db.asUser(user, async (q) => {
        const world = (await q("select id from world_lore.worlds where slug = $1", [slug])).rows[0]
          ?.id;
        if (!world) return undefined;
        const line = (
          await q("select id from world_lore.world_lines where world_id = $1 and is_default", [
            world,
          ])
        ).rows[0]?.id;
        if (!line) return undefined;
        return work(q, { worldId: String(world), line: String(line) }, user);
      });
    } catch (e) {
      if (e instanceof HostError) throw e;
      throw new HostError("bad_state", "The database cannot be reached right now.");
    }
  }

  async cardFiles(slug: string): Promise<CardFile[] | undefined> {
    const key = `${this.userId() ?? ""}|${slug}`;
    const had = this.recent.get(key);
    if (had && this.now() - had.at < this.keepMs) return had.files;
    const files = await this.readCardFiles(slug);
    this.recent.set(key, { at: this.now(), files });
    return files;
  }

  private async readCardFiles(slug: string): Promise<CardFile[] | undefined> {
    return this.within(slug, async (q, { worldId, line }) => {
      const cards = (
        await q(
          `select c.id, c.kind, c.slug, d.title, d.body, d.meta
             from world_lore.cards c
             join world_lore.card_drafts d on d.card_id = c.id and d.line_id = $1
            where c.world_id = $2 order by c.slug`,
          [line, worldId],
        )
      ).rows;
      const parts = (
        await q(
          "select card_id, part_key, body from world_lore.card_draft_parts where line_id = $1 order by card_id, position",
          [line],
        )
      ).rows;
      const secrets = (
        await q(
          "select card_id, body from world_lore.card_draft_secrets where line_id = $1 order by card_id, position",
          [line],
        )
      ).rows;
      return cards.map((c): CardFile => {
        const { path: savedPath, ...stamped } = (c.meta as Record<string, unknown> | null) ?? {};
        const meta = withoutStamp(stamped);
        const path = typeof savedPath === "string" ? savedPath : `lore/${String(c.slug)}.md`;
        const fields: Record<string, string> = {};
        for (const p of parts) if (p.card_id === c.id) fields[String(p.part_key)] = String(p.body);
        const secret = secrets
          .filter((s) => s.card_id === c.id)
          .map((s) => String(s.body))
          .join("\n\n");
        if (secret) fields[SECRETS] = secret;
        const fm = CardFrontmatter.safeParse({
          ...meta,
          id: meta.id ?? `${String(c.kind)}.${String(c.slug)}`,
          kind: c.kind,
          name: c.title,
          fields,
        });
        if (!fm.success) {
          return { path, text: "", problems: formatIssues(fm.error) };
        }
        const card: Card = { path, fm: fm.data, body: String(c.body) };
        return { path, text: serializeCard(card), card };
      });
    });
  }

  async save(slug: string, card: Card): Promise<boolean> {
    this.recent.clear();
    const done = await this.within(slug, async (q, { worldId, line }, userId) => {
      const row = cardRow(card);
      const id = await upsertCard(q, worldId, row);
      await writeDraft(q, { worldId, line, card: id, userId }, row);
      return true;
    });
    return done === true;
  }

  async removeFile(slug: string, path: string): Promise<boolean> {
    this.recent.clear();
    const done = await this.within(slug, async (q, { line }) => {
      const found = (
        await q(
          "select card_id from world_lore.card_drafts where line_id = $1 and meta ->> 'path' = $2",
          [line, path],
        )
      ).rows[0]?.card_id;
      if (!found) return false;
      await q("delete from world_lore.card_drafts where line_id = $1 and card_id = $2", [
        line,
        found,
      ]);
      // a card that was never published goes entirely; a published one keeps its history
      await q(
        `delete from world_lore.cards c where c.id = $1
           and not exists (select 1 from world_lore.card_revisions r where r.card_id = c.id)`,
        [found],
      );
      return true;
    });
    return done === true;
  }
}
