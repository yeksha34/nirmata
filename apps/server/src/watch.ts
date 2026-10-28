import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Recipe } from "./legacy";
import { describe, type SyncReport, syncImport } from "./legacy-sync";
import { isNoise, settle } from "./watch-core";

/**
 * Keeps a world that was imported from an older story in step with that story:
 *
 *   pnpm --filter @nirmata/server import:watch <story folder> <world folder> <recipe.json>
 *
 * The world is the version that stories start from, so it follows its source: it is brought up to
 * date once, then the story folder is watched and, a moment after the changes stop, it is done
 * again. Stories already played in the world have their own copy and are never touched; a file
 * the world had in a different state is kept in `.import/replaced/` (see legacy-sync.ts).
 * Options:
 *
 *   --once         bring it up to date and stop
 *   --dry-run      say what would change and change nothing
 *   --keep-edits   let what was changed in Nirmata win; a file changed in both places is left
 *                  as it is and the story's version put in `.import/incoming/` to merge
 *   --quiet <ms>   how long the story must be still before it is read again (default 2000)
 *   --notes        also print the importer's notes (links to nowhere, cards with no keywords)
 */

const USAGE =
  "usage: import:watch <story folder> <world folder> <recipe.json> [--once] [--dry-run] [--keep-edits] [--quiet <ms>] [--notes]";

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (line: string) => console.log(`${stamp()}  ${line}`);

function show(report: SyncReport, notes: boolean) {
  say(describe(report));
  const list = (title: string, paths: string[], max = 12) => {
    if (!paths.length) return;
    console.log(`        ${title}`);
    for (const p of paths.slice(0, max)) console.log(`          ${p}`);
    if (paths.length > max) console.log(`          … and ${paths.length - max} more`);
  };
  list("added:", report.added);
  list("updated:", report.updated);
  list("removed (kept in .import/replaced):", report.removed);
  list("the world's own different version put aside in .import/replaced:", report.replacedEdits, 8);
  if (notes) list("your own edits kept (the story has not changed these):", report.kept);
  list("changed in both places; the story's version is in .import/incoming:", report.conflicts, 50);
  if (report.replacedIn) console.log(`        replaced files are in ${report.replacedIn}`);
  if (report.notes.length) {
    if (notes) for (const n of report.notes) console.log(`        note: ${n}`);
    else console.log(`        ${report.notes.length} importer notes (--notes to read them)`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const optionValue = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const valued = new Set(["--quiet"]);
  const positional = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
  const [srcArg, destArg, recipeArg] = positional;
  if (!srcArg || !destArg || !recipeArg) {
    console.error(USAGE);
    process.exit(2);
  }
  // pnpm runs this from apps/server; paths are meant from where the person typed the command
  const base = process.env.INIT_CWD ?? process.cwd();
  const src = resolve(base, srcArg);
  const dest = resolve(base, destArg);
  const recipe = JSON.parse(await readFile(resolve(base, recipeArg), "utf8")) as Recipe;
  const quietMs = Number(optionValue("--quiet") ?? 2000);
  if (!Number.isFinite(quietMs) || quietMs < 0) {
    console.error("--quiet wants a number of milliseconds");
    process.exit(2);
  }
  const options = { dryRun: flag("--dry-run"), keepEdits: flag("--keep-edits") };
  const notes = flag("--notes");

  const sync = async () => {
    const report = await syncImport(src, dest, recipe, options);
    show(report, notes);
    return report;
  };

  say(
    `${options.dryRun ? "checking" : "bringing"} ${dest} ${options.dryRun ? "against" : "up to date from"} ${src}`,
  );
  const first = await sync();
  if (flag("--once")) {
    process.exit(first.conflicts.length ? 3 : 0);
  }

  const settler = settle(
    async (changed) => {
      say(
        `${changed.length ? `${changed.length} changed` : "changes"}: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", …" : ""}`,
      );
      await sync();
    },
    { quietMs, onError: (e) => say(`could not bring it up to date: ${(e as Error).message}`) },
  );

  const watcher = watch(src, { recursive: true }, (_event, name) => {
    const path = name?.toString().replace(/\\/g, "/");
    if (path && isNoise(path)) return;
    settler.poke(path ?? undefined);
  });
  watcher.on("error", (e) => say(`the watcher stopped: ${e.message}`));
  say(`watching ${src} (runs ${quietMs} ms after the last change; Ctrl C to stop)`);

  const stop = () => {
    settler.stop();
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
