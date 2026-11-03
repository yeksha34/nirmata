# F-64: Import a world and read it from the database

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `v0.3.0-supabase-database` |

## Value
An imported world has one source of truth that survives the folder, and storage stays within the free plan.

## Acceptance criteria
- [x] `import:world <folder> --user=<id> --dry` and the real run complete against the project (owner, 2026-11-03).
- [x] Cards the app edited are kept on a re-import unless `--force` (unit tests).
- [ ] `import:assets` uploads the newest run per asset within the quota and records asset, spec and render.
- [ ] The world page shows the Database badge and the cards load; the gallery serves images from storage for the host's own cookie only.
- [ ] Deleting a gallery run removes the file and frees quota; an asset's current image is refused.

## Non-goals
- `world.json`, chapters and drafts, stories, visual novel manifests and images stay in files.
- Publishing from the app (the importer's `--publish` freezes a version).

## Design
[ADR-0028](../decisions/0028-asset-files-served-by-backend-from-any-store.md), [ADR-0030](../decisions/0030-imported-worlds-read-lore-from-the-database.md); `apps/server/src/lore-*.ts`, `image-store.ts`, `apps/gen/src/import-dataset.ts`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | `import:world` run by the owner; unit tests with fake databases (736 passing) | World imported; the rest awaits a live run |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written for release v0.3.0-supabase-database; state Review. |
