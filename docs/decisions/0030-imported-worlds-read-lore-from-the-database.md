# ADR-0030: An imported world reads and writes its cards in the database

- Status: Proposed
- Date: 2026-11-03
- Related: [ADR-0027](0027-database-is-lore-source-of-truth.md), [ADR-0029](0029-roles-admin-author-moderator-player.md)

## Context
`import:world` copies a world's cards into the database as the author's draft, but the app kept reading the folder, so the two copies could drift and edits went to the wrong one. The cut-over has to be one world at a time, because most worlds are not imported and the app must keep working for them.

## Decision
- **Precedence per world.** If the world is in the database (found by its `world.json` name as a slug) and the table's host is signed in, its cards are read from and written to the database draft. Otherwise the folder is used, exactly as before.
- **Who reads.** Database access is as the signed-in host (row level security applies), never as the server. With no signed-in host (the obsolete host-key login) the folder is used.
- **No silent fallback.** If the database is unreachable for an imported world, the request fails with a plain message. Falling back to files would let edits land in the folder and diverge.
- **One seam.** `WorldFiles` takes an optional card store (`LoreCards`); the card list, save and remove go through it. Everything that reads cards (the world page, starting a story, the manager) is unchanged.
- **Still in files.** `world.json` (title, tone, genre, systems), chapters, drafts, stories, visual novels and images. The database has no tables for the manifest yet.
- **Publishing** is a separate step. The app edits the draft; `import:world --publish` freezes a version.

## Consequences
+ An imported world is edited in one place; unimported worlds are unaffected.
+ The change is reversible per world: stop signing in as host and the folder is used.
- The folder copy of an imported world goes stale and should not be edited. Re-running the import would overwrite database edits; guarding against that is not built.
- A world imported under a custom `--slug` is not recognised, because the lookup uses the `world.json` name.
- Stories still take their snapshot from the draft, not a published version.

## Alternatives considered
Read the database for every world (breaks unimported ones); copy from the database back to files on each save (two writers, drift); fall back to files on a database error (silent divergence).
