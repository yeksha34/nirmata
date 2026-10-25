# Architecture decision records

One file per decision, numbered, never rewritten. A changed decision is a new ADR that supersedes the old one.
Use `.agents/skills/record-decision`.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-tech-stack.md) | TypeScript, React + Vite, Hono, pnpm monorepo | Accepted (amended by 0006) |
| [0002](0002-storage-files-plus-sqlite-index.md) | Markdown files in git as source of truth, SQLite as rebuildable index | Accepted |
| [0003](0003-llm-provider-abstraction.md) | Provider adapter layer over OpenAI-compatible API and Anthropic | Proposed (partly superseded by 0006) |
| [0004](0004-desktop-shell-and-mobile.md) | Electron shell and PWA for phones | Superseded by 0006 |
| [0005](0005-scaffold-content-neutral.md) | Scaffold copies structure and tooling, not private story content | Accepted |
| [0006](0006-stack-revision.md) | Stack revision: headless core, event-sourced adventures, own model adapters, no desktop shell | Accepted |
| [0007](0007-adventure-compaction.md) | Compaction is an event; chapters and tracking cards are projections | Superseded by 0008 |
| [0008](0008-window-shift-and-plot-points.md) | Shift the context window into chapters; carry plot on the cards | Accepted |
| [0009](0009-adventure-copies-and-source-permissions.md) | Adventures start from a copy of the source cards; only hosts edit the source | Accepted |
| [0010](0010-adults-only.md) | Nirmata is for adults; there are no rating tiers | Accepted |
| [0011](0011-irc-style-joining.md) | Joining a story works like IRC: no accounts | Accepted |
| [0012](0012-player-input-is-not-fact.md) | Player input is never fact; the rules checker only judges generated text | Accepted |

"Proposed" ADRs become "Accepted" when the owner confirms; until then treat them as the working plan.
