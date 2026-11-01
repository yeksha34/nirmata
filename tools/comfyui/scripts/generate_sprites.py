#!/usr/bin/env python3
"""
Generate Consistent Character Sprite Portraits
Generates transparent RGBA PNG sprites across multiple expressions and states.
Supports Humanoid Mode (OpenPose + FaceDetailer) and Adaptive Monster/Visceral Mode.
"""

import os
import sys
import json
import re
import argparse
import random
from pathlib import Path
from typing import List, Dict, Any

from comfy_client import ComfyClient

EXPRESSION_PROMPT_MAP = {
    "neutral": "calm composed neutral expression, closed mouth, gentle direct glance",
    "smiling": "gentle friendly smile, soft happy eyes, relaxed warm expression",
    "bashful": "bashful shy expression, blushing rosy cheeks, timid downcast glance, soft hesitant smile",
    "smug": "smug confident smirk, amused raised eyebrow, self-satisfied cunning expression",
    "angry": "angry furrowed brow, fierce scowl, intense glare, tense jaw",
    "shocked": "shocked astonished expression, wide eyes, parted lips, startled gaze",
    "crying": "distressed crying expression, tears streaming down cheeks, trembling lips, sorrowful eyes",
    "mocking": "mocking playful sneer, haughty expression, condescending smirk"
}


def load_workflow_template() -> Dict[str, Any]:
    workflow_path = Path(__file__).resolve().parent.parent / "workflows" / "sprite_portrait_workflow.api.json"
    with open(workflow_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_sprite_prompt(
    template: Dict[str, Any],
    char_prompt: str,
    expression: str,
    mode: str = "humanoid",
    ref_image: str = "reference_character_anchor.png",
    seed: int = 1024,
    steps: int = 25,
    cfg: float = 7.0
) -> Dict[str, Any]:
    prompt = json.loads(json.dumps(template))  # Deep copy

    # Base prompt injection
    full_positive = f"masterpiece, best quality, visual novel character sprite, full body portrait, crisp line art, smooth digital anime illustration, {char_prompt}, {EXPRESSION_PROMPT_MAP.get(expression, expression)}"
    prompt["2"]["inputs"]["text"] = full_positive

    # Seed and sampling settings
    prompt["11"]["inputs"]["seed"] = seed
    prompt["11"]["inputs"]["steps"] = steps
    prompt["11"]["inputs"]["cfg"] = cfg

    # Anchor image
    prompt["5"]["inputs"]["image"] = ref_image

    if mode == "monster":
        # Adaptive Monster / Visceral Mode:
        # 1. Switch ControlNet from OpenPose to Depth
        prompt["8"]["inputs"]["control_net_name"] = "diffusers_xl_depth_midas.safetensors"
        # 2. Bypass FaceDetailer: connect VAE Decode directly to Transparency Node
        prompt["15"]["inputs"]["image"] = ["12", 0]
    else:
        # Humanoid Mode: Configure FaceDetailer for target expression
        expr_text = EXPRESSION_PROMPT_MAP.get(expression, expression)
        prompt["14"]["inputs"]["seed"] = seed + 100
        prompt["14"]["inputs"]["steps"] = max(15, int(steps * 0.8))
        prompt["14"]["inputs"]["denoise"] = 0.45
        # Pass expression prompt to face detailer
        prompt["14"]["inputs"]["positive"] = ["2", 0]

    return prompt


def generate_sprites(
    character: str,
    state: str = "",
    expressions: List[str] = ["neutral"],
    prompt_desc: str = "",
    ref_image: str = "reference_character_anchor.png",
    mode: str = "humanoid",
    output_dir: Path = Path("sprites"),
    host: str = "127.0.0.1",
    port: int = 8188,
    steps: int = 25,
    cfg: float = 7.0,
    seed: int = -1,
    dry_run: bool = False
):
    output_dir.mkdir(parents=True, exist_ok=True)
    base_seed = seed if seed >= 0 else random.randint(1, 2**31 - 1)
    template = load_workflow_template()

    print(f"\n========================================================")
    print(f"Generating Character Sprites: {character}")
    print(f"State: {state or '(default base)'} | Mode: {mode}")
    print(f"Expressions: {', '.join(expressions)}")
    print(f"Target Directory: {output_dir}")
    print(f"========================================================\n")

    client = None if dry_run else ComfyClient(host=host, port=port)

    for idx, expr in enumerate(expressions):
        # Format filename according to ADR-0023
        if state:
            filename = f"{character}_{state}_{expr}.png"
        else:
            filename = f"{character}_{expr}.png"

        target_file = output_dir / filename
        expr_seed = base_seed + (idx * 17)

        workflow = build_sprite_prompt(
            template=template,
            char_prompt=prompt_desc,
            expression=expr,
            mode=mode,
            ref_image=ref_image,
            seed=expr_seed,
            steps=steps,
            cfg=cfg
        )

        if dry_run:
            print(f"[DRY-RUN] Target: {filename}")
            print(f"          Mode: {mode} | Seed: {expr_seed}")
            print(f"          Prompt tokens: {prompt_desc[:60]}... ({expr})")
            continue

        print(f"--> Queueing {filename} (expr={expr}, seed={expr_seed})...")
        prompt_id = client.queue_prompt(workflow)
        print(f"    Waiting for execution (prompt_id={prompt_id})...")
        client.wait_for_completion(prompt_id)
        saved = client.download_and_save_outputs(prompt_id, output_dir, target_filename=filename)
        print(f"    Saved: {target_file}")

    print("\nSprite batch generation complete.")


def load_character_prompt_from_world(world: str, character: str) -> str:
    """
    Dynamically loads character prompt descriptors from /worlds/<slug>/.
    Reads character cards from worlds/<slug>/characters/ or prompt specs.
    """
    world_path = Path(world) if Path(world).exists() else Path("worlds") / world
    if not world_path.exists():
        return ""

    # 1. Check prompt specs in vns/_shared/assets/prompts.json or assets/workflow/prompts.json
    spec_candidates = [
        world_path / "vns" / "_shared" / "assets" / "prompts.json",
        world_path / "assets" / "workflow" / "prompts.json"
    ]
    for cand in spec_candidates:
        if cand.exists():
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        if character.lower() in k.lower():
                            return v.get("positivePrompt", "")
            except Exception:
                pass

    # 2. Check character card in worlds/<slug>/characters/
    char_dir = world_path / "characters"
    if char_dir.exists():
        char_norm = re.sub(r"[^a-zA-Z0-9]", "", character.lower())
        for f in char_dir.glob("*.md"):
            stem_norm = re.sub(r"[^a-zA-Z0-9]", "", f.stem.lower())
            if char_norm in stem_norm:
                try:
                    text = f.read_text(encoding="utf-8")
                    parts = []
                    app_match = re.search(r"<appearance[^>]*>(.*?)</appearance>", text, re.DOTALL | re.IGNORECASE)
                    if app_match:
                        parts.append(app_match.group(1).strip())
                    ward_match = re.search(r"<wardrobe[^>]*>(.*?)</wardrobe>", text, re.DOTALL | re.IGNORECASE)
                    if ward_match:
                        parts.append(ward_match.group(1).strip())
                    body_match = re.search(r"<body[^>]*>(.*?)</body[^>]*>", text, re.DOTALL | re.IGNORECASE)
                    if body_match:
                        parts.append(body_match.group(1).strip())
                    if parts:
                        return ", ".join(parts)
                except Exception:
                    pass
    return ""


def main():
    parser = argparse.ArgumentParser(description="Generate visual novel character sprites using ComfyUI.")
    parser.add_argument("--character", required=True, help="Character identifier (e.g. protagonist, heroine)")
    parser.add_argument("--world", default="", help="World slug or path (e.g. worlds/<slug>) to load character cards and prompts from")
    parser.add_argument("--state", default="", help="Costume/wardrobe state (e.g. clerk, uniform, armor)")
    parser.add_argument("--expressions", default="neutral", help="Comma-separated list of expressions (e.g. neutral,smiling,bashful,smug)")
    parser.add_argument("--prompt", default="", help="Core character description and attire prompt (optional if --world is provided)")
    parser.add_argument("--ref-image", default="reference_character_anchor.png", help="Reference image filename for IP-Adapter")
    parser.add_argument("--mode", choices=["humanoid", "monster"], default="humanoid", help="Adaptive mode: humanoid (FaceDetailer+OpenPose) or monster (Depth+organic)")
    parser.add_argument("--output-dir", default="", help="Desheroinetion folder for transparent PNGs (defaults to worlds/<slug>/assets/sprites if --world given)")
    parser.add_argument("--host", default="127.0.0.1", help="ComfyUI host address")
    parser.add_argument("--port", type=int, default=8188, help="ComfyUI port")
    parser.add_argument("--steps", type=int, default=25, help="Sampling steps (use 4-8 for Lightning models on Intel Iris Xe)")
    parser.add_argument("--cfg", type=float, default=7.0, help="CFG scale")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for randomized)")
    parser.add_argument("--dry-run", action="store_true", help="Print plans without connecting to ComfyUI")

    args = parser.parse_args()
    expr_list = [e.strip() for e in args.expressions.split(",") if e.strip()]

    prompt = args.prompt
    if not prompt and args.world:
        prompt = load_character_prompt_from_world(args.world, args.character)
    if not prompt:
        prompt = f"{args.character}, anime character portrait, detailed attire"

    output_dir = Path(args.output_dir) if args.output_dir else (
        Path(args.world) / "assets" / "sprites" if args.world else Path("worlds/_shared/assets/sprites")
    )

    generate_sprites(
        character=args.character,
        state=args.state,
        expressions=expr_list,
        prompt_desc=prompt,
        ref_image=args.ref_image,
        mode=args.mode,
        output_dir=output_dir,
        host=args.host,
        port=args.port,
        steps=args.steps,
        cfg=args.cfg,
        seed=args.seed,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
