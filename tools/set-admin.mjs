#!/usr/bin/env node
// Human-run: makes a signed-up person a platform administrator, or takes it back. Run it yourself.
//
//   node tools/set-admin.mjs <email> [--off]
//
// Needs DATABASE_URL_BOOTSTRAP in .env (the postgres login, as for db-apply) and `cd tools/db-deps && npm install`.
// The person must already have an account and have finished onboarding. It acts as service_role to call
// identity.set_admin, which the backend's own login cannot call. An administrator can do everything, in every world.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const on = !args.includes('--off');
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('usage: node tools/set-admin.mjs <email> [--off]');
  process.exit(2);
}
if (!env.DATABASE_URL_BOOTSTRAP) {
  console.error('DATABASE_URL_BOOTSTRAP is not set in .env');
  process.exit(1);
}

let pg;
try {
  pg = createRequire(join(root, 'tools', 'db-deps', 'package.json'))('pg');
} catch {
  console.error('pg is not installed here: cd tools/db-deps && npm install');
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.DATABASE_URL_BOOTSTRAP, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query('begin');
  const found = await client.query('select p.user_id from identity.profiles p join auth.users u on u.id = p.user_id where lower(u.email) = $1', [email]);
  if (found.rows.length === 0) throw new Error(`no onboarded account for ${email}`);
  await client.query('set local role service_role');
  await client.query('select identity.set_admin($1, $2)', [found.rows[0].user_id, on]);
  await client.query('commit');
  console.log(`${email} is ${on ? 'now' : 'no longer'} an administrator.`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
