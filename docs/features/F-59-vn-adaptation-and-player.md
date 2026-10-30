# F-59: Visual novel adaptation and player

| | |
|---|---|
| State | Building |
| Priority | Should |
| Owner | unassigned |
| Branch | `feat/F-59-adaptation-pipeline` |
| Target tag | v0.3.0 |

## Value
Authors can adapt their written chapters and drafts into interactive visual novels, scoped to manageable budgets one piece of prose at a time, and immediately play and test them in the browser before commissioning or generating final art.

## Acceptance criteria
- [x] An adaptation pipeline operates on exactly one chapter or draft at a time.
- [x] The adaptation output is saved to `worlds/<name>/vns/<slug>/` containing `manifest.json` and `adaptation.md` following the `story-to-vn-adaptation` specification.
- [x] A compiler parses the neutral script notation in `adaptation.md` into a typed, deterministic slide deck in `slides.json`.
- [x] The slide deck validates scene jumps, menu choices, and route variable operations.
- [ ] A Phaser.js presentation screen displays the visual novel:
  - Background rendering with transition support.
  - Character sprite slots (left, center, right) and expression swapping.
  - Procedural placeholder fallbacks for backgrounds and sprites when image assets do not exist.
  - Dialogue box with typewriter text effect, speaker nameplate, and distinct formatting for inner monologue `( MC )`.
  - Interactive choice menus that branch to target scenes and update variables.
- [ ] Game loop hooks are in place for future capabilities: dialogue backlog, save/load state, auto-play, skip, and audio playback.
- [x] The world's Writings view (`Writings.tsx`) shows an "Adapt to VN" or "Play VN" action next to each chapter and draft.

## Non-goals
- Full Ren'Py engine emulation in the browser.
- Generating finished sprite or background image files directly inside the player UI.
- Whole-world single-pass adaptation.

## Design
- Architecture Decision: [ADR-0019](../../docs/decisions/0019-vn-adaptation-pipeline-and-player.md).
- Adaptation skill: [.agents/skills/story-to-vn-adaptation](../../.agents/skills/story-to-vn-adaptation/SKILL.md).
- Pipeline states:
  1. **Source:** `chapters/<name>.md` or `drafts/<name>.md`.
  2. **Adaptation doc:** `vns/<slug>/adaptation.md` (written via GenAI agent) + `manifest.json`.
  3. **Compiled slides:** `vns/<slug>/slides.json` (compiled mechanically in `@nirmata/core`).
  4. **Player:** Canvas component rendered with Phaser.js in `apps/web`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-30 | `npx vitest run packages/core/test/vn.test.ts` | 15/15 tests pass (parser, compiler, stage states, menus, validator) |
| 2026-10-30 | `npx vitest run apps/server/test/vn.test.ts` | 3/3 tests pass (scaffold, disk compile, REST API) |
| 2026-10-30 | `npm run typecheck` & `npm run lint` | 0 errors, 0 warnings across all packages |

## History
| Date | Change |
|---|---|
| 2026-10-30 | Implemented VN adaptation pipeline: parser, compiler, slide deck validator, server filesystem & REST endpoints, and Writings UI actions. |
| 2026-10-30 | Specified feature and documented pipeline states, output scaffolding, and presentation engine ([ADR-0019](../../docs/decisions/0019-vn-adaptation-pipeline-and-player.md)). |
