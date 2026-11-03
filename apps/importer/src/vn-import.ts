import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { VnManifestSchema, VnSlideDeckSchema } from "@nirmata/core";
import type { Db } from "@nirmata/db";

export interface VnImportOptions {
  db: Db;
  /** The world's folder. Only its `vns/` folder is read. */
  folder: string;
  /** The author the import acts as. */
  userId: string;
  /** The world's name in the database. */
  slug: string;
  /** Overwrite a visual novel that differs from the files. */
  force?: boolean | undefined;
  /** Check everything and write nothing. */
  dryRun?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
}

export interface VnImportReport {
  found: number;
  added: number;
  updated: number;
  unchanged: number;
  /** Visual novels that differ in the database, so left as they are (use force). */
  conflicts: string[];
  /** Folders that could not be read as a visual novel, or whose names the database cannot hold. */
  skipped: string[];
}

const VN_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Copies a world's visual novels (`vns/<slug>/manifest.json`, `adaptation.md`, `slides.json`) into the
 * database as the author's working copies (ADR-0035). The world must be in the database and published
 * once. Run again after editing the files: a visual novel that is the same is skipped, and one that
 * differs in the database (edited there since) is kept and listed, unless `force`. The assets under
 * `vns/*\/assets` are not read here: `import:assets` and `import:linked` carry those.
 */
export async function importWorldVns(options: VnImportOptions): Promise<VnImportReport> {
  const log = options.log ?? (() => undefined);
  const report: VnImportReport = {
    found: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    conflicts: [],
    skipped: [],
  };
  const dir = join(options.folder, "vns");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => !n.startsWith("_") && !n.startsWith(".")).sort();
  } catch {
    return report;
  }

  for (const name of names) {
    const manifestText = await readIfThere(join(dir, name, "manifest.json"));
    if (manifestText === undefined) continue; // not a visual novel folder
    report.found++;
    if (!VN_SLUG.test(name)) {
      report.skipped.push(`${name}: the name cannot be used in the database (letters, digits, hyphens)`);
      continue;
    }
    let manifest: ReturnType<typeof VnManifestSchema.parse>;
    try {
      manifest = VnManifestSchema.parse(JSON.parse(manifestText));
    } catch (e) {
      report.skipped.push(`${name}: manifest.json is not valid (${e instanceof Error ? e.message.split("\n")[0] : "unreadable"})`);
      continue;
    }
    if (manifest.slug !== name) {
      report.skipped.push(`${name}: the manifest names "${manifest.slug}"`);
      continue;
    }
    const adaptationMd = (await readIfThere(join(dir, name, "adaptation.md"))) ?? "";
    let slides: ReturnType<typeof VnSlideDeckSchema.parse> | undefined;
    const slidesText = await readIfThere(join(dir, name, "slides.json"));
    if (slidesText !== undefined) {
      try {
        slides = VnSlideDeckSchema.parse(JSON.parse(slidesText));
      } catch {
        report.skipped.push(`${name}: slides.json is not valid; it can be compiled again from adaptation.md`);
      }
    }

    const wanted = { manifest, adaptationMd, slides: slides ?? null };
    try {
      await options.db.asUser(options.userId, async (q) => {
        const world = (
          await q("select id from world_lore.worlds where slug = $1", [options.slug])
        ).rows[0]?.id;
        if (!world) throw new Error(`The world "${options.slug}" is not in the database.`);
        const had = (
          await q(
            `select d.manifest, d.adaptation_md, d.slides
               from vn_content.vns v join vn_content.vn_drafts d on d.vn_id = v.id
              where v.world_id = $1 and v.slug = $2`,
            [world, name],
          )
        ).rows[0];
        if (had) {
          const stored = { manifest: had.manifest, adaptationMd: had.adaptation_md, slides: had.slides };
          if (stable(stored) === stable(wanted)) {
            report.unchanged++;
            return;
          }
          if (!options.force) {
            report.conflicts.push(name);
            return;
          }
        }
        if (!options.dryRun) {
          await q("select vn_content.save_vn($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)", [
            world,
            name,
            manifest.title,
            { micro: "short", short: "short", mid: "medium", large: "long" }[manifest.tier],
            JSON.stringify(manifest),
            adaptationMd,
            slides ? JSON.stringify(slides) : null,
          ]);
        }
        if (had) report.updated++;
        else report.added++;
        log(`${had ? "updated" : "added"} the visual novel "${name}"`);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report.skipped.push(`${name}: ${message}`);
      if ((e as { code?: string }).code === "23514") break; // the world is not published: no other one will work
    }
  }
  return report;
}
