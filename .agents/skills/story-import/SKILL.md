---
name: "story-import"
description: "Import a story's source files (characters, lore, settings, plot, chapters, drafts, translations, the author's rules and guide) into a Nirmata world through the agent endpoints, as parallel workers each on its own kinds of card, so every card holds one subject. Use when asked to import, load, migrate or break up a story folder into a world."
---

# Story import

Fills a world in Nirmata from a story's source folder. The agents are the importer: the source is not shaped like cards, so the work is reading a file, deciding which subjects it holds, and writing one card for each. See [ADR-0037](../../../docs/decisions/0037-import-is-done-by-an-agent-one-file-at-a-time.md). The calls are in [docs/api/agent.openapi.json](../../../docs/api/agent.openapi.json).

## Rules

- **Endpoints only.** Use `Authorization: Bearer nga_…` with a token for this world, at `/api/agent/worlds/<world>`. Never the database, never a script that bypasses the endpoints (`AGENTS.md`). Check your token first with `GET /api/agent/me`. To call through the helper, keep each worker's token in its own agent env file: see [env.example](env.example).
- **The world is made by the import.** The author uses "Import a world" in the app, which makes the world in the database, empty, and the tokens for the workers with it. You fill the world; you do not make it.
- **Work on a copy.** The author's source is copied into a temporary folder outside the repository and you work there. Never edit the original, and never edit the copy: a ledger (below) says what you took. Never copy source text into the repository, a commit, an issue or a log.
- **One file at a time.** Finish a file (its cards saved, its ledger lines written) before opening the next.
- **The order is the author's.** The author tells you the order of folders and any kinds to use for this world. The order below is the default.
- **Keep to your lane.** A lane token can write cards of its own kinds only; the server refuses the rest. It can read everything.

## What a card is

A card is one subject: a person, a garment, a place, a species, an event. Its id is `kind.name` (lowercase letters, digits, hyphens in the name; the kind has no hyphen).

- **Only what is true of the subject.** Not what the story later did to it, not another subject's details. If a plot event changed a character, the event is its own card (kind `event`), and the character card keeps what was true of her as the world defines her.
- **Only the card's own fields.** A character uses the fields of her template (`appearance`, `manner`, `voice`, `wants`, `relations`, `history`, …) with the content each expects. Use `secrets` for what the host must not reveal. Put long prose in the `body`.
- **Keep the author's words.** Move text; do not summarise it away. Tidy only what is needed to make it stand alone (a heading, a pronoun that pointed at a neighbour).
- **Kinds.** Standard kinds: `character`, `place`, `lore`, `arc`, `rule`, `scene`. Others when the world needs them (`deity`, `playground`, `species`, `event`, and `clothes`, `adornment`, `object`). Before you invent a kind, `GET …/cards` and reuse one already in use.
- **No duplicates.** `GET …/cards?kind=<kind>` before you write; if the subject has a card, read it (`GET …/cards/<id>`) and `PUT` it with the new facts merged in.

## Threads

The import runs as workers at the same time, each on its own kinds, so none waits for another and none overwrites another. The author's session starts them and makes one token for each in the Agent access panel ("Works on"). Give each worker its token in its own environment variable (`NIRMATA_TOKEN`); never paste it into a message.

| Worker | Token's kinds | Reads | Writes |
|---|---|---|---|
| **characters** | `character` | the character files | one `character.<file-name>` card per character |
| **accessories** | `clothes`, `adornment`, `object` | the same character files, for what she wears, bears and handles | one card per garment, ornament or object, each with an `owner` field naming its character |
| **settings** | `place`, and the world's own kind for settings (for example `playground`) | the setting files | one card per place |

Rules that let them work together:

1. **A character's id is fixed by her file.** `character.` plus the file's name in lowercase, underscores as hyphens, no extension (`deity_areola.md` is `character.deity-areola`). The accessories worker uses that id as the `owner` without waiting for the characters worker.
2. **Nobody edits the source.** Each worker keeps a ledger in `<temp>/ledger/<lane>.jsonl`, one line for each stretch of source it took: `{"file":"characters/deity_areola.md","from":3,"to":18,"card":"clothes.areola-gown"}` (lines are 1-based, both ends included). A line two workers took is counted once.
3. **The lanes finish before the rest starts.** The author's session waits for all of them, then checks `GET …/cards`: every character file has a card; every garment, ornament and object in those files has its own card.

### Then the cards no lane knew

When the known kinds are done, one more worker (or one per folder, each with its own ledger) takes the rest. Its token has no kinds, or only the kinds the world invents.

1. Work out what is left: `node <repo>/.agents/skills/story-import/remnants.mjs <temp>/source <temp>/ledger <temp>/left`. It writes each file's untaken lines under `<temp>/left` and lists any ledger line it could not use.
2. **Remnants of the character and setting files first.** Sort each into cards: relations to groups into the group's card, customs into lore, plot consequences into `event` cards. Make a kind of your own where none fits.
3. **Then the lore files, whole,** one card per subject. A file with several subjects becomes several cards.
4. **Then the plots.** Save each plot's scenes, drafts, chapters and translations as writings, one file per call: `chapters/<plot>/scene/<file>.md`, `…/draft/…`, `…/chapter/…`, `chapters/<plot>/translations.md`, `chapters/<plot>/character_arcs.md`. Writings need an unrestricted token. The folder names matter: a folder called `draft` or `drafts` under the plot makes its files drafts (listed under Drafts, and counted as drafts by `GET /api/agent/worlds/<world>`), one called `scene` or `scenes` makes them scenes (one-line beats, kept out of the Chapters list), and anything else is a chapter. `drafts/<plot>/<file>.md` also makes a draft.
5. Write ledger lines as before. Run `remnants.mjs` again: what it still lists is unplaced.

### Guide, rules and publishing

An unrestricted token saves the world's skill (`PUT …/skills/<name>`) and each of the author's rule files (`PUT …/rules/<name>`), whole and unchanged, before anything else. Read them before you split: they say what the author means by each thing. When the author says the cards are in, `POST …/publish` once. Lane tokens cannot do these.

## One worker alone

Without threads one agent with an unrestricted token does the same in order: guide and rules, characters, accessories, settings, then the rest, keeping the same ledger.

## Report

When you stop, tell the author: how many cards of each kind you wrote, which kinds are new, which files still hold text you could not place (by file name, not by content), and any subject you were unsure how to split. Do not paste story text into the report.
