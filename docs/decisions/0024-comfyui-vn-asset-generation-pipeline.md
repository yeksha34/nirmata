# ADR-0024: ComfyUI visual novel asset generation pipeline

- Status: Accepted
- Date: 2026-10-31
- Related: [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [ADR-0022](0022-vn-dynamic-asset-loading-and-artstyle-fallback.md), [ADR-0023](0023-vn-character-state-and-costume-sprite-resolution.md), [F-59](../features/F-59-vn-adaptation-and-player.md), [F-60](../features/F-60-comfyui-vn-asset-generation.md)

## Context
Interactive Visual Novel adaptations in Nirmata (`worlds/<world>/vns/<slug>/`) require three visual asset modalities:
1. **Character Sprite Portraits:** Full-body or 3/4 standing sprites across multiple emotional expressions and costume states (`<character>_<state>_<expression>.png`), requiring true alpha transparency to overlay cleanly onto stage slots (`left`, `center`, `right`).
2. **Event CGs:** 16:9 widescreen narrative illustrations depicting pivotal turning points, intimate encounters, or climaxes, often involving multiple interacting characters whose visual appearance must match their standalone sprites.
3. **Environmental Backgrounds:** 16:9 sceneries devoid of stray characters, requiring strict architectural and perspective consistency across time-of-day and weather variations (day, dusk, night, rainy).

Furthermore, stories hosted in adult, dark fantasy, or esoteric worlds often depict non-human, monstrous, visceral, or unusual entities alongside humans. Standard AI generation pipelines fail in four critical areas when encountering such imagery:
- **FaceDetailers** fail or distort when attempting to detect non-human faces or amorphous masses with human-centric bounding boxes (`face_yolov8m`).
- **OpenPose** skeletons cannot model tails, multiple limbs, quadrupedal anatomy, tentacles, or fluid masses.
- **InsightFace / FaceID** crashes or distorts on non-human facial topologies.
- Standard consumer hardware (such as laptops with Intel Iris Xe graphics and ~8 GB shared memory) cannot execute full fp16 SDXL models locally without optimization, requiring lightweight inference paths (4–8 step Lightning/Turbo checkpoints, GGUF/FP8 quantization) and first-class remote server offloading.

## Decision

1. **Modular ComfyUI Workflow Architecture:**
   - Workflows are defined in two formats: interactive visual graphs (`.json`) for drag-and-drop tuning in the ComfyUI web canvas, and API prompt graphs (`.api.json`) for programmatic automation.
   - **Sprite Workflow (`sprite_portrait_workflow.json`):**
     - Base SDXL checkpoint with IP-Adapter Plus (reference portrait anchor).
     - Two-stage expression rendering: base sampler locks pose and costume; `FaceDetailer` inpaints targeted expressions without redrawing wardrobe.
     - Native ComfyUI 4-channel RGBA generation via `BiRefNet` or `LayerDiffuse`, saving directly as transparent PNGs.
   - **Event CG Workflow (`cg_narrative_workflow.json`):**
     - 16:9 widescreen layout with Regional Conditioning (`ConditioningSetArea`) separating interacting characters into discrete spatial regions to eliminate prompt/costume bleeding.
     - Dual-head `FaceDetailer` with per-character IP-Adapter anchors to preserve facial identity across wide narrative shots.
   - **Background Workflow (`background_variants_workflow.json`):**
     - Strict human-exclusion negative conditioning.
     - Geometry locking via ControlNet Depth (ZoeDepth / MiDaS) and LineArt/Canny keyed to a master location anchor render, allowing prompt-swapped time-of-day variations (overcast day, sunset dusk, night, rainy) with zero architectural drift.

2. **Adaptive Mode for Monstrous / Visceral / Non-Human Subjects:**
   - Rather than maintaining disconnected workflow graphs, the pipeline incorporates an adaptive toggle:
     - **Humanoid Mode:** Engages OpenPose, FaceID, and `FaceDetailer` expression inpainting.
     - **Creature / Visceral Mode:** Bypasses human face detectors, routes pose/silhouette guidance through ControlNet Depth/SoftEdge (which handles arbitrary organic/visceral shapes), switches IP-Adapter to ClipVision image embedding (encoding textures, skin, slime, and horror palettes), and uses `BiRefNet-general` for multi-limb alpha cutouts.
     - **Hybrid Mode (Event CGs):** Regional conditioning applies Humanoid FaceDetailer to human characters while allowing creature regions full organic freedom without face distortion.

3. **Headless CLI & Automation Tooling (`tools/comfyui/`):**
   - Provide a Python client (`comfy_client.py`) that communicates with ComfyUI via HTTP POST (`/prompt`) and WebSocket (`/ws`) for execution monitoring.
   - High-level CLI commands: `generate_sprites.py`, `generate_cgs.py`, `generate_backgrounds.py`, and `sync_adaptation_assets.py`.
   - `sync_adaptation_assets.py` inspects a visual novel's `manifest.json` and `adaptation.md`, detects missing assets, generates them, and places them directly into `worlds/<world>/vns/_shared/assets/` following Nirmata's hierarchical naming conventions ([ADR-0023](0023-vn-character-state-and-costume-sprite-resolution.md)).

4. **Hardware Adaptation (Low-VRAM & Remote Support):**
   - For Intel Iris Xe / integrated GPUs (shared memory): recommend SDXL Lightning/Turbo checkpoints (4–8 steps), FP8 quantization, and `--lowvram` ComfyUI launch flags.
   - Native `--host` / `--port` and `COMFYUI_HOST` environment variable support across all CLI tools to offload compute-heavy generation to remote GPU servers (RunPod, local LAN desktop, Colab) while keeping asset management local.

## Consequences
+ **Complete Visual Novel Art Autonomy:** Sprites, CGs, and backgrounds can be generated and managed without manual image editing tools.
+ **Style & Identity Integrity:** IP-Adapter anchors and FaceDetailer passes prevent character drift across dozens of VN scenes.
+ **Unrestricted Narrative Range:** Supports both everyday character interactions and extreme, dark fantasy, or visceral monster lore seamlessly.
+ **Hardware Flexibility:** Operates within shared-memory integrated GPU constraints locally or scales to high-end cloud GPU instances via remote execution.
+ **Zero Engine Regressions:** Generated assets conform directly to existing Phaser dynamic loader conventions and content-neutral world structures.
