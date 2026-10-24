#!/usr/bin/env node
// CLI wrapper around lib.mjs's selectRuleGroups() -- see lib.mjs for the
// actual selection logic and mcp-server.mjs for the MCP-tool version of
// this same entry point.
//
// Usage:
//   node select.mjs --text-file <path> [--target cards|prose] [--exclude-universal] [--only slug1,slug2]
//   cat card.md | node select.mjs [--target cards|prose]
//
// Prints one JSON object: { checked: [{slug,title,scope,reason,ruleText}], skipped: [{slug,reason}] }

import { readFileSync } from 'node:fs';
import { selectRuleGroups } from './lib.mjs';

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function parseArgs(argv) {
  const out = { target: null, excludeUniversal: false, only: null, textFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text-file') out.textFile = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--exclude-universal') out.excludeUniversal = true;
    else if (a === '--only') out.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const text = args.textFile ? readFileSync(args.textFile, 'utf8') : readStdin();
if (!text.trim()) {
  console.error('No input text (pass --text-file <path> or pipe text on stdin).');
  process.exit(2);
}

try {
  const result = selectRuleGroups(text, { target: args.target, excludeUniversal: args.excludeUniversal, only: args.only });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
