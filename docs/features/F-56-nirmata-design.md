# F-56: The Nirmata design

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
The app looks and works like the owner's design canvas ("Nirmata", in their Artifacts): warm paper and ink, a serif for names and the story, a sans for controls, a lantern mark, 44 px controls, and a world workspace of three panes: your worlds, one world's cards, one card open for editing.

## Source
The design canvas "Nirmata" (artboards: Home page, World workspace, Play on a phone). Taken from it: the colours (the app already used the same paper, surface, line and soft-accent values; the accent is now `#9a4f04`), Newsreader for names and story text and Hanken Grotesk for controls, the lantern logo with a serif wordmark, uppercase small labels over groups, 10 px controls and 14 px panels, a "Saved" mark with a tick, the jump box (Ctrl K), the three-pane workspace, the editor header with "View raw file", the "Linked from ..." strip, and a quiet left-ruled block for what is on the table.

## Acceptance criteria
- [x] The fonts ship with the app (`@fontsource-variable`), so nothing is fetched from the network (N-01); light and dark both use the tokens.
- [x] Header: lantern mark and wordmark, "Worlds", a jump box, connection dot, seat menu; the jump box and Ctrl or Cmd K are the host's.
- [x] Jump box: type to find a world, or a card in the world on show; arrow keys and Enter; Escape closes.
- [x] Front page: a short statement of what Nirmata is, where you left off, and your worlds.
- [x] World workspace: worlds down the side with their story counts and "New world"; the world's title with Play (Continue when a story exists) and Cards, Stories and World tabs; cards grouped by kind; the chosen card edits beside the list.
- [x] The editor shows "Saved", "Unsaved changes" or "Not saved yet", "View raw file", the template's parts, who links to the card, Save and Remove; it is the same form as before, inline instead of in a dialog.
- [x] On a narrow screen the three panes become one at a time, with a way back.
- [x] The story window and its controls use the same type and 44 px buttons; "Keep going" is the primary action; Saved has a tick.
- [x] Labels show in Hindi and give their English on hover, tap or keyboard focus, as in the canvas: the header, front page, workspace, editor (including the names of every template and part), story controls and dialogs. The English stays in the page for screen readers; places that cannot hold markup (menu choices) show "हिंदी · English"; what people write is never translated.
- [ ] Used with a screen reader, in dark mode and on a real phone.

## Not applied
- Long explanatory sentences (hints, paragraphs, error messages) stay in English; the labels, headings, buttons, tabs and statuses are in Hindi. The Hindi was written for this app and has not been read by a native speaker ([open-questions](../open-questions.md), Q36).
- The "Now" banner and the "entered the scene because you wrote ..." strip of the Play artboard need the storyteller's cards, which players are never shown ([ADR-0016](../decisions/0016-table-server.md)); a host-only version is possible later.
- The Graph and Lint tabs of the workspace artboard, and Stories and Settings in the header: those features do not exist yet.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-26 | `vitest`, `tsc`, `biome`, `vite build` | 441 tests pass; no test changed (the design is styling and layout) |
| 2026-10-26 | The in-app browser, demo model, host | Front page, three-pane workspace, a card opened in the editor (Saved, View raw file, parts), Ctrl K to a card, the story window over the page |
| not yet | Dark mode, phone width of the workspace, a screen reader | Not checked |

## History
| Date | Change |
|---|---|
| 2026-10-26 | Applied from the owner's Nirmata design canvas |
