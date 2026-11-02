# ADR-0027: The database is the source of truth for lore; exports are separate

- Status: Accepted
- Date: 2026-11-02
- Related: [Supabase database plan](../supabase-database-plan.md), [ADR-0005](0005-scaffold-content-neutral.md)

## Context
Lore lives in `worlds/` files today. The Supabase design adds `world_lore` with drafts, immutable published versions and world-lines.

## Decision
Once `world_lore` exists and a one-time import has run, the database is the source of truth for lore. Lore is edited as drafts and published as immutable versions; hosted stories and VN builds read published versions. `worlds/` then becomes an import/export format or backup, not the working copy. The importer, world export and VN export are separate features, outside the schema work. Agents reach data only through Nirmata backend endpoints (see AGENTS.md).

## Consequences
+ One place for versioning, permissions and rollback.
- Until the importer exists, `worlds/` stays the only source and the skills keep reading it.

## Alternatives considered
Two-way file/database sync (conflict handling and two truths); files only (no per-user permissions, drafts or rollback).
