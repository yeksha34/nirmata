# F-60: ComfyUI visual novel asset generation pipeline

| | |
|---|---|
| State | Verified |
| Priority | Should |
| Owner | agent |
| Branch | `feat/F-60-comfyui-cli-tools` |
| Target tag | `v0.2.0-comfyui-pipeline` |

## Value
Empowers world builders and story adaptors to generate production-quality, consistent visual novel assets (character sprite portraits with alpha transparency, narrative event CGs, and geometry-locked environmental backgrounds) locally or via remote ComfyUI endpoints, supporting both humanoid characters and monstrous/visceral subjects through automated CLI commands.

## Acceptance criteria
- [x] ComfyUI workflow definitions for consistent sprite portraits, event CGs, and environmental backgrounds are packaged in both UI graph and API JSON formats in `tools/comfyui/workflows/`.
- [x] Sprites are generated with native alpha transparency (RGBA 4-channel PNGs) and follow the `<character>_<state>_<expression>.png` naming convention ([ADR-0023](../decisions/0023-vn-character-state-and-costume-sprite-resolution.md)).
- [x] Workflows include an adaptive mode for non-human, monstrous, or visceral subjects that bypasses human face detectors and uses geometry-agnostic ControlNets and ClipVision image embeddings.
- [x] Background workflow supports prompt-swapped time-of-day variations (day, overcast, dusk, night, rainy) with ControlNet Depth locking to preserve architectural geometry.
- [x] Headless Python CLI tools (`tools/comfyui/scripts/`) allow generating sprites, CGs, and backgrounds via command line with support for remote ComfyUI endpoints (`--host`, `--port`, `COMFYUI_HOST`).
- [x] `sync_adaptation_assets.py` parses `manifest.json` and `adaptation.md` to identify missing assets and generate them into `worlds/<world>/vns/_shared/assets/`.
- [x] Unit tests validate the syntax, schema, and node connectivity of all workflow JSON files.

## Non-goals
- Bundling heavy model weights or checkpoint safetensors in the git repository.
- Re-implementing a custom diffusion sampling engine outside ComfyUI.
- Web UI canvas editor for nodes inside Nirmata (users use ComfyUI's native web interface or Nirmata's CLI).

## Design
See [ADR-0024](../decisions/0024-comfyui-vn-asset-generation-pipeline.md) for full architectural design and signal flow diagrams.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-31 | `python tools/comfyui/tests/test_workflows.py` | 6 unit tests passing (JSON schemas, humanoid vs. monster adaptive mode, regional conditioning, depth locking, endpoint resolution). |
| 2026-10-31 | `python tools/comfyui/scripts/generate_sprites.py --dry-run` | Successfully validated prompt synthesis and hierarchical output naming for multiple expressions. |
| 2026-10-31 | `python tools/comfyui/scripts/generate_sprites.py --mode monster --dry-run` | Verified automatic bypass of FaceDetailer and engagement of Depth ControlNet. |
| 2026-10-31 | `python tools/comfyui/scripts/generate_cgs.py --dry-run` | Verified 16:9 widescreen layout and regional conditioning prompt splitting. |
| 2026-10-31 | `python tools/comfyui/scripts/generate_backgrounds.py --dry-run` | Verified time-of-day atmospheric prompt selection with 0.60 denoise geometry lock. |
| 2026-10-31 | `node .agents/skills/world-lint/driver.mjs check worlds/example-world` | Clean: 0 broken links. |

## History
| Date | Change |
|---|---|
| 2026-10-31 | Created feature specification and linked ADR-0024 |
