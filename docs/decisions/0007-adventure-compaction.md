# ADR-0007: Compaction is an event; chapters and tracking cards are projections

- Status: Proposed
- Date: 2026-10-25
- Related: [ADR-0002](0002-storage-files-plus-sqlite-index.md), [ADR-0006](0006-stack-revision.md), [F-40](../features/F-40-adventure-compaction.md)

## Context
Long adventures outgrow the context window. Dropping old turns loses the story; a plain summary loses detail and leaves no readable record. The owner wants the compacted conversation (1) to keep the live prompt small, (2) to be written out as a **chapter**, and (3) to update **cards that track scenes and live changes** (who is where, what each character now has or wants).

Two things must stay true: undo, retry and branching must keep working (so any derived data must follow the branch), and one adventure must not silently rewrite the shared world that other adventures use.

## Decision
1. **Compaction is a `compact` event** appended to the branch. It carries the cumulative summary, the chapter (`title`, `text`), the id of the last turn it covers (`covers`), and `cardUpdates`. Turns up to `covers` stay in the transcript but leave the prompt; the summary replaces them.
2. **Chapters and tracking cards are projections of the log**, never edited by hand: `adventures/<id>/chapters/chapter-NN-<slug>.md` and `adventures/<id>/cards/<id>.md`, rebuilt from the events on the current branch. Undo or branching therefore changes them correctly, and deleting the folders loses nothing.
3. **Tracking cards are an adventure-scoped overlay.** Two kinds, both `origin: adventure`:
   - `scene` cards: one per compaction (where, when, who, what happened, outcome), recalled later by keyword.
   - `state` cards: the live status of an entity (`state.marrow`: what Marrow knows, holds, wants now), updated in place, plus one always-on `state.now` (location, time, who is present, goals, open threads).
   The world's own cards (`lore/`, `characters/`, ...) are **never modified** by play. Promoting an adventure's chapter or cards into the world is a separate, explicit action (F-41).
4. **Three model steps per compaction**, each simple enough for small local models: chapter prose, a JSON record (scene, state, now), and the cumulative summary. If the chapter or summary fails, nothing is committed and the turns stay in the prompt. If only the JSON record fails (after one retry), the compaction is committed without card updates and the player is warned; the summary still carries the facts.
5. **The compactor sees only the transcript and the existing tracking cards**, never host-only world cards, so secrets cannot leak into a chapter the player can read.
6. **Triggers:** after a reply, when enough player turns have passed since the last compaction, or when the history uses more than a set fraction of the prompt budget; and on demand ("close this chapter"). The newest few turns always stay verbatim.

## Consequences
+ The prompt stays bounded while the story, its prose record and its state stay complete and readable.
+ Branches are consistent: each has its own chapters, scenes and state.
+ Canon is safe; promotion is a deliberate act.
- A retry of the reply that triggered a compaction discards that compaction (it lived on the replaced branch); it is simply redone on a later turn.
- The log grows by the chapter text; acceptable for text, revisit if adventures reach hundreds of chapters.
- Small models may produce weak JSON; mitigated by the retry and by degrading to summary-only.

## Alternatives considered
- **Write chapters and edits straight into the world folder.** Cross-contaminates adventures and cannot follow undo or branches. Rejected.
- **Summary-only compaction.** Cheapest, but gives no readable chapter and no structured state. Rejected.
- **One model call returning everything.** Fewer calls, but one malformed answer loses the chapter too. Rejected.
- **Files as the source of truth for chapters and cards.** Would need manual reconciliation on every undo or branch. Rejected.
