---
name: "story-import"
description: "Import a story's source files (characters, lore, settings, plot, chapters, drafts, translations, the author's rules and guide) into a Nirmata world through the agent endpoints, one file at a time, so every card holds one subject. Use when asked to import, load, migrate or break up a story folder into a world."
---

# Story import

Fills a world in Nirmata from a story's source folder. The agent is the importer: the source is not shaped like cards, so the work is reading a file, deciding which subjects it holds, and writing one card for each. See [ADR-0037](../../../docs/decisions/0037-import-is-done-by-an-agent-one-file-at-a-time.md).

## Rules

- **Endpoints only.** Use `Authorization: Bearer nga_…` with the author's token for this world, at `/api/agent/worlds/<world>`. Never the database, never a script that bypasses the endpoints (`AGENTS.md`). Check the token first with `GET /api/agent/me`: it needs `import.read` and `import.write`.
- **The world already exists.** The author made it. Importing does not make worlds.
- **Work on a copy.** Copy the whole source folder into a new temporary folder outside the repository and work there. Never edit the original. Never copy source text into the repository, a commit, an issue or a log.
- **One file at a time.** Finish a file (its cards saved, its written text removed from the copy) before opening the next.
- **The order is the author's.** The author tells you the order of folders for this world, and any kinds to use. If they did not, use: guide and rules, characters, lore, settings, plots (scenes, drafts, chapters, arcs, translations).

## What a card is

A card is one subject: a person, a garment, a place, a species, an event. Its id is `kind.name` (lowercase letters, digits, hyphens in the name; the kind has no hyphen).

- **Only what is true of the subject.** Not what the story later did to it, not another subject's details. If a plot event changed a character, the event is its own card (kind `event`), and the character card keeps what was true of her as the world defines her.
- **Only the card's own fields.** A character uses the fields of her template (`appearance`, `manner`, `voice`, `wants`, `relations`, `history`, …) with the content each expects. Use `secrets` for what the host must not reveal. Put long prose in the `body`.
- **Keep the author's words.** Move text; do not summarise it away. Tidy only what is needed to make it stand alone (a heading, a pronoun that pointed at a neighbour).
- **Kinds.** Standard kinds: `character`, `place`, `lore`, `arc`, `rule`, `scene`. Make up others when the world needs them (`deity`, `playground`, `species`, `event`). Before you invent one, `GET …/cards` and reuse a kind already in use.
- **No duplicates.** `GET …/cards?kind=<kind>` before you write; if the subject has a card, merge the new facts into it (read it with `GET …/cards/<id>`, then `PUT`).

## The endpoints

The full reference, with request and response shapes, is [docs/api/agent.openapi.json](../../../docs/api/agent.openapi.json). The ones you need most:

| Do | Call |
|---|---|
| list cards (`?kind=`) | `GET …/cards` |
| read a card | `GET …/cards/<kind.name>` |
| save a card | `PUT …/cards/<kind.name>` with `{name, summary, keywords, fields:{…}, body}` |
| remove a card | `DELETE …/cards/<kind.name>` |
| world skills (guides to writing the world) | `GET/PUT/DELETE …/skills[/<name>]` with `{title, description, body}` |
| the author's rules of writing | `GET/PUT/DELETE …/rules[/<name>]` with `{title, body}` |
| chapters, scenes, drafts, translations | `GET …/writings`, `GET/PUT/DELETE …/writing?path=` with `{path, text}` |
| publish the cards as a version | `POST …/publish` with `{note}` |

## Procedure

1. **Guide and rules.** Save the world's skill (a `SKILL.md` the author kept with the world) with `PUT …/skills/<name>` and each of the author's rule files with `PUT …/rules/<name>`, whole and unchanged. Read them before you split anything else: they say what the author means by each thing.
2. **Characters, file by file.** For a character file:
   - Write the character card.
   - Write separate cards for what she wears (`clothes`), ornament she bears (`adornment`) and things she handles (`object`), each naming its owner in an `owner` field. A garment two characters share is two cards.
   - Remove from your copy everything you have written. What remains is a remnant.
3. **Remnants of the characters.** When every character file is done, read what is left in each one and sort it into cards: relations to groups into the group's card, places into place cards, customs into lore, plot consequences into `event` cards. Make a kind of your own where none fits. Remove each piece as you write it.
4. **Lore, file by file.** A lore file with several subjects becomes several cards. Same discipline: scoped, no plot leakage, remove what you wrote.
5. **Settings and places.** The same, kind `place` or the world's own (`playground`).
6. **Plots.** For each plot, save its scenes, drafts, chapters, translations and character arcs as writings: `chapters/<plot>/scene/<file>.md`, `…/draft/…`, `…/chapter/…`, `chapters/<plot>/translations.md`; save its arc notes as `arc` cards. One file per call.
7. **Check.** `GET …/cards` and compare with the files you handled: every character has a card; every garment, ornament and object found in a character file has its own card. Anything left in your copy is unplaced: list it for the author.
8. **Publish.** `POST …/publish` once, when the author says the cards are in.

## Report

When you stop, tell the author: how many cards of each kind you wrote, which kinds are new, which files still hold text you could not place (by file name, not by content), and any subject you were unsure how to split. Do not paste story text into the report.
