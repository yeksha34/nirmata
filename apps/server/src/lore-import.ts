import type { Db, Query } from "@nirmata/db";
import { WorldFiles } from "./files";
import {
  CARD_SLUG,
  type CardRow,
  cardRow,
  contentHash,
  contentOf,
  IMPORTED,
  SLUG,
  slugFor,
  stable,
  upsertCard,
  withoutStamp,
  writeDraft,
} from "./lore-rows";

export { cardRow, slugFor };

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
  /** Overwrite cards that were changed in the database since they were imported. */
  force?: boolean | undefined;
  /** Check everything and write nothing. */
  dryRun?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface LoreImportReport {
  worldId: string | undefined;
  slug: string;
  worldCreated: boolean;
  cards: { found: number; added: number; updated: number; unchanged: number };
  /** Cards changed in the database since they were imported, so left as they are (use force). */
  conflicts: string[];
  /** Files that could not be read as cards, or whose names the database cannot hold. */
  skipped: string[];
  publishedVersion: string | undefined;
}

class DryRunDone extends Error {}

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
    conflicts: [],
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
      const card = await upsertCard(q, worldId, row);
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
        const had_ = {
          title: String(had.title),
          body: String(had.body),
          meta: withoutStamp((had.meta as Record<string, unknown> | null) ?? {}),
          parts: parts.map((p): [string, string] => [String(p.part_key), String(p.body)]),
          secrets: secrets.map((x) => String(x.body)),
        };
        const wanted = contentOf(row);
        if (stable(had_) === stable(wanted)) {
          report.cards.unchanged++;
          continue;
        }
        // The importer stamped what it wrote. If the stored content no longer matches its stamp,
        // someone edited the card in the app: keep that edit unless told to overwrite it.
        const stamp = (had.meta as Record<string, unknown> | null)?.[IMPORTED];
        if (stamp !== contentHash(had_) && !options.force) {
          report.conflicts.push(row.meta.path ? String(row.meta.path) : row.slug);
          continue;
        }
      }
      const stamped: CardRow = {
        ...row,
        meta: { ...row.meta, [IMPORTED]: contentHash(contentOf(row)) },
      };
      await writeDraft(q, { worldId, line, card, userId }, stamped);
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
