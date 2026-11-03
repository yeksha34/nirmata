# ADR-0035: An imported world keeps its adaptation data in the database

- Status: Proposed
- Date: 2026-11-03
- Related: [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [ADR-0027](0027-database-is-source-of-truth-for-lore.md), [ADR-0030](0030-imported-worlds-read-lore-from-the-database.md), [ADR-0033](0033-clothes-adornments-objects-asset-kinds.md), [ADR-0034](0034-current-image-in-supabase-history-local.md)

## Context
ADR-0027 and ADR-0030 made the database the source of truth for the lore cards of an imported world, but left the rest of what an adaptation produces in files: the visual novel's `manifest.json`, `adaptation.md` and `slides.json`, the asset plan inside the manifest, the prompt specs and the workflow templates. So an imported world exists twice (rows and folder), and the adaptation agent is told to write files, which `AGENTS.md` does not allow it to do through the database and which no endpoint serves.

## Decision
- **One copy.** After import, the database is the only copy of a world's lore, character prep, asset plan, workflow templates and visual novel content. The folder is an import and export format. Files remain only for asset-generation workflows in flight and dataset archives (ADR-0034).
- **Two packages.** `apps/importer` turns a folder into rows. `apps/adaptation` turns a world's novel into a visual novel. The server imports both.
- **Characters are prepared once, assets grow per chapter.** Before any chapter is adapted, the adaptation agent reads the character cards and records, per character, what asset generation needs (the base look, expressions, outfits, adornments). The first assets are the naked base character, equipables, important objects and locations, kept in the world's shared pool. Each chapter or draft adaptation then adds an asset only when no existing one expresses a needed state; the check is a fixed rule (the sprite fallback order), not a judgment.
- **Workflow templates are rows.** The adaptation copies the default templates for the world (and the visual novel) and may override them. A render records which template version it used.
- **The agent uses endpoints, with its own credential.** An author makes a revocable agent token for one world. It is stored hashed, shown once, limited to `adaptation.read` and `adaptation.write`, and every write is audited. The agent acts with the author's rights narrowed to that world; it never gets a database login (`AGENTS.md`).

## Consequences
+ No duplicate sources; an agent works through endpoints that validate what it writes.
+ A chapter adaptation re-run plans the same assets, and nothing already generated is repeated.
- Import must grow to cover chapters, drafts, `world.json` and the visual novel files before the disk copy can stop being read (done in the slice that needs each).
- A database outage fails an imported world's requests; there is no silent fallback to files (as in ADR-0030).
- A token acts as its author until revoked: it is scoped to one world and two verbs, not to individual endpoints.
