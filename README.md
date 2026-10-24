# Nirmata

Build worlds. Then host adventurers in them.

A local-first toolkit with two halves:

1. **Studio** - manage a world: lore, characters, places, arcs and rules as plain markdown cards in git, with a lorebook engine, link graph, rule checking and a version-control drawer.
2. **Host** - run adventures in a finished world with an AI game master (any local or hosted model), with Do/Say/Story input, Retry/Edit/Undo, memory, and your world's rules enforced.

Design references: SillyTavern + KoboldAI (local control, lorebooks), AI Dungeon (turn UX, story cards), Janitor AI (card browsing). Goal: **easy UI/UX**, see [docs/ux-principles.md](docs/ux-principles.md).

## Status: v0.1.1-scaffold

| Part | State |
|---|---|
| World template + example world (`worlds/`) | Done |
| Studio (legacy vanilla-JS editor, `apps/studio`) | Baseline, copied and runnable |
| World linter (`.agents/skills/world-lint`) | Verified on the example world |
| Rules judge (`services/rules-gatekeeper`) | Copied; training project, optional |
| `packages/core` engine (cards, lorebook matching, context builder, event tree) | Built, 44 tests (F-30 in progress) |
| Model providers, host orchestration, server, React UI | Planned, see [docs/lifecycle.md](docs/lifecycle.md) |

## Run the baseline Studio

Requires Node 18+. No install step.

```bash
node apps/studio/server.mjs --port 8787
```

Open http://localhost:8787/. Worlds are read from `./worlds` (override with `WORLDS_DIR`).

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
