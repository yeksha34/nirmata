import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDb, isUuid } from "@nirmata/db";
import { type ImportSelect, type ImportTarget, importDataset } from "@nirmata/gen";
import { storesFromEnv } from "@nirmata/storage";

/**
 * Imports a world's dataset images into the database and a file store. Run by a person:
 *
 *   pnpm --filter @nirmata/server import:assets <world folder> --world=<uuid> --user=<host uuid>
 *        [--target=supabase|local] [--select=latest|all] [--dry]
 *
 * `--world` is the world's id in the database and `--user` the host the import acts as. `--dry`
 * checks everything (duplicates, quota) and uploads nothing. Run it again after a stop: files
 * already imported are skipped.
 */
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  if (typeof process.loadEnvFile === "function") {
    for (const file of [join(process.cwd(), ".env"), join(here, "..", "..", "..", ".env")]) {
      if (existsSync(file)) {
        try {
          process.loadEnvFile(file);
          break;
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
  const target = (opt("target") ?? "supabase") as ImportTarget;
  const select = (opt("select") ?? "latest") as ImportSelect;
  const bad =
    !folder ||
    !world ||
    !user ||
    !isUuid(world) ||
    !isUuid(user) ||
    !["supabase", "local"].includes(target) ||
    !["latest", "all"].includes(select);
  if (bad) {
    console.error(
      "usage: import:assets <world folder> --world=<uuid> --user=<host uuid> [--target=supabase|local] [--select=latest|all] [--dry]",
    );
    process.exit(2);
  }

  const datasetDir = resolve(folder, "assets", "dataset");
  if (!existsSync(datasetDir)) {
    console.error(`No dataset folder at ${datasetDir}`);
    process.exit(1);
  }
  const db = await connectDb(process.env);
  if (!db) {
    console.error("DATABASE_URL_RW is not set.");
    process.exit(1);
  }
  const dry = args.includes("--dry");
  try {
    const report = await importDataset({
      db,
      stores: storesFromEnv(process.env),
      datasetDir,
      worldId: world,
      userId: user,
      target,
      select,
      dryRun: dry,
      log: (m) => console.log(m),
    });
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    console.log(
      `\n${dry ? "Would import" : "Imported"} ${report.uploaded} of ${report.found} files (${mb(report.bytesUploaded)}): ` +
        `sprites ${report.byKind.sprite}, cgs ${report.byKind.cg}, backgrounds ${report.byKind.bg}`,
    );
    console.log(`Already there or repeated: ${report.duplicates}`);
    if (report.blocked) console.log(`Not uploaded, storage full: ${report.blocked}`);
    if (report.failed) {
      console.log(`Failed: ${report.failed}`);
      for (const f of report.failures.slice(0, 20)) console.log(`  - ${f}`);
    }
    process.exitCode = report.failed || report.blocked ? 3 : 0;
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
