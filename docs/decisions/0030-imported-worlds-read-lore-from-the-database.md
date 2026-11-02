# ADR-0030: An imported world reads its cards and images from the database

- Status: Proposed
- Date: 2026-11-03
- Related: [ADR-0027](0027-database-is-lore-source-of-truth.md), [ADR-0029](0029-roles-admin-author-moderator-player.md)

## Context
`import:world` copies a world's cards into the database as the author's draft, but the app kept reading the folder, so the two copies could drift and edits went to the wrong one. The cut-over has to be one world at a time, because most worlds are not imported and the app must keep working for them.

## Decision
- **Precedence per world.** If the world is in the database (found by its `world.json` name as a slug) and the table's host is signed in, its cards are read from and written to the database draft. Otherwise the folder is used, exactly as before.
- **Who reads.** Database access is as the signed-in host (row level security applies), never as the server. With no signed-in host (the obsolete host-key login) the folder is used.
- **No silent fallback.** If the database is unreachable for an imported world, the request fails with a plain message. Falling back to files would let edits land in the folder and diverge.
- **Images.** The dataset gallery's image route looks the render up by the path the importer wrote (`<world id>/<scope>/<name>/<run>.png`) and streams it from the store the row names (ADR-0028). If there is no such render it reads the file as before. A render whose bytes were deleted (`store = none`) answers "not found" and is not brought back from an old local copy.
- **New generations** are written to disk as before and, for an imported world with the host signed in, also uploaded and recorded (same rows as the importer, quota-checked, supabase first then local). A recording failure is logged and never fails the generation: the file is the copy that is certain to exist. Deleting a dataset run (a new gallery action) is a store change: the render goes to `none` and its file is removed from the store; the current render of an asset is refused. The existing archive and delete buttons act on a visual novel's current image files, never on the dataset, so they stay file-only.
- **Run names keep their case.** A run folder is a time such as `…T10-00-00-000Z`; its capital letters are part of the stored path, so lookups and the recorder do not lowercase it (only the visual novel and asset names are lowercased, as the folders are).
- **Privacy of the database copy.** The image route is open to anyone for files, because an image tag cannot send a token. The database copy is returned only when the request carries the signed-in host's own session cookie; any other request gets the file or nothing.
- **One seam.** `WorldFiles` takes an optional card store (`LoreCards`); the card list, save and remove go through it. Everything that reads cards (the world page, starting a story, the manager) is unchanged.
- **Still in files.** `world.json` (title, tone, genre, systems), chapters, drafts, stories, visual novels, visual novel images (`…/vns/…/assets/…`) and every new generation. The database has no tables for the manifest yet.
- **Publishing** is a separate step. The app edits the draft; `import:world --publish` freezes a version.

## Consequences
+ An imported world is edited in one place; unimported worlds are unaffected.
+ The change is reversible per world: stop signing in as host and the folder is used.
- The folder copy of an imported world goes stale and should not be edited. Re-running the import keeps database edits: each imported card carries a hash of what the importer wrote (`meta.imported`), and a card whose stored content no longer matches it is kept and listed unless `--force` is given. A card imported before the stamp existed counts as edited when it differs from the file.
- A world imported under a custom `--slug` is not recognised, because the lookup uses the `world.json` name.
- Stories still take their snapshot from the draft, not a published version.

## Alternatives considered
Read the database for every world (breaks unimported ones); copy from the database back to files on each save (two writers, drift); fall back to files on a database error (silent divergence).
