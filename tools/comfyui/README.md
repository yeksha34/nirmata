# ComfyUI Visual Novel Asset Pipeline

Headless CLI automation and ComfyUI workflow definitions for generating consistent visual novel assets (character sprite portraits with alpha transparency, narrative event CGs, and environmental backgrounds) for Nirmata.

---

## 1. Directory Structure

```
tools/comfyui/
├── README.md                          # This setup and reference guide
├── requirements.txt                   # Python dependencies for the CLI runner
├── workflows/                         # ComfyUI workflow graph definitions
│   ├── sprite_portrait_workflow.json         # Drag-and-drop UI graph for character sprites
│   ├── sprite_portrait_workflow.api.json     # Headless API prompt graph for sprites
│   ├── cg_narrative_workflow.json            # Drag-and-drop UI graph for 16:9 Event CGs
│   ├── cg_narrative_workflow.api.json        # Headless API prompt graph for CGs
│   ├── background_variants_workflow.json     # Drag-and-drop UI graph for backgrounds
│   └── background_variants_workflow.api.json # Headless API prompt graph for backgrounds
├── scripts/                           # Headless automation CLI scripts
│   ├── comfy_client.py                # HTTP + WebSocket bridge to ComfyUI
│   ├── generate_sprites.py            # CLI for multi-expression/state character sprites
│   ├── generate_cgs.py                # CLI for 16:9 Event CGs with regional conditioning
│   ├── generate_backgrounds.py        # CLI for time-of-day background variations
│   └── sync_adaptation_assets.py      # Scans VN manifest/adaptation to generate missing assets
└── tests/
    └── test_workflows.py              # Automated validation of workflow schemas and CLI logic
```

---

## 2. Prerequisites & Recommended Models

### A. Base Diffusion Checkpoints
Recommended standard for visual novel line art and high fidelity:
- **Illustrious-XL-v0.1** (`Illustrious-XL-v0.1.safetensors`) or **Pony Diffusion V6 XL** (`ponyDiffusionV6XL_v6StartWithThisOne.safetensors`).
- Place checkpoints in: `ComfyUI/models/checkpoints/`.

### B. Required Custom Nodes
Install via [ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager) or clone directly into `ComfyUI/custom_nodes/`:
- **ComfyUI_IPAdapter_plus** (`git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus`): Character identity anchor.
- **ComfyUI-Impact-Pack** (`git clone https://github.com/ltdrdata/ComfyUI-Impact-Pack`): Targeted expression inpainting via `FaceDetailer`.
- **ComfyUI-ControlNet-Aux** (`git clone https://github.com/Fannovel16/comfyui_controlnet_aux`): OpenPose, DWPose, ZoeDepth preprocessors.
- **BiRefNet / InSPyReNet** (`git clone https://github.com/ZHO-ZHO-ZHO/ComfyUI-BiRefNet-ZHO`): In-workflow alpha background removal.
- **ComfyUI-Inspire-Pack** (optional for advanced regional conditioning): Multi-character staging.

### C. Supporting Weights & Models
- **IP-Adapter Models:** `ip-adapter-plus-face_sdxl_vit-h.safetensors` in `ComfyUI/models/ipadapter/`.
- **CLIP Vision:** `CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors` in `ComfyUI/models/clip_vision/`.
- **ControlNets:** `controlnet-openpose-sdxl-1.0.safetensors` and `diffusers_xl_depth_midas.safetensors` in `ComfyUI/models/controlnet/`.
- **Upscaler:** `4x-UltraSharp.pth` in `ComfyUI/models/upscale_models/`.

---

## 3. Hardware Optimization & Remote Execution

### Local Profile (Intel Iris Xe / Integrated Graphics / 8 GB Shared RAM)
When running ComfyUI locally on an integrated GPU with shared system RAM:
1. Launch ComfyUI with low-VRAM optimizations:
   ```bash
   python main.py --lowvram --fp8_e4m3fn-unet
   ```
2. Use **SDXL Lightning** (4-step or 8-step) checkpoints to minimize inference latency and avoid paging memory.
3. The in-workflow transparency node (`BiRefNet`) operates via CPU/ONNX fallback to prevent VRAM allocation spikes.

### Remote Execution Profile (Recommended for Heavy Batching)
All CLI tools support remote ComfyUI endpoints. You can host ComfyUI on a dedicated GPU instance (e.g. desktop workstation, RunPod, or local LAN server):
```bash
# Pass server address via flag
python tools/comfyui/scripts/generate_sprites.py --host 192.168.1.50 --port 8188 ...

# Or configure environment variable
export COMFYUI_HOST=192.168.1.50:8188
```

---

## 4. CLI Usage Examples

### A. Character Sprite Generation (`generate_sprites.py`)
Generates 4-channel transparent RGBA PNG sprites following the hierarchical naming pattern `<character>_<state>_<expression>.png`:

```bash
# Standard Humanoid Mode with multiple expressions
python tools/comfyui/scripts/generate_sprites.py \
  --character protagonist \
  --state formal \
  --expressions neutral,smiling,bashful,smug \
  --prompt "young officer in pristine white formal uniform with silver epaulets, dark hair, blue eyes" \
  --ref-image path/to/character_anchor.png \
  --output-dir worlds/my_world/vns/_shared/assets/sprites/

# Adaptive Monster / Non-Human Mode (bypasses FaceDetailer and OpenPose)
python tools/comfyui/scripts/generate_sprites.py \
  --character shadowy_beast \
  --mode monster \
  --prompt "amorphous shadowy creature with glowing crimson eyes and twisting tendrils, dark misty aura" \
  --output-dir worlds/my_world/vns/_shared/assets/sprites/
```

### B. Narrative Event CG Generation (`generate_cgs.py`)
Generates 16:9 widescreen illustrations using regional conditioning:

```bash
python tools/comfyui/scripts/generate_cgs.py \
  --cg-name cg_confrontation \
  --global-prompt "dimly lit stone council chamber, arched stained glass windows, moonlight beams" \
  --char-a-prompt "1man, senior commander in ornate dark plate armor, commanding scowl, left hand on pommel" \
  --char-b-prompt "1girl, rogue scout in hooded leather garb, defiant smirk, arms crossed" \
  --output-dir worlds/my_world/vns/_shared/assets/cgs/
```

### C. Geometry-Locked Background Variations (`generate_backgrounds.py`)
Generates time-of-day and atmospheric lighting variants of a location with locked architectural geometry:

```bash
python tools/comfyui/scripts/generate_backgrounds.py \
  --location council_chamber \
  --time-variant dusk \
  --anchor-image worlds/my_world/vns/_shared/assets/backgrounds/council_chamber_day.jpg \
  --output-dir worlds/my_world/vns/_shared/assets/backgrounds/
```

### D. Sync Adaptation Assets (`sync_adaptation_assets.py`)
Scans a visual novel adaptation (`manifest.json` and `adaptation.md`) and automatically queues any missing sprites, CGs, or backgrounds:

```bash
python tools/comfyui/scripts/sync_adaptation_assets.py \
  --vn-dir worlds/my_world/vns/ch01-awakening \
  --dry-run
```

## Reference images (ADR-0031)

`templates/sprite_ref.template.api.json` and `templates/cg_ref.template.api.json` take reference images. The app uses them when the Studio's "Reference images" list has ticked sprites; a world's own `assets/workflow/sprite_ref.json` or `cg_ref.json` wins over these.

- **`sprite_ref`** starts from the reference (a `LoadImage` titled "Reference Image", encoded and sampled at denoise 0.55). Built-in nodes only.
- **`cg_ref`** sends the model through `IPAdapterUnifiedLoader` and `IPAdapterAdvanced`, fed by the reference image. It needs `ComfyUI_IPAdapter_plus`, an **SD1.5** IPAdapter model (for the `PLUS (high strength)` preset, `ip-adapter-plus_sd15`) in `models/ipadapter/`, and the CLIP vision model `CLIP-ViT-H-14-laion2B-s32B-b79K` in `models/clip_vision/`. The checkpoint in these templates is SD1.5, so the SDXL model named above does not fit it. This variant has not been run against an installed ComfyUI; if the node's inputs differ in your version, adjust `cg_ref.json` in the world's `assets/workflow/`.
- A world says which expression is a character's base sprite in `assets/workflow/references.json`, for example `{"baseSprite": "neutral"}`. Add `"cgSprite"` to use another expression as the character's stand-in in a CG.
- Any workflow can take references: add a `LoadImage` node whose title contains "Reference" and wire it in. The app fills it; several images work when the slot feeds an IPAdapter node.
