# F-62: Supabase database

| | |
|---|---|
| State | Released |
| Priority | Must |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `v0.3.0-supabase-database` |

## Value
Worlds, stories, assets and accounts have one durable, access-controlled home instead of loose files, which is what a hosted, multi-person Nirmata needs.

## Acceptance criteria
- [x] Migrations 001-022 listed in `db/order.txt` apply in order to a Supabase project with `node tools/db-apply.mjs`, and `node tools/db-doctor.mjs --login` passes.
- [x] Row level security is on every table; `anon` holds nothing; `app_ro` cannot write; views use the caller's rights (pgTAP 001, 16 of 16).
- [x] The main flows work as author, moderator, player, outsider and the server: roles, lore and Secrets, stories and moderation, chapters, visual novels and pins, assets and jobs, templates, file and channel helpers, anon (pgTAP 002, 69 of 69).
- [x] Render stores, the storage quota, the render file lookup, the invitation lookup and the four roles each have a passing test (003 27, 004 12, 005 6, 006 5, 007 12).
- [x] No migration, seed or comment contains story content; seeds are lookups, defaults and the bundled workflow graphs.

## Non-goals
- The Auth hook end to end, rebase and rollback, and the dataset views are not tested yet (listed in `db/README.md`).
- A read replica, scheduled jobs (invitation expiry, outbox and job retention, orphan check) and the nightly checks in the plan are not built.

## Design
[Supabase database plan](../supabase-database-plan.md); ADRs [0005](../decisions/0005-scaffold-content-neutral.md), [0026](../decisions/0026-generation-jobs-and-status-store.md), [0027](../decisions/0027-database-is-lore-source-of-truth.md), [0028](../decisions/0028-asset-files-served-by-backend-from-any-store.md), [0029](../decisions/0029-roles-admin-author-moderator-player.md).

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-02 | `node tools/db-apply.mjs` for 001-021; pgTAP 001, 002, 003, 004, 005, 006 in the SQL editor as `postgres` | All applied; 16/16, 69/69, 27/27, 12/12, 6/6, 5/5 |
| 2026-11-03 | `node tools/db-apply.mjs` for 022 (45 functions re-created, closing check passed); pgTAP 001, 002, 006, 007; `db-doctor --login` | Applied; 16/16, 69/69, 5/5, 12/12; all doctor checks passed |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written for release v0.3.0-supabase-database; state Released. |
