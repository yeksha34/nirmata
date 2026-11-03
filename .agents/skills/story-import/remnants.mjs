#!/usr/bin/env node
// What is left of a source after the import workers have taken their parts.
//
//   node remnants.mjs <source-dir> <ledger-dir> <out-dir>
//
// Each worker keeps a ledger: one file `<lane>.jsonl` in <ledger-dir>, one JSON object per line,
//   {"file": "characters/areola.md", "from": 3, "to": 18, "card": "character.areola"}
// meaning lines 3 to 18 (1-based, inclusive) of that file went into that card. Workers never edit
// the source, so they can read the same file at the same time. This tool reads every ledger, takes
// those lines out of a copy of each markdown file, and writes what is left under <out-dir>, in the
// same layout. Files with nothing left are not written. It prints a summary as JSON.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** The ledger entries of every lane, and the lines in them that cannot be read. */
export function readLedgers(ledgerDir) {
  const entries = [];
  const problems = [];
  let names = [];
  try {
    names = readdirSync(ledgerDir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {
    return { entries, problems };
  }
  for (const name of names) {
    readFileSync(join(ledgerDir, name), "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (!line.trim()) return;
        try {
          const e = JSON.parse(line);
          if (
            typeof e.file !== "string" ||
            !Number.isInteger(e.from) ||
            !Number.isInteger(e.to) ||
            e.from < 1 ||
            e.to < e.from
          ) {
            throw new Error("needs file, from and to (1-based, from <= to)");
          }
          entries.push({ ...e, lane: name.replace(/\.jsonl$/, "") });
        } catch (err) {
          problems.push(`${name}:${i + 1}: ${err.message}`);
        }
      });
  }
  return { entries, problems };
}

/**
 * Returns { left: Map<file, text>, problems, empty: string[] }. `file` is relative to the source,
 * with forward slashes. A file whose lines are all taken (or blank) is listed in `empty`.
 */
export function remnants(sourceDir, ledgerDir) {
  const { entries, problems } = readLedgers(ledgerDir);
  const taken = new Map();
  for (const e of entries) {
    const file = e.file.replaceAll("\\", "/");
    if (!taken.has(file)) taken.set(file, []);
    taken.get(file).push(e);
  }
  const left = new Map();
  const empty = [];
  const seen = new Set();
  for (const full of markdownFiles(sourceDir)) {
    const file = relative(sourceDir, full).replaceAll("\\", "/");
    seen.add(file);
    const lines = readFileSync(full, "utf8").split(/\r?\n/);
    const gone = new Array(lines.length).fill(false);
    for (const e of taken.get(file) ?? []) {
      if (e.to > lines.length) {
        problems.push(`${e.lane}: ${file} has ${lines.length} lines, the ledger says ${e.to}`);
      }
      for (let n = e.from; n <= Math.min(e.to, lines.length); n++) gone[n - 1] = true;
    }
    const kept = lines.filter((_, i) => !gone[i]);
    if (kept.every((l) => !l.trim())) empty.push(file);
    else left.set(file, kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n");
  }
  for (const file of taken.keys()) {
    if (!seen.has(file)) problems.push(`the ledger names ${file}, which is not in the source`);
  }
  return { left, problems, empty };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) {
  const [source, ledger, out] = process.argv.slice(2);
  if (!source || !ledger || !out) {
    console.error("usage: node remnants.mjs <source-dir> <ledger-dir> <out-dir>");
    process.exit(2);
  }
  const { left, problems, empty } = remnants(source, ledger);
  for (const [file, text] of left) {
    const target = join(out, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  console.log(
    JSON.stringify({ withRemnant: [...left.keys()], fullyPlaced: empty.length, problems }, null, 2),
  );
  process.exit(problems.length ? 1 : 0);
}
