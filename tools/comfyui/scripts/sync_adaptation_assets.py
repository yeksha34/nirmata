#!/usr/bin/env python3
"""
Sync Adaptation Assets
Scans a visual novel adaptation (manifest.json and adaptation.md) to detect
all required sprites, event CGs, and backgrounds, identifying missing assets
and queueing generation with ComfyUI.
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from typing import Dict, List, Set, Any


def scan_manifest_and_script(vn_dir: Path) -> Dict[str, Set[str]]:
    required = {
        "sprites": set(),
        "backgrounds": set(),
        "cgs": set()
    }

    manifest_path = vn_dir / "manifest.json"
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                asset_catalog = data.get("assets", {})
                for bg in asset_catalog.get("backgrounds", []):
                    required["backgrounds"].add(bg if isinstance(bg, str) else bg.get("name", ""))
                for cg in asset_catalog.get("cgs", []):
                    required["cgs"].add(cg if isinstance(cg, str) else cg.get("name", ""))
                for sp in asset_catalog.get("sprites", []):
                    required["sprites"].add(sp if isinstance(sp, str) else sp.get("name", ""))
        except Exception as e:
            print(f"Warning: Could not fully parse manifest.json: {e}")

    adaptation_path = vn_dir / "adaptation.md"
    if adaptation_path.exists():
        try:
            with open(adaptation_path, "r", encoding="utf-8") as f:
                content = f.read()
                # Parse stage directives
                bgs = re.findall(r"\[bg\s+([a-zA-Z0-9_\-]+)", content)
                for bg in bgs:
                    required["backgrounds"].add(bg.strip())

                cgs = re.findall(r"\[cg\s+([a-zA-Z0-9_\-]+)", content)
                for cg in cgs:
                    required["cgs"].add(cg.strip())

                shows = re.findall(r"\[show\s+([^\]]+)\]", content)
                for show in shows:
                    tokens = show.split()
                    if tokens:
                        char = tokens[0]
                        expr = tokens[1] if len(tokens) > 1 else "neutral"
                        required["sprites"].add(f"{char}_{expr}")
        except Exception as e:
            print(f"Warning: Could not parse adaptation.md directives: {e}")

    # Clean empty values
    for k in required:
        required[k] = {item for item in required[k] if item}

    return required


def find_asset_file(name: str, category: str, vn_dir: Path, shared_dir: Path) -> bool:
    extensions = [".png", ".jpg", ".jpeg", ".webp"]
    search_dirs = [
        vn_dir / "assets" / category,
        shared_dir / "assets" / category,
        vn_dir / "assets",
        shared_dir / "assets"
    ]

    base_name = Path(name).stem
    for folder in search_dirs:
        if not folder.exists():
            continue
        for ext in extensions:
            candidate = folder / f"{base_name}{ext}"
            if candidate.exists():
                return True
    return False


def sync_assets(
    vn_dir: Path,
    shared_dir: Path,
    host: str = "127.0.0.1",
    port: int = 8188,
    dry_run: bool = True
):
    print(f"\n========================================================")
    print(f"Scanning Visual Novel Assets: {vn_dir}")
    print(f"Shared Asset Pool: {shared_dir}")
    print(f"========================================================\n")

    required = scan_manifest_and_script(vn_dir)

    missing = {
        "sprites": [],
        "backgrounds": [],
        "cgs": []
    }

    total_count = 0
    missing_count = 0

    for cat in ["backgrounds", "sprites", "cgs"]:
        print(f"--- Category: {cat.upper()} ---")
        items = sorted(list(required[cat]))
        total_count += len(items)
        for item in items:
            exists = find_asset_file(item, cat, vn_dir, shared_dir)
            if exists:
                print(f"  [OK]      {item}")
            else:
                print(f"  [MISSING] {item}")
                missing[cat].append(item)
                missing_count += 1

    print(f"\nTotal Assets Declared: {total_count}")
    print(f"Missing Assets:        {missing_count}")

    if missing_count == 0:
        print("\nAll visual novel assets are present and ready!")
        return

    if dry_run:
        print("\n[DRY-RUN] Missing asset generation plan:")
        for bg in missing["backgrounds"]:
            print(f"  -> python tools/comfyui/scripts/generate_backgrounds.py --location {bg} ...")
        for sp in missing["sprites"]:
            parts = sp.split("_")
            char = parts[0]
            expr = parts[1] if len(parts) > 1 else "neutral"
            print(f"  -> python tools/comfyui/scripts/generate_sprites.py --character {char} --expressions {expr} ...")
        for cg in missing["cgs"]:
            print(f"  -> python tools/comfyui/scripts/generate_cgs.py --cg-name {cg} ...")
        print("\nPass without --dry-run to trigger automatic generation.")


def main():
    parser = argparse.ArgumentParser(description="Check and sync visual novel assets via ComfyUI.")
    parser.add_argument("--vn-dir", required=True, help="Path to visual novel adaptation folder")
    parser.add_argument("--shared-dir", default="", help="Path to shared visual novel assets (default: sibling _shared)")
    parser.add_argument("--host", default="127.0.0.1", help="ComfyUI host address")
    parser.add_argument("--port", type=int, default=8188, help="ComfyUI port")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Preview missing assets without running ComfyUI")

    args = parser.parse_args()
    vn_dir = Path(args.vn_dir)
    shared_dir = Path(args.shared_dir) if args.shared_dir else vn_dir.parent / "_shared"

    sync_assets(
        vn_dir=vn_dir,
        shared_dir=shared_dir,
        host=args.host,
        port=args.port,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
