# ADR-0038: Chapter- and VN-scoped cards and scene state matrix

- Status: Proposed
- Date: 2026-11-04
- Related: [ADR-0005](0005-scaffold-content-neutral.md), [ADR-0017](0017-xml-markdown-cards.md), [ADR-0018](0018-card-parts-and-templates.md), [ADR-0023](0023-vn-character-state-and-costume-sprite-resolution.md), [ADR-0033](0033-clothes-adornments-objects-asset-kinds.md), [ADR-0036](0036-chapters-and-drafts-as-writings.md), [ADR-0037](0037-import-is-done-by-an-agent-one-file-at-a-time.md)

## Context
In long-form stories and episodic visual novel adaptations, characters and assets undergo radical evolutions:
1. Characters adopt different roles, disguises, titles, and physical forms (e.g. baseline mortal hide vs true form vs transformed vessel).
2. Attire changes across scenes and chapters: intact initial garments, damaged/torn states, altered or stripped states, ceremonial uniforms, or unclad base states (`<char>:naked`).
3. Chapter-specific accessories and adornments (chains, bindings, jewelry, regalia) are attached, locked to characters, transferred, or removed.
4. Objects and props are introduced, held, interacted with, or discarded within specific chapters.
5. Settings and locations vary scene by scene within a chapter.

Previously, world cards in `world_lore.cards` and world file trees were stored in a flat namespace per world (`unique(world_id, slug)`). Dumping all temporary chapter variants, damaged wardrobe states, and chapter-specific props into global cards causes:
- Namespace collisions and clutter.
- Inability to track a character's state progression cleanly from scene to scene.
- Overwriting earlier scene canonical states when updating assets for later chapters.

## Decision
1. **Chapter & VN Scoping in Database and File Trees:**
   - In `world_lore.cards`, add nullable scoping columns: `chapter_slug text` and `vn_slug text`.
   - Update card uniqueness to allow scoped overrides alongside global cards: `unique (world_id, coalesce(chapter_slug, ''), coalesce(vn_slug, ''), slug)`.
   - Global cards carry `chapter_slug IS NULL` and `vn_slug IS NULL`.
   - A chapter or visual novel can declare local cards of any kind (`character`, `clothes`/`attire`, `adornment`/`accessories`, `object`, `setting`/`place`).
   - In file systems, scoped cards sit in `chapters/<chapter_slug>/cards/` or `vns/<vn_slug>/cards/`.

2. **Hierarchical Fallback Resolution:**
   - Resolution checks the most specific scope first:
     1. Local chapter/VN scope: `chapters/<chapter>/cards/<kind>/<slug>.md` (or DB row with matching `chapter_slug`/`vn_slug`).
     2. Global world scope: `<kind>/<slug>.md` (or DB row with null `chapter_slug`/`vn_slug`).
   - If a chapter defines an override card for character `elena`, that card specifies her chapter-specific role, appearance, base unclad state, and psychological notes. Other characters without overrides fall back to their global card seamlessly.

3. **Scene-to-Card State Tracking Matrix (`world_lore.scene_card_states`):**
   - Relational mapping connecting every scene in a chapter or visual novel to its active cards and asset states:
     - `world_id`, `chapter_slug` / `vn_slug`, `scene_id`, `card_id`.
     - `character_state`: e.g. `base`, `naked`, `disguised`, `transformed`.
     - `clothing_state`: e.g. `intact`, `torn`, `altered`, `discarded`, `none`.
     - `role`: interaction/stage direction note for that scene.
   - Unique per `(world_id, coalesce(chapter_slug, ''), coalesce(vn_slug, ''), scene_id, card_id)`.
   - In text files, scenes in `scenes.md` record these mappings via inline card tags:
     `[cards: <char>:<state>(<clothing_state>), <accessory>, <object> | bg: <setting>]`.

4. **Web UI Routing and Breadcrumbs:**
   - The web interface (`apps/web`) adopts a hierarchical breadcrumb navigation pattern:
     - World chapters: `Worlds > [World] > Chapters > [Chapter] > [Cards | Scenes | Matrix]`
     - Visual novels: `Visual Novels > [World] > [VN] > [Overview | Slides | Assets | Matrix]`
   - Deep URLs map directly to chapters, cards, and scene matrices (`/worlds/:world/chapters/:chapter/matrix`, `/vn/:world/:slug/matrix`).

5. **Tooling and Corpus Validation:**
   - `world-lint` verifies chapter-scoped card references and validates that scene matrix links resolve to valid character, attire, accessory, object, and setting cards without broken references or false orphan warnings.

## Consequences
+ **Clean Layering:** Global cards remain focused on immutable, world-wide lore; chapter cards record transient, chapter-specific narrative states.
+ **Deterministic Asset Planning:** Visual novel adaptations and ComfyUI asset generation read the scene matrix directly to know exact attire states (intact vs torn vs naked base) needed for every scene beat.
+ **Backwards Compatibility:** Worlds and stories without chapter-scoped cards continue operating identically under the global scope fallback.
