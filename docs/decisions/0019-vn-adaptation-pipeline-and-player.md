# ADR-0019: Chapter and draft visual novel pipeline and player

- Status: Proposed
- Date: 2026-10-30
- Related: [ADR-0006](0006-stack-revision.md), [F-58](../features/F-58-paged-reader.md), [F-59](../features/F-59-vn-adaptation-and-player.md), [.agents/skills/story-to-vn-adaptation](../../.agents/skills/story-to-vn-adaptation/SKILL.md)

## Context
A world contains lore cards, but also written prose in `chapters/` and `drafts/`, which can be read as books ([F-58](../features/F-58-paged-reader.md)). The `story-to-vn-adaptation` skill defines how a story adapts into a visual novel: intake mode, scope budget, dramatic cuts/compressions, branching routes, asset requirements, and a script with inner monologue and stage direction.

Adapting an entire novel at once exceeds context budgets and loses dramatic control. Furthermore, turning prose into a visual novel requires dramatic compression, dialog/monologue division, and choice design that cannot be done with mechanical heuristics; it requires a GenAI agent step. Conversely, compiling the resulting script into slides and presenting it in the browser is fully programmatic and should be driven by a structured game loop.

## Decision
1. **Adaptation is granular: one chapter or draft at a time.** Each adaptation takes exactly one markdown file from `chapters/` or `drafts/` as its source. This bounds the word count, asset budget, and LLM context.
2. **Three-state pipeline:**
   - **State 1 — Source:** A prose chapter or draft (`chapters/<file>.md` or `drafts/<file>.md`).
   - **State 2 — Adaptation document (GenAI step):** An agent runs `story-to-vn-adaptation` on the source file to produce `vns/<slug>/adaptation.md` (notes, route map, variables, asset checklist, scene list, and script in neutral bracket notation) and `manifest.json`.
   - **State 3 — Compiled slide deck (Mechanical step):** A deterministic parser in `@nirmata/core` compiles the neutral script into `vns/<slug>/slides.json`.
3. **Output scaffolding on disk:** Adaptations live in the world folder under `vns/<slug>/`:
   ```text
   worlds/<world>/vns/<slug>/
   ├── manifest.json       # Source link, mode, tier, route list, variable definitions, asset checklist
   ├── adaptation.md       # Human-readable adaptation doc + neutral bracket script
   └── slides.json         # Compiled atomic slide states for the game loop
   ```
4. **Compiled slide model:** Each slide in `slides.json` is an atomic presentation beat:
   - `id`, `sceneId`, `route`
   - `stage`: background, transitions, active character sprites (`character`, `expression`, `slot: left|center|right`), active CG, background music, SFX
   - `dialogue`: speaker (`undefined` for narration, `( MC )` for inner monologue, or character name), text (under 60 words)
   - `action`: `continue` (advance on user input), `menu` (choices with route target and variable updates), `jump`, or `end`
5. **Presentation engine (Phaser.js):** The visual novel is presented in the browser using Phaser.js:
   - Canvas-based rendering with layered display: Background -> Character Sprites -> CG Overlay -> Dialogue Box -> Choice Menu.
   - An interactive game loop state machine supporting click/space/tap advance, typewriter text, sound channels, and choice branching.
   - **Placeholder asset fallbacks:** If image files in `assets/` do not yet exist, the player procedurally renders styled placeholders (a gradient card with the scene's name for backgrounds, and a silhouette card with the character name and expression tag for sprites) so the VN is playable immediately upon compilation.
   - Pre-wired hooks for future actions: dialogue backlog/history, save/load state, auto-play, skip-read, and variable inspection.

## Consequences
+ Authors adapt and test their story incrementally without token wastage or loss of control.
+ Clean separation between creative adaptation (GenAI agent) and presentation (deterministic compiler and game loop).
+ Visual novels are playable immediately after adaptation without waiting for finished artwork.
+ Plain files and diffable markdown remain the source of truth, matching Nirmata's local-first principles.
- Multi-chapter storylines require passing variable state across chapter boundaries.
- Phaser.js adds a client-side dependency to the web bundle.

## Alternatives considered
- **Mechanical prose-to-script converter:** Rejected; prose description needs transformation into staging cues, and inner monologue needs extraction from narrative thoughts. Heuristics produce unreadable scripts.
- **Whole-book adaptation:** Rejected; exceeds token budgets, produces unmanageable asset lists, and removes the author from the adaptation loop.
- **Ren'Py export as the only presentation:** Ren'Py `.rpy` export is supported by the skill for desktop creators, but relying solely on Ren'Py prevents playing directly inside Nirmata's web interface.
