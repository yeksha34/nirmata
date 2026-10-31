#!/usr/bin/env python3
"""
Generate Consistent Narrative Event CGs (16:9)
Generates cinematic visual novel illustrations using regional conditioning
to prevent character appearance bleeding.
"""

import os
import sys
import json
import argparse
import random
from pathlib import Path
from typing import Dict, Any

from comfy_client import ComfyClient


def load_workflow_template() -> Dict[str, Any]:
    workflow_path = Path(__file__).resolve().parent.parent / "workflows" / "cg_narrative_workflow.api.json"
    with open(workflow_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_cg_prompt(
    template: Dict[str, Any],
    global_prompt: str,
    char_a_prompt: str,
    char_b_prompt: str,
    staging_image: str = "cg_staging_pose.png",
    seed: int = 4096,
    steps: int = 28,
    cfg: float = 6.5
) -> Dict[str, Any]:
    prompt = json.loads(json.dumps(template))  # Deep copy

    # Global environment prompt
    full_global = f"masterpiece, best quality, visual novel narrative event CG, 16:9 widescreen, cinematic lighting, {global_prompt}"
    prompt["2"]["inputs"]["text"] = full_global

    # Regional prompts
    prompt["4"]["inputs"]["text"] = char_a_prompt
    prompt["6"]["inputs"]["text"] = char_b_prompt

    # Staging guide
    prompt["11"]["inputs"]["image"] = staging_image

    # KSampler params
    prompt["14"]["inputs"]["seed"] = seed
    prompt["14"]["inputs"]["steps"] = steps
    prompt["14"]["inputs"]["cfg"] = cfg

    return prompt


def generate_cg(
    cg_name: str,
    global_prompt: str,
    char_a_prompt: str,
    char_b_prompt: str,
    staging_image: str = "cg_staging_pose.png",
    output_dir: Path = Path("cgs"),
    host: str = "127.0.0.1",
    port: int = 8188,
    steps: int = 28,
    cfg: float = 6.5,
    seed: int = -1,
    dry_run: bool = False
):
    output_dir.mkdir(parents=True, exist_ok=True)
    cg_seed = seed if seed >= 0 else random.randint(1, 2**31 - 1)
    template = load_workflow_template()

    filename = f"{cg_name}.jpg" if not cg_name.endswith(".jpg") else cg_name
    target_file = output_dir / filename

    print(f"\n========================================================")
    print(f"Generating Event CG: {cg_name} (16:9)")
    print(f"Region A (Left): {char_a_prompt[:50]}...")
    print(f"Region B (Right): {char_b_prompt[:50]}...")
    print(f"Target File: {target_file}")
    print(f"========================================================\n")

    workflow = build_cg_prompt(
        template=template,
        global_prompt=global_prompt,
        char_a_prompt=char_a_prompt,
        char_b_prompt=char_b_prompt,
        staging_image=staging_image,
        seed=cg_seed,
        steps=steps,
        cfg=cfg
    )

    if dry_run:
        print(f"[DRY-RUN] Target Output: {filename}")
        print(f"          Global: {global_prompt[:60]}...")
        print(f"          Seed: {cg_seed} | Steps: {steps} | CFG: {cfg}")
        return

    client = ComfyClient(host=host, port=port)
    print(f"--> Submitting prompt to ComfyUI (seed={cg_seed})...")
    prompt_id = client.queue_prompt(workflow)
    print(f"    Executing narrative CG render (prompt_id={prompt_id})...")
    client.wait_for_completion(prompt_id)
    saved = client.download_and_save_outputs(prompt_id, output_dir, target_filename=filename)
    print(f"    Saved: {target_file}")


def main():
    parser = argparse.ArgumentParser(description="Generate visual novel narrative event CGs using ComfyUI.")
    parser.add_argument("--cg-name", required=True, help="CG identifier (e.g. cg_confrontation, cg_climax)")
    parser.add_argument("--global-prompt", required=True, help="Environmental setting, lighting, and mood prompt")
    parser.add_argument("--char-a-prompt", required=True, help="Prompt tokens for Character A (left region)")
    parser.add_argument("--char-b-prompt", required=True, help="Prompt tokens for Character B or Creature (right region)")
    parser.add_argument("--staging-image", default="cg_staging_pose.png", help="Composition pose guide image")
    parser.add_argument("--output-dir", default="worlds/_shared/assets/cgs", help="Desheroinetion folder for CGs")
    parser.add_argument("--host", default="127.0.0.1", help="ComfyUI host address")
    parser.add_argument("--port", type=int, default=8188, help="ComfyUI port")
    parser.add_argument("--steps", type=int, default=28, help="Sampling steps")
    parser.add_argument("--cfg", type=float, default=6.5, help="CFG scale")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for randomized)")
    parser.add_argument("--dry-run", action="store_true", help="Print plans without connecting to ComfyUI")

    args = parser.parse_args()

    generate_cg(
        cg_name=args.cg_name,
        global_prompt=args.global_prompt,
        char_a_prompt=args.char_a_prompt,
        char_b_prompt=args.char_b_prompt,
        staging_image=args.staging_image,
        output_dir=Path(args.output_dir),
        host=args.host,
        port=args.port,
        steps=args.steps,
        cfg=args.cfg,
        seed=args.seed,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
