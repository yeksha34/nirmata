#!/usr/bin/env node
// Dry run of the asset import: reads the local dataset folders and reports what an upload to Supabase storage
// would cost. Writes nothing (no database, no storage, no files). Run it yourself.
//
//   node tools/assets-import-dry-run.mjs <world> [--select=latest|all] [--used-bytes=N] [--limit-bytes=N]
//        [--warn=80] [--block=95] [--hash] [--json]
//
// Layout read: worlds/<world>/assets/dataset/<scope>/<name>/<timestamp>/{generated_image.png,prompt.json,feedback.json}
//   --select=latest  one file per <name>: the newest attempt that has an image (default; keeps the free plan small)
//   --select=all     every attempt with an image
//   --used-bytes     what Supabase storage already holds (from assets.storage_status, run by you)
//   --limit-bytes    plan limit (default 1 GiB, the free plan; edit assets.quota_limits to match)
//   --hash           also compute SHA-256 per file (what the real import uses to skip duplicates)
import { readdirSync, statSync, existsSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const world = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
if (!world || !/^[A-Za-z0-9_-]+$/.test(world)) {
  console.error('usage: node tools/assets-import-dry-run.mjs <world> [--select=latest|all] [--used-bytes=N] [--limit-bytes=N] [--warn=80] [--block=95] [--hash] [--json]');
  process.exit(2);
}
const select = opt('select', 'latest');
const usedBytes = Number(opt('used-bytes', '0'));
const limitBytes = Number(opt('limit-bytes', String(1024 ** 3)));
const warnPct = Number(opt('warn', '80'));
const blockPct = Number(opt('block', '95'));
const doHash = args.includes('--hash');
const asJson = args.includes('--json');
if (!['latest', 'all'].includes(select) || [usedBytes, limitBytes, warnPct, blockPct].some((n) => !Number.isFinite(n) || n < 0) || limitBytes === 0 || warnPct >= blockPct) {
  console.error('bad option value');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = join(root, 'worlds', world, 'assets', 'dataset');
if (!existsSync(dataset)) {
  console.error(`no dataset folder: worlds/${world}/assets/dataset`);
  process.exit(1);
}

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const sha256 = (file) =>
  new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', fail);
  });

const scopes = {};
const noImage = [];
let attempts = 0;
const picked = [];
for (const scope of dirs(dataset)) {
  const s = (scopes[scope] ??= { names: 0, attempts: 0, withImage: 0, picked: 0, bytes: 0 });
  for (const name of dirs(join(dataset, scope))) {
    s.names++;
    const runs = dirs(join(dataset, scope, name)).sort();         // timestamps sort oldest to newest
    const withImage = [];
    for (const run of runs) {
      attempts++;
      s.attempts++;
      const img = join(dataset, scope, name, run, 'generated_image.png');
      if (existsSync(img)) {
        s.withImage++;
        withImage.push({ scope, name, run, file: img, bytes: statSync(img).size });
      } else {
        noImage.push(`${scope}/${name}/${run}`);
      }
    }
    const chosen = select === 'all' ? withImage : withImage.slice(-1);
    for (const c of chosen) {
      s.picked++;
      s.bytes += c.bytes;
      picked.push(c);
    }
  }
}

if (doHash) {
  const seen = new Map();
  for (const p of picked) {
    p.sha256 = await sha256(p.file);
    const first = seen.get(p.sha256);
    if (first) p.duplicateOf = first; else seen.set(p.sha256, `${p.scope}/${p.name}/${p.run}`);
  }
}

const total = picked.reduce((n, p) => n + p.bytes, 0);
const dupBytes = picked.filter((p) => p.duplicateOf).reduce((n, p) => n + p.bytes, 0);
const pct = ((usedBytes + total) * 100) / limitBytes;
const level = pct >= blockPct ? 'block' : pct >= warnPct ? 'warn' : 'ok';
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const report = {
  world, select, attempts, attemptsWithImage: Object.values(scopes).reduce((n, s) => n + s.withImage, 0),
  attemptsWithoutImage: noImage.length, filesToUpload: picked.length, bytesToUpload: total,
  duplicateBytes: doHash ? dupBytes : null, usedBytes, limitBytes, pctAfter: Number(pct.toFixed(2)), level, scopes,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`world ${world}   select=${select}   (nothing is written)`);
  for (const [name, s] of Object.entries(scopes))
    console.log(`  ${name.padEnd(24)} ${String(s.names).padStart(4)} names  ${String(s.attempts).padStart(4)} attempts  ${String(s.withImage).padStart(4)} with image  ${String(s.picked).padStart(4)} to upload  ${mb(s.bytes).padStart(10)}`);
  console.log(`attempts: ${attempts}, with image: ${report.attemptsWithImage}, without image: ${noImage.length}`);
  if (noImage.length) {
    console.log('  without image (first 10):');
    for (const n of noImage.slice(0, 10)) console.log(`    ${n}`);
  }
  console.log(`would upload: ${picked.length} files, ${mb(total)}`);
  if (doHash) console.log(`  identical content: ${picked.filter((p) => p.duplicateOf).length} files, ${mb(dupBytes)} (the import skips these)`);
  console.log(`storage: ${mb(usedBytes)} used of ${mb(limitBytes)}; after upload ${pct.toFixed(1)}%  -> ${level.toUpperCase()}`);
  if (level !== 'ok') console.log(`  ${level === 'block' ? 'The real import would be refused.' : 'The real import would warn.'} Try --select=latest, or upload only approved files.`);
  if (!doHash) console.log('add --hash to find identical files');
}
process.exitCode = level === 'block' ? 3 : 0;
