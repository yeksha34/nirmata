# F-61: ComfyUI visual novel asset studio and feedback reinforcement

| | |
|---|---|
| State | Verified |
| Priority | Must |
| Owner | agent |
| Branch | `feat/F-61-comfyui-vn-asset-studio` |
| Target tag | `v0.2.0-comfyui-pipeline` |

## Value
Provides visual novel authors with an interactive web studio in Nirmata at `/vn` to manage, inspect, and generate visual novel assets (sprites, CG scenes, and backgrounds) via ComfyUI. Authors can tokenize prompts into Danbooru badges, tune attention weights through a three-way feedback questionnaire (`make better`, `keep as is`, `make worse`), and automatically archive prior iterations into feedback datasets.

## Acceptance criteria
- [x] Dedicated `/vn` page lists all visual novels across worlds with asset completion status.
- [x] Direct deep-linking routes:
  - `/vn`: Overview list of all visual novels.
  - `/vn/:world/:slug`: Selected visual novel asset dashboard.
  - `/vn/:world/:slug/:type/:name`: Specific asset inspector & feedback form (`:type` in `[sprite, cg, bg]`).
- [x] Workflow templates for `sprite`, `cg`, and `bg` are stored in `tools/comfyui/templates/` with per-world customization in `worlds/<slug>/assets/workflow/`.
- [x] Asset inspector displays the current asset image, prompt inputs, and tokenizes positive prompt tags into interactive Danbooru badges.
- [x] Selecting badges populates an Attention Adjustment Questionnaire with 3-way options (`make better`, `keep as is`, `make worse`) that dynamically recalculate token attention weights.
- [x] "Trigger Generation with Feedback" automatically archives existing asset, prompt, workflow state, and user feedback into `worlds/<slug>/assets/dataset/<vn>/<asset_id>/<timestamp>/` before executing generation.
- [x] ComfyUI execution runs via backend REST API, polls for completion, saves the output image directly to the VN's asset folder, and updates the UI live.
- [x] GenAI skill `gen-assets-workflow-comfyui` scaffolds customized workflows following VN adaptation into `worlds/<slug>/assets/workflow/`.
- [x] `worlds/**/assets/workflow/` and `worlds/**/assets/dataset/` are excluded via `.gitignore`.
- [x] Core visual novel presentation/player scaffolding remains unchanged.

## Non-goals
- Re-architecting or altering the `/worlds` workspace screen in this deliverable (deferred).
- Re-implementing a node-canvas editor inside Nirmata (ComfyUI native GUI is used for graph editing).
- Committing private story lore or generated dataset images to the git repository.

## Design
See [ADR-0025](../decisions/0025-comfyui-vn-asset-studio-and-reinforcement-loop.md).

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-01 | Created feature specification | Specified & Building |
| 2026-11-01 | Full test suite: 544 tests across 44 test files in vitest (server, web, core, host) + TypeScript typechecks (tsc -b, tsc -p apps/web) + dom/markup rules + world-lint | Verified (100% green) |

## History
| Date | Change |
|---|---|
| 2026-11-01 | Created feature specification and linked ADR-0025 |
| 2026-11-01 | Verified full implementation: templates, skill, backend bridge, web studio, tag badges & questionnaire |
