#!/usr/bin/env python3
"""
Generate Consistent Environmental Backgrounds & Time-of-Day Variations (16:9)
Uses ControlNet Depth to freeze architectural geometry and furniture layout
while resamplng lighting and atmosphere across day, dusk, night, and rainy variants.
"""

import os
import sys
import json
import argparse
import random
from pathlib import Path
from typing import Dict, Any

from comfy_client import ComfyClient

TIME_VARIANT_PROMPTS = {
    "day": "bright natural daylight, clear sky, soft natural ambient lighting, clean reflections",
    "overcast": "pale diffuse overcast sky through window, soft shadowless diffuse lighting, cool neutral tones",
    "dusk": "golden hour sunset glow, warm amber lighting streaming through panoramic window, dramatic long shadows, twilight sky",
    "night": "pitch black night outside window with distant glowing city lights, cool interior fluorescent fixtures, solitary desk lamp glow",
    "rainy": "dark stormy sky, heavy rain droplets streaking down window glass, wet reflections, moody dim ambient lighting"
}


def load_workflow_template() -> Dict[str, Any]:
    workflow_path = Path(__file__).resolve().parent.parent / "workflows" / "background_variants_workflow.api.json"
    with open(workflow_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_background_prompt(
    template: Dict[str, Any],
    location_desc: str,
    time_variant: str = "day",
    custom_lighting: str = "",
    anchor_image: str = "location_master_anchor.png",
    denoise: float = 0.60,
    seed: int = 8192,
    steps: int = 25,
    cfg: float = 7.0
) -> Dict[str, Any]:
    prompt = json.loads(json.dumps(template))  # Deep copy

    time_lighting = custom_lighting or TIME_VARIANT_PROMPTS.get(time_variant, time_variant)
    full_positive = f"masterpiece, best quality, visual novel scenery background, 16:9 widescreen, empty room, {location_desc}, {time_lighting}, detailed architecture, high production art"
    prompt["4"]["inputs"]["text"] = full_positive

    # Anchor image
    prompt["2"]["inputs"]["image"] = anchor_image

    # KSampler params
    prompt["8"]["inputs"]["seed"] = seed
    prompt["8"]["inputs"]["steps"] = steps
    prompt["8"]["inputs"]["cfg"] = cfg
    prompt["8"]["inputs"]["denoise"] = denoise

    return prompt


def generate_background(
    location: str,
    time_variant: str = "day",
    location_prompt: str = "",
    custom_lighting: str = "",
    anchor_image: str = "location_master_anchor.png",
    denoise: float = 0.60,
    output_dir: Path = Path("backgrounds"),
    host: str = "127.0.0.1",
    port: int = 8188,
    steps: int = 25,
    cfg: float = 7.0,
    seed: int = -1,
    dry_run: bool = False
):
    output_dir.mkdir(parents=True, exist_ok=True)
    bg_seed = seed if seed >= 0 else random.randint(1, 2**31 - 1)
    template = load_workflow_template()

    filename = f"{location}_{time_variant}.jpg"
    target_file = output_dir / filename

    print(f"\n========================================================")
    print(f"Generating Background Variant: {filename} (16:9)")
    print(f"Location: {location} | Variant: {time_variant}")
    print(f"Anchor Reference: {anchor_image}")
    print(f"Denoise: {denoise} (Depth Locked)")
    print(f"Target File: {target_file}")
    print(f"========================================================\n")

    workflow = build_background_prompt(
        template=template,
        location_desc=location_prompt,
        time_variant=time_variant,
        custom_lighting=custom_lighting,
        anchor_image=anchor_image,
        denoise=denoise,
        seed=bg_seed,
        steps=steps,
        cfg=cfg
    )

    if dry_run:
        print(f"[DRY-RUN] Target Output: {filename}")
        print(f"          Atmosphere: {TIME_VARIANT_PROMPTS.get(time_variant, custom_lighting)[:60]}...")
        print(f"          Seed: {bg_seed} | Steps: {steps} | Denoise: {denoise}")
        return

    client = ComfyClient(host=host, port=port)
    print(f"--> Queueing background render in ComfyUI (seed={bg_seed})...")
    prompt_id = client.queue_prompt(workflow)
    print(f"    Executing background resample (prompt_id={prompt_id})...")
    client.wait_for_completion(prompt_id)
    saved = client.download_and_save_outputs(prompt_id, output_dir, target_filename=filename)
    print(f"    Saved: {target_file}")


def main():
    parser = argparse.ArgumentParser(description="Generate visual novel background sceneries and time-of-day variants.")
    parser.add_argument("--location", required=True, help="Location identifier (e.g. boardroom, corridor, chamber)")
    parser.add_argument("--time-variant", choices=["day", "overcast", "dusk", "night", "rainy"], default="day", help="Time of day / atmospheric lighting preset")
    parser.add_argument("--prompt", default="", help="Location architectural description")
    parser.add_argument("--lighting", default="", help="Custom lighting tokens override")
    parser.add_argument("--anchor-image", default="location_master_anchor.png", help="Filename of the master anchor image for geometry depth locking")
    parser.add_argument("--denoise", type=float, default=0.60, help="Resampling denoise factor (0.55-0.65 locks geometry, 1.0 generates new)")
    parser.add_argument("--output-dir", default="worlds/_shared/assets/backgrounds", help="Desheroinetion folder for backgrounds")
    parser.add_argument("--host", default="127.0.0.1", help="ComfyUI host address")
    parser.add_argument("--port", type=int, default=8188, help="ComfyUI port")
    parser.add_argument("--steps", type=int, default=25, help="Sampling steps")
    parser.add_argument("--cfg", type=float, default=7.0, help="CFG scale")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for randomized)")
    parser.add_argument("--dry-run", action="store_true", help="Print plans without connecting to ComfyUI")

    args = parser.parse_args()

    generate_background(
        location=args.location,
        time_variant=args.time_variant,
        location_prompt=args.prompt,
        custom_lighting=args.lighting,
        anchor_image=args.anchor_image,
        denoise=args.denoise,
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
