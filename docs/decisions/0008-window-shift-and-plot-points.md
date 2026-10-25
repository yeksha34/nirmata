# ADR-0008: Shift the context window into chapters; carry plot on the cards

- Status: Accepted 2026-10-25
- Date: 2026-10-25
- Supersedes: [ADR-0007](0007-story-compaction.md)
- Amended by [ADR-0009](0009-story-copies-and-source-permissions.md): wherever this says plot points overlay "the world's cards", read "the story's own copy of the cards"; the source cards are never touched by play.
- Related: [F-40](../features/F-40-window-shift-to-chapters.md), [F-42](../features/F-42-plot-points-on-cards.md)

## Context
ADR-0007 compacted old turns with three model calls (summary, chapter prose, card notes). The owner's direction is simpler and more faithful:
- Do **not** compact the context. Let the window shift live, and write the text that falls out of it into the **chapter** as it was written.
- Cards affected by the plot should get **that plot point added after it has happened** in the story.
- Plot points must be **undoable**.
- Where chapters break will be decided later.

## Decision
1. **No summarising.** The prompt holds whatever recent turns fit the budget (the builder already does this). Nothing rewrites history.
2. **The window cursor is recorded on host events** (`shifted`: the newest turn that was outside the window when that reply was written). It is monotonic and branch-local, so a turn that has left the window never returns, even if the budget grows. No extra events are needed.
3. **Turns at or before the cursor are written verbatim to the chapter** by the projection (`projectStory`), so the chapter file grows live as the window shifts. Text still inside the window is not yet in the chapter.
4. **Chapter breaks are `break` events** (optional title). For now they are only inserted by hand; an automatic policy is a later decision and will need no format change. With no break there is one open chapter.
5. **Plot points** are one-sentence, past-tense facts about something that has happened, attached to an existing card. Every few player turns a model reads the newest turns and the *names and kinds* of candidate cards (never their summaries, bodies or secrets) and returns `{card, text}` points, saved in a `plot` event whose `covers` is the new extraction cursor. Points are shown under the card in later prompts (newest eight per card) and listed in `plot/<card-id>.md` files.
6. **Plot points are story-scoped.** They overlay the world's cards; the world is never modified. Promotion into the world is an explicit later action (F-41).
7. **Undo.** Points are events on the branch, so undo, retry, edit and branching add and remove them correctly. Additionally an `unplot` event revokes one point, `undoLastPlot` revokes the newest batch, and the player can add a point by hand. A revoked point is not re-extracted, because the extraction cursor has already passed those turns.
8. The scene/state tracking cards and the model-written summary and chapter of ADR-0007 are removed.

## Consequences
+ Cheaper (one small extraction call every few turns instead of three calls per compaction) and the chapter is the exact text, not a retelling.
+ Long-term memory is explicit, inspectable and editable: it lives on cards players can read.
- Details that were never turned into a plot point or a pin are gone from the prompt once they leave the window (they remain in the chapter file). Mitigations: manual add, pins, keyword-triggered cards.
- A weak model may miss or phrase points badly; they can be revoked or added by hand.
- "Where are we now" is no longer tracked by a dedicated card; it relies on the recent turns and on plot points on place cards. A current-situation card can be added later as a special plot target.

## Decided later the same day
- **A current-situation card** helps and was added: every story's copy gets an always-on `lore.current-situation` card (unless the world defines one). The plot extractor is offered it every time and told to give it one point only when the situation changed; it shows only the newest point under "Right now". It is empty, and costs nothing in the prompt, until it has a point.
- **Revokes and undo is a host setting**, `revokesSurviveUndo`, off by default. Off: undo is plain time travel and a revoke made after a turn goes with it. On: a revoked point stays revoked on every branch.
- **Still open:** whether the memory trade-off is acceptable long term, and how chapter breaks are decided. See [open-questions](../open-questions.md).

## Alternatives considered
- **Keep ADR-0007's summary compaction.** Rejected by the owner.
- **Separate `shift` events.** One more event per exchange for no extra information. Rejected.
- **Extract plot points when text leaves the window.** Leaves a gap where text is gone from the prompt but not yet on a card. Extracting from recent turns while they are still in the prompt avoids it.
- **Edit the world's cards directly.** Cannot follow undo or branches and leaks between stories. Rejected (see ADR-0007).
