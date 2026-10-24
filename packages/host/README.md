# @nirmata/host

The game master. Runs an adventure on top of [`@nirmata/core`](../core/README.md) (prompt building, event tree) and [`@nirmata/llm`](../llm/README.md) (models). It does no I/O of its own: saving goes through an `EventSink`, ids and time through `Ports`, so sessions are testable and replayable.

```ts
const session = AdventureSession.create({ world, cards, provider, sink, settings, judge });

for await (const ev of session.start({ arcId: "arc.fourth-light" })) render(ev);
for await (const ev of session.submit({ mode: "say", text: "Marrow, what is that light?" })) render(ev);
```

Every streaming call is an async generator of `HostEvent`s and **never throws**: failures arrive as an `error` event with a plain-language message, and the last event is always `done`.

| Event | Meaning |
|---|---|
| `context` | The prompt inputs for this attempt (powers the "why is this card here" drawer) |
| `player` | The player's action was saved |
| `text` | A live token chunk |
| `reply` | A reply was saved (with any rule `violations`) |
| `rule-violation`, `attempt` | A reply broke a rule; a rewrite is starting, so clear the streamed text |
| `compacting`, `compacted` | Older turns are being folded into a chapter, a summary and tracking cards / it was saved (chapter number and title, ids of cards updated) |
| `warning` | Worth showing, did not stop the turn (cut-off reply, judge offline, ignored sampler settings) |
| `stopped` | The caller aborted; `partial` was not saved |
| `error` | `{ message, code, recoverable }` |
| `done` | Last event; carries the new state |

## Operations

| Call | What it does |
|---|---|
| `start({ arcId? })` | Opening scene; the chosen arc card is pinned for that turn |
| `submit({ mode, text })` | Save the action, then write the reply |
| `retry()` | New reply as a sibling of the old one. Also works when the last attempt failed and the action has no reply yet |
| `continueStory()` | Extend the latest reply with no new player action |
| `undo()`, `edit(id, text)`, `goto(id)` | Single saved events; nothing is ever deleted |
| `pin(fact)`, `unpin(fact)` | Memory the player controls |
| `compact()` | "Close this chapter" now, without waiting for a trigger |

## Guarantees

- **Save before apply.** An event reaches the sink before it changes state. A crash loses at most the reply being streamed; the player's action is already saved.
- **One turn at a time.** A second call while a turn runs gets a `busy` error. Single-event operations throw `HostError("busy")`.
- **Retry forgets the reply it replaces,** including any compaction written after it (memory, chapters and cards are read as of the parent node); the compaction is redone on the new branch.
- **Rule checks never block play.** If the judge fails, the reply is kept and a `warning` is shown.

## Rule checking

Set `judge` (for example `createLlmJudge(provider, { model })`) and `settings.ruleCheck` (`"must"` / `"all"` / `"off"`). After each reply the judge answers each rule's `**Check:**` question. A violating reply is saved with `flags`, then rewritten up to `maxRegenerations` times with an editor note listing what broke; the flagged draft stays in the log as a sibling. After the last attempt the reply is accepted, still flagged.

## Compaction: chapters and live cards

Long stories are compacted so the prompt stays bounded ([ADR-0007](../../docs/decisions/0007-adventure-compaction.md), F-40). After a reply, when `settings.compaction` says so (enough player turns since the last compaction, or the last prompt used more than `pressure` of the budget), everything except the newest `keepRecent` turns (the kept tail always starts at a player action) is compacted by three model calls:

1. **Summary**: the cumulative summary, which replaces those turns in the prompt.
2. **Chapter**: a prose retelling of those turns, with a title.
3. **Record** (JSON): a `scene` card for what happened, `state` cards for entities that changed (`state.marrow`), and the always-on `state.now` (where, when, who is present, goals, open threads).

The result is one `compact` event. Chapters and cards are therefore on the branch: undo, retry and `goto` change which ones are current, and `projectAdventure(state)` (in core) turns them into files for the server to write. The world's own cards are never modified, and the compactor only ever sees the transcript plus the existing tracking cards, never host-only world cards.

Failure handling: if the summary or chapter step fails, nothing is saved and play carries on (the next reply tries again). If only the record fails (after one retry), the chapter and summary are saved without card updates and a `warning` says so. Aborting mid-compaction is silent.

```ts
settings.compaction = { enabled: true, keepRecent: 4, minTurns: 6, everyPlayerTurns: 8, pressure: 0.7, model: "cheap-model" };
```

Use `compactionProvider` in the deps to run these calls on a cheaper model or server.

## Memory

Pinned facts are events on the branch, as is the summary written by each compaction, so every branch remembers only its own history.

## Not here yet
- Server wiring, file persistence and the play screen (`apps/server`, React).
- Auto-suggested story cards, dice and stats (F-34), multiple players (F-37).
