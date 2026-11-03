# F-72: Visual novel content in the database

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `adaptation-in-the-database` once the database parts have run |

## Value
A visual novel's manifest, script (`adaptation.md`) and compiled slides are rows in the database, not three files in the world's folder. The adaptation agent saves and compiles them through the backend; the Studio and the player read them from the database. Third slice after [F-70](F-70-adaptation-agent-in-the-database.md) and [F-71](F-71-workflow-templates-in-the-database.md) ([ADR-0035](../decisions/0035-adaptation-data-in-the-database.md)).

## Acceptance criteria
- [x] `vn_content.vn_drafts` holds `adaptation_md` and `slides` beside the manifest; `vn_content.save_vn` makes the visual novel on first save (pinned to the latest published version of the world's main line, with its workflow pins) and keeps any part that is not sent.
- [x] `WorldFiles.vns/vn/saveVn/scaffoldVn/compileVn` (and everything that reads a manifest through them: the asset plan, the Studio lists) use the database for a world that is in it and the folder otherwise; scaffolding writes no files for such a world.
- [x] `import:world` also copies `vns/*` (manifest, script, slides); a visual novel that already differs in the database is kept and listed unless `--force`; `--no-vns` skips it.
- [x] Agent endpoints: `GET …/vns`, `GET …/vns/:slug`, `PUT …/vns/:slug` (manifest validated, its slug must match), `POST …/vns/:slug/compile`.
- [x] The migration and `db/tests/013_vn_draft_content.sql` run on a real database (owner, 2026-11-04).
- [ ] `import:world` copies `vns/*` from a real world folder (held until chapters and drafts are importable too, F-73).
- [ ] Tried with a real agent: save a chapter's adaptation, compile, open it in the Studio.
- [ ] The Studio's asset plan for an imported world reads the database plan (still the manifest's `assets`).

## Non-goals (next: F-73)
- Chapters, drafts and `world.json` (`reader.*`). The adaptation agent still reads the story's text from files until they are imported.
- Routes, scenes, scene revisions and `publish_vn`: a visual novel here is its working copy. Publishing it as versions comes with player access for non-authors; a non-author member cannot read a working copy.
- The Studio "Agent access" panel.

## Design
- Migration `20261103000600_vn_draft_content.sql`. The core tier names (`micro`/`short`/`mid`/`large`) map to the database's three (`short`/`medium`/`long`); the exact tier stays in the manifest.
- `apps/adaptation/src/vn-store.ts`: `VnStore` and `VnSource` (what the library asks), read and written as the signed-in author. `apps/importer/src/vn-import.ts` does the same copy with SQL only (the importer does not depend on the adaptation package).
- A world "is in the database" when `world_lore.worlds` has it; a database that fails raises (no silent fallback to files).
- Creating a visual novel needs a published world version: `import:world --publish` the first time.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | `tsc -b`; full test suite | Pass |
| 2026-11-04 | Migration and pgTAP 013 | Pass (owner) |
| | `import:world` on a folder | Not run yet (held for F-73) |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Working copy columns, `save_vn`, store, library delegation, importer, agent endpoints. |
