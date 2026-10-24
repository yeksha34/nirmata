# @nirmata/core

The pure engine behind both the Studio and the Host. No file, network or clock access: callers pass in text, ids and timestamps, so everything is deterministic and testable. See [ADR-0006](../../docs/decisions/0006-stack-revision.md).

| Module | What it does |
|---|---|
| `schema` | Zod schemas for card frontmatter, `world.json`, player modes, ratings |
| `cards` | `parseCard`, `parseWorldManifest`, `checkCards` (duplicate ids), `plainLinks` |
| `normalize`, `matcher` | Case/accent/whitespace folding; Aho-Corasick keyword scan on word boundaries |
| `tokens` | `TokenCounter` interface and a conservative fallback estimate |
| `context` | `buildContext`: rules, always-on cards, keyword-triggered cards, memory and recent turns packed into a token budget, with an explanation for every inclusion and exclusion |
| `events` | Append-only event tree: `replay`, `undoEvent`, `retryParent`, `editEvent`, `gotoEvent`, `breakEvent`, `parseLog`. `turnsOf` is the transcript, `memoryOf` the pins; both (and everything below) can be read "as of" any node. Host events carry `flags` (rules a reply broke) and `shifted` (the window cursor) |
| `window` | `windowCursor`, `contextTurnsOf` (what may still be in the prompt), `chaptersOf` (the turns outside the window, verbatim, split at `break` events), `renderTurn` |
| `plot` | `plotPointsOf`, `plotCursor`, `turnsSincePlot`, `cardsWithPlot` (appends a card's points to its body), and event makers `plotEvent`, `unplotEvent`, `undoLastPlotEvent`, `manualPlotEvent` |
| `projection` | `projectAdventure(state)`: the `chapters/` and `plot/` files the current branch should have on disk, as pure data |

## Context priority

Required (throws `ContextBudgetError` if they cannot fit): host instructions, player input, `must` rules.
Then, dropped lowest first: `should` rules, always-on cards, the last two turns, keyword-triggered cards (most recently triggered first), pinned facts, memory summary, older turns (newest first, contiguous).

## Develop

```bash
corepack pnpm install
corepack pnpm test        # vitest
corepack pnpm typecheck   # tsc -b
corepack pnpm lint        # biome
```

`test/__golden__/` holds the snapshotted prompt for the example world. A change there means the prompt the model sees changed: review it as a product change, then `corepack pnpm exec vitest run -u`.
