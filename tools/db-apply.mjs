#!/usr/bin/env node
// Applies db/ migrations in db/order.txt order. A HUMAN runs this, agents do not (AGENTS.md).
//   cd tools/db-deps && npm install
//   node tools/db-apply.mjs --dry     list what would run
//   node tools/db-apply.mjs           apply what is not applied yet, then set the app role passwords
// Uses DATABASE_URL_BOOTSTRAP (user postgres) for everything: 001 runs as postgres, every other file runs
// after `set role migration_owner` so the objects are owned by it. Applied files are recorded in
// supabase_migrations.schema_migrations. Prints file names and errors only, never a secret or a row.
import { readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const dry = process.argv.includes('--dry');
const files = readFileSync(join(root, 'db', 'order.txt'), 'utf8').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

if (dry) { files.forEach((f, i) => console.log(`${i === 0 ? 'bootstrap' : 'owner    '}  ${f}`)); process.exit(0); }

for (const k of ['DATABASE_URL_BOOTSTRAP', 'APP_RW_PASSWORD', 'APP_RO_PASSWORD'])
  if (!env[k]) { console.error(`${k} is empty`); process.exit(2); }

let pg;
try { pg = (await import(pathToFileURL(createRequire(join(root, 'tools', 'db-deps', 'package.json')).resolve('pg')).href)).default; } catch { console.error('run: cd tools/db-deps && npm install pg'); process.exit(2); }

const c = new pg.Client({ connectionString: env.DATABASE_URL_BOOTSTRAP, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
try { await c.connect(); } catch (e) { console.error('cannot connect as bootstrap:', e.code || e.message); process.exit(1); }

const fail = (what, e) => { console.error(`FAIL ${what}: ${e.code ?? ''} ${e.message}${e.position ? ` (char ${e.position})` : ''}`); process.exit(1); };

try {
  await c.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])`);
} catch (e) { fail('tracking table', e); }
const done = new Set((await c.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));

for (const [i, f] of files.entries()) {
  const name = basename(f);
  const version = name.split('_')[0];
  if (done.has(version)) { console.log(`skip   ${f}`); continue; }
  const sql = readFileSync(join(root, 'db', f), 'utf8');
  try {
    await c.query('begin');
    if (i > 0) await c.query('set role migration_owner');
    await c.query(sql);
    await c.query('reset role');
    if (i === 0) {
      // let the bootstrap login assume migration_owner (newer Postgres does not grant SET to the creator)
      try { await c.query('grant migration_owner to current_user with set true'); }
      catch { await c.query('grant migration_owner to current_user'); }
    }
    await c.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [version, name]);
    await c.query('commit');
    console.log(`applied ${f}`);
  } catch (e) { await c.query('rollback').catch(() => {}); fail(f, e); }
}

try {
  await c.query(`alter role app_rw password ${pg.escapeLiteral(env.APP_RW_PASSWORD)}; alter role app_ro password ${pg.escapeLiteral(env.APP_RO_PASSWORD)}`);
  console.log('set    app_rw and app_ro passwords');
} catch (e) { fail('role passwords', e); }

await c.end();
console.log('done. next: node tools/db-doctor.mjs --login');
