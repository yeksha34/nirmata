# F-43 / F-44: Adventures start from a copy; only hosts edit the source

| | |
|---|---|
| State | Building |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-adventure-host-core` |
| Target tag | v0.2.0 |

## Value
A world is a reusable source. Every adventure plays on its own copy, so play never damages the world, adventures never affect each other, and only the people who host a world can change it.

## Acceptance criteria
**F-43 Adventure copies**
- [x] The first event of every adventure (`begin`) holds a deep copy of the world manifest and all source cards.
- [x] The session builds prompts, rule checks and plot extraction from that copy, not from the source.
- [x] Editing or deleting a source card after the adventure began changes nothing in that adventure.
- [x] Two adventures from one world do not affect each other.
- [x] An adventure can be resumed from its log alone, without the source.
- [x] Undo, retry, edit and branching keep working with the `begin` root, including going back to "before the first turn".

**F-44 Source permissions**
- [x] A host can edit and remove source cards.
- [x] A player cannot: the attempt is refused with a plain-language message and nothing is written.
- [x] Invalid cards are refused for everyone, with the problems listed.
- [x] A player cannot start an adventure, jump branches, add or revoke plot points, break chapters or change settings; a player can act, retry, continue, undo, edit their own turn and pin a fact.
- [x] The permission table lives in one place.

## Non-goals
- Real accounts and sign-in (the caller decides who is host or player).
- Hiding Secrets from players when reading source cards (decided separately).
- Pulling source changes into a running adventure, and promoting adventure content back to the source (F-41).

## Design
[ADR-0009](../decisions/0009-adventure-copies-and-source-permissions.md). `begin` event and `permissions` in `packages/core`; `SourceCards` and the session's role checks in `packages/host`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `pnpm exec vitest run`, `tsc -b`, `biome check packages` | 240 tests pass (core 91, llm 48, host 101). F-43: deep copy proven by mutating the source after the fact, source edited between two adventures, rules / plot / add-point read the copy, resume with no source, legacy log without a copy, jump and undo land on the copy. F-44: host edits via text and card, player refused on every write path with nothing saved, invalid and duplicate cards refused, every non-host action refused with its own message, player can still play, retry, continue, undo, edit and pin, automatic plot extraction not blocked. In-memory source backend and fake provider only. |
| open | Real backend | `SourceBackend` over files on disk, and who is host or player (accounts), belong to the server; not built. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified (ADR-0009) |
| 2026-10-25 | Implemented: `begin` event and `permissions` in core; `SourceCards`, session roles and adventure copies in host |
