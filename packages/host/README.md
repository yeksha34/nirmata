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
| `memory` | The summary was refreshed |
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

## Guarantees

- **Save before apply.** An event reaches the sink before it changes state. A crash loses at most the reply being streamed; the player's action is already saved.
- **One turn at a time.** A second call while a turn runs gets a `busy` error. Single-event operations throw `HostError("busy")`.
- **Retry forgets the reply it replaces,** including any summary derived from it (memory is read as of the parent node).
- **Rule checks never block play.** If the judge fails, the reply is kept and a `warning` is shown.

## Rule checking

Set `judge` (for example `createLlmJudge(provider, { model })`) and `settings.ruleCheck` (`"must"` / `"all"` / `"off"`). After each reply the judge answers each rule's `**Check:**` question. A violating reply is saved with `flags`, then rewritten up to `maxRegenerations` times with an editor note listing what broke; the flagged draft stays in the log as a sibling. After the last attempt the reply is accepted, still flagged.

## Memory

Every `summaryEvery` player turns the model rewrites a short summary from the previous summary plus the turns since. Summaries are events on the branch, so each branch remembers only its own history.

## Not here yet
- Server wiring, file persistence and the play screen (`apps/server`, React).
- Auto-suggested story cards, dice and stats (F-34), multiple players (F-37).
