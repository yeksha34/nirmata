# F-53: The worlds page - pick up a story, explore, make and manage worlds

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
One front door for the host. Open the app and you see the story you were in, one click from carrying on, wherever it is. The rest of your worlds are there too: look inside one, start a story in it, make a new one, rename it, put it away. No world has to be "opened" first.

## Acceptance criteria
**Pick up**
- [x] The front page lists the latest stories across every world, newest first, each with its world's title, the start of its latest passage, how long ago, turns and who played. A damaged story, or a world that cannot be read, is left out of this list.
- [x] "Continue" on one opens that story's world if it is not the open one and resumes the story for everyone at the table, in one step.
- [x] Starting a story from a world's page opens that world first if needed.

**Explore**
- [x] Every world is a card with its title, tagline and how many stories it holds; a world that cannot be read says why and can still be put away.
- [x] A world's page shows its saved stories and its cards by kind (lore, characters, places, arcs, rules, scenes), each opening to its text, and marks cards that are always in the storyteller's view. Nothing is opened or started by looking.
- [x] The page starts a new story, from an arc or its own way.

**Make and manage**
- [x] "New world" asks for a title, an optional line and an optional premise. The folder name follows the title and is made unique; the premise becomes a card that is always in view, so the world can be played at once. The new world is not opened by being made.
- [x] "Edit details" changes the title and tagline; the rest of `world.json` is kept as it was. If that world is open, everyone at the table sees the new title.
- [x] "Put away" asks first, then renames the world's folder to start with `_archived-`, which the library skips. Nothing is deleted and renaming it back restores it. If it was the open world, the table goes back to waiting for a world.
- [x] All of it is the host's; anyone else is refused.
- [x] Works at phone width (no sideways scrolling), in light and dark.

## Non-goals
- Editing cards on screen, restoring a put-away world from the app, deleting a world for good (see Q34).
- Showing this page to anyone but the host. Players and spectators see who is at the table behind the story window.

## Design
`Library` (`apps/server/src/files.ts`) gains `recent`, `detail`, `create`, `update`, `archive` and one cached `StoryFiles` per world. `Table` wraps them with host checks, plus `startStoryIn` and `resumeStoryIn`, which open the world if needed and then use the existing start and resume. Routes: `GET /api/recent`, `GET/PATCH /api/worlds/:name`, `POST /api/worlds`, `POST /api/worlds/:name/archive`, `POST /api/worlds/:name/stories`, `POST /api/worlds/:name/stories/:id/resume`. In `apps/web`, `screens/Worlds.tsx` replaces the old library screen; it keeps its own page state (home or one world) and has no router.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc`, `biome` | 399 tests pass; 11 new server tests: make (names, uniqueness, premise card, host only, no half-made folders), a world's page without opening it, edit (keeps other fields, updates the open world), put away (rename, name freed, open world closed for everyone), recent across worlds, continue in another world, plain errors |
| 2026-10-25 | Demo server and the in-app browser, by eye | Made a world from the dialog; started a story in it; played a turn; put the story away; saw it under "Pick up"; edited a title; continued a story in a world that was not open; put a world away (folder renamed on disk, gone from the list); phone width and light mode, no sideways scroll |
| not yet | Keyboard-only use, reduced motion, a screen reader | Not checked |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified from the owner's note about a "portal" for continuing a story and exploring, creating and managing the other worlds; built as a landing page. The owner then explained that a portal is a floating window (see [F-54](F-54-story-window.md)); this page was renamed from "portal" to "worlds page" and now sits behind that window. Starting or continuing another story waits while one is open |
