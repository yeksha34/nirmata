# F-55: The story manager

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
The host builds and tends a world from the page: its lore, characters, places, rules and story arcs, and the world's own description, without opening a world or touching a file. The cards themselves are written as XML around markdown ([ADR-0017](../decisions/0017-xml-markdown-cards.md)), which reads the same to a person, the editor and, later, the model.

## Acceptance criteria
**The card syntax**
- [x] A card is a `<card>` element: fields as attributes, `<keywords>` and `<summary>` as child tags, then markdown left exactly as written; it parses back to the same card.
- [x] Cards written with a YAML `---` header still load; whatever the app writes is the new syntax (saving a card, saving a story as a world, a new world's premise).
- [x] Unknown fields survive a round trip; text with `<`, `&` or quotes is escaped; a name that looks like a number stays text.
- [x] A file that is not a card says what is wrong in plain words (no closing tag, a field without quotes, a field written twice, a tag never closed, an id that does not look right).
- [x] The shipped example world and the template cards use the new syntax, and the template cards are tested to be valid.

**The manager (the worlds page, host only)**
- [x] A tab for the world and one each for lore, characters, places, rules, story arcs (and scenes when there are some), each with how many cards it holds.
- [x] The world tab shows title, tagline, genre, tone and point of view, and "Edit the world" changes them; the rest of `world.json` is kept.
- [x] "New ..." makes a card from a form (name, one line, trigger words, always in view; a character's part; a rule's strictness and what it applies to; the markdown), starting with blanks to fill in; it gets its own file in the folder for its kind and an id from its name, made unique.
- [x] "Edit" changes a card from the form and keeps its file, its id and any fields the form does not show; an older card is rewritten in the new syntax.
- [x] "As text" shows and edits the file itself, saved exactly as written; text that is not a card, or that reuses another card's id, is refused with the reason, shown inside the dialog, and nothing is written.
- [x] A card file that cannot be read is listed with what is wrong, can be fixed as text or removed, and does not stop the rest of the page.
- [x] "Remove" asks first, deletes the card's file and says that stories already begun keep their own copy.
- [x] Everything works without opening the world; players are refused; paths outside the card folders are refused.
- [ ] Used with a screen reader and by keyboard alone; at phone width; in dark mode.

## Non-goals
- A live preview, a rich-text editor, or a link picker (the body is plain markdown).
- Changing a story already begun: it keeps its own copy of the cards ([ADR-0009](../decisions/0009-story-copies-and-source-permissions.md)).
- Moving a card between folders, or renaming its id.
- Restoring a put-away world, or deleting one for good (Q34).

## Design
`packages/core/src/cards.ts`: `parseCard` picks the syntax from the first characters of the file; `serializeCard` writes XML+MD. `apps/server/src/files.ts`: `WorldFiles.cardFiles` reads every card file readable or not; `Library.detail` returns `cards` (with each file's text), `broken` and the world's `manifest`; `Library.saveCard` and `removeCard` do the work, through `Table` (which checks the host's right to edit the source). Routes: `PUT /api/worlds/:name/cards` (`{path?, form}` or `{path, text}`), `DELETE /api/worlds/:name/cards?path=`, and `PATCH /api/worlds/:name` now also takes genre, tone and perspective. `apps/web/src/screens/Manager.tsx` is the panel and its dialogs; a dialog shows a problem inside itself, because a notice would sit behind the dialog's backdrop (`useSave`).

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-26 | `vitest`, `tsc`, `biome`, `vite build` | 430 tests pass: 9 new for the syntax (round trip, escaping, errors, comments, templates) and 10 for the server (add, edit, text, broken cards, remove, host only, world fields, premise) |
| 2026-10-26 | `world-lint check` on the example world after converting it | No broken links |
| 2026-10-26 | The in-app browser, demo model, host | Opened a world's page; the manager showed with its tabs and counts; made a character from the form (file written in the new syntax, list updated); in "As text" a card with an unquoted field was refused with the reason shown in the dialog |
| not yet | A screen reader, keyboard alone, phone width, dark mode; remove, edit-as-form and the world dialog in the browser (covered by server tests only) | Not checked |

## History
| Date | Change |
|---|---|
| 2026-10-26 | Specified from the owner's note "story manager: lore, characters, world, cards; cards use xml+md syntax" and their choices of shape and migration; built |
