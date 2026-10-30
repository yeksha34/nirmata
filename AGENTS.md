# Agent guide

Nirmata: build worlds, then host stories in them. Start at [docs/README.md](docs/README.md).

- Skills live in `.agents/skills/` (canonical). To use them with Claude Code, expose them as `.claude/skills`:
  `New-Item -ItemType Junction -Path .claude\skills -Target .agents\skills` (PowerShell) or `ln -s ../.agents/skills .claude/skills`.
- Before changing behaviour read [docs/lifecycle.md](docs/lifecycle.md); after changing it, follow `track-feature`.
- Record bugs in [docs/bugs.md](docs/bugs.md) (`log-bug`) and choices in [docs/decisions/](docs/decisions/) (`record-decision`).
- Never commit secrets, and never copy private story content into this repo ([ADR-0005](docs/decisions/0005-scaffold-content-neutral.md)).
- Do only what was asked. Never inspect, query git, or explore directories outside this workspace (e.g. external repos) unless explicitly told to do so. Do not invent side tasks or preemptive investigations that waste tokens.
- Git deliverable workflow: for every deliverable step, create a dedicated branch, commit on that branch, and merge it back into the current working branch. Do this for all deliverables steps.
- Check a world: `node .agents/skills/world-lint/driver.mjs check`.

| Skill | Use for |
|---|---|
| `world-builder` | Create/extend worlds and cards |
| `story-host` | Run or specify a hosted story |
| `world-lint` | Validate links, orphans, stats; navigate cards |
| `story-direction` | Layering discipline: lore vs scenes vs drafts vs chapters |
| `story-to-vn-adaptation` | Adapt a story into a visual novel: routes, scenes, script, asset budget |
| `structured-prompts` | Write host/system prompts with clean context/output separation |
| `rules-check-manual` | Judge a draft against a world's rule cards, using the agent itself |
| `track-feature` | Feature lifecycle and status board |
| `record-decision` | ADRs |
| `log-bug` | Bug and tech-debt register |
| `release-tag` | Cut a tagged release |
