# @nirmata/host

The game master. Runs an adventure on top of [`@nirmata/core`](../core/README.md) (prompt building, event tree) and [`@nirmata/llm`](../llm/README.md) (models). It does no I/O of its own: saving goes through an `EventSink`, ids and time through `Ports`, so sessions are testable and replayable.

```ts
const session = AdventureSession.create({ world, cards, provider, sink, settings, judge, actor });

for await (const ev of session.start({ arcId: "arc.fourth-light" })) render(ev);
for await (const ev of session.submit({ mode: "say", text: "Marrow, what is that light?" })) render(ev);
```

Every streaming call is an async generator of `HostEvent`s and **never throws**: failures arrive as an `error` event with a plain-language message, and the last event is always `done`.

| Event | Meaning |
|---|---|
| `context` | The prompt inputs for this attempt (powers the "why is this card here" drawer) |
| `begun` | The adventure took its copy of the source cards (always the first event of a new one) |
| `player` | The player's action was saved |
| `text` | A live token chunk |
| `reply` | A reply was saved (with any rule `violations`) |
| `rule-violation`, `attempt` | A reply broke a rule; a rewrite is starting, so clear the streamed text |
| `plotting`, `plot` | The recent turns are being read for plot points / plot points were saved (`points` carry the ids used to revoke them) |
| `warning` | Worth showing, did not stop the turn (cut-off reply, judge offline, ignored sampler settings) |
| `stopped` | The caller aborted; `partial` was not saved |
| `error` | `{ message, code, recoverable }` |
| `done` | Last event; carries the new state |

## Adventures play on a copy of the source cards

([ADR-0009](../../docs/decisions/0009-adventure-copies-and-source-permissions.md), F-43.) `world` and `cards` in the deps are the **source**. `start()` copies them once into a `begin` event, the root of the adventure, and from then on the session reads its own copy from the log: prompts, rule checks, plot extraction and plot points all use it. Editing or deleting a source card later changes nothing in a running adventure, two adventures never affect each other, and a saved adventure resumes from its log alone (leave `world` and `cards` out). An older log without a `begin` still works, using the source it is given.

Note that the copy contains host-only text (Secrets). The log and the card copies are for the host's server; players get turns, chapters and plot points, never the cards.

## Who may do what

([F-44](../../docs/features/F-43-adventure-copies-and-source-permissions.md).) A session acts for one `actor` (`{ id, role: "host" | "player" }`, default a host running their own adventure); the server decides who is who. The table is in core's `permissions.ts`:

| | Host | Player |
|---|:-:|:-:|
| Edit or remove **source cards** | yes | **no** |
| Start an adventure | yes | no |
| Act, retry, continue, undo, edit own turn, pin a fact | yes | yes |
| Jump to another branch, add or revoke plot points, break a chapter, run plot extraction, change settings | yes | no |

A refused call yields an `error` event (or rejects) with `code: "forbidden"` and a plain message such as "Only the host can add plot points.", and saves nothing. Plot extraction that happens as part of play is not a player action and is never blocked.

**Source cards** are only written through `SourceCards` (`update`, `editFromText`, `remove`), which checks the role first, validates the card (and refuses duplicate ids) and then calls your `SourceBackend` (files on disk, a database). Anyone can read through it; only a host can write or take the `snapshot` that starts an adventure.

## Operations

| Call | What it does |
|---|---|
| `start({ arcId? })` | Opening scene; the chosen arc card is pinned for that turn |
| `submit({ mode, text })` | Save the action, then write the reply |
| `retry()` | New reply as a sibling of the old one. Also works when the last attempt failed and the action has no reply yet |
| `continueStory()` | Extend the latest reply with no new player action |
| `undo()`, `edit(id, text)`, `goto(id)` | Single saved events; nothing is ever deleted |
| `pin(fact)`, `unpin(fact)` | Memory the player controls |
| `plot()` | Look for plot points now, without waiting for the trigger |
| `addPlotPoint(card, text)`, `revokePlotPoint(id)`, `undoLastPlot()` | Plot points by hand, and their undo |
| `breakChapter(title?)` | Start a new chapter here (the only thing that creates a break, for now) |

## Guarantees

- **Save before apply.** An event reaches the sink before it changes state. A crash loses at most the reply being streamed; the player's action is already saved.
- **One turn at a time.** A second call while a turn runs gets a `busy` error. Single-event operations throw `HostError("busy")`.
- **Retry forgets the reply it replaces,** including plot points and window shifts written after it (everything is read as of the parent node); the extraction is simply redone on the new branch.
- **Rule checks never block play.** If the judge fails, the reply is kept and a `warning` is shown.

## Rule checking

Set `judge` (for example `createLlmJudge(provider, { model })`) and `settings.ruleCheck` (`"must"` / `"all"` / `"off"`). After each reply the judge answers each rule's `**Check:**` question. A violating reply is saved with `flags`, then rewritten up to `maxRegenerations` times with an editor note listing what broke; the flagged draft stays in the log as a sibling. After the last attempt the reply is accepted, still flagged.

## The context window shifts into chapters

There is no summarising ([ADR-0008](../../docs/decisions/0008-window-shift-and-plot-points.md), F-40). The prompt holds the recent turns that fit the budget. When a reply is written with some older turns left out, the reply records `shifted`: the newest turn that was outside the window. That cursor only moves forward on a branch, so a turn that has left the window never returns, even if the budget grows. Turns up to the cursor are the **chapter**, verbatim (`session.chapters`, and `projectAdventure(state)` in core for files). No model call is involved. Chapters split only at `breakChapter()`; where breaks should happen automatically is a later decision.

## Plot points on cards

Long-term memory lives on the cards (F-42). Every `settings.plot.everyPlayerTurns` player turns, while those turns are still in the prompt, a model reads them and returns one-sentence, past-tense **plot points**, each attached to an existing card. They are saved in a `plot` event and appear under the card (newest eight) whenever the card is in a prompt. The world's own cards are never modified.

- The extractor is shown card **ids, names and kinds only**, never summaries or bodies, so host-only secrets cannot leak into something the player can read, and it can only attach points to cards it was offered (those mentioned recently, those in the last prompt, and every arc).
- Failure never breaks play: a `warning` is shown and the same turns are read next time.
- **Undo:** points are events on the branch, so undo, retry, edit and `goto` remove and restore them with the turns that produced them (including a revoke made after those turns, which time-travels too). On top of that, `revokePlotPoint(id)` takes one back, `undoLastPlot()` takes back the newest batch, and `addPlotPoint(card, text)` adds one by hand without moving the extraction cursor. A revoked point is not re-extracted because the turns it came from were already read.

```ts
settings.plot = { enabled: true, everyPlayerTurns: 3, maxPoints: 6, maxTurns: 12, model: "cheap-model" };
```

Use `plotProvider` in the deps to run extraction on a cheaper model or server.

## Memory

Pinned facts are events on the branch, so every branch remembers only its own.

## Not here yet
- Server wiring, file persistence and the play screen (`apps/server`, React).
- Auto-suggested story cards, dice and stats (F-34), multiple players (F-37).
