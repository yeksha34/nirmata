# F-30: Adventure host core

| | |
|---|---|
| State | Building |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-adventure-host-core` |
| Target tag | v0.2.0 |

## Value
A person picks a finished world, makes (or picks) a character, and plays a turn-by-turn adventure where an
AI host narrates using that world's cards and rules. This is the second half of the brief: "hosting
adventurers in created worlds".

## Acceptance criteria
- [ ] From the world library, **Play** starts an adventure; the opening scene is generated from the world's `world.json`, active arc and `always` cards.
- [ ] Player input has three modes: **Do**, **Say**, **Story** (AI Dungeon style), plus free-form.
- [ ] Each turn streams the host reply token by token.
- [ ] The prompt for each turn is built by the context builder (F-32): rules, always-on cards, keyword-triggered cards, memory, recent turns, within a token budget.
- [ ] The adventure is saved after every turn under `worlds/<name>/adventures/<id>/` as an append-only event log plus a rendered transcript.
- [ ] Host-only fields (e.g. a character's `Secrets`) are included in context but the host is instructed never to reveal them unprompted.
- [ ] Works against any OpenAI-compatible endpoint (KoboldCpp, Ollama, LM Studio) and against Anthropic, chosen in settings (F-35).

## Progress
- [x] `packages/core`: card/world schemas and parsing, Aho-Corasick keyword matcher, deterministic context builder with token budget and rating gate, event-tree adventure log (undo, retry, edit, branch, per-branch memory). 44 tests including a golden prompt for the example world.
- [ ] `packages/llm`: provider adapters (OpenAI-compatible, Anthropic), fake replay provider, plain-language connection errors ([ADR-0003](../decisions/0003-llm-provider-abstraction.md), [ADR-0006](../decisions/0006-stack-revision.md)).
- [ ] `packages/host`: turn orchestration (build context, stream, rule check, append events, summary refresh).
- [ ] `apps/server`: Hono routes, SSE streaming, file loading and watching, `events.jsonl` persistence.
- [ ] Play screen (React): input modes, streaming render, retry/edit/undo controls, cards-in-context drawer.

## Non-goals
- Multiple simultaneous players (F-37).
- Dice and stat resolution beyond a narrated check (F-34).

## Design
- Engine lives in `packages/host`, with the card/lorebook engine in `packages/core` and provider adapters in `packages/llm` (see [ADR-0001](../decisions/0001-tech-stack.md), [ADR-0003](../decisions/0003-llm-provider-abstraction.md)).
- Adventure log format: [ADR-0002](../decisions/0002-storage-files-plus-sqlite-index.md). One JSON object per line: `{t, turn, kind: player|host|system|edit|undo, mode, text, cardsUsed[], model}`.
- Prompt skeleton and secrecy rules: see `.agents/skills/adventure-host/SKILL.md`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `pnpm exec vitest run`, `pnpm exec tsc -b`, `pnpm exec biome check packages` | 44 tests pass, no type or lint errors. Covers the core slice only; no acceptance bullet is fully verified until server and UI exist. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified during scaffold |
| 2026-10-25 | ADR-0001/0002/0006 accepted; branch created; `packages/core` implemented |
