# F-40: Compaction into chapters and live cards

| | |
|---|---|
| State | Building |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-adventure-host-core` (shares the branch while the host is built) |
| Target tag | v0.2.0 |

## Value
Long adventures stay playable on small context windows without losing the story, and the player ends up with a readable book (chapters) and an up-to-date picture of the world state (scene and state cards), without any manual bookkeeping.

## Acceptance criteria
- [x] When history exceeds the trigger (player turns since last compaction, or a fraction of the prompt budget), the host compacts everything except the newest few turns, and the next prompt contains the summary instead of those turns.
- [ ] Each compaction writes one **chapter** (title + prose) that retells the compacted turns without adding events.
- [x] Each compaction adds one **scene card** and updates **state cards** and the always-on **`state.now`** card; unchanged entities are left alone.
- [x] Compaction is one `compact` event; undo, retry, edit and branching make chapters and cards follow the current branch.
- [x] Chapters and cards can be written as files under the adventure folder, rebuilt from the log (deleting them loses nothing).
- [x] World cards (`lore/`, `characters/`, ...) are never modified; the compactor never sees host-only world cards.
- [x] If the chapter or summary step fails, nothing is committed and play continues; if only the JSON record fails, the compaction is committed without card updates and the player is warned.
- [x] The transcript shown to the player still contains every turn.
- [x] "Close this chapter" compacts on demand.

## Non-goals
- Editing canon from play (F-41 promotes content explicitly).
- A chapter-reading UI (play screen work).
- Writing the files to disk (the server does that from `projectAdventure`).

## Design
[ADR-0007](../decisions/0007-adventure-compaction.md). Pure parts (event, live-card folding, projection to files) in `packages/core`; the three model steps and triggers in `packages/host`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `pnpm exec vitest run`, `tsc -b`, `biome check packages` | 174 tests pass (core 61, llm 48, host 65). New: 14 core tests (compact event, branch-aware chapters/cards, projection round-trips through the card parser) and 29 host tests (planning, parsing, triggers by turns and by budget pressure, failure modes, abort, save failure, branch behaviour, secrets never reach the compactor). All with the fake provider. |
| open | Read a real model's chapters | **Not verified:** that a real model retells the turns faithfully without adding events, and returns usable JSON, needs a live-model review. That acceptance bullet stays unchecked. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified (ADR-0007) |
| 2026-10-25 | Implemented in `packages/core` and `packages/host`; replaces the earlier plain summary refresh |
