#!/usr/bin/env node
// Connection and access check for the Supabase setup. A HUMAN runs this, agents do not (AGENTS.md).
//   node tools/db-doctor.mjs            static + DNS + TCP checks (no login)
//   node tools/db-doctor.mjs --login    also logs in as each role (needs `cd tools/db-deps && npm install`)
// Prints pass/fail and counts only: never a secret, never a row.
import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const env = {};
try {
  for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { console.error('no .env'); process.exit(2); }

let bad = 0;
const ok = (m) => console.log('  ok   ', m);
const no = (m, fix) => { bad++; console.log('  FAIL ', m); if (fix) console.log('       fix:', fix); };

function parse(key) {
  const v = env[key];
  if (!v) return no(`${key} is empty`, 'fill it in .env');
  try { return new URL(v); } catch {
    no(`${key} is not a valid URL`, 'percent-encode the password (? -> %3F, @ -> %40, # -> %23, / -> %2F)');
  }
}

console.log('1. variables');
for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'APP_RW_PASSWORD', 'APP_RO_PASSWORD'])
  env[k] ? ok(`${k} set`) : no(`${k} empty`);
if (!env.SUPABASE_SERVICE_ROLE_KEY) no('SUPABASE_SERVICE_ROLE_KEY empty', 'needed only by the backend worker; fill before step 5 (generation)');

const urls = {};
for (const k of ['DATABASE_URL_RW', 'DATABASE_URL_RO', 'DATABASE_URL_MIGRATOR', 'DATABASE_URL_BOOTSTRAP']) {
  const u = parse(k);
  if (!u) continue;
  urls[k] = u;
  const user = decodeURIComponent(u.username);
  const pooler = /pooler\.supabase\.com$/.test(u.hostname);
  const want = { DATABASE_URL_RW: 'app_rw', DATABASE_URL_RO: 'app_ro', DATABASE_URL_MIGRATOR: 'migration_owner', DATABASE_URL_BOOTSTRAP: 'postgres' }[k];
  user.split('.')[0] === want ? ok(`${k} logs in as ${want}`) : no(`${k} user is "${user}", expected ${want}`);
  if (k === 'DATABASE_URL_MIGRATOR' || k === 'DATABASE_URL_BOOTSTRAP') {
    if (!pooler) console.log('  note  ' + k + ' uses the direct host (IPv6 only); if the network test fails, use the session pooler string');
  } else {
    if (!pooler) no(`${k} uses the direct host`, 'use the pooler string (Project > Connect > Transaction/Session pooler); the user becomes app_rw.<project-ref>. The direct host is IPv6 only and fails on most home networks');
    else if (!user.includes('.')) no(`${k} on the pooler needs the user as ${want}.<project-ref>`);
    else ok(`${k} uses the pooler`);
    const pw = k.endsWith('RW') ? env.APP_RW_PASSWORD : env.APP_RO_PASSWORD;
    decodeURIComponent(u.password) === pw ? ok(`${k} password matches its APP_*_PASSWORD`) : no(`${k} password differs from APP_*_PASSWORD`);
  }
}
if (urls.DATABASE_URL_RW && urls.DATABASE_URL_RO && urls.DATABASE_URL_RW.username === urls.DATABASE_URL_RO.username)
  no('RW and RO use the same user', 'RO must log in as app_ro');

const staticOnly = process.argv.includes('--static');
if (!staticOnly) console.log('2. network');
for (const [k, u] of staticOnly ? [] : Object.entries(urls)) {
  try {
    const addrs = await lookup(u.hostname, { all: true });
    const v6only = addrs.every((a) => a.family === 6);
    ok(`${k} host resolves (${addrs.map((a) => 'IPv' + a.family).join(', ')})`);
    const port = Number(u.port || 5432);
    await new Promise((res, rej) => {
      const s = connect({ host: u.hostname, port, timeout: 6000 }, () => { s.destroy(); res(); });
      s.on('timeout', () => { s.destroy(); rej(new Error('timeout')); });
      s.on('error', rej);
    }).then(() => ok(`${k} port ${port} reachable`),
      (e) => no(`${k} port ${port}: ${e.code || e.message}`, v6only ? 'host is IPv6 only; use the pooler host' : 'check firewall / project paused'));
  } catch (e) { no(`${k} DNS: ${e.code || e.message}`); }
}

if (process.argv.includes('--login')) {
  console.log('3. login and access');
  let pg;
  try { pg = (await import(pathToFileURL(createRequire(new URL('./db-deps/package.json', import.meta.url)).resolve('pg')).href)).default; } catch { no('pg not installed', 'cd tools/db-deps && npm install pg'); }
  if (pg) {
    const run = async (k, label, sql, expect) => {
      const u = urls[k];
      if (!u) return;
      const c = new pg.Client({ connectionString: u.href, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
      try { await c.connect(); } catch (e) { return no(`${label}: cannot log in (${e.code || e.message})`, e.code === '28P01' || /password/i.test(e.message) ? 'role missing or wrong password: run migration 001, then ALTER ROLE ... PASSWORD' : undefined); }
      try {
        const r = await c.query(sql);
        const v = r.rows[0]?.v;
        expect(v) ? ok(`${label}: ${r.rows[0].note ?? v}`) : no(`${label}: got ${v}`);
      } catch (e) { /error/i.test(label) ? ok(`${label}`) : no(`${label}: ${e.code || e.message}`); }
      finally { await c.end().catch(() => {}); }
    };
    await run('DATABASE_URL_MIGRATOR', 'migrator connects', 'select current_user v', (v) => !!v);
    await run('DATABASE_URL_MIGRATOR', 'nine schemas present',
      "select count(*)::int v from pg_namespace where nspname in ('identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')",
      (v) => v === 9);
    await run('DATABASE_URL_RW', 'app_rw connects, default role is read/write',
      "select current_setting('transaction_read_only') v", (v) => v === 'off');
    await run('DATABASE_URL_RO', 'app_ro connects and is read-only',
      "select current_setting('transaction_read_only') v", (v) => v === 'on');
    await run('DATABASE_URL_RO', 'app_ro cannot write (expects an error)',
      'create temp table _x(i int)', () => false); // reaching here means it could write
  }
}

console.log(bad ? `\n${bad} problem(s)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
