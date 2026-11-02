// Content-neutrality check for db/. Reads a list of forbidden terms (one per line) from the file
// named by FORBIDDEN_TERMS_FILE, which is kept outside the repo (a CI secret). Fails closed when
// the file is missing. Prints file and line only, never the matched term.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const termsFile = process.env.FORBIDDEN_TERMS_FILE;
if (!termsFile || !existsSync(termsFile)) {
  console.error("FORBIDDEN_TERMS_FILE is not set or not readable: failing closed");
  process.exit(2);
}

const fold = (s) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const terms = readFileSync(termsFile, "utf8")
  .split(/\r?\n/)
  .map((t) => fold(t.trim()))
  .filter((t) => t.length >= 3);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(sql|md|txt|json|mjs)$/.test(name)) files.push(p);
  }
};
walk(join(root, "db"));
const extra = process.argv.slice(2);
for (const e of extra) if (existsSync(e)) files.push(e);

let hits = 0;
for (const file of files) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      const f = fold(line);
      if (terms.some((t) => f.includes(t))) {
        hits++;
        console.error(`${relative(root, file)}:${i + 1}`);
      }
    });
}
if (hits) {
  console.error(`${hits} line(s) contain a forbidden term`);
  process.exit(1);
}
console.log(`ok: ${files.length} files checked against ${terms.length} terms`);
