#!/usr/bin/env node
// Finds dataset images with identical content and removes the extra copies. Run it yourself.
// Only generated_image.png is removed; prompt.json and feedback.json stay, so the asset can be generated again
// and the import skips it until it has an image.
//
//   node tools/assets-dedupe.mjs <world>                         list groups of identical images
//   node tools/assets-dedupe.mjs <world> --init=<keep.json>      write a keep file to fill in (hash -> the one name to keep)
//   node tools/assets-dedupe.mjs <world> --keep=<keep.json>      dry run: show what would be removed
//   node tools/assets-dedupe.mjs <world> --keep=<keep.json> --delete --yes     remove the extras
//
// The keep file maps a group's short hash to the <scope>/<name> that really owns the image. A group with no entry
// (null or missing) is left alone. A name that is not in its group stops the run.
import { readdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const world = args.find((a) => !a.startsWith('--'));
const opt = (n) => args.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
if (!world || !/^[A-Za-z0-9_-]+$/.test(world)) {
  console.error('usage: node tools/assets-dedupe.mjs <world> [--init=<file> | --keep=<file> [--delete --yes]]');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = join(root, 'worlds', world, 'assets', 'dataset');
if (!existsSync(dataset)) { console.error(`no dataset folder: worlds/${world}/assets/dataset`); process.exit(1); }

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const sha = (f) => new Promise((ok, no) => { const h = createHash('sha256'); createReadStream(f).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', no); });

const groups = new Map();                           // short hash -> [{ key: scope/name, file }]
for (const scope of dirs(dataset))
  for (const name of dirs(join(dataset, scope)))
    for (const run of dirs(join(dataset, scope, name))) {
      const file = join(dataset, scope, name, run, 'generated_image.png');
      if (!existsSync(file)) continue;
      const h = (await sha(file)).slice(0, 12);
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h).push({ key: `${scope}/${name}`, run, file });
    }
const dups = [...groups].filter(([, m]) => m.length > 1).sort((a, b) => b[1].length - a[1].length);

if (opt('init')) {
  const out = Object.fromEntries(dups.map(([h]) => [h, null]));
  writeFileSync(resolve(opt('init')), JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${opt('init')}: set each hash to the one <scope>/<name> to keep (null leaves the group alone)`);
  process.exit(0);
}

if (!opt('keep')) {
  for (const [h, m] of dups) console.log(`${h}  ${m.length} copies: ${m.map((x) => x.key).join(', ')}`);
  console.log(`${dups.length} groups, ${dups.reduce((n, [, m]) => n + m.length - 1, 0)} extra files`);
  process.exit(0);
}

const keep = JSON.parse(readFileSync(resolve(opt('keep')), 'utf8'));
const doDelete = args.includes('--delete') && args.includes('--yes');
let removed = 0, skipped = 0;
for (const [h, m] of dups) {
  const k = keep[h];
  if (!k) { skipped += m.length; continue; }
  if (!m.some((x) => x.key === k)) { console.error(`${h}: "${k}" is not in that group`); process.exit(1); }
  for (const x of m.filter((y) => y.key !== k)) {
    console.log(`${doDelete ? 'remove' : 'would remove'}  ${x.key}/${x.run}/generated_image.png`);
    if (doDelete) unlinkSync(x.file);
    removed++;
  }
}
console.log(`${doDelete ? 'removed' : 'would remove'} ${removed} files; ${skipped} files in groups without a keep entry were left alone`);
if (!doDelete) console.log('add --delete --yes to remove them');
