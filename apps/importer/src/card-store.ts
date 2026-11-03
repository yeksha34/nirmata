import { type Card, CardFrontmatter, formatIssues } from "@nirmata/core";
import type { Db, Query } from "@nirmata/db";
import { CARD_SLUG, cardRow, SECRETS, upsertCard, withoutStamp, writeDraft } from "./lore-rows";

/** A request the store refuses: the words say what to change. */
export class CardError extends Error {}

/** What an importing agent sends for one card. The card's id is `kind.slug`. */
export interface CardSave {
  /** The card's kind: one of the standard kinds, or a name the world gives to its own. */
  kind: string;
  /** Lowercase letters, digits and hyphens. The card's id is `kind.slug`. */
  slug: string;
  name: string;
  summary?: string | undefined;
  keywords?: string[] | undefined;
  always?: boolean | undefined;
  role?: string | undefined;
  scope?: "chapter" | "story" | "both" | undefined;
  severity?: "must" | "should" | undefined;
  /** The card's named parts (appearance, voice ...). `secrets` is host-only. */
  fields?: Record<string, string> | undefined;
  body?: string | undefined;
}

/** A card as the agent reads it. */
export interface CardView {
  id: string;
  kind: string;
  name: string;
  summary: string;
  keywords: string[];
  /** The named parts, with the host-only `secrets` part included for the author the agent speaks for. */
  fields: Record<string, string>;
  body: string;
}

export interface CardListed {
  id: string;
  kind: string;
  name: string;
  summary: string;
  /** The names of the parts that are filled in. */
  parts: string[];
  /** How much text the card holds, in characters. */
  size: number;
}

interface Place {
  worldId: string;
  line: string;
}

const KIND = /^[a-z][a-z0-9]{0,39}$/;
const SLUG_PART = /^[a-z0-9][a-z0-9-]{0,60}$/;

/**
 * A world's cards, read and written one at a time for an importing agent, as the author the agent's
 * token stands for (row level security decides what they may do). The card's content is checked as a
 * card file would be: the same frontmatter, the same part names. A card is kept as the author's draft
 * until the world is published.
 */
export class CardStore {
  constructor(private readonly db: Db) {}

  private async within<T>(
    userId: string,
    worldSlug: string,
    work: (q: Query, place: Place) => Promise<T>,
  ): Promise<T> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug]))
        .rows[0]?.id;
      if (!world) throw new CardError(`There is no world "${worldSlug}" in the database.`);
      const line = (
        await q("select id from world_lore.world_lines where world_id = $1 and is_default", [world])
      ).rows[0]?.id;
      if (!line) throw new CardError("That world has no default line.");
      return work(q, { worldId: String(world), line: String(line) });
    });
  }

  /** Every card, without its text. Optionally only those of one kind. */
  async list(userId: string, worldSlug: string, kind?: string): Promise<CardListed[]> {
    return this.within(userId, worldSlug, async (q, { line, worldId }) => {
      const rows = (
        await q(
          `select c.kind, c.slug, d.title, d.meta, length(d.body) as body_size,
                  coalesce((select array_agg(p.part_key order by p.position)
                              from world_lore.card_draft_parts p
                             where p.line_id = d.line_id and p.card_id = d.card_id), '{}') as parts,
                  coalesce((select sum(length(p.body)) from world_lore.card_draft_parts p
                             where p.line_id = d.line_id and p.card_id = d.card_id), 0) as part_size,
                  coalesce((select sum(length(s.body)) from world_lore.card_draft_secrets s
                             where s.line_id = d.line_id and s.card_id = d.card_id), 0) as secret_size
             from world_lore.cards c
             join world_lore.card_drafts d on d.card_id = c.id and d.line_id = $1
            where c.world_id = $2 and ($3::text is null or c.kind = $3)
            order by c.kind, c.slug`,
          [line, worldId, kind ?? null],
        )
      ).rows;
      return rows.map((r) => {
        const meta = (r.meta as Record<string, unknown> | null) ?? {};
        return {
          id: typeof meta.id === "string" ? meta.id : `${String(r.kind)}.${String(r.slug)}`,
          kind: String(r.kind),
          name: String(r.title),
          summary: typeof meta.summary === "string" ? meta.summary : "",
          parts: (r.parts as string[]) ?? [],
          size: Number(r.body_size) + Number(r.part_size) + Number(r.secret_size),
        };
      });
    });
  }

  /** One card in full, found by its id (`kind.slug`). */
  async get(userId: string, worldSlug: string, id: string): Promise<CardView | undefined> {
    return this.within(userId, worldSlug, async (q, { line, worldId }) => {
      const row = (
        await q(
          `select c.id as card, c.kind, c.slug, d.title, d.body, d.meta
             from world_lore.cards c
             join world_lore.card_drafts d on d.card_id = c.id and d.line_id = $1
            where c.world_id = $2 and c.slug = $3`,
          [line, worldId, slugOf(id)],
        )
      ).rows[0];
      if (!row) return undefined;
      const card = String(row.card);
      const parts = (
        await q(
          "select part_key, body from world_lore.card_draft_parts where line_id = $1 and card_id = $2 order by position",
          [line, card],
        )
      ).rows;
      const secrets = (
        await q(
          "select body from world_lore.card_draft_secrets where line_id = $1 and card_id = $2 order by position",
          [line, card],
        )
      ).rows;
      const meta = withoutStamp((row.meta as Record<string, unknown> | null) ?? {});
      const fields: Record<string, string> = {};
      for (const p of parts) fields[String(p.part_key)] = String(p.body);
      if (secrets.length) fields[SECRETS] = secrets.map((s) => String(s.body)).join("\n\n");
      return {
        id: typeof meta.id === "string" ? meta.id : `${String(row.kind)}.${String(row.slug)}`,
        kind: String(row.kind),
        name: String(row.title),
        summary: typeof meta.summary === "string" ? meta.summary : "",
        keywords: Array.isArray(meta.keywords) ? meta.keywords.map(String) : [],
        fields,
        body: String(row.body),
      };
    });
  }

  /** Saves a card, making it if it is new. Says whether it was new. */
  async save(userId: string, worldSlug: string, input: CardSave): Promise<{ created: boolean }> {
    const kind = input.kind.trim();
    const slug = input.slug.trim();
    if (!KIND.test(kind)) {
      throw new CardError("A kind is lowercase letters and digits, starting with a letter.");
    }
    if (!SLUG_PART.test(slug)) {
      throw new CardError("A card name is lowercase letters, digits and hyphens.");
    }
    const id = `${kind}.${slug}`;
    const fm = CardFrontmatter.safeParse({
      id,
      kind,
      name: input.name,
      keywords: input.keywords ?? [],
      summary: input.summary ?? "",
      always: input.always ?? false,
      fields: Object.fromEntries(
        Object.entries(input.fields ?? {}).filter(([, text]) => text.trim() !== ""),
      ),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
    });
    if (!fm.success) throw new CardError(formatIssues(fm.error).join("; "));
    const card: Card = { path: pathOf(kind, slug), fm: fm.data, body: input.body ?? "" };
    const row = cardRow(card);
    if (!CARD_SLUG.test(row.slug)) throw new CardError("That card name is too long.");

    return this.within(userId, worldSlug, async (q, { worldId, line }) => {
      const had = (
        await q(
          `select c.id, d.meta ->> 'id' as card_id
             from world_lore.cards c
             left join world_lore.card_drafts d on d.card_id = c.id and d.line_id = $1
            where c.world_id = $2 and c.slug = $3`,
          [line, worldId, row.slug],
        )
      ).rows[0];
      // "a.b-c" and "a-b.c" would share a database name; do not let one overwrite the other
      if (had?.card_id && had.card_id !== id) {
        throw new CardError(`The name is already used by the card ${String(had.card_id)}.`);
      }
      const cardId = await upsertCard(q, worldId, row);
      await writeDraft(q, { worldId, line, card: cardId, userId }, row);
      return { created: !had };
    });
  }

  /** Removes a card. A card that was published keeps its history and only leaves the draft. */
  async remove(userId: string, worldSlug: string, id: string): Promise<boolean> {
    return this.within(userId, worldSlug, async (q, { worldId, line }) => {
      const found = (
        await q("select id from world_lore.cards where world_id = $1 and slug = $2", [
          worldId,
          slugOf(id),
        ])
      ).rows[0]?.id;
      if (!found) return false;
      await q("delete from world_lore.card_drafts where line_id = $1 and card_id = $2", [
        line,
        found,
      ]);
      await q(
        `delete from world_lore.cards c where c.id = $1
           and not exists (select 1 from world_lore.card_revisions r where r.card_id = c.id)`,
        [found],
      );
      return true;
    });
  }

  /** Publishes the draft as the world's next version, so readers and visual novels can use it. */
  async publish(userId: string, worldSlug: string, note: string): Promise<string | undefined> {
    return this.within(userId, worldSlug, async (q, { line }) => {
      await q("select world_lore.set_line_ready($1, true)", [line]);
      const version = (await q("select world_lore.publish_world_line($1, $2) as id", [line, note]))
        .rows[0]?.id;
      return version ? String(version) : undefined;
    });
  }
}

/** The name a card has in the database: its id with the dot as a hyphen. */
export function slugOf(id: string): string {
  return id.replace(".", "-");
}

/** Where the card would live as a file: the folder the world's tools expect for its kind. */
function pathOf(kind: string, slug: string): string {
  const dir =
    kind === "character"
      ? "characters"
      : kind === "place"
        ? "setting/places"
        : kind === "arc"
          ? "plot/arcs"
          : kind === "scene"
            ? "plot/scenes"
            : kind === "rule"
              ? ".agents/rules"
              : kind === "lore"
                ? "lore"
                : `lore/${kind}`;
  return `${dir}/${slug}.md`;
}
