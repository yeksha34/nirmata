# F-40: Live context-window shifting into chapters

| | |
|---|---|
| State | Building |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-adventure-host-core` |
| Target tag | v0.2.0 |

## Value
Long adventures stay playable without any summarising: the prompt holds the recent turns that fit, and everything older is kept, word for word, as the adventure's chapter.

## Acceptance criteria
- [x] When a turn no longer fits the prompt, the reply written with that prompt records it as outside the window (`shifted`), and it never re-enters the prompt, even if the budget grows.
- [x] Turns outside the window are written verbatim, in order, to the chapter; turns still in the window are not.
- [x] The chapter file grows as the window shifts (it is a projection of the log, rebuilt on demand).
- [x] `break` events split chapters; with no break there is one open chapter; the format needs no change when automatic breaks are added.
- [x] Undo, retry, edit and branching change the window and chapters correctly.
- [x] The transcript shown to the player always contains every turn.
- [x] No model call is made to shift the window.

## Non-goals
- Deciding where chapters break automatically (decided later).
- Summaries of any kind.
- Writing files to disk (the server does that from `projectAdventure`).

## Design
[ADR-0008](../decisions/0008-window-shift-and-plot-points.md). Pure parts in `packages/core` (cursor, chapters, projection); the host records the cursor on each reply.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `pnpm exec vitest run`, `tsc -b`, `biome check packages` | 207 tests pass (core 81, llm 48, host 78). Window: cursor validated and monotonic, chapters equal the turns outside the window and window turns plus chapter turns equal the transcript, breaks, undo, retry, budget growth never re-admits a turn, no extra model call per turn. Fake provider only. |
| open | Files on disk | The projection is pure data and tested; writing it to `adventures/<id>/` is the server's job and is not built yet. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified (ADR-0008); replaces the compaction design of ADR-0007 / earlier F-40 |
| 2026-10-25 | Implemented in `packages/core` (`window`, `projection`) and `packages/host` |
