import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ImportReport, importStory, type Recipe, walk } from "./legacy";

/**
 * Keeps a world that was imported from an older story the same as that story. The world is the
 * version every story starts from; the stories played in it have their own copy of the cards
 * (ADR-0009) and live in the world's `stories/` folder, which is never touched. So the world
 * follows its source: the importer builds a whole world from nothing, so an update is to build it
 * again in a scratch folder and bring every file that differs into the world.
 *
 * Nothing is lost by it. A file the world already had in a different state (a card edited in
 * Nirmata, or one an older import wrote) is put in `.import/replaced/<time>/` before the new one is
 * written, and so is a file the importer no longer writes. Cards made in Nirmata and everything
 * else the importer never wrote are not looked at.
 *
 * To work the other way, with edits made in Nirmata winning (`keepEdits`), it compares three
 * things for each file, using what the importer wrote last time (its hash is in
 * `.import/state.json`) as the base:
 *
 *   world changed, story not   the world's file stays
 *   story changed, world not   the file takes the new version
 *   both changed               a conflict: the new version goes to `.import/incoming/` to merge
 */

export interface SyncOptions {
  /** Work out what would change, and write nothing. */
  dryRun?: boolean;
  /** Let what was done to the world in Nirmata win over the story, and report conflicts. */
  keepEdits?: boolean;
  now?: () => Date;
}

export interface SyncReport {
  added: string[];
  /** Files that took the story's version (including those in `replacedEdits`). */
  updated: string[];
  /** The world's own, different version of these was put in `.import/replaced/`. */
  replacedEdits: string[];
  removed: string[];
  /** `keepEdits` only: the world's edits that were kept (and files it removed that stay removed). */
  kept: string[];
  /** `keepEdits` only, changed on both sides: the story's version is in `.import/incoming/`. */
  conflicts: string[];
  unchanged: number;
  /** Where replaced and removed files went, if any did. */
  replacedIn?: string;
  /** The importer's own notes (links to nowhere, cards with no keywords). */
  notes: string[];
}

interface State {
  version: 1;
  files: Record<string, string>;
}

const STATE = ".import/state.json";
/** Folders in the world that the importer must never write into. */
const OWN = [".import/", "stories/"];

const sha = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

async function read(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

async function put(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // a file the server may be reading is replaced whole, never half written
  const temp = `${path}.import-tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

/**
 * Gives a file in the world the modification time of the story's file it came from, so "last
 * changed" means when the author changed it, not when it was copied. Only the time changes.
 */
async function alignTime(from: string, to: string): Promise<void> {
  try {
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    if (Math.abs(a.mtimeMs - b.mtimeMs) > 1000) await utimes(to, a.atime, a.mtime);
  } catch (e) {
    // a file with no counterpart in the story (a card made from several) keeps its own time
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** Puts a file aside; one that is not there is not an error. */
async function move(from: string, to: string): Promise<boolean> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export async function syncImport(
  src: string,
  dest: string,
  recipe: Recipe,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const replaced = join(dest, ".import", "replaced", stamp);
  const keepEdits = options.keepEdits === true;
  const report: SyncReport = {
    added: [],
    updated: [],
    replacedEdits: [],
    removed: [],
    kept: [],
    conflicts: [],
    unchanged: 0,
    notes: [],
  };

  const scratch = await mkdtemp(join(tmpdir(), "nirmata-sync-"));
  try {
    const made = join(scratch, "world");
    const imported: ImportReport = await importStory(src, made, recipe);
    report.notes = imported.warnings;

    let state: State = { version: 1, files: {} };
    const saved = await read(join(dest, STATE));
    if (saved) {
      try {
        const parsed = JSON.parse(saved.toString("utf8")) as State;
        if (parsed.version === 1) state = parsed;
      } catch {
        // an unreadable record is the same as none
      }
    }
    const next: Record<string, string> = { ...state.files };
    let moved = false;
    const away = async (rel: string) => {
      if (options.dryRun) moved = (await read(join(dest, rel))) !== undefined || moved;
      else moved = (await move(join(dest, rel), join(replaced, rel))) || moved;
    };

    const fresh = new Set<string>();
    for await (const rel of walk(made)) {
      if (OWN.some((p) => rel.startsWith(p))) {
        report.notes.push(`${rel}: in a folder Nirmata keeps for itself, so it was not brought in`);
        continue;
      }
      fresh.add(rel);
      const data = await readFile(join(made, rel));
      const now = sha(data);
      const base = state.files[rel];
      const there = await read(join(dest, rel));
      const have = there ? sha(there) : undefined;

      let current = false;
      const write = async (into: "added" | "updated") => {
        if (!options.dryRun) await put(join(dest, rel), data);
        report[into].push(rel);
        next[rel] = now;
        current = true;
      };
      const replace = async () => {
        await away(rel);
        await write("updated");
        report.replacedEdits.push(rel);
      };
      const conflict = async () => {
        if (!options.dryRun) await put(join(dest, ".import", "incoming", rel), data);
        report.conflicts.push(rel);
      };

      if (have === now) {
        report.unchanged++;
        next[rel] = now;
        current = true;
      } else if (have === undefined) {
        // not in the world: new, or taken out of it since
        if (base === undefined) await write("added");
        else if (!keepEdits) await write("updated");
        else if (now === base) report.kept.push(rel);
        else await conflict();
      } else if (base !== undefined && have === base) {
        // the world's file is what the importer wrote: only the story has moved
        await write("updated");
      } else if (!keepEdits) {
        await replace();
      } else if (base !== undefined && now === base) {
        report.kept.push(rel);
      } else {
        await conflict();
      }
      if (current && !options.dryRun) await alignTime(join(src, rel), join(dest, rel));
    }

    // files the importer wrote before and no longer does
    for (const [rel, base] of Object.entries(state.files)) {
      if (fresh.has(rel)) continue;
      const there = await read(join(dest, rel));
      delete next[rel];
      if (there === undefined) continue;
      if (!keepEdits || sha(there) === base) {
        await away(rel);
        report.removed.push(rel);
      } else report.kept.push(rel);
    }

    if (moved) report.replacedIn = replaced;
    if (!options.dryRun) {
      await put(
        join(dest, STATE),
        Buffer.from(`${JSON.stringify({ version: 1, files: sortKeys(next) }, null, 2)}\n`),
      );
    }
    return report;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const sortKeys = (o: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** One line a person can read: what a sync did. */
export function describe(r: SyncReport): string {
  const parts = [
    r.added.length && `${r.added.length} added`,
    r.updated.length && `${r.updated.length} updated`,
    r.removed.length && `${r.removed.length} removed`,
    r.kept.length && `${r.kept.length} of your own edits kept`,
    r.conflicts.length && `${r.conflicts.length} to merge`,
  ].filter(Boolean);
  const aside = r.replacedEdits.length
    ? `, ${r.replacedEdits.length} differing ones put aside`
    : "";
  return `${parts.length ? parts.join(", ") : "nothing to change"}${aside} (${r.unchanged} already up to date)`;
}
