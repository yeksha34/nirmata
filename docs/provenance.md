# Provenance: what came from where

Realmwright was scaffolded on 2026-10-25 from three sibling projects. Nothing was moved; the originals
are untouched.

| Source | Taken | Went to | Left behind, and why |
|---|---|---|---|
| `story-editor-pc` (branch `pc`, **working tree**, with uncommitted edits to `app.js`, `index.html`, `server.mjs`; HEAD `33a47ae`) | `tools/story_editor/*` (code only) | `apps/studio/` | `assets/` (183 MB personal images), `state/` (personal story state and API-config), `electron/node_modules` (460 MB), `.git` (373 MB history) |
| | `tools/*.py`, `tools/*.mjs`, `reader_head.html` | `tools/` | `tools/.env` (contains a live API key, see BUG-001), `__pycache__`, built reader HTML |
| | `.claude/skills/rules-check-manual`, `.claude/skills/world-lint` | `.agents/skills/rules-check-manual`, `.agents/skills/world-lint` | |
| | `.mcp.json`, `.AGENT/implementation_plan_*` | `.mcp.json` (path updated) | Plans were specific to the old corpus |
| `rules-gatekeeper` (branch `main`, `e34323a`) | scripts, README, model card, requirements | `services/rules-gatekeeper/` | `data/dataset.jsonl`, `rule_groups.json`, `rule_scopes.json` (generated from private rule text) |
| `stories-repo` (branch `story/imported-story`, `7746d8d`) | **Structure only**: the `lore/characters/setting/plot/scenes/drafts/chapters/.agents/rules` layering, and the `story-direction` and `structured-prompts` skills | `worlds/_template/`, `worlds/example-world/`, `.agents/skills/` | All story content (cards, chapters, drafts, rules). It is the author's private work and is not needed to demonstrate the scaffolding; the example world is new and content-safe |

## Deliberate changes during copy

- `stories/` became `worlds/`; `STORIES_ROOT` still works as a legacy override, `WORLDS_DIR` is the new one.
- `.claude/skills` became `.agents/skills` (see the README for how to expose them to Claude Code).
- Default world is `example-world`.
- Everything else is byte-for-byte the source (see TD-003, TD-006, TD-007 for the cleanup list).
