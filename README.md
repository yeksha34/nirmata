# Nirmata

Build worlds. Then host stories in them.

A local-first toolkit with two halves:

1. **Studio** - manage a world: lore, characters, places, arcs and rules as plain markdown cards in git, with a lorebook engine, link graph, rule checking and a version-control drawer.
2. **Host** - run stories in a finished world with an AI game master (any local or hosted model), with Do/Say/Story input, Retry/Edit/Undo, memory, and your world's rules enforced.

Design references: SillyTavern + KoboldAI (local control, lorebooks), AI Dungeon (turn UX, story cards), Janitor AI (card browsing). Goal: **easy UI/UX**, see [docs/ux-principles.md](docs/ux-principles.md).

## Status: v0.1.1-scaffold

| Part | State |
|---|---|
| World template + example world (`worlds/`) | Done |
| Studio (legacy vanilla-JS editor, `apps/studio`) | Baseline, copied and runnable |
| World linter (`.agents/skills/world-lint`) | Verified on the example world |
| Rules judge (`services/rules-gatekeeper`) | Copied; training project, optional |
| `packages/core` engine (cards, lorebook matching, context builder, event tree) | Built, 113 tests (F-30 in progress) |
| `packages/llm` model providers (OpenAI-compatible, Anthropic, fake) | Built, 48 tests; not yet tried against a live model |
| `packages/host` game master (turns, retry/undo/branch, rule checks, context window shifting into chapters, plot points on cards) | Built, 157 tests with the fake provider |
| `apps/server` table server (join, shared board, live story, saved stories, per-role views) | Built, 46 tests; no screens yet, see [apps/server/README.md](apps/server/README.md) |
| `apps/web` screens (join, choose a world, continue or start a story, play on the shared board) | Built, 11 tests; not yet checked by eye in a browser, see [F-49](docs/features/F-49-screens-join-library-table.md) |

## Run the baseline Studio

Requires Node 18+. No install step.

```bash
node apps/studio/server.mjs --port 8787
```

Open http://localhost:8787/. Worlds are read from `./worlds` (override with `WORLDS_DIR`).

## Run a table

Needs Node 22+ and a model (or `NIRMATA_PROVIDER=demo` to try it without one). This builds the screens, starts the server and opens your browser as the host; you choose the world there. Everyone else joins at the address it prints, by name. Details and the API in [apps/server/README.md](apps/server/README.md).

```bash
NIRMATA_PROVIDER=demo corepack pnpm start
```

Your worlds live in `worlds/` (or the folder in `NIRMATA_WORLDS`).

## Develop the engine

Requires Node 22+ and pnpm (`corepack pnpm ...` works without installing it).

```bash
corepack pnpm install
corepack pnpm test
```

See [packages/core/README.md](packages/core/README.md).

## Check a world

```bash
node .agents/skills/world-lint/driver.mjs check
```

## Docs

[docs/README.md](docs/README.md) indexes requirements, lifecycle, bugs, decisions, tech stack and provenance. The original input is kept verbatim in [docs/brief.md](docs/brief.md).
