# F-73: The story (chapters, drafts, world.json) in the database

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `adaptation-in-the-database` once the database parts have run |

## Value
The text the adaptation agent adapts, and the manifest the host runs the world by, are rows. With [F-70](F-70-adaptation-agent-in-the-database.md) to [F-72](F-72-vn-content-in-the-database.md) an imported world no longer needs its folder for anything an adaptation touches ([ADR-0035](../decisions/0035-adaptation-data-in-the-database.md), [ADR-0036](../decisions/0036-chapters-and-drafts-as-writings.md)). The folder still holds `stories/` (saved play) and the asset images.

## Acceptance criteria
- [x] `reader.writings` keeps each chapter, scene and draft by path (authors only); `reader.save_writing` / `remove_writing`; an edit keeps the import mark.
- [x] `world_lore.worlds.manifest` and `world_lore.save_world_manifest` hold what `world.json` held.
- [x] `WorldFiles.writings/writing` list and read chapters and drafts from the database for a world that is in it (scenes and index files left out of the lists as before); what the database does not hold is not found. `world()` and `exists()` read the manifest from the database first, then `world.json`.
- [x] `import:world` also copies `world.json` and every markdown file under `chapters/` and `drafts/` (`--no-story` skips); an unchanged text is skipped, a file newer than an unedited copy replaces it, a text edited in the database is kept and listed unless `--force`.
- [x] Agent endpoints: `GET …/worlds/:name` (manifest and counts), `GET …/writings`, `GET/PUT/DELETE …/writing?path=`.
- [ ] The migrations and `db/tests/014_story_in_the_database.sql` run on a real database.
- [ ] `import:world --publish` on a real world folder copies everything (cards, story, visual novels) and the Studio and workspace show it with the folder moved away.
- [ ] Tried with a real agent reading a chapter and saving an adaptation.

## Non-goals
- The stories under `stories/` (saved play) and `story_run`.
- Publishing a writing to readers (`reader.chapters`), and the editing of writings in the web app (it only reads them).
- Removing a writing from the database when its file is deleted: an import adds and updates, it does not delete.

## Design
- Two migrations: `reader/…0700_writings.sql`, `world_lore/…0710_world_manifest.sql`.
- `WritingStore`, `WorldStore` in `apps/adaptation`; `importWorldStory` in `apps/importer`. `WorldFiles` takes its database sources as one options object (`DbSources`).
- The manifest read is cached for 5 seconds per author and world, since the host reads it many times a request.
- A folder is matched to its world by `slugFor(folder name)`; `import:world --slug` with another name keeps the file as the manifest.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-04 | `tsc -b`; full test suite | Pass |
| 2026-11-04 | Migrations, pgTAP 014, `import:world` on a folder | Not run yet |

## History
| Date | Change |
|---|---|
| 2026-11-04 | Writings table, world manifest column, store and library reads, importer, agent endpoints, ADR-0036. |
