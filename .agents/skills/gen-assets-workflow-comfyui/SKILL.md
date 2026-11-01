---
name: "gen-assets-workflow-comfyui"
description: "Generate tailored ComfyUI workflows (sprites with alpha transparency, 16:9 narrative Event CGs, and environmental backgrounds) for a visual novel adaptation into worlds/<slug>/assets/workflow/."
---

# Generate Assets Workflow (ComfyUI)

Prepare and scaffold customized ComfyUI workflows for visual novel assets (character sprites, event CG scenes, and environmental backgrounds) following a story or chapter visual novel adaptation (`story-to-vn-adaptation`).

## Role in the Pipeline
```
[Story / Chapter] 
      │
      ▼
story-to-vn-adaptation  ───▶  manifest.json & adaptation.md (Asset Budget)
      │
      ▼
gen-assets-workflow-comfyui ──▶  worlds/<world-slug>/assets/workflow/
                                 ├── sprite.json (and .api.json)
                                 ├── cg.json (and .api.json)
                                 └── background.json (and .api.json)
      │
      ▼
Nirmata Web (/vn) ────────▶  User reviews, adjusts Danbooru attention weights,
                             and executes via ComfyUI API (:8188)
```

## Principles & Boundaries
1. **GenAI Responsibility:** Constructing, tuning, and parameterizing the ComfyUI workflow JSON graphs is strictly the responsibility of GenAI via this skill. The Nirmata web app and server are execution and feedback review harnesses; they do not construct diffusion node graphs from scratch.
2. **Storage Location:** All customized workflows for a specific world are written to:
   `worlds/<world-slug>/assets/workflow/`
3. **Content Neutrality (ADR-0005):** `worlds/**/assets/workflow/` is excluded by `.gitignore`. Do not commit story-specific workflow payloads or private lore to git.
4. **Base Templates:** If no customized workflow exists in a world's `assets/workflow/`, the system falls back to default templates in `tools/comfyui/templates/`.

---

## Workflow Types to Prepare

### 1. Sprites (`sprite.json` / `sprite.api.json`)
* **Purpose:** Character portraits across expressions, costumes, and physical states.
* **Canvas:** $512 \times 768$ (vertical portrait aspect).
* **Alpha Transparency:** Incorporate background removal (`LayerMask: RemBg` or BRIA RMBG node) to output RGBA PNGs.
* **Subject Modes:**
  * **Humanoid:** Standard anime face, natural body contours.
  * **Non-Humanoid / Stylized:** Non-standard character anatomy or stylized biology. Dynamically extract explicit anatomical tags from world character cards and use negative tokens to suppress standard trope collapse.
* **Hardware:** Wire `TorchCompileDiffusionOpenVINO` (device: `GPU`) for Intel Iris Xe acceleration without host memory thrashing.

### 2. Event CG Scenes (`cg.json` / `cg.api.json`)
* **Purpose:** Key emotional or dramatic narrative beats (climaxes, turning points, intimate encounters).
* **Canvas:** 16:9 widescreen ($960 \times 540$ or $1024 \times 576$).
* **Composition:** Cinematic lighting, deep atmospheric depth, multi-subject or focal action framing.
* **Regional Conditioning:** For scenes with multiple characters or contrasting focal elements, split the canvas into distinct latent regions (`ConditioningSetArea`) or use sequential inpainting to prevent concept bleeding.

### 3. Environmental Backgrounds (`background.json` / `background.api.json`)
* **Purpose:** Locations, interiors, and landscapes where visual novel scenes take place.
* **Canvas:** 16:9 widescreen ($960 \times 540$ or $1024 \times 576$).
* **Exclusions:** Enforce strict negative tokens (`1girl, 1boy, human, person, crowd`) to guarantee clean, unpopulated scenery.
* **Lighting & Atmosphere:** Support prompt swapping for times of day (day, overcast, dusk, night, rainy).
* **Geometry Preservation:** For repeated visits to the same location, use ControlNet Depth with a 0.50–0.60 denoise lock to preserve architectural line consistency across lighting changes.

---

## Execution Checklist

1. **Read the Asset Manifest:**
   Inspect `worlds/<world-slug>/vns/<vn-slug>/manifest.json` and `adaptation.md` to identify the required cast sprites, key event CGs, and location backgrounds.
2. **Select Base Templates:**
   Start from `tools/comfyui/templates/{sprite,cg,background}.template.api.json`.
3. **Customize Prompts & Tags:**
   Synthesize Danbooru-compatible positive and negative tags based on the world's lore cards, character physical traits, and setting atmosphere.
4. **Write Workflows to Disk:**
   Ensure directory `worlds/<world-slug>/assets/workflow/` exists and output:
   * `sprite.json` (and `sprite.api.json`)
   * `cg.json` (and `cg.api.json`)
   * `background.json` (and `background.api.json`)
5. **Notify User:**
   Direct the user to the `/vn` route in Nirmata Web to inspect the assets, review the Danbooru tag badges, and trigger test generations.
