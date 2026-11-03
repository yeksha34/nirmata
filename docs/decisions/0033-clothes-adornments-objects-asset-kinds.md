# ADR-0033: Clothes, adornments and objects as visual novel asset kinds

- Status: Proposed
- Date: 2026-11-03
- Related: [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [ADR-0023](0023-vn-character-state-and-costume-sprite-resolution.md), [ADR-0024](0024-comfyui-vn-asset-generation-pipeline.md), [ADR-0031](0031-reference-images-in-generation.md), [F-67](../features/F-67-clothes-adornments-objects.md)

## Context
Adaptation assets were sprites, CGs and backgrounds. Things a character wears or handles that a generic prompt cannot draw once the world customises them had no home. "Wearable" is too narrow: in some worlds characters stay unclothed and bear ornament that frames or shows the body rather than covering it.

## Decision
1. Three new asset kinds, generic for any world: **clothes** (cover a body), **adornment** (dress a body without necessarily covering it: jewellery, body art, grown or attached ornament) and **object** (props).
2. **Locks.** Clothes and adornments are locked to exactly one character; the unclad base state (`naked`, or `<name>_naked`) is the only unlocked one. Objects link to one or more characters and/or CGs, and are assets only when a character interacts with them and the world makes them non-generic; they record `interaction` and `why_custom`.
3. **Cards.** World cards of kind `clothes`, `adornment`, `object` in `worlds/<world>/{clothes,adornments,objects}/`; `world-lint assets` checks owners and links.
4. **Manifest.** Optional `assets.clothes`, `assets.adornments`, `assets.objects` (backward compatible).
5. **Database.** `assets.asset_kinds` gains the three keys; `assets.asset_links` holds the character and CG links; `assets.set_links` enforces the locks; `assets.v_asset_link_issues` lists breaches; `assets.v_asset_list` shows the links.
6. **Rendering.** Isolated-item art (768x768, alpha) from generic templates `clothes`, `adornment`, `object`; it serves as a reference image for the owner's sprite state or the linked CG (ADR-0031). No layer compositor. These kinds have no reference slot of their own.
7. **Prompts are described, not named.** The image model does not know a world's items, so the prompt for a linked asset is composed from its card (`composeLinkedPrompt`: the card's `<prompt>`, then appearance, material, placement, use). A card may name a `<reference>` image in the world; the server feeds it to the render through the reference slot of the CG workflow. World detail lives in cards and the database, never in source.
8. The kind list lives once per package (`VN_ASSET_KINDS` in core, `ASSET_KINDS` in gen) instead of repeated unions.

## Consequences
- Worlds without these kinds are unaffected; `gen-assets-workflow-comfyui check` treats the new templates as optional.
- The server list endpoints return `clothes`, `adornments`, `objects` beside the existing three.
- `lockedTo` / `linkedCgs` come from the manifest; the generation ledger passes them to `assets.set_links` when it creates the asset (a refusal is logged, never stops the generation).
