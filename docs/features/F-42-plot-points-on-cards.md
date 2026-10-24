# F-42: Plot points on cards, with undo

| | |
|---|---|
| State | Building |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-adventure-host-core` |
| Target tag | v0.2.0 |

## Value
Cards stay true to the story: once something affecting a character, place or arc has happened in the adventure, that plot point appears on the card, so it is recalled whenever the card is. It is the adventure's long-term memory, visible and editable.

## Acceptance criteria
- [x] Every few player turns the host extracts plot points (past tense, one sentence, only things that happened) for existing cards and saves them in one event.
- [x] A card's plot points appear under it in later prompts, newest eight, when the card is in context.
- [x] The extractor sees the transcript and only the names and kinds of candidate cards, never summaries, bodies or secrets, and cannot attach points to unknown cards.
- [x] The world's cards are never modified; points are listed in `plot/<card-id>.md` in the adventure.
- [x] **Undo:** undoing, retrying, editing or branching removes the points the removed turns produced; a single point can be revoked; the latest batch can be undone; a revoked point is not re-extracted.
- [x] The player can add a point to a card by hand.
- [x] An extraction failure never breaks play and is retried later.

## Non-goals
- Creating new cards from play.
- Promoting points into the world (F-41).

## Design
[ADR-0008](../decisions/0008-window-shift-and-plot-points.md). Events `plot` and `unplot`; pure folding in core; extraction and triggers in host.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `pnpm exec vitest run`, `tsc -b`, `biome check packages` | 207 tests pass. Plot: extraction trigger and cursor, unknown cards dropped, duplicates dropped, secrets and summaries never sent to the extractor, points shown under recalled cards only, failures and aborts, undo / retry / goto, single revoke, undo newest batch, time-travel of a later revoke, manual add, busy guard, plot files. Fake provider only. |
| open | Real model quality | **Not verified:** that a real model writes faithful, non-repeating, past-tense points and attaches them to the right cards. Needs a live-model review. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified (ADR-0008) |
| 2026-10-25 | Implemented in `packages/core` (`plot`) and `packages/host` (`plot`, session methods) |
