# ADR-0025: ComfyUI visual novel asset studio and feedback reinforcement loop

- Status: Accepted
- Date: 2026-11-01
- Related: [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [ADR-0024](0024-comfyui-vn-asset-generation-pipeline.md), [F-59](../features/F-59-vn-adaptation-and-player.md), [F-60](../features/F-60-comfyui-vn-asset-generation.md), [F-61](../features/F-61-comfyui-vn-asset-studio.md)

## Context
Following the implementation of headless ComfyUI CLI tools and visual novel adaptation pipelines (F-59, F-60), authors need an interactive web interface within Nirmata to inspect visual novel asset requirements, trigger image generation via local/remote ComfyUI instances, and iteratively guide the model toward complex anatomical, narrative, and atmospheric targets without needing to hand-code JSON payloads or manipulate node graphs in ComfyUI directly.

Specifically:
1. Diffusion models frequently resist non-standard anatomy (e.g. multi-teat udder structures, ventral midline genitalia rows, swept-back wing-membranes, digitigrade limbs) or confuse multi-character compositions due to training dataset prior probability and cross-attention spatial smearing.
2. Users need a tight, interactive human-in-the-loop feedback mechanism: tokenizing Danbooru prompt tags into visual badges, adjusting attention weights through a structured three-option questionnaire (`make better`, `keep as is`, `make worse`), and automatically archiving previous attempts into feedback datasets.
3. Separation of concerns must be preserved: the Nirmata web/server application is an executor and review harness; GenAI (via the dedicated skill `gen-assets-workflow-comfyui`) is responsible for compiling and parameterizing the ComfyUI workflow graphs during VN adaptation.

## Decision

1. **Routing and Page Architecture:**
   - The dedicated Visual Novel Asset Studio is served at `/vn`.
   - Direct deep-linking is supported:
     - `/vn`: Overview of all visual novels and asset budgets.
     - `/vn/:world/:slug`: Selected visual novel asset dashboard.
     - `/vn/:world/:slug/:type/:name`: Specific asset inspector and feedback loop (`:type` in `[sprite, cg, bg]`).
   - The `/worlds` workspace remains untouched and will be refactored as a separate, lower-priority deliverable.

2. **Template-Driven Automation:**
   - Standard workflow templates for `sprite`, `cg`, and `bg` are maintained in `tools/comfyui/templates/`.
   - Per-world customized workflows are stored in `worlds/<slug>/assets/workflow/` and take precedence if present.
   - The Nirmata web studio displays template parameters, accepts user prompt and parameter inputs, injects updated attention weights into the workflow payload, and submits it to ComfyUI's REST API (`/prompt`, `/history`, `/view`).

3. **Danbooru Tag Badges & Attention Adjustment Questionnaire:**
   - Positive prompt text is parsed into clickable Danbooru tag badges.
   - Selecting badges populates an Attention Adjustment Questionnaire.
   - Each selected keyword offers three reinforcement options:
     - `make better`: Increases token attention weight by $+0.1$ or $+0.2$ (e.g. `1.0 -> 1.2 -> 1.4` or wraps with additional emphasis parentheses `((...))`).
     - `keep as is`: Preserves current attention weight.
     - `make worse`: Decreases token attention weight by $-0.1$ or $-0.2$ (or moves the term to the negative prompt if reduced below $1.0$).

4. **Archival & Feedback Datasets (ADR-0005 Content Neutrality):**
   - Prior to triggering a new generation, the existing asset image, prompt string, workflow parameters, and user feedback choices are archived into:
     `worlds/<slug>/assets/dataset/<vn>/<asset_id>/<timestamp>/`
   - Both `worlds/**/assets/workflow/` and `worlds/**/assets/dataset/` are excluded by `.gitignore` to protect private story lore and prevent repository bloat.

5. **GenAI Skill Separation:**
   - GenAI follows VN adaptation (`story-to-vn-adaptation`) with `gen-assets-workflow-comfyui` to generate tailored workflows in `worlds/<slug>/assets/workflow/`.

## Consequences
- Authors can iteratively refine and reinforce complex character and scene assets directly in their browser.
- Past generation history and human feedback choices are systematically preserved for dataset curation or LoRA fine-tuning without polluting the git tree.
- Core VN engine/player presentation remains completely decoupled and unaffected.
