# db

Supabase/Postgres migrations for Nirmata. The design is in [docs/supabase-database-plan.md](../docs/supabase-database-plan.md).
Nothing in this folder may contain world or story content ([ADR-0005](../docs/decisions/0005-scaffold-content-neutral.md)).

```
db/
  order.txt                      cross-schema order (the only list that matters)
  <schema>/migrations/*.sql      one folder per schema, <UTC timestamp>_<name>.sql
  tests/*.sql                    pgTAP
```

| Command | Does |
|---|---|
| `node tools/db-build.mjs` | copies the migrations, in order, to `supabase/migrations/` (generated, git-ignored) |
| `node tools/db-apply.mjs [--dry]` | human-run: applies unapplied migrations via `DATABASE_URL_BOOTSTRAP`, then sets the app role passwords (needs `cd tools/db-deps && npm install`) |
| `node tools/db-apply.mjs --reset --yes` | development only: drops the nine schemas and forgets applied files, then run `db-apply` again |
| `node tools/db-build.mjs --check` | verifies order, names and that every file is listed |
| `FORBIDDEN_TERMS_FILE=<path outside the repo> node tools/db-check-neutral.mjs` | fails if any line contains a forbidden term; fails closed if the file is missing |

## Running migrations

Files under `_bootstrap/` run as `postgres` (the only role that can touch Supabase's `auth` schema); all others run as `migration_owner`. They use
 `DATABASE_URL_BOOTSTRAP` (user `postgres`). Everything else uses `DATABASE_URL_MIGRATOR`.

Migrations run as a login that is a member of `migration_owner` and does `set role migration_owner`
first, so every object is owned by it. The app never uses that role. `_bootstrap` runs once as a
superuser (or Supabase's `postgres`).

Set role passwords (`app_rw`, `app_ro`) outside the repo. In the Auth settings turn off sign-ups and
every provider except the SSO one, and set the before-user-created hook to
`pg-functions://postgres/identity/hook_before_user_created`. Add the provider's adult-claim rule to
`identity.idp_age_rules` as configuration (no rows ship).

## Status

| # | Migration | State |
|---|---|---|
| 001 | roles and schemas | applied |
| 002 | platform core | applied |
| 003 | identity | applied |
| 004 | membership, accept_invitation | applied |
| 005 | world_lore | applied |
| 006 | story_run | applied |
| 007 | reader | applied |
| 008 | platform templates | applied |
| 009 | vn_content | applied |
| 009b | platform server guard (is_server) | applied |
| 010 | assets | applied |
| 011 | generation | applied |
| 011b | membership path and channel helpers | applied |
| 012 | storage buckets and policies, realtime channel policy (bootstrap) | applied |
| 013 | seeds: default workflow and VN templates | applied |
| 014 | server grants (service_role may run the generation worker) | written, syntax-checked |

"Applied" means a person ran it with `tools/db-apply.mjs` against the project. "Written, syntax-checked" means the file
parses with the Postgres parser (every PL/pgSQL body included) but has not been run. `db/tests` has not been run.

## Tests

pgTAP, in `db/tests/`. Enable the `pgtap` extension (Dashboard, Database, Extensions), then paste a file into the
SQL editor (runs as `postgres`). Each file ends in `rollback`, so nothing is left behind.

| File | Covers |
|---|---|
| `001_baseline.sql` | anon holds nothing, `app_ro` cannot write, views use the caller's rights, RLS on every table, invitation state machine |
| `002_flows.sql` | the main flows as host, moderator, player, outsider and the server: roles, lore and secrets, stories and moderation, chapters, VNs and pins, assets and jobs, templates and validation, file and channel helpers, anon |

Both files parse with the Postgres parser; neither has been run yet.
