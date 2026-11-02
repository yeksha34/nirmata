---
name: "gen-assets-workflow-comfyui"
description: "Generate tailored ComfyUI workflows (sprites with alpha transparency, 16:9 narrative Event CGs, and environmental backgrounds) for a visual novel adaptation into worlds/<slug>/assets/workflow/."
---

# Generate Assets Workflow (ComfyUI)

Prepare and scaffold customized ComfyUI workflows for visual novel assets (character sprites, event CG scenes, and environmental backgrounds) following a story or chapter visual novel adaptation (`story-to-vn-adaptation`).

## Role in the Pipeline
```text
[Story / Chapter] 
      │
      ▼
story-to-vn-adaptation  ───▶  manifest.json & adaptation.md (Asset Budget)
      │
      ▼
gen-assets-workflow-comfyui ──▶  worlds/<world-slug>/assets/workflow/
                                 ├── sprite.api.json (and sprite.json)
                                 ├── cg.api.json (and cg.json)
                                 ├── bg.api.json & background.api.json (and .json)
                                 └── prompts.json
      │
      ▼
Nirmata Web (/vn) ────────▶  User reviews, adjusts Danbooru attention weights,
                             and executes via ComfyUI API (:8188)
```

## Quick Start (Driver CLI)

The skill includes an automated driver script to scaffold and verify workflow templates:

```bash
# 1. Scaffold all workflow templates and prompts catalog for a world
node .agents/skills/gen-assets-workflow-comfyui/driver.mjs scaffold <world-slug> [vn-slug]

# 2. Verify all workflow files and ComfyUI node graphs are valid
node .agents/skills/gen-assets-workflow-comfyui/driver.mjs check <world-slug>

# 3. List status across all worlds
node .agents/skills/gen-assets-workflow-comfyui/driver.mjs list
```

---

## Principles & Boundaries

1. **Adaptation Ownership:** Workflows belong to the world and adaptation. The server (`apps/server`) and web client (`apps/web`) are execution harnesses; they do not synthesize diffusion graphs from scratch. The world's `assets/workflow/` directory must contain the prepared templates before generation can proceed.
2. **Storage Location:** All customized workflows for a specific world are written to:
   `worlds/<world-slug>/assets/workflow/`
3. **Content Neutrality (ADR-0005):** `worlds/**/assets/workflow/` is excluded by `.gitignore`. Do not commit story-specific workflow payloads or private lore to git.
4. **Canonical Template Names:** The server generation endpoint queries by asset type (`"sprite"`, `"cg"`, `"bg"`). The following files must be present:
   - Sprites: `sprite.api.json` (and `sprite.json`)
   - Event CGs: `cg.api.json` (and `cg.json`)
   - Backgrounds: `bg.api.json` and `background.api.json` (and `.json`)

---

## Workflow Types to Prepare

### 1. Sprites (`sprite.api.json` / `sprite.json`)
* **Purpose:** Character portraits across expressions, costumes, and physical states.
* **Canvas:** $512 \times 768$ (vertical portrait aspect).
* **Alpha Transparency:** Incorporate background removal (`LayerMask: RemBg` or BRIA RMBG node) or clean cutout to output RGBA PNGs.
* **Subject Modes:**
  * **Humanoid:** Standard anime face, natural body contours.
  * **Non-Humanoid / Stylized:** Non-standard character anatomy or stylized biology. Dynamically extract explicit anatomical tags from world character cards and use negative tokens to suppress standard trope collapse.
* **Hardware:** Wire `TorchCompileDiffusionOpenVINO` (device: `GPU`) for Intel Iris Xe acceleration without host memory thrashing.

### 2. Event CG Scenes (`cg.api.json` / `cg.json`)
* **Purpose:** Key emotional or dramatic narrative beats (climaxes, turning points, intimate encounters).
* **Canvas:** 16:9 widescreen ($960 \times 540$ or $1024 \times 576$).
* **Composition:** Cinematic lighting, deep atmospheric depth, multi-subject or focal action framing.
* **Regional Conditioning:** For scenes with multiple characters or contrasting focal elements, split the canvas into distinct latent regions (`ConditioningSetArea`) or use sequential inpainting to prevent concept bleeding.

### 3. Environmental Backgrounds (`bg.api.json`, `background.api.json` / `.json`)
* **Purpose:** Locations, interiors, and landscapes where visual novel scenes take place.
* **Canvas:** 16:9 widescreen ($960 \times 540$ or $1024 \times 576$).
* **Exclusions:** Enforce strict negative tokens (`1girl, 1boy, human, person, crowd`) to guarantee clean, unpopulated scenery.
* **Lighting & Atmosphere:** Support prompt swapping for times of day (day, overcast, dusk, night, rainy).
* **Geometry Preservation:** For repeated visits to the same location, use ControlNet Depth with a 0.50–0.60 denoise lock to preserve architectural line consistency across lighting changes.

---

## Execution Checklist

1. **Scaffold Templates via Driver:**
   Run:
   ```bash
   node .agents/skills/gen-assets-workflow-comfyui/driver.mjs scaffold <world-slug> [vn-slug]
   ```
2. **Inspect & Customize Node Graphs:**
   Review `worlds/<world-slug>/assets/workflow/`:
   * `sprite.api.json` (and `sprite.json`)
   * `cg.api.json` (and `cg.json`)
   * `bg.api.json` & `background.api.json` (and `.json`)
   Ensure checkpoints (`AOM3A1B_orangemixs.safetensors`, `ponyDiffusionV6XL_fp16.safetensors`, etc.) match available hardware.
3. **Verify Compliance:**
   Run:
   ```bash
   node .agents/skills/gen-assets-workflow-comfyui/driver.mjs check <world-slug>
   ```
   Confirm all checks pass before directing the user to `/vn` or calling the generation API.
4. **Notify User:**
   Direct the user to the `/vn` route in Nirmata Web to inspect the assets, review the Danbooru tag badges, and trigger test generations.
