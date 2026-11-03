# F-57: Bring an older story in

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
A story that was written before Nirmata (a folder of markdown files: a `## Name` heading over `- **Label:** text` bullets) becomes a world the app can host, without anyone retyping a card. The first one brought in is the owner's own story, `imported-story` (146 cards of characters, places, lore, rules and arcs).

## How it works
`pnpm --filter @nirmata/importer import <story folder> <new world folder> <recipe.json>` ([legacy.ts](../../apps/importer/src/legacy.ts)). The recipe ([imported-story.json](../../apps/server/imports/imported-story.json)) names the world and settles the few things a file cannot say about itself.

| In the old story | In the world |
|---|---|
| `characters/*.md` | character cards: `- **Label:**` bullets become named parts (`Owner` is the template's `keeper`, `Kind of place` is `kind`, `The ground` is `layout`), the rest is the body. `(protagonist)` in a heading becomes the role. |
| `setting/**/*.md` | place cards, the same way (one file, the family, is set to lore in the recipe) |
| `lore/**/*.md` | lore cards: the markdown kept as it was, with a summary taken from its first words |
| `.agents/rules/*.md` | rule cards: the text is the rule, a `trigger: always_on` header makes it `must`, the judge's yes/no question comes from the recipe |
| `plot/arcs/character_arcs.md` and `plot/story_state.md` | one arc card per character, holding their arc as the body and where they stand now as the `progress` part |
| working documents (checklists, style sheets) | copied to `notes/`, and links to them are pointed there |
| chapters, drafts, assets, skills | copied across exactly as they were |

Keywords come from the name: the full name, the name without its title, and the first name when it is a person's and no other card of that kind has it. The recipe lists the words the story also uses for something else (`avoid`), and writes the lore cards' keywords by hand, since a shortened name like "touch" would bring a card in on every page.

## Keeping the world in step with its story
The world made by the import is the version every story starts from; stories played in it keep their own copy of the cards and live in the world's `stories/` folder, which is never touched. So the world follows its source:

```
pnpm --filter @nirmata/importer import:watch <story folder> <world folder> <recipe.json>
```

For this story (from the project folder):

```
pnpm --filter @nirmata/importer import:watch stories/imported-story worlds\imported-story apps\server\imports\imported-story.json
```

([watch.ts](../../apps/importer/src/watch.ts), [legacy-sync.ts](../../apps/importer/src/legacy-sync.ts), [watch-core.ts](../../apps/importer/src/watch-core.ts))

- It brings the world up to date once, then watches the story folder and, 2 seconds after the changes stop (`--quiet <ms>`), does it again. A burst of saves, a sync client dropping a batch or a `git checkout` is one run, never two at once, and no later than ten seconds after the first change however long the changes keep coming. Version control, caches and editors' scratch files (`.git`, `__pycache__`, `*~`, `*.swp`, `*.tmp`, `~$*`, `.DS_Store`) neither trigger a run nor are brought in.
- A run builds the world again in a scratch folder and brings in every file that differs: new files are added, changed ones replaced, ones the importer no longer writes removed. Files are replaced whole, never half written, as the server may be reading them.
- **Nothing is lost.** A file the world had in a different state (edited in Nirmata, or from an older import) is moved to `.import/replaced/<time>/` before the new one is written, as is a removed one. Cards made in Nirmata and anything else the importer never wrote are not looked at. `.import/state.json` records what the importer wrote.
- `--dry-run` says what would change and writes nothing; `--once` runs once and stops (exit code 3 if a conflict was left); `--notes` prints the importer's notes; `--keep-edits` works the other way, letting what was changed in Nirmata win: a file changed on both sides is left as it is and the story's version goes to `.import/incoming/` to merge.
- Stories already open keep their own copy; the new cards show in stories started afterwards, and on the worlds page after a reload.

A dry run against the real `worlds/imported-story` (no earlier record, and the story having moved on since the import): 19 files added, 160 replaced (each old copy would be kept), 62 already the same. It has not been run for real; the first real run puts those 160 old copies in `.import/replaced/`.

## Acceptance criteria
- [x] The world can be kept in step with its story by a debounced watcher (22 tests on the sync, the waiting and the noise filter, and a run of the real watcher on a copy of the story).
- [x] Every card file is written in the XML+markdown syntax and read back; the import says so when one comes back different (none do).
- [x] The importer reports a link to a card that is not there, and a label it had to rename; it will not write over an existing world.
- [x] Tests on a small made-up story: parts and aliases, nested bullets, a body after a heading, first names shared by two people, skins, rule severity and questions, arcs merged with state, notes and relinking, copied files untouched (11 tests).
- [x] The imported story opens in the app: 146 cards (63 characters, 31 lore, 8 places, 11 rules, 33 arcs), none unreadable, and a prompt built from it brings in the right cards for a line of play (checked at 4,096 and 16,384 tokens).

## Not done / to know
- Three links in the old lore already led nowhere (two baits and a playground whose cards were never written); they still do.
- The rules' check questions, the world's genre, tone and point of view, and the one-line summaries were written for the import from the rules and chapters; they are in the recipe and the cards to correct.
- All eleven rules take about 5,000 tokens. At the default 4,096-token window seven of the eleven rules and at most one other card fit; this story wants a 16,000-token window or more.
