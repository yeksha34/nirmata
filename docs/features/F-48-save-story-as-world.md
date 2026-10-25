# F-48: Save an ongoing story as a world

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
A story that has gone somewhere worth keeping can be saved as one individual thing - a world of its own - so that new stories can begin from where it got to, and the original world is left exactly as it was.

The owner picked "a new world" from four ways to save a session (a world, a branch/line, a draft, a snapshot). The others are not built; see Q33.

## Acceptance criteria
- [x] The host can save the running story as a new world folder beside the current one, from the current moment or from any earlier moment of the story.
- [x] The new world is the story's own copy of the cards, with every plot point that happened written into the card it happened to, plus the chapters written so far and an empty `stories/` folder.
- [x] The built-in current-situation card is left out; stories in the new world get a fresh one.
- [x] The world's name is lowercase letters, digits and hyphens; a name already in use is refused and nothing is overwritten.
- [x] A failed save leaves no half-made folder behind.
- [x] The original world, its source cards and the running story are not changed.
- [x] A story started in the new world opens with the saved plot in its cards.
- [x] Only the host can do it (it needs `source.edit`); a story from before story copies existed is refused in plain words.
- [x] The new world appears in the library at once and can be opened without a restart.
- [ ] A screen for it (the web app).

## Non-goals
- Merging a story back into its source world ([F-41](../requirements.md)).
- Saving as a branch/line, a draft or a snapshot file.

## Design
`worldFromStory` (`packages/core/src/fork.ts`, pure) builds the manifest, cards and chapter files from the log as of a node. `writeNewWorld` (`apps/server/src/files.ts`) writes them into a temporary folder and moves it into place. `Table.saveAsWorld` and `POST /api/story/save-as-world {name, title?, at?}`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc -b`, `biome` | 364 tests pass. 7 core (naming, plot into cards, situation card left out, source copy untouched, earlier moment, chapters only, no-copy refusal) and 5 server (new world beside the old, original untouched, fresh story opens with the saved plot, refusals, earlier moment) |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified from the owner's request and answer; built and tested |
