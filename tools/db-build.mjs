// Assemble supabase/migrations/ from db/<schema>/migrations/ in the order of db/order.txt.
// The output is generated: never edit it by hand. Fails if the order is not strictly ascending
// by timestamp, a listed file is missing, or a migration file is not listed.
//   node tools/db-build.mjs          build
//   node tools/db-build.mjs --check  verify only
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = join(root, "db");
const out = join(root, "supabase", "migrations");
const checkOnly = process.argv.includes("--check");

const listed = readFileSync(join(db, "order.txt"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const problems = [];
let last = "";
for (const rel of listed) {
  const name = rel.split("/").pop() ?? "";
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) problems.push(`bad file name: ${rel}`);
  if (name.slice(0, 14) <= last) problems.push(`not ascending: ${rel}`);
  last = name.slice(0, 14);
  if (!existsSync(join(db, rel))) problems.push(`missing: ${rel}`);
}

const onDisk = [];
for (const dir of readdirSync(db, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === "tests") continue;
  const m = join(db, dir.name, "migrations");
  if (existsSync(m)) {
    for (const f of readdirSync(m)) if (f.endsWith(".sql")) onDisk.push(`${dir.name}/migrations/${f}`);
  }
}
for (const f of onDisk) if (!listed.includes(f)) problems.push(`not listed in order.txt: ${f}`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
if (checkOnly) {
  console.log(`ok: ${listed.length} migrations in order`);
  process.exit(0);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const rel of listed) copyFileSync(join(db, rel), join(out, rel.split("/").pop() ?? rel));
console.log(`built ${listed.length} migrations into supabase/migrations`);
