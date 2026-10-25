# F-45: Player input is never fact

| | |
|---|---|
| State | Building |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
Players can say anything without blocking the story or corrupting it. What they claim only counts if the story confirms it, and the rules checker never edits their words.

## Acceptance criteria
- [x] Player input reaches the host exactly as written (no sanitising, rewriting or rejecting).
- [x] The host is told that player input is not fact and that contradictions with rules, cards or memory are untrue in the story.
- [x] The rules checker is given only host-written text, after it is generated.
- [x] The plot extractor is told to ignore claims the host did not confirm.
- [ ] A real model actually treats a false claim as untrue (needs a live-model check; the fake provider cannot show it).

## Non-goals
- Deciding in advance which input is valid.
- Hiding the player's words from the transcript or the chapter.

## Design
[ADR-0012](../decisions/0012-player-input-is-not-fact.md). Prompt text in `packages/core/src/context.ts`; extractor text in `packages/host/src/plot.ts`; the judge is called with the reply text only (`packages/host/src/session.ts`).

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc -b`, `biome` | Input passthrough, judge-sees-only-host-text, and both prompt instructions tested (fake provider). Real-model behaviour not verified. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified and implemented from the owner's answer (ADR-0012) |
