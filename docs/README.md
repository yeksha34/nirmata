# Realmwright docs

| Doc | Purpose |
|---|---|
| [brief.md](brief.md) | The original input, verbatim |
| [requirements.md](requirements.md) | Every feature (F-xx) with priority and current status |
| [lifecycle.md](lifecycle.md) | The states a feature moves through, definition of done, status board |
| [features/](features/) | One record per feature under active work (design notes, test evidence, history) |
| [bugs.md](bugs.md) | Bug and tech-debt register (BUG-xxx / TD-xxx) |
| [decisions/](decisions/) | Architecture decision records (ADR-xxxx) |
| [tech-stack.md](tech-stack.md) | Recommended stack and the alternatives rejected |
| [ux-principles.md](ux-principles.md) | What "easy UI/UX" means here, drawn from the reference products |
| [provenance.md](provenance.md) | What was copied from the three source repos and what was left behind |

Rule of thumb: if you change behaviour, update the feature's row in `requirements.md` and its record in
`features/`. If you make a choice someone could later question, write an ADR. If something is broken,
log it in `bugs.md` before (or while) fixing it. The skills in `.agents/skills/` (`track-feature`,
`record-decision`, `log-bug`) spell out the exact steps.
