# F-49: Screens - join, choose a world, continue, play

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
Nothing is configured outside the screen: the host lands in the app, sees the worlds on their computer, picks one, starts a story or continues a saved one, and saves a story as a new world. Everyone else joins with a name and plays on the shared board.

## Acceptance criteria
The server side of each item is tested. How the screens behave has been built and type-checked but not yet run in a browser, so the on-screen items under **Playing** stay open until someone has used them.

**Choosing and continuing (the host)**
- [x] The server takes a folder of worlds, not a world: which one to play is chosen on screen. There is no `NIRMATA_WORLD`. If the folder holds exactly one world it opens by itself.
- [x] The library lists every world with its title, tagline and how many stories it holds; a world that cannot be read is shown with the reason and cannot be opened.
- [x] Opening a world is refused while a reply is being written; the story in progress stays saved.
- [x] Saved stories are listed newest first with when, turns, who played and the start of the latest passage, so they can be recognised; an unreadable one is marked and cannot be continued.
- [x] "Continue" brings a saved story back, for everyone at the table. "Put the story away" returns to the library.
- [x] A new story can begin from a chosen arc or its own way.
- [x] "Save as a new world" names it (folder name follows the title), confirms what was kept, and offers to open it now. The new world appears in the library without a restart.
- [x] The story is shown as saved automatically.

**Playing**
- [ ] Joining asks for a name (and the adult confirmation in production); coming back in the same tab returns to the same seat; the host takes the host's seat from the link the server prints. (The server also opens that link in the browser; that step has not been run.)
- [ ] Spectators watch and can join in; players write their turn in the composer (Do / Say / Story); everyone sees each draft as it is typed; Ready sends it when everyone who wrote is ready; the host can send it early.
- [ ] People can object to a draft and talk; objections stay visible until answered; the host can hush, rename or send away, and the in-fiction notices show.
- [ ] The reply streams in live; Stop, Try again, Keep going and Undo are one tap; the hushed and spectators see why they cannot write.
- [ ] A lost connection is shown and recovers by itself; errors appear in the server's own plain words.
- [ ] Works from phone width up; light and dark; keyboard reachable; honours reduced motion. (Written for it; not yet checked by eye.)

## Non-goals
- Model setup on screen, card editing on screen, plot-point and context drawers, branch browsing ([F-50](../requirements.md) and later).

## Design
`apps/web`: React + Vite ([ADR-0001](../decisions/0001-tech-stack.md)). `store.ts` folds everything the server sends into one state (unit tested without a browser); `live.ts` is the one event-stream connection; `api.ts` the typed calls; `screens/` Join, Library, Waiting, Table, Board. The server serves the built screens at `/` (`apps/server/src/ui.ts`) and a library of worlds (`Library`, `GET /api/worlds`, `POST /api/worlds/open`).

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc`, `biome`, `vite build` | Server: 13 new tests for the library, opening, story list, closing, continuing and serving the screens. Web: 11 tests of the state store. Production build 251 kB (79 kB gzipped). |
| 2026-10-25 | Server started with two worlds | Serves the built page and bundle with correct types; no world opened by itself when there are two. |
| not yet | Looked at in a real browser | The browser extension was not allowed on `127.0.0.1`; layout, focus order and the phone width are unchecked by eye. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified from the owner's note that the world must not be an environment variable, and that listing, choosing, saving and continuing need a UI; built |
