# Open questions

Things not yet decided or not yet proven. When one is settled, move it to the decision record that governs it (an ADR, or the feature record) and delete it here. Decided on 2026-10-25 and recorded elsewhere: turn order (the shared board, ADR-0013), age confirmation (production only, ADR-0014), moderation (in the story's voice, ADR-0015), the Adventure-to-Story rename, player permissions, who may read the source cards, revokes and undo, the current-situation card, adults only, IRC-style joining, input is not fact, no import of the existing story, retiring the old editor.

## Decisions waiting on the owner
| # | Question | Why it is open | Meanwhile |
|---|---|---|---|
| Q1 | **Memory trade-off.** Is it acceptable long term that anything never turned into a plot point or pin is gone from the prompt once it leaves the window (it stays only in the chapter)? | Hard to judge without long real play | Plot points, pins, manual add and the current-situation card are the only memory |
| Q2 | **Chapter breaks.** When and how should a new chapter start (size, scene change, time passing, plot events)? | Deferred by the owner | Only `breakChapter()` by hand creates one |
| Q3 | **Player characters.** How much do they differ from the world (stats, inventory, dice, a character sheet)? | Deferred by the owner | A player is just a name; no stats |

## Defaults I chose on the board, for you to confirm
| # | Default | Alternative |
|---|---|---|
| Q21 | Objections never block a round; they stay visible until the drafter edits | An objection blocks "ready" until answered |
| Q22 | A round closes when everyone who wrote is ready; players who wrote nothing do not hold it up; the host can close early | Every seated player must write or pass |
| Q23 | Spectators can watch the board but not talk | Spectators may remark |
| Q24 | No time limit on a round | A countdown after the first "ready" |
| Q25 | Kick lets the person rejoin immediately; there is no ban | Kick plus a ban for the session |
| Q26 | Lines in a round reach the story in the order players became ready | Join order, or alphabetical |

## Unproven (works in tests only)
| # | Question | Needs |
|---|---|---|
| Q7 | Do the provider adapters work against a live KoboldCpp, Ollama, LM Studio and Anthropic? | A model running |
| Q8 | Does a real model write faithful, non-repeating plot points and attach them to the right cards (F-42)? | A model running |
| Q9 | Does a real model treat a player's false claim as untrue (F-45)? | A model running |
| Q10 | Does an LLM rules judge give usable verdicts at acceptable cost and latency? | A model running |
| Q11 | Is the bundled local model (`node-llama-cpp`) workable on your hardware? | A prototype |
| Q12 | The token budget uses an estimate, not a real tokenizer. Close enough? | Real prompts |

## Technical, to settle before the server stores real stories
| # | Question |
|---|---|
| Q13 | **Log format versioning.** The event format changed several times today and has no version field or migrations. |
| Q14 | **Size of the first event.** It holds the whole world. Fine now; a plan is needed if worlds get very large. |
| Q15 | **Log growth.** Replay is linear; is a periodic snapshot needed? |
| Q16 | **Window cut point.** The window can start on a host reply, separating it from the action it answered. |
| Q17 | **Two processes, one story.** Nothing yet prevents concurrent writers on one `events.jsonl`. |

## Project
| # | Question |
|---|---|
| Q19 | The repo lives inside OneDrive, which will sync `node_modules` and may conflict on `events.jsonl`. Move it outside? |
| Q20 | Nothing is pushed or on a remote. The tag `v0.1.1-scaffold` is on an older commit; `v0.2.0` is only a target; the merge plan for `feat/F-30-story-host-core` is undecided. |
