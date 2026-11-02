import type { Card } from "@nirmata/core";
import type { Db, Query } from "@nirmata/db";
import { WorldFiles } from "./files";

export interface LoreImportOptions {
  db: Db;
  /** The world's folder: world.json and its card folders. Read only. */
  folder: string;
  /** The author the import acts as (row level security decides what they may do). */
  userId: string;
  /** The world's name in the database; defaults to the name in world.json. */
  slug?: string | undefined;
  /** Publish the draft as a new version when something changed (or nothing is published yet). */
  publish?: boolean | undefined;
  /** Check everything and write nothing. */
  dryRun?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface LoreImportReport {
  worldId: string | undefined;
  slug: string;
  worldCreated: boolean;
  cards: { found: number; added: number; updated: number; unchanged: number };
  /** Files that could not be read as cards, or whose names the database cannot hold. */
  skipped: string[];
  publishedVersion: string | undefined;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const CARD_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const SECRETS = "secrets";

/** What one card becomes in the database. Its id is kept in `meta`, so it can be written back out. */
export interface CardRow {
  kind: string;
  slug: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  parts: Array<{ key: string; body: string }>;
  secrets: string[];
}

export function cardRow(card: Card): CardRow {
  const { name, kind, fields, ...rest } = card.fm as Record<string, unknown> & {
    name: string;
    kind: string;
    fields: Record<string, string>;
  };
  const parts = Object.entries(fields ?? {})
    .filter(([key, text]) => key !== SECRETS && text.trim())
    .map(([key, text]) => ({ key, body: text.trim() }));
  const secret = (fields?.[SECRETS] ?? "").trim();
  return {
    kind,
    slug: card.fm.id.replace(".", "-"),
    title: name,
    body: card.body,
    meta: { ...rest, path: card.path },
    parts,
    secrets: secret ? [secret] : [],
  };
}

/** JSON with sorted keys, so two meta objects compare equal whatever order the database returns. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

class DryRunDone extends Error {}

/** The world name in world.json as a database slug (lowercase letters, digits, hyphens). */
export function slugFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * Copies a world's lore from its folder into the database as the author's draft: the world (made if
 * missing), then each card with its named parts and its host-only Secrets. It never publishes unless
 * asked. Safe to run again: a card that has not changed is left alone, so nothing is marked edited.
 * The folder is only read, and nothing from it is written anywhere but the database.
 */
export async function importWorldLore(options: LoreImportOptions): Promise<LoreImportReport> {
  const { db, userId } = options;
  const log = options.log ?? (() => undefined);
  const files = new WorldFiles(options.folder);
  const manifest = await files.world();
  const slug = options.slug ?? slugFor(manifest.name);
  if (!SLUG.test(slug)) {
    throw new Error(`"${slug}" cannot be a world name in the database (letters, digits, hyphens).`);
  }

  const skipped: string[] = [];
  const rows: CardRow[] = [];
  const seen = new Set<string>();
  for (const file of await files.cardFiles()) {
    if (!file.card) {
      skipped.push(`${file.path}: ${(file.problems ?? []).join("; ")}`);
      continue;
    }
    const row = cardRow(file.card);
    if (!CARD_SLUG.test(row.slug) || seen.has(row.slug)) {
      skipped.push(`${file.path}: the id "${file.card.fm.id}" cannot be used twice or as a name`);
      continue;
    }
    seen.add(row.slug);
    rows.push(row);
  }

  const report: LoreImportReport = {
    worldId: undefined,
    slug,
    worldCreated: false,
    cards: { found: rows.length, added: 0, updated: 0, unchanged: 0 },
    skipped,
    publishedVersion: undefined,
  };

  const work = async (q: Query): Promise<void> => {
    let world = (await q("select id from world_lore.worlds where slug = $1", [slug])).rows[0]?.id;
    if (!world) {
      world = (await q("select world_lore.create_world($1, $2) as id", [slug, manifest.title]))
        .rows[0]?.id;
      report.worldCreated = true;
      log(`created the world "${slug}"`);
    }
    const worldId = String(world);
    report.worldId = worldId;
    const line = String(
      (
        await q("select id from world_lore.world_lines where world_id = $1 and is_default", [
          worldId,
        ])
      ).rows[0]?.id,
    );

    for (const row of rows) {
      const card = String(
        (
          await q(
            `insert into world_lore.cards (world_id, kind, slug) values ($1, $2, $3)
             on conflict (world_id, slug) do update set kind = excluded.kind returning id`,
            [worldId, row.kind, row.slug],
          )
        ).rows[0]?.id,
      );
      const had = (
        await q(
          "select title, body, meta from world_lore.card_drafts where line_id = $1 and card_id = $2",
          [line, card],
        )
      ).rows[0];
      if (had) {
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
        const same =
          had.title === row.title &&
          had.body === row.body &&
          stable(had.meta) === stable(row.meta) &&
          stable(parts.map((p) => [p.part_key, p.body])) ===
            stable(row.parts.map((p) => [p.key, p.body])) &&
          stable(secrets.map((s) => s.body)) === stable(row.secrets);
        if (same) {
          report.cards.unchanged++;
          continue;
        }
      }
      await q(
        `insert into world_lore.card_drafts (line_id, card_id, world_id, title, body, meta, updated_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7)
         on conflict (line_id, card_id) do update
           set title = excluded.title, body = excluded.body, meta = excluded.meta`,
        [line, card, worldId, row.title, row.body, JSON.stringify(row.meta), userId],
      );
      await q("delete from world_lore.card_draft_parts where line_id = $1 and card_id = $2", [
        line,
        card,
      ]);
      await q("delete from world_lore.card_draft_secrets where line_id = $1 and card_id = $2", [
        line,
        card,
      ]);
      for (const [i, p] of row.parts.entries()) {
        await q(
          `insert into world_lore.card_draft_parts (line_id, card_id, world_id, position, part_key, body)
           values ($1, $2, $3, $4, $5, $6)`,
          [line, card, worldId, i, p.key, p.body],
        );
      }
      for (const [i, body] of row.secrets.entries()) {
        await q(
          `insert into world_lore.card_draft_secrets (line_id, card_id, world_id, position, body)
           values ($1, $2, $3, $4, $5)`,
          [line, card, worldId, i, body],
        );
      }
      if (had) report.cards.updated++;
      else report.cards.added++;
    }

    if (options.publish) {
      const head = (
        await q("select head_version_id from world_lore.world_lines where id = $1", [line])
      ).rows[0]?.head_version_id;
      if (!head || report.cards.added + report.cards.updated > 0) {
        await q("select world_lore.set_line_ready($1, true)", [line]);
        const version = (
          await q("select world_lore.publish_world_line($1, $2) as id", [line, "import from files"])
        ).rows[0]?.id;
        report.publishedVersion = version ? String(version) : undefined;
      }
    }
    if (options.dryRun) throw new DryRunDone();
  };

  try {
    await db.asUser(userId, work);
  } catch (e) {
    if (!(e instanceof DryRunDone)) throw e;
    if (report.worldCreated) report.worldId = undefined; // rolled back: there is no such world
  }
  return report;
}
