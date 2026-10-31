# ADR-0023: Visual novel character state, costume, and wardrobe sprite resolution

- Status: Proposed
- Date: 2026-10-31
- Related: [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [ADR-0022](0022-vn-dynamic-asset-loading-and-artstyle-fallback.md), [F-59](../features/F-59-vn-adaptation-and-player.md)

## Context
In long-form stories and episodic visual novel adaptations (`worlds/<world>/vns/<slug>/`), characters frequently undergo wardrobe, uniform, age, or physical state changes across narrative arcs (e.g. Elena Marsh beginning as an everyday junior filing clerk in blouse and navy skirt, then transitioning to a bespoke promotion uniform post-fitting; or characters in formal vs casual vs uniform attire).

Under [ADR-0022](0022-vn-dynamic-asset-loading-and-artstyle-fallback.md) and JIT asset promotion rules:
1. Assets shared across scenes are promoted to `worlds/<world>/vns/_shared/assets/sprites/`.
2. Sprites previously followed a flat naming pattern `<character>.<ext>` or `<character>_<expression>.<ext>`.
3. When multiple distinct wardrobe states or portraits exist for a single character (e.g. clerk Elena vs promotion uniform Elena), promoting a later adaptation's portrait to `_shared/assets/sprites/elena.png` would overwrite the earlier scene's canonical wardrobe, causing regressions in prior chapters (e.g. displaying promotion attire during initial scenes before the uniform was introduced).
4. Visual novel scripts needed a structured mechanism to specify costume states while preserving clean character display names on UI nameplates (e.g. rendering "ELENA", not "ELENA_UNIFORM").

## Decision
1. **Hierarchical Sprite Naming Scheme:**
   - **State Base:** `<character>_<state>.<ext>` (e.g. `elena_clerk.png`, `elena_uniform.png`)
   - **State Expression:** `<character>_<state>_<expression>.<ext>` (e.g. `elena_uniform_blushing.png`, `elena_clerk_neutral.png`)
   - **Default Base:** `<character>.<ext>` (canonical default / fallback)
   - **Simple Expression:** `<character>_<expression>.<ext>` (backwards-compatible for single-state characters, e.g. `evelyn_smug.png`)

2. **Script Directives with State Support:**
   - Extend the `[show ...]` directive in `@nirmata/core` to parse character states:
     - Colon syntax: `[show <character>:<state> <expression> <slot>]` (e.g. `[show Elena:uniform submissive center]`)
     - Space-separated syntax: `[show <character> <state> <expression> <slot>]` when slot is specified or when 4 tokens follow
     - Underscore syntax: `[show <character>_<state> <expression> <slot>]`
   - Store `state?: string` in `VnStageCharacter` on compiled slides.
   - The UI stage layer continues to display `char.character` on nameplates without leaking internal state/costume identifiers into player-facing text.

3. **Server-Side Fallback Resolution (`apps/server/src/files.ts`):**
   When resolving static sprite assets under `/api/worlds/:name/vns/:slug/assets/sprites/*`, the server tests candidates in order:
   - For `<char>_<state>_<expression>` requests:
     1. `vns/<slug>/assets/sprites/<char>_<state>_<expression>.<ext>`
     2. `vns/_shared/assets/sprites/<char>_<state>_<expression>.<ext>`
     3. `vns/<slug>/assets/sprites/<char>_<state>.<ext>`
     4. `vns/_shared/assets/sprites/<char>_<state>.<ext>`
     5. `vns/<slug>/assets/sprites/<char>_<state>_neutral.<ext>`
     6. `vns/_shared/assets/sprites/<char>_<state>_neutral.<ext>`
     7. `vns/<slug>/assets/sprites/<char>_<expression>.<ext>`
     8. `vns/_shared/assets/sprites/<char>_<expression>.<ext>`
     9. `vns/<slug>/assets/sprites/<char>.<ext>`
     10. `vns/_shared/assets/sprites/<char>.<ext>`
   - For `<char>_<state>` base requests:
     1. `vns/<slug>/assets/sprites/<char>_<state>.<ext>`
     2. `vns/_shared/assets/sprites/<char>_<state>.<ext>`
     3. `vns/<slug>/assets/sprites/<char>.<ext>`
     4. `vns/_shared/assets/sprites/<char>.<ext>`

4. **Web Frontend Dynamic Loader (`apps/web/src/vn/VnCanvas.tsx`):**
   - Texture cache keys incorporate state when present: `sprite_<world>_<slug>_<character>_<state>_<expression>` and `sprite_<world>_<slug>_<character>_<state>`.
   - Dynamic asset loader requests the state-specific sprite path first, falling back to base and procedural sculptures seamlessly.

## Consequences
+ **Zero Shared Overwrites:** Multiple wardrobe variants (`elena_clerk.png`, `elena_uniform.png`) coexist safely in `_shared/assets/sprites/` across multi-chapter adaptations.
+ **Mid-Scene Wardrobe Shifts:** Adaptations can transition characters across outfits within a single script (e.g. SC-01 in clerk wear, SC-05 in promotion uniform).
+ **Complete Backwards Compatibility:** Characters without state tags continue resolving via `<character>_<expression>.<ext>` and `<character>.<ext>` without breaking existing assets or tests.
+ **Clean UI Presentation:** Player-facing nameplates show the clean character name without internal costume tags.
