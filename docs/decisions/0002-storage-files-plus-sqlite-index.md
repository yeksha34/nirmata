# ADR-0002: Markdown files in git as source of truth, SQLite as rebuildable index

- Status: Proposed
- Date: 2026-10-25
- Related: [tech-stack](../tech-stack.md)

## Context
Existing worlds are markdown cards with cross-links in git. Play needs fast search, a per-turn event log, and (later) embeddings. Users also want to hand-edit and diff.

## Decision
- Authored content (cards, `world.json`, rules) stays as `.md`/`.json` files under `worlds/<name>/`.
- Adventures are stored as append-only JSONL under `worlds/<name>/adventures/<id>/events.jsonl` plus a rendered `transcript.md`.
- A SQLite database (FTS5, later `sqlite-vec`) lives in an ignored cache directory and is **always rebuildable** from the files. It is never the only copy of anything.

## Consequences
+ Diffable, portable, recoverable; works with the existing git drawer.
+ Search and sessions are fast.
- Two representations to keep in sync: handled by a rebuild-on-start and a file watcher.

## Alternatives considered
Database-only storage (loses git and hand-editing); files-only with no index (slow search over long adventures).
