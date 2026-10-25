# ADR-0018: A card has named parts, and templates say which

- Status: Accepted 2026-10-26 (the owner asked for per-kind fields and templates generalised from an existing story world)
- Related: [ADR-0017](0017-xml-markdown-cards.md), [F-55](../features/F-55-story-manager.md)

## Context
[ADR-0017](0017-xml-markdown-cards.md) gave a card its attributes, `<keywords>`, `<summary>` and a markdown body, and nothing in between: a character's appearance, voice and wants were bullets someone had to remember to type. Long-running story worlds show what cards want to be: every character repeats the same labels (kind, age, position, appearance, manner, voice, mannerisms, relations), every place the same (kind of place, keeper, the ground, hooks), lore a handful of recurring shapes (a custom, a group, a kind of being, an event).

## Decision
1. **A card has named parts.** Each is a child tag whose name is the part (`<appearance>`, `<voice>`, `<life-outside-the-story>`) and whose content is markdown. They sit after `<keywords>` and `<summary>`, before the free body, which stays for anything else. Parts are stored as `fm.fields` (name to text, in the order written), so they travel through the story copy, the event log and "save a story as a world" with no new plumbing.
2. **Any lowercase tag is a part, except structure and HTML.** The names a card may not use (`card`, `keywords`, `summary`, `data`, and common HTML such as `p`, `div`, `details`) are listed in `schema.ts`; a body that opens with one of those is still body. So a world can have parts no template knows, and a typo is a custom part rather than an error.
3. **Templates are lists of parts, not schemas.** `packages/core/src/templates.ts` holds, for each kind, the shapes people reach for (person, creature, deity or being of power, player character; location, venue or establishment, region; concept or custom, group or faction, species or kind, event or era; rule; story arc; scene) and a blank "plain notes" for each kind. A template gives each part a label and a hint. Templates were generalised from the labels the owner's existing story world repeats, keeping the structure and none of its content. A card stores only the parts that are filled in, and may carry parts from no template.
4. **The same part has the same label everywhere** (tested), so a card reads the same whichever template it began from. Which template suits an existing card is inferred from the parts it has.
5. **The storyteller reads parts as `- **Label:** text`** lines (a multi-line part as a bold label over its lines), then the body without its title. `cardBody` in core does this; the context builder and the rule checker (which looks for the **Check** part) both use it.
6. **The server serves the templates** (`GET /api/card-templates`) so the screen has one list, and accepts a card's parts in the manager's form; a part with a bad name is refused in plain words.
7. Text inside a part is dedented when read, so an indented list written inside a tag comes out as written.

## Consequences
+ A new character, place or custom starts with the right blanks, and the prompt shows them in a steady shape.
+ The example world and the template files show the format; old cards with bullets in the body still work unchanged.
+ Adding or renaming a template needs no migration: cards keep the parts they have.
- A part that contains its own closing tag (`</appearance>`) cannot be written.
- A body that starts with a lowercase tag that is not in the HTML list is read as a part, so to open a body with such a tag, put a line of text before it.
- The prompt is slightly longer for a card written in parts than for a terse paragraph; the context budget already accounts for each card's rendered text.

## Alternatives considered
- **Schemas per kind, parts validated:** forces authors into one shape and makes every world a migration.
- **Parts as attributes:** long text does not belong in an attribute.
- **Keeping the bullets in the body and teaching the form to read them:** fragile; the writer could not tell a part from prose.
