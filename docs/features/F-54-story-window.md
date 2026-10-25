# F-54: The story window

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
The story lives in a window that floats over the page, like a chat box. You can put it where it suits you, make it bigger or smaller, shrink it out of the way, and the rest of the app stays usable behind it. For the host that is the worlds page (explore, make, rename worlds while the story goes on); for everyone else it is the table.

## Acceptance criteria
- [x] Whenever a story is open, everyone at the table - host, players and spectators - sees it in a window mounted on `<body>` through a React portal, above whatever page they are on.
- [x] The window is dragged by its title bar, resized from its bottom right corner, and cannot be dragged or sized off the screen or below a usable minimum.
- [x] Double-clicking the title bar, or its button, makes the window fill the page and brings it back.
- [x] Its minimize button turns it into a small chip in the bottom right corner ("world title" and "story", or "writing…" while the story is being written); the chip opens it again.
- [x] Where the window is, how big it is and whether it is minimized are remembered in this browser, and are pulled back on screen when the screen gets smaller.
- [x] By keyboard: the grip beside the title moves it with the arrow keys and the corner handle resizes it (Shift takes bigger steps); focus goes to the chip when it is minimized and back to the grip when it is restored.
- [x] On a phone (under 640 px) it is a sheet from the bottom of the screen that can be minimized, with nothing to drag; no sideways scrolling.
- [x] The story keeps running while the window is moved, minimized or maximized: it is the app's state, not the window's.
- [x] Inside the window the board sits beside the story when the window is wide and below it when narrow.
- [x] Notices appear bottom left so they never cover the chip.
- [x] While a story is open the host's worlds page says so and holds back "Start" and "Continue" (with a button to put the story away); putting away or archiving the open world closes the window for everyone.
- [ ] Used with a screen reader, and with reduced-motion and high-contrast settings.

## Non-goals
- Snapping to edges, several windows, or a pop-out into a separate browser window.
- Keeping the window position in sync between a person's tabs or devices.

## Design
`apps/web/src/story-window.tsx` (`StoryWindow`, rendered with `createPortal(…, document.body)` so no parent clips it or stacks over it; React state, context and events still flow through it). `window-geometry.ts` is the pure part - default box, clamping, moving, resizing, reading what was stored - and is unit tested. The window shows the existing `TableScreen`; `App.tsx` puts it over the page chosen by `screenFor`, which now only picks the page behind it (`worlds`, `waiting-world`, `waiting-story`). The story pane follows the story by scrolling the window's body instead of the page, and the board stacks under the story through a container query on that body, not a screen-width query.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc`, `biome` | 411 tests pass; 11 new for the geometry (start position, clamping, moving, resizing, small screens, remembering, phone) and the store tests changed to the new pages |
| 2026-10-25 | The in-app browser, demo model, host and a player in two tabs | Window opened over the worlds page; dragged by the title bar; resized from the corner; minimized to the chip (focus moved to it) and opened again; filled the page, with the board beside the story; a player joined in from inside their own window and the host's window showed the draft as it was typed; arrow keys moved it (Shift for 64 px); at 375 px it was a bottom sheet with no sideways scroll; position, size and minimized survived a reload. A notice was found covering the chip and moved |
| not yet | A screen reader; reduced motion; a real phone; touch dragging | Not checked |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified from the owner's explanation that a portal is a DOM element another DOM is mounted in, which can be moved around like a chat box, and the answer "for all"; built |
