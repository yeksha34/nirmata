import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDb, isUuid } from "@nirmata/db";
import { addSpec, assetSize, ensureAsset, getDefaultNegativePrompt } from "@nirmata/gen";
import { collectLinked } from "./linked-import";

/**
 * Copies a world's clothes, adornment and object cards into the database as assets: one asset per card,
 * a spec holding the prompt composed from the card, and its character / CG links. Run by a person:
 *
 *   pnpm --filter @nirmata/importer import:linked <world folder> --world=<uuid> --user=<author uuid> [--dry]
 *
 * Run it again after editing the cards: an asset whose prompt did not change is left alone, a changed
 * prompt becomes a new spec. Reference images are not uploaded. `--dry` writes nothing.
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  if (typeof process.loadEnvFile === "function") {
    for (const file of [join(process.cwd(), ".env"), join(here, "..", "..", "..", ".env")]) {
      if (existsSync(file)) {
        try {
          process.loadEnvFile(file);
        } catch {
          // ignore an unreadable .env
        }
      }
    }
  }

  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith("--"));
  const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const world = opt("world");
  const user = opt("user");
  if (!folder || !world || !user || !isUuid(world) || !isUuid(user)) {
    console.error("usage: import:linked <world folder> --world=<uuid> --user=<author uuid> [--dry]");
    process.exit(2);
  }
  const dry = args.includes("--dry");
  const found = collectLinked(resolve(folder));
  if (found.length === 0) {
    console.error(`No clothes, adornment or object cards under ${resolve(folder)}`);
    process.exit(1);
  }
  const unlinked = found.filter((a) => a.characters.length + a.cgs.length === 0);
  const count = (k: string) => found.filter((a) => a.kind === k).length;
  console.log(
    `${found.length} cards: clothes ${count("clothes")}, adornments ${count("adornment")}, objects ${count("object")}` +
      (unlinked.length ? `; ${unlinked.length} with no link: ${unlinked.map((a) => a.name).join(", ")}` : ""),
  );
  if (dry) return;

  const db = await connectDb(process.env);
  if (!db) {
    console.error("DATABASE_URL_RW is not set.");
    process.exit(1);
  }
  let added = 0;
  let changed = 0;
  let same = 0;
  const failures: string[] = [];
  try {
    for (const a of found) {
      try {
        const r = await db.asUser(user, async (q) => {
          const id = await ensureAsset(q, world, a.kind, a.name);
          const prev = (
            await q(
              "select s.positive from assets.assets x join assets.asset_specs s on s.id = x.current_spec_id where x.id = $1",
              [id],
            )
          ).rows[0]?.positive;
          let state: "added" | "changed" | "same" = "same";
          if (prev !== a.positive) {
            await addSpec(q, id, {
              positive: a.positive,
              negative: getDefaultNegativePrompt(a.kind),
              ...assetSize(a.kind),
              seed: 0,
              steps: 24,
              cfg: 7,
              sampler: "dpmpp_2m",
              scheduler: "karras",
            });
            state = prev === undefined ? "added" : "changed";
          }
          if (a.characters.length + a.cgs.length > 0 || a.kind !== "object") {
            const cgIds: string[] = [];
            for (const cg of a.cgs) cgIds.push(await ensureAsset(q, world, "cg", cg));
            await q("select assets.set_links($1, $2, $3)", [id, a.characters, cgIds]);
          }
          return state;
        });
        if (r === "added") added++;
        else if (r === "changed") changed++;
        else same++;
      } catch (e) {
        failures.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await db.close();
  }
  console.log(`Imported ${found.length - failures.length} of ${found.length}: ${added} new, ${changed} changed, ${same} unchanged.`);
  for (const f of failures.slice(0, 20)) console.log(`  - ${f}`);
  process.exitCode = failures.length ? 3 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
