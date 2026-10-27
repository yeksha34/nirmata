# F-57: Bring an older story in

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
A story that was written before Nirmata (a folder of markdown files: a `## Name` heading over `- **Label:** text` bullets) becomes a world the app can host, without anyone retyping a card. The first one brought in is the owner's own story, `cuntitty` (146 cards of characters, places, lore, rules and arcs).

## How it works
`pnpm --filter @nirmata/server import <story folder> <new world folder> <recipe.json>` ([legacy.ts](../../apps/server/src/legacy.ts)). The recipe ([cuntitty.json](../../apps/server/imports/cuntitty.json)) names the world and settles the few things a file cannot say about itself.

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

## Acceptance criteria
- [x] Every card file is written in the XML+markdown syntax and read back; the import says so when one comes back different (none do).
- [x] The importer reports a link to a card that is not there, and a label it had to rename; it will not write over an existing world.
- [x] Tests on a small made-up story: parts and aliases, nested bullets, a body after a heading, first names shared by two people, skins, rule severity and questions, arcs merged with state, notes and relinking, copied files untouched (11 tests).
- [x] The imported story opens in the app: 146 cards (63 characters, 31 lore, 8 places, 11 rules, 33 arcs), none unreadable, and a prompt built from it brings in the right cards for a line of play (checked at 4,096 and 16,384 tokens).

## Not done / to know
- Three links in the old lore already led nowhere (two baits and a playground whose cards were never written); they still do.
- The rules' check questions, the world's genre, tone and point of view, and the one-line summaries were written for the import from the rules and chapters; they are in the recipe and the cards to correct.
- All eleven rules take about 5,000 tokens. At the default 4,096-token window seven of the eleven rules and at most one other card fit; this story wants a 16,000-token window or more.
