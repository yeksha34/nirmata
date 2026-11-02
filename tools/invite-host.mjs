#!/usr/bin/env node
// Human-run: invites the first world host (or any person who may found worlds). Run it yourself.
//
//   node tools/invite-host.mjs <email> [--days=7]
//
// Needs DATABASE_URL_BOOTSTRAP in .env (the postgres login, as for db-apply) and `cd tools/db-deps && npm install`.
// It acts as migration_owner to call identity.create_host_invitation, which only the owner and the service role may call.
// The invitation token is printed once and stored only as a hash; send the link to that person. Sign-up with that
// address then works (Supabase's before-user-created hook allows it), and accepting the invitation lets them found worlds.
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
const days = Number(args.find((a) => a.startsWith('--days='))?.slice(7) ?? '7');
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !Number.isInteger(days) || days < 1 || days > 30) {
  console.error('usage: node tools/invite-host.mjs <email> [--days=1..30]');
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
  await client.query('set local role migration_owner');
  const res = await client.query('select identity.create_host_invitation($1, make_interval(days => $2)) as token', [email, days]);
  await client.query('commit');
  const site = (env.NIRMATA_SITE_URL || `http://127.0.0.1:${env.NIRMATA_PORT || 8788}`).replace(/\/+$/, '');
  console.log(`Invitation for ${email}, valid ${days} days.`);
  console.log(`Send this link (shown once, not stored):\n  ${site}/accept-invite?token=${res.rows[0].token}`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
