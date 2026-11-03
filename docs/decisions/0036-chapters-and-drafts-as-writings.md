# ADR-0036: Chapters and drafts are kept as writings, by path

- Status: Proposed
- Date: 2026-11-04
- Related: [ADR-0035](0035-adaptation-data-in-the-database.md), [ADR-0030](0030-imported-worlds-read-lore-from-the-database.md)

## Context
ADR-0035 moves the adaptation data into the database. The story text it adapts is two folders of markdown, `chapters/` and `drafts/` (scenes sit under `chapters/scenes/`). The database already has `reader.chapters`, but that table is for what a reader is shown: a slug, a position in a line, a draft, published versions. Imported prose does not fit it: paths are nested and named `chapter_1.md`, drafts are not chapters, scenes are one-line beats, and nothing here is published.

## Decision
- A new table `reader.writings` keeps each file by its path (`chapters/…` or `drafts/…`, markdown, no `..`), with its title, text, the text's hash and the hash an import wrote. The app and the Studio address writings by path already, so no mapping is needed.
- Authors read and write them through `reader.save_writing` and `reader.remove_writing`; players and readers cannot read them. Publishing a chapter to readers stays with `reader.chapters` and is a later step.
- An import marks what it wrote. On the next import a text still equal to its mark is replaced by the file; a text that differs was changed in the database and is kept and listed (as for cards).
- `world.json` becomes `world_lore.worlds.manifest`. The folder remains the place for the stories under `stories/` and is the fallback for a world with no manifest in the database.

## Consequences
+ The adaptation agent reads the story from an endpoint; an imported world needs no `chapters/` or `drafts/` on disk.
+ Re-importing is safe: an edit made in the database is never overwritten without `--force`.
- Two models of prose exist (`writings` for the author's files, `chapters` for the reading feature) until publishing is built on top of writings.
- `world()` now reads the database first (cached for a few seconds), so a database outage fails an imported world's requests.
