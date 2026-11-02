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
| `node tools/db-apply.mjs [--dry] [--passwords]` | human-run: applies unapplied migrations via `DATABASE_URL_BOOTSTRAP`; `--passwords` also sets the app role passwords (the pooler caches the old hash for a minute or two) (needs `cd tools/db-deps && npm install`) |
| `node tools/db-apply.mjs --reset --yes` | development only: drops the nine schemas and forgets applied files, then run `db-apply` again |
| `node tools/db-build.mjs --check` | verifies order, names and that every file is listed |
| `FORBIDDEN_TERMS_FILE=<path outside the repo> node tools/db-check-neutral.mjs` | fails if any line contains a forbidden term; fails closed if the file is missing |
| `node tools/assets-import-dry-run.mjs <world> [--select=latest or all] [--used-bytes=N] [--hash]` | read-only: counts dataset files and bytes an upload would use, finds identical files, and shows the quota level it would reach (no database or storage access) |
| `node tools/invite-host.mjs <email> [--days=7]` | human-run: invites the first host (or anyone who may found worlds) and prints the one-time link; uses `DATABASE_URL_BOOTSTRAP` |

## Running migrations

Files under `_bootstrap/` run as `postgres` (the only role that can touch Supabase's `auth` schema); all others run as `migration_owner`. They use
 `DATABASE_URL_BOOTSTRAP` (user `postgres`). Everything else uses `DATABASE_URL_MIGRATOR`.

Migrations run as a login that is a member of `migration_owner` and does `set role migration_owner`
first, so every object is owned by it. The app never uses that role. `_bootstrap` runs once as a
superuser (or Supabase's `postgres`).

Set role passwords (`app_rw`, `app_ro`) outside the repo (`node tools/db-apply.mjs --passwords`).

Sign-in is email and password for now; SSO is a separate scope. In the Auth settings leave email sign-up on, turn
"Confirm email" on, turn every other provider off, and set the before-user-created hook to
`pg-functions://postgres/identity/hook_before_user_created`. The hook refuses any email without a pending
invitation, so sign-up stays invitation-only. With no SSO there is no provider claim, so each person confirms
they are an adult after sign-in (`identity.attest_adult`). When SSO is added later, its adult-claim rule goes
in `identity.idp_age_rules` as configuration (no rows ship).

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
| 014 | server grants (service_role may run the generation worker) | applied |
| 015 | repair: platform.uid() and jwt() executable by signed-in roles | applied |
| 016 | repair: render path check used a repetition count above the regex limit | applied |
| 017 | repair: row level security on platform.publish_status_history | applied |
| 018 | renders record their store (supabase/local/none), size and hash; `set_render_store`; `v_store_usage` | applied |
| 019 | storage quota: editable limits and `assets.storage_status` (server only: used, level ok/warn/block, daily alert) | applied |
| 020 | `assets.render_file`: where a render's file is, for the backend (the server sees all; a person must be a member) | applied |

"Applied" means a person ran it with `tools/db-apply.mjs` against the project. "Written, syntax-checked" means the file
parses with the Postgres parser (every PL/pgSQL body included) but has not been run. `db/tests` has not been run.

## Tests

pgTAP, in `db/tests/`. Enable the `pgtap` extension (Dashboard, Database, Extensions), then paste a file into the
SQL editor (runs as `postgres`). Each file ends in `rollback`, so nothing is left behind.

| File | Covers |
|---|---|
| `001_baseline.sql` | anon holds nothing, `app_ro` cannot write, views use the caller's rights, RLS on every table, invitation state machine |
| `002_flows.sql` | the main flows as host, moderator, player, outsider and the server: roles, lore and secrets, stories and moderation, chapters, VNs and pins, assets and jobs, templates and validation, file and channel helpers, anon |
| `003_render_store.sql` | where a render's file lives: store, size and hash, moving between stores, who may do it, the usage view |
| `004_quota.sql` | the quota check: what counts, the levels, the daily alert, who may call it |
| `005_render_file.sql` | the file lookup: member, outsider, server, anon, unknown id |

Pass on the project: `001_baseline.sql` 16 of 16, `002_flows.sql` 69 of 69. `003_render_store.sql` 27 of 27. `004_quota.sql` 12 of 12. `005_render_file.sql` 6 of 6. Not covered yet: invitation acceptance end to end, the Auth hook, rebase and rollback, the dataset views.
