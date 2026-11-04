import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Db } from "@nirmata/db";
import { markdownFiles, readWorldManifest } from "./card-folder";

export interface StoryImportOptions {
  db: Db;
  /** The world's folder. Only world.json and the markdown under `chapters/` and `drafts/` are read. */
  folder: string;
  /** The author the import acts as. */
  userId: string;
  /** The world's name in the database. */
  slug: string;
  /** Overwrite a chapter or draft that was changed in the database since it was imported. */
  force?: boolean | undefined;
  /** Check everything and write nothing. */
  dryRun?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface StoryImportReport {
  /** What happened to world.json's copy in the database. */
  manifest: "added" | "updated" | "unchanged" | "none";
  writings: { found: number; added: number; updated: number; unchanged: number };
  /** Changed in the database since they were imported (or made there), so left as they are. */
  conflicts: string[];
  /** Files the database cannot hold, with the reason. */
  skipped: string[];
}

const DIRS = ["chapters", "drafts"] as const;
const MAX_BYTES = 4_194_304;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const BAD_PATH = /[\\\x01-\x1f]|(^|\/)\.\.(\/|$)/;

const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** The first heading of a text, else its file's name (the same rule the Studio lists them by). */
function titleOf(text: string, path: string): string {
  const heading = /^#{1,2}[ \t]+(.+?)[ \t]*$/m.exec(text.slice(0, 2000));
  if (heading?.[1]) return heading[1].slice(0, 300);
  const name = basename(path, ".md").replace(/[_-]+/g, " ").trim() || "Untitled";
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 300);
}

/**
 * Copies a world's story into the database (ADR-0035): `world.json` as the world's manifest, and every
 * markdown file under `chapters/` and `drafts/` (scenes and index files included) as a writing, by its
 * path. Run again after editing the files: a text that is the same is skipped, one the database still
 * holds as imported is updated, and one changed in the database since is kept and listed unless `force`.
 * Cards are not read here (`import:world` carries them), nor are the stories under `stories/`.
 */
export async function importWorldStory(options: StoryImportOptions): Promise<StoryImportReport> {
  const log = options.log ?? (() => undefined);
  const report: StoryImportReport = {
    manifest: "none",
    writings: { found: 0, added: 0, updated: 0, unchanged: 0 },
    conflicts: [],
    skipped: [],
  };

  let manifest: Awaited<ReturnType<typeof readWorldManifest>> | undefined;
  try {
    manifest = await readWorldManifest(options.folder);
  } catch (e) {
    report.skipped.push(`world.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  const files: Array<{ path: string; text: string; hash: string }> = [];
  for (const dir of DIRS) {
    for (const full of await markdownFiles(join(options.folder, dir))) {
      const path = full.slice(options.folder.length + 1).replaceAll("\\", "/");
      if (path.includes("/cards/")) continue;
      report.writings.found++;
      const text = await readFile(full, "utf8");
      if (path.length > 300 || BAD_PATH.test(path)) {
        report.skipped.push(`${path}: the path cannot be used in the database`);
        continue;
      }
      if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
        report.skipped.push(`${path}: larger than 4 MB`);
        continue;
      }
      files.push({ path, text, hash: createHash("sha256").update(text, "utf8").digest("hex") });
    }
  }

  await options.db.asUser(options.userId, async (q) => {
    const world = (
      await q("select id, manifest from world_lore.worlds where slug = $1", [options.slug])
    ).rows[0];
    if (!world) throw new Error(`The world "${options.slug}" is not in the database.`);

    if (manifest) {
      if (!world.manifest) report.manifest = "added";
      else report.manifest = stable(world.manifest) === stable(manifest) ? "unchanged" : "updated";
      if (report.manifest !== "unchanged" && !options.dryRun) {
        await q("select world_lore.save_world_manifest($1, $2::jsonb)", [
          world.id,
          JSON.stringify(manifest),
        ]);
      }
    }

    const had = new Map(
      (
        await q(
          "select path, body_hash, imported_hash from reader.writings where world_id = $1",
          [world.id],
        )
      ).rows.map((r) => [String(r.path), r]),
    );
    for (const f of files) {
      const row = had.get(f.path);
      if (row && row.body_hash === f.hash) {
        report.writings.unchanged++;
        continue;
      }
      // unchanged since the import wrote it, so the file is the newer copy; anything else was edited here
      if (row && row.imported_hash !== row.body_hash && !options.force) {
        report.conflicts.push(f.path);
        continue;
      }
      if (!options.dryRun) {
        await q("select reader.save_writing($1, $2, $3, $4, $5)", [
          world.id,
          f.path,
          titleOf(f.text, f.path),
          f.text,
          f.hash,
        ]);
      }
      if (row) report.writings.updated++;
      else report.writings.added++;
      log(`${row ? "updated" : "added"} ${f.path}`);
    }
  });
  return report;
}
