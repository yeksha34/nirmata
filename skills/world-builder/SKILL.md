---
name: world-builder
description: Create or extend a Nirmata world (worlds/<name>/) - lore, characters, places, arcs and rules - from the template, keeping cards valid and linked. Use when asked to make a new world, add NPCs/places/lore/rules to a world, expand a card, or check that a world is ready to host a story.
---

# world-builder

Read `worlds/_template/README.md` for the folder layers and `.agents/skills/story-direction` for the discipline: **lore is the source of truth; prose and stories are derived from it and never copy it verbatim**.

## New world
1. Ask (or infer) only: title, tagline, genre, tone, perspective (default second-person).
2. Copy `worlds/_template/` to `worlds/<kebab-name>/` and fill `world.json`.
3. Create at minimum: one `lore/` card (the central premise, `always: true`), one place, one character, one arc. Remove the `_*.template.md` files from the new world.

## Cards
- Frontmatter required on every card: `id` (unique, `kind.slug`), `kind`, `name`, `keywords` (words a player would actually type), `summary` (one line).
- `keywords` drive injection during play: prefer specific words over common ones, and put names plus likely nicknames.
- Put host-only information under **Secrets** and nothing that must be known by the player there.
- Link related cards with relative markdown links; every card should be reachable from the world `README.md` or another card.
- Keep scene order out of lore, and lore explanation out of scenes.

## Rules
Rule cards live in `.agents/rules/`: a `Rule` sentence, a yes/no `Check` question, and a `Why`. Mark `scope: story` for play-time rules.

## Finish
Run `node .agents/skills/world-lint/driver.mjs check` (the active world is set in `worlds/.active_story.json`). Fix broken links and orphans. A world is **ready to host** when: it lints clean, has an `always` premise card, at least one place, one character and one arc.
