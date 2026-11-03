# ADR-0031: Reference images in generation

- Status: Accepted
- Date: 2026-11-03
- Related: [ADR-0025](0025-comfyui-vn-asset-studio-and-reinforcement-loop.md), [ADR-0028](0028-asset-files-served-by-backend-from-any-store.md)

## Context
Every expression of a character must look like that character, and a CG must show the characters it is about. The workflows were plain text-to-image, so nothing carried one image's look into the next.

## Decision
- **Sprite from base sprite.** A character's base sprite influences the character's other sprites by image-to-image: the base sprite is the sampler's starting image (denoise about 0.55). It uses built-in ComfyUI nodes only.
- **CG from sprites.** A CG is guided by the sprites of the characters it shows through an IPAdapter identity reference (several images are batched), so the character's look carries over and the sprite's pose does not. It needs the `ComfyUI_IPAdapter_plus` custom node, an SD1.5 IPAdapter model and a CLIP vision model.
- **Which sprite is the base.** A sprite is named `<character>_<expression>`; the base sprite's expression is set per world in `assets/workflow/references.json` (`baseSprite`, default `neutral`; optional `cgSprite`, default the same). The repository holds no story-specific names.
- **Mechanism.** A workflow takes references through a `LoadImage` node whose title contains "Reference". When references are given, the server adds that slot to the workflow the world already uses (its own `sprite.json`/`cg.json`, else the bundled one), so a customised workflow keeps its settings; a world's own `sprite_ref.json`/`cg_ref.json` is used as it is, if present. The server uploads each reference image to ComfyUI's input folder under a name taken from its content and fills the slot. A workflow without a slot refuses the request in plain words; a missing reference sprite stops the job before anything is archived.
- **Suggestions, not automation.** The Studio pre-ticks the suggested sprites (the base sprite for a sprite; for a CG, each character named in its name or prompt) and the author can change them. A background takes none.

## Consequences
+ Expressions keep the character; CGs show the right people; the author stays in control.
+ Existing workflows are unchanged.
- The derived workflows were checked against the node definitions of a running ComfyUI with `ComfyUI_IPAdapter_plus`, `ip-adapter-plus_sd15` and the ViT-H CLIP vision model installed, but not executed end to end. Another version of the IPAdapter node may need its inputs adjusted in a world's own `cg_ref.json`.
- A reference is read from the visual novel's current sprite file, not from the database store.
- References are not yet recorded in the asset's spec.

## Alternatives considered
IPAdapter for sprites too (loses pose and outfit consistency, needs an install); image-to-image for CGs (copies the sprite's pose and framing); picking references automatically with no say for the author.
