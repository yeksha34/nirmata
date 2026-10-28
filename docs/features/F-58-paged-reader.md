# F-58: Read it as a book

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
Anything with words in it can be read slowly, a page at a time, the way an ebook is: a card, a whole world, the story so far, a turn someone has drafted. Reading is the other half of writing a world, and a screen of form fields is a poor place to find out whether it works.

## How it works
A **Read** button opens the reader over the screen it was pressed on:

| Where | What is read |
|---|---|
| A card's editor | the card as it is in the form, saved or not: a cover (what it is, its name, its summary, its keywords) and each named part as a chapter, then the body |
| The world's page | the whole world: a cover with its title, tagline, genre and tone, then every card as a chapter, in the order a reader wants them (lore, places, people, arcs, scenes, rules) |
| The story window | the story so far, in the chapters it has been cut into (the rest of what has been written goes on the end of the last), the players' lines as quotations |
| A draft on the board | what someone has written for the next round |
| The world's **Chapters** tab | one chapter, or **Read all the chapters** one after the other (the world's cover, then each under its title) |
| The world's **Drafts** tab | one draft |

The Chapters and Drafts tabs list the prose in a world's `chapters/` and `drafts/` folders (markdown that is not a card; the one-line scene beats in `chapters/scenes/` are left out). Chapters run in file-name order (`chapter_1`, `chapter_1_part_2`, `chapter_2`, `chapter_10`), drafts newest first, each with its first heading as its title, how long ago it was changed and its size. The server serves the list with the world's page and each text on request (`GET /api/worlds/:name/writing?path=`, host only, and only for markdown under those two folders). A 373 KB chapter opens as a 397-page book in under a second.

Under the hood ([reader/](../../apps/web/src/reader/)):
- **book.ts** turns each of those into one `Book` (a cover and chapters of paragraphs, headings, quotations, lists and rules); markdown is read for bold, italic, code, lists, quotations and headings.
- **Pages are columns.** The whole text is one flow cut into columns the size of a page; each page is a window scrolled to its column. It reflows with the screen and the type size, chapters start on a fresh page, and the reader keeps its place when the page count changes. A wide screen shows a two-page spread; a narrow one shows a single page.
- **Turning a page lifts a leaf** (a copy of the text on its front and its back) round the spine in CSS 3D, with shading as it turns. A jump to a chapter turns one leaf, it does not flick through the pages between. Keys pressed during a turn are queued, not lost.
- **Ambience.** A gradient that drifts slowly and changes colour with the *mood* (dusk, embers, forest, rain, moonlight, ink); weather on a canvas behind the book (dust, rising embers, fireflies, rain, stars); and, only if the reader asks, the sound of the room made with the Web Audio API alone: wind, rain, a fire's crackle, crickets, the air of a quiet room, and a swish of paper for each page. Nothing in it holds a note (a sustained tone under the weather was heard as a machine left on, and taken out). No sound files. Each kind of card has the mood that suits it.
- **Controls.** Arrow keys, Page Up/Down, Space, Home and End; swipe or tap the edge of a page; a slider to scrub; contents; mood; type size (remembered); sound (remembered, off to begin with).
- **The cursor** ([cursor.ts](../../apps/web/src/reader/cursor.ts), [QuillCursor.tsx](../../apps/web/src/reader/QuillCursor.tsx)). For a mouse, inside the reader: at rest the pointer is the tip of a quill, still, its point exactly on the pointer. While the mouse moves it is a page in the wind, and loose pages come off it (one for each 22 px of travel, at most 36 at a time) and are blown back along the way it came, fluttering and turning over, then fall away. The two ease into each other. Over a button, a menu or the slider the system's own cursor stays, so nothing clickable is hidden. A finger or a pen gets no cursor of its own.
- It honours `prefers-reduced-motion`: no leaf, no drifting, no weather, no trailing pages (the still quill stays).
- The labels are Hindi with their English on hover like the rest of the app; what people wrote is shown as written. The reading copy of the text is the only one screen readers see.

## Acceptance criteria
- [x] A card, a world, a story and a draft each become a book with the right cover and chapters (unit tests on the builders, including a story cut into chapters and one with no cuts).
- [x] Which page every surface shows, at rest and while a leaf turns forward, back, over a single page and across a jump (unit tests).
- [x] The weather keeps every particle on the canvas however long it runs; the moods all have Hindi names, weather and sound.
- [x] In the app: both layouts, page turns by key, button, contents and slider; rapid keys all play; mood, type size and sound change as asked; no console errors; a phone-width pass.
- [x] A chapter's last turn is on the wire so the story can be laid out in chapters (server test).

## Not done / to know
- The story is read as it stood when the reader was opened; close it and open it again to read what has been written since.
- A saved story that is not open cannot be read yet (the server has no call for its turns).
- The sound was checked with an analyser on the output (every mood is audible and well under clipping), not by ear; the mix is a first try.
- A very long book (the whole imported world is about 500 pages) lays out several copies of its text; it opens in a second or two, and a much longer one would want the text cut into chapters per page-window.
