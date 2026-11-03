#!/usr/bin/env python3
"""
Generate Visual Novel Sprites for Entities via ComfyUI
Content-neutral framework script adhering to ADR-0005.
Supports modular generation across:
  1) Objects (handheld/carried discipline tools, vessels, trophies; supports discrete split sets)
  2) Adornments (sacred mekhala, jewelry, somatic modifications, body ornaments)
  3) Clothes (sacred unclad temple form, ceremonial wraps, disguises)
  4) Expressions (sovereign neutral, mocking sneer, casting climax, furious scowl, etc.)
Operates against any target world in Nirmata (e.g., cuntitty, example-world).
"""

import os
import sys
import json
import argparse
import random
from pathlib import Path
from typing import List, Dict, Any, Optional

scripts_dir = Path(__file__).resolve().parent
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))
tools_dir = scripts_dir.parent.parent
if str(tools_dir) not in sys.path:
    sys.path.insert(0, str(tools_dir))

from comfy_client import ComfyClient
from entity_registry import (
    load_entity_registry,
    get_entity,
    list_entity_slugs,
    build_entity_prompt,
    resolve_world_path
)


def load_workflow_template(backend: str = "openvino", model_type: str = "sd15") -> Dict[str, Any]:
    """Loads the appropriate ComfyUI API workflow JSON template."""
    workflows_dir = scripts_dir.parent / "workflows"
    if backend == "openvino":
        path = workflows_dir / "openvino_entity_sprite_sd15.api.json"
    else:
        path = workflows_dir / "entity_sprite_workflow.api.json"

    if not path.exists():
        raise FileNotFoundError(f"Workflow template not found at {path}")

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_entity_workflow_payload(
    entity_slug: str,
    variant_type: str = "base",
    variant_key: str = "neutral",
    object_parts: Optional[List[str]] = None,
    adornment_parts: Optional[List[str]] = None,
    clothe_parts: Optional[List[str]] = None,
    world: str = "cuntitty",
    backend: str = "openvino",
    model_type: str = "sd15",
    seed: int = -1,
    steps: int = 24,
    cfg: float = 7.0,
    width: Optional[int] = None,
    height: Optional[int] = None,
    custom_ckpt: Optional[str] = None
) -> Dict[str, Any]:
    """
    Builds a complete, validated ComfyUI API payload for generating an entity sprite.
    """
    entity = get_entity(entity_slug, world=world)
    if not entity:
        raise ValueError(f"Entity '{entity_slug}' is not recognized in world '{world}' registry.")

    template = load_workflow_template(backend=backend, model_type=model_type)
    payload = json.loads(json.dumps(template))  # Deep copy

    # Generate prompt strings from modular entity registry
    prompt_bundle = build_entity_prompt(
        entity=entity,
        variant_type=variant_type,
        variant_key=variant_key,
        object_parts=object_parts,
        adornment_parts=adornment_parts,
        clothe_parts=clothe_parts,
        model_type=model_type
    )

    positive_text = prompt_bundle["positive"]
    negative_text = prompt_bundle["negative"]

    # Resolution defaults preserving Navatala vertical proportions (w <= h/3 framing)
    if width is None or height is None:
        if backend == "openvino" or model_type == "sd15":
            width, height = 512, 896
        else:
            width, height = 832, 1216

    # Prefix naming for VN sprite asset pipeline
    if variant_type == "expression":
        filename_prefix = f"sprites/{entity_slug}_expr_{variant_key}"
    elif variant_type == "object":
        filename_prefix = f"sprites/{entity_slug}_obj_{variant_key}"
    elif variant_type == "adornment":
        filename_prefix = f"sprites/{entity_slug}_adorn_{variant_key}"
    elif variant_type == "clothe":
        filename_prefix = f"sprites/{entity_slug}_cloth_{variant_key}"
    elif variant_type == "accessory":
        filename_prefix = f"sprites/{entity_slug}_acc_{variant_key}"
    else:
        filename_prefix = f"sprites/{entity_slug}_base"

    actual_seed = seed if seed >= 0 else random.randint(1, 2**31 - 1)

    # Inject into graph nodes based on backend template structure
    if custom_ckpt:
        payload["1"]["inputs"]["ckpt_name"] = custom_ckpt

    # Node "3": Positive CLIPTextEncode
    payload["3"]["inputs"]["text"] = positive_text

    # Node "4": Negative CLIPTextEncode
    payload["4"]["inputs"]["text"] = negative_text

    # Node "5": EmptyLatentImage
    payload["5"]["inputs"]["width"] = width
    payload["5"]["inputs"]["height"] = height

    # Node "6": KSampler
    payload["6"]["inputs"]["seed"] = actual_seed
    payload["6"]["inputs"]["steps"] = steps
    payload["6"]["inputs"]["cfg"] = cfg

    # Node "8": SaveImage
    payload["8"]["inputs"]["filename_prefix"] = filename_prefix

    return payload


def generate_entity_sprites(
    entity_slug: str,
    variant_type: str = "all",
    specific_variant: Optional[str] = None,
    world: str = "cuntitty",
    backend: str = "openvino",
    model_type: str = "sd15",
    output_dir: Optional[Path] = None,
    host: str = "127.0.0.1",
    port: int = 8188,
    seed: int = -1,
    steps: int = 24,
    cfg: float = 7.0,
    width: Optional[int] = None,
    height: Optional[int] = None,
    dry_run: bool = False,
    apply_alpha: bool = True
) -> List[Dict[str, Any]]:
    """
    Executes or plans generation for a specific entity across requested variants.
    """
    entity = get_entity(entity_slug, world=world)
    if not entity:
        raise ValueError(f"Unknown entity '{entity_slug}' in world '{world}'")

    if output_dir is None:
        output_dir = resolve_world_path(world) / "assets" / "sprites"

    tasks = []

    # 1. Base sprite
    if variant_type in ("base", "all"):
        tasks.append(("base", "sacred_unclad"))

    # 2. Expression variants
    if variant_type in ("expression", "all"):
        if specific_variant and variant_type == "expression":
            tasks.append(("expression", specific_variant))
        else:
            for expr_key in entity.get("expressions", {}).keys():
                tasks.append(("expression", expr_key))

    # 3. Object variants
    if variant_type in ("object", "all"):
        if specific_variant and variant_type == "object":
            tasks.append(("object", specific_variant))
        else:
            for obj_key in entity.get("objects", {}).keys():
                tasks.append(("object", obj_key))

    # 4. Adornment variants
    if variant_type in ("adornment", "accessory", "all"):
        if specific_variant and variant_type in ("adornment", "accessory"):
            tasks.append(("adornment", specific_variant))
        else:
            for adorn_key in entity.get("adornments", {}).keys():
                tasks.append(("adornment", adorn_key))

    # 5. Clothe variants
    if variant_type in ("clothe", "all"):
        if specific_variant and variant_type == "clothe":
            tasks.append(("clothe", specific_variant))
        else:
            for cloth_key in entity.get("clothes", {}).keys():
                tasks.append(("clothe", cloth_key))

    results = []
    output_dir.mkdir(parents=True, exist_ok=True)

    client = None if dry_run else ComfyClient(host=host, port=port)

    print(f"\n========================================================")
    print(f"Entity: {entity.get('name', entity_slug)} ({entity.get('hindi_name', '')}) | World: {world}")
    print(f"Kind: {entity.get('kind', 'entity')} | Species: {entity.get('species_category', 'general')}")
    print(f"Variants planned: {len(tasks)} | Backend: {backend} | Dry Run: {dry_run}")
    print(f"========================================================")

    for v_type, v_key in tasks:
        item_seed = seed if seed >= 0 else random.randint(1, 2**31 - 1)
        payload = build_entity_workflow_payload(
            entity_slug=entity_slug,
            variant_type=v_type,
            variant_key=v_key,
            world=world,
            backend=backend,
            model_type=model_type,
            seed=item_seed,
            steps=steps,
            cfg=cfg,
            width=width,
            height=height
        )

        filename_prefix = payload["8"]["inputs"]["filename_prefix"]
        out_filename = f"{Path(filename_prefix).name}.png"
        target_path = output_dir / out_filename

        print(f"  -> [{v_type.upper()}: {v_key}] => {out_filename}")

        if dry_run:
            results.append({
                "entity": entity_slug,
                "variant_type": v_type,
                "variant_key": v_key,
                "target_path": str(target_path),
                "payload": payload,
                "status": "dry_run_ready"
            })
            continue

        # Execute on ComfyUI daemon
        try:
            print(f"     Submitting prompt to ComfyUI ({host}:{port})...")
            prompt_id = client.queue_prompt(payload)
            print(f"     Prompt ID: {prompt_id}. Waiting for completion...")
            history = client.wait_for_completion(prompt_id)

            outputs = history.get("outputs", {})
            saved_images = outputs.get("8", {}).get("images", [])
            if not saved_images:
                raise RuntimeError(f"No image returned from node 8 for {entity_slug} ({v_key})")

            img_info = saved_images[0]
            downloaded = client.download_image(
                filename=img_info["filename"],
                subfolder=img_info.get("subfolder", ""),
                folder_type=img_info.get("type", "output"),
                dest_path=target_path
            )
            print(f"     Saved raw sprite to: {downloaded}")

            # Optional alpha cutout via make_transparent.py
            if apply_alpha:
                try:
                    from make_transparent import make_transparent
                    make_transparent(downloaded, downloaded, color_tolerance=35.0)
                    print(f"     Applied soft-matte alpha transparency.")
                except Exception as e:
                    print(f"     [Warning] Transparency post-processor skipped: {e}")

            results.append({
                "entity": entity_slug,
                "variant_type": v_type,
                "variant_key": v_key,
                "target_path": str(target_path),
                "status": "generated"
            })

        except Exception as err:
            print(f"     [Error] Generation failed for {entity_slug} ({v_key}): {err}")
            results.append({
                "entity": entity_slug,
                "variant_type": v_type,
                "variant_key": v_key,
                "error": str(err),
                "status": "failed"
            })

    return results


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Generate Visual Novel Character Sprites for Nirmata Worlds via ComfyUI."
    )
    parser.add_argument(
        "--world",
        type=str,
        default=os.environ.get("NIRMATA_WORLD", "cuntitty"),
        help="Target world slug or path (e.g. cuntitty, example-world)."
    )
    parser.add_argument(
        "--entity",
        "--character",
        dest="entity",
        type=str,
        default="",
        help="Entity slug to generate (e.g. fog_spectre, salt_sovereign). See --list."
    )
    parser.add_argument(
        "--all-entities",
        dest="all_entities",
        action="store_true",
        help="Generate sprites for all entities in target world registry."
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all registered entities and their variants in target world."
    )
    parser.add_argument(
        "--variant",
        type=str,
        default="all",
        choices=["base", "expression", "object", "adornment", "clothe", "accessory", "all"],
        help="Category of sprite variant to generate."
    )
    parser.add_argument(
        "--specific-variant",
        type=str,
        default="",
        help="Specific key to generate."
    )
    parser.add_argument(
        "--backend",
        type=str,
        default="openvino",
        choices=["openvino", "standard"],
        help="Execution backend: 'openvino' (Intel Iris Xe GPU accelerated) or 'standard'."
    )
    parser.add_argument(
        "--model",
        type=str,
        default="sd15",
        choices=["sd15", "sdxl"],
        help="Model baseline architecture."
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="",
        help="Output directory where transparent PNG sprites will be saved (defaults to worlds/<world>/assets/sprites)."
    )
    parser.add_argument(
        "--host",
        type=str,
        default=os.environ.get("COMFYUI_HOST", "127.0.0.1"),
        help="ComfyUI server hostname/IP."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("COMFYUI_PORT", 8188)),
        help="ComfyUI server port."
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=24,
        help="Sampling steps."
    )
    parser.add_argument(
        "--cfg",
        type=float,
        default=7.0,
        help="CFG guidance scale."
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=-1,
        help="Random seed (-1 for random)."
    )
    parser.add_argument(
        "--width",
        type=int,
        default=None,
        help="Image width (default: 512 for SD1.5, 832 for SDXL)."
    )
    parser.add_argument(
        "--height",
        type=int,
        default=None,
        help="Image height (default: 896 for SD1.5, 1216 for SDXL)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compile and validate API payloads without dispatching to ComfyUI server."
    )
    parser.add_argument(
        "--no-alpha",
        action="store_true",
        help="Skip post-generation alpha cutout step."
    )

    args = parser.parse_args()

    if args.list:
        slugs = list_entity_slugs(world=args.world)
        print(f"\n=================================================================")
        print(f"Entities in world '{args.world}' ({len(slugs)} total)")
        print(f"=================================================================")
        for s in slugs:
            d = get_entity(s, world=args.world)
            h_name = d.get('hindi_name', '')
            name = d.get('name', s)
            print(f"• [{s:20}] {h_name:25} ({name})")
            print(f"    Kind: {d.get('kind', 'entity')} | Species: {d.get('species_category', 'general')}")
            print(f"    Proportions: {d.get('proportions', '')[:60]}...")
            print(f"    1) Objects ({len(d.get('objects', {}))}): {', '.join(d.get('objects', {}).keys())}")
            print(f"    2) Adornments ({len(d.get('adornments', {}))}): {', '.join(d.get('adornments', {}).keys())}")
            print(f"    3) Clothes ({len(d.get('clothes', {}))}): {', '.join(d.get('clothes', {}).keys())}")
            print(f"    4) Expressions ({len(d.get('expressions', {}))}): {', '.join(d.get('expressions', {}).keys())}\n")
        return

    targets = []
    if args.all_entities:
        targets = list_entity_slugs(world=args.world)
    elif args.entity:
        targets = [args.entity.lower().strip()]
    else:
        print(f"[Error] Must specify either --entity <slug> or --all-entities for world '{args.world}' (or --list).")
        sys.exit(1)

    out_dir = Path(args.output_dir) if args.output_dir else (resolve_world_path(args.world) / "assets" / "sprites")

    all_results = []
    for slug in targets:
        res = generate_entity_sprites(
            entity_slug=slug,
            variant_type=args.variant,
            specific_variant=args.specific_variant,
            world=args.world,
            backend=args.backend,
            model_type=args.model,
            output_dir=out_dir,
            host=args.host,
            port=args.port,
            seed=args.seed,
            steps=args.steps,
            cfg=args.cfg,
            width=args.width,
            height=args.height,
            dry_run=args.dry_run,
            apply_alpha=not args.no_alpha
        )
        all_results.extend(res)

    print(f"\nCompleted {len(all_results)} sprite tasks for world '{args.world}'.")


if __name__ == "__main__":
    main()
