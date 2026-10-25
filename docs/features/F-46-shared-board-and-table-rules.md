# F-46: The shared board, age confirmation and moderation

| | |
|---|---|
| State | Building |
| Priority | Must (board), Should (age, moderation) |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
Several people can play one story fairly and without accounts: they write their turns side by side, talk and object before submitting, and the host keeps order in the story's own voice.

## Acceptance criteria
**Shared board ([ADR-0013](../decisions/0013-shared-board.md))**
- [x] Each player has their own lines; everyone at the table sees every draft and remark.
- [x] Players can remark, object to a specific draft, and withdraw their own; changing a turn answers objections to it.
- [x] A round closes when the story is idle and every player who wrote something is ready; the host can close it early.
- [x] Lines are submitted together, attributed and tagged as one round, and answered by one reply.
- [x] Undo, retry and the plot trigger treat a round as one turn.
- [x] Players can prepare the next turn while the story is writing.
- [ ] Live updates between connected people (needs the server).

**Age confirmation ([ADR-0014](../decisions/0014-age-confirmation-production-only.md))**
- [x] When on, joining without confirmation is refused with a plain message and nobody is seated.
- [x] It is on only when `NODE_ENV` is `production`; never in development or tests.
- [ ] The confirmation screen (needs the interface).

**Moderation ([ADR-0015](../decisions/0015-moderation-in-the-story-voice.md))**
- [x] Host-only kick, mute, unmute and rename; players are refused and nothing changes.
- [x] Each action is announced in an in-fiction line (spell, tape, weapon, trap); the effect is separate plain state.
- [x] The host cannot be targeted; kicked people can rejoin; muted drafts are not submitted.

## Non-goals
- Real-time transport, accounts, bans, time limits on a round.

## Design
`Board` (`packages/host/src/board.ts`), `describeModeration`, `isProduction`; `by`, `round` and `roundLines` in core; `submitRound` in the session.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc -b`, `biome` | 310 tests pass. Board: joining, nicknames, drafts, remarks and objections, round closing, early close, busy handling, solo shortcut, moderation permissions and effects, wording for every action and style. Rounds: attribution, one reply for several lines, undo and retry as one turn, chapter text with names, plot trigger and transcript. Fake provider only. |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified from the owner's answers; implemented in `packages/core` and `packages/host` |
