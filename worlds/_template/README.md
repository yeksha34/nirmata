# World template

The cards in this folder are the world's **source cards**. Only whoever hosts the world edits them; players never do. Every adventure begins by taking its own copy, so play never changes the source and later source edits do not reach adventures already running (docs/decisions/0009-adventure-copies-and-source-permissions.md).

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
| `adventures/<id>/` | One hosted run: `events.jsonl` (the truth), plus files rebuilt from it: `chapters/` (the turns that have left the context window, verbatim) and `plot/` (what has happened to each card). Never edit the rebuilt files by hand; see docs/decisions/0008-window-shift-and-plot-points.md |
| `.agents/rules/` | Hard rules the AI host/writer must obey in this world |
| `assets/` | Portraits and backgrounds |

Every card is markdown with YAML frontmatter (`id`, `kind`, `name`, `keywords`, `summary`)
so the host can inject it into context when a keyword fires (the lorebook model).
