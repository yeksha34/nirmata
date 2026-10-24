#!/usr/bin/env node
// Node port of the old compact_rules.py -- proof of concept for dropping
// the Python stack entirely (see the story-editor session's own notes on
// why Python existed at all: only the LLM-calling scripts needed it, and
// this one never called an LLM). Reuses driver.mjs's own file index rather
// than re-walking the story root, so it can never disagree with what the
// rest of the toolchain (the editor, the link-checker) considers "the
// corpus."
//
// Extracts compact keywords from all rules and cards (.agents/rules,
// characters, lore, setting) and writes them into a single file to save
// context space. Excludes plot/arcs and chapters.
//
// Usage: node tools/compact_rules.mjs [output_path]
// Default output: stories/<active>/sanitized_output/rules_and_cards_compact.txt

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getFiles, rel, ROOT } from '../.agents/skills/world-lint/driver.mjs';

const INCLUDE_PREFIXES = ['.agents/rules/', 'characters/', 'lore/', 'setting/'];
const EXCLUDE_PREFIXES = ['plot/', 'chapters/'];

function getKeywords(text) {
  const m = text.match(/^keywords:\s*(.+)$/m);
  return m ? m[1].trim() : 'No keywords defined.';
}

function collectFiles() {
  return getFiles()
    .map((f) => ({ abs: f, relPath: rel(f) }))
    .filter(({ relPath }) => INCLUDE_PREFIXES.some((p) => relPath.startsWith(p)))
    .filter(({ relPath }) => !EXCLUDE_PREFIXES.some((p) => relPath.startsWith(p)))
    // Plain codepoint order, not .localeCompare() -- this machine's default
    // ICU locale is hi-IN, which reorders ASCII paths unpredictably (see
    // driver.mjs's own Number.toLocaleString('en-US') gotcha for the same
    // root cause). Python's sorted() on strings is codepoint order, so this
    // is also what keeps output identical to the old script's.
    .sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

function main() {
  const outPath = process.argv[2] || join(ROOT, 'sanitized_output', 'rules_and_cards_compact.txt');
  mkdirSync(dirname(outPath), { recursive: true });

  const files = collectFiles();
  const parts = files.map(({ abs, relPath }) => {
    const keywords = getKeywords(readFileSync(abs, 'utf8'));
    return `### ${relPath}\nKeywords: ${keywords}`;
  });

  writeFileSync(outPath, parts.join('\n\n') + '\n', 'utf8');
  console.log(`Wrote ${outPath} (${files.length} files)`);
}

main();
