# World template

The cards in this folder are the world's **source cards**. Only whoever hosts the world edits them; players never do. Every story begins by taking its own copy, so play never changes the source and later source edits do not reach stories already running (docs/decisions/0009-story-copies-and-source-permissions.md).

Copy this folder to `worlds/<your-world>/` (or use **New world** in the Studio).
Layers, from source of truth outward (see `.agents/skills/story-direction`):

| Folder | Job |
|---|---|
| `lore/` | What is true in the world: rules, history, factions, magic, secrets |
| `characters/` | Character cards (NPCs, companions, antagonists) |
| `setting/places/` | Locations and regions |
| `plot/arcs/` | Story arcs and beats a host can steer toward |
| `scenes/` | One-line events |
| `drafts/`, `chapters/` | Prose, for authored stories |
| `stories/<id>/` | One hosted run: `events.jsonl` (the truth), plus files rebuilt from it: `chapters/` (the turns that have left the context window, verbatim) and `plot/` (what has happened to each card). Never edit the rebuilt files by hand; see docs/decisions/0008-window-shift-and-plot-points.md |
| `.agents/rules/` | Hard rules the AI host/writer must obey in this world |
| `assets/` | Portraits and backgrounds |

Every card is markdown inside a `<card>` tag: the fields are attributes (`id`, `kind`, `name`, and
`role`, `always`, `scope`, `severity` where they apply), `<keywords>` and `<summary>` follow, and the
markdown comes after (see docs/decisions/0017-xml-markdown-cards.md). The host injects a card into
context when a keyword fires (the lorebook model). Named parts (`<appearance>`, `<voice>` ...) can sit between them and the markdown; the template files show them. Cards written with YAML frontmatter still load.
