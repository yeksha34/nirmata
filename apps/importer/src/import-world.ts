import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDb, isUuid } from "@nirmata/db";
import { importWorldLore } from "./lore-import";
import { importWorldVns } from "./vn-import";

/**
 * Copies a world's lore (its cards, their parts and host-only Secrets) from a folder into the
 * database as the author's draft. Run by a person:
 *
 *   pnpm --filter @nirmata/importer import:world <world folder> --user=<author uuid>
 *        [--slug=<name>] [--publish] [--force] [--dry] [--no-vns]
 *
 * `--user` is the author the import acts as (they must be allowed to found worlds). `--dry` checks
 * everything and writes nothing. Run it again after editing the files: unchanged cards are skipped,
 * and a card that was edited in the app since it was imported is kept and listed, unless `--force`.
 * It also copies the world's visual novels (`vns/*`: manifest, script, slides) unless `--no-vns`; the world has to
 * be published once for that, so add `--publish` the first time. It prints the world's id, which `import:assets` needs.
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  if (typeof process.loadEnvFile === "function") {
    for (const file of [join(process.cwd(), ".env"), join(here, "..", "..", "..", ".env")]) {
      if (existsSync(file)) {
        try {
          process.loadEnvFile(file); // a variable already set is kept, so the nearest file wins
        } catch {
          // ignore an unreadable .env
        }
      }
    }
  }

  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith("--"));
  const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const user = opt("user");
  if (!folder || !user || !isUuid(user)) {
    console.error(
      "usage: import:world <world folder> --user=<author uuid> [--slug=<name>] [--publish] [--force] [--dry] [--no-vns]",
    );
    process.exit(2);
  }
  const root = resolve(folder);
  if (!existsSync(join(root, "world.json"))) {
    console.error(`No world.json in ${root}`);
    process.exit(1);
  }
  const db = await connectDb(process.env);
  if (!db) {
    console.error("DATABASE_URL_RW is not set.");
    process.exit(1);
  }
  const dry = args.includes("--dry");
  try {
    const r = await importWorldLore({
      db,
      folder: root,
      userId: user,
      slug: opt("slug"),
      publish: args.includes("--publish"),
      force: args.includes("--force"),
      dryRun: dry,
      log: (m) => console.log(m),
    });
    const c = r.cards;
    console.log(
      `\n${dry ? "Would import" : "Imported"} "${r.slug}": ${c.found} cards (${c.added} new, ${c.updated} changed, ${c.unchanged} unchanged)` +
        `${r.worldCreated ? ", world created" : ""}`,
    );
    if (r.worldId) console.log(`World id: ${r.worldId}`);
    if (r.publishedVersion) console.log(`Published version: ${r.publishedVersion}`);
    if (r.skipped.length) {
      console.log(`Skipped ${r.skipped.length}:`);
      for (const s of r.skipped.slice(0, 20)) console.log(`  - ${s}`);
    }
    if (r.conflicts.length) {
      console.log(
        `Kept ${r.conflicts.length} card(s) edited in the database (add --force to overwrite):`,
      );
      for (const c of r.conflicts.slice(0, 20)) console.log(`  - ${c}`);
    }
    let incomplete = r.skipped.length > 0 || r.conflicts.length > 0;
    if (!args.includes("--no-vns") && r.worldId) {
      const v = await importWorldVns({
        db,
        folder: root,
        userId: user,
        slug: r.slug,
        force: args.includes("--force"),
        dryRun: dry,
        log: (m) => console.log(m),
      });
      if (v.found > 0) {
        console.log(
          `${dry ? "Would import" : "Imported"} ${v.found} visual novel(s): ${v.added} new, ${v.updated} changed, ${v.unchanged} unchanged`,
        );
        for (const s of v.skipped) console.log(`  - skipped ${s}`);
        for (const c of v.conflicts) {
          console.log(`  - kept ${c}: it differs in the database (add --force to overwrite)`);
        }
        incomplete = incomplete || v.skipped.length > 0 || v.conflicts.length > 0;
      }
    }
    process.exitCode = incomplete ? 3 : 0;
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
