# World template

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
| `adventures/` | Saved play sessions (hosted runs of this world), see docs/requirements.md F-30..F-39 |
| `.agents/rules/` | Hard rules the AI host/writer must obey in this world |
| `assets/` | Portraits and backgrounds |

Every card is markdown with YAML frontmatter (`id`, `kind`, `name`, `keywords`, `summary`)
so the host can inject it into context when a keyword fires (the lorebook model).
