#!/usr/bin/env python3
"""
ComfyUI Model Downloader
Downloads required model checkpoints, VAE, ControlNet, IP-Adapter, and BiRefNet
directly into the user's ComfyUI installation directory.
"""

import os
import sys
import argparse
import urllib.request
from pathlib import Path
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Direct Download URLs (HuggingFace Mirrors)
# ---------------------------------------------------------------------------

MODELS_SPEC: List[Dict[str, str]] = [
    {
        "id": "pony_fp8",
        "name": "Pony Diffusion V6 XL (FP8 - Low RAM)",
        "subfolder": "checkpoints",
        "filename": "ponyDiffusionV6XL_v6StartWithThisOne.fp8.safetensors",
        "url": "https://huggingface.co/KBlueLeaf/Pony-Diffusion-V6-XL-fp8/resolve/main/ponyDiffusionV6XL_v6StartWithThisOne.fp8.safetensors",
        "size_est": "~3.8 GB"
    },
    {
        "id": "sdxl_vae",
        "name": "SDXL VAE (FP16 Fix)",
        "subfolder": "vae",
        "filename": "sdxl_vae.safetensors",
        "url": "https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors",
        "size_est": "~335 MB"
    },
    {
        "id": "controlnet_depth",
        "name": "SDXL Depth ControlNet (Midas / ZoeDepth)",
        "subfolder": "controlnet",
        "filename": "diffusers_xl_depth_midas.safetensors",
        "url": "https://huggingface.co/xinsir/controlnet-depth-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors",
        "size_est": "~1.25 GB"
    },
    {
        "id": "clip_vision_bigg",
        "name": "CLIP-ViT-bigG-14 (Vision Encoder for SDXL)",
        "subfolder": "clip_vision",
        "filename": "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
        "url": "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/image_encoder/model.safetensors",
        "size_est": "~3.7 GB"
    },
    {
        "id": "ipadapter_plus",
        "name": "IP-Adapter Plus SDXL (Style / Texture / Monster)",
        "subfolder": "ipadapter",
        "filename": "ip-adapter-plus_sdxl_vit-h.safetensors",
        "url": "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
        "size_est": "~800 MB"
    },
    {
        "id": "ipadapter_plus_sd15",
        "name": "IP-Adapter Plus SD 1.5 (High Strength)",
        "subfolder": "ipadapter",
        "filename": "ip-adapter-plus_sd15.safetensors",
        "url": "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.safetensors",
        "size_est": "~135 MB"
    },
    {
        "id": "clip_vision_h",
        "name": "CLIP-ViT-H-14 (Vision Encoder for SD 1.5)",
        "subfolder": "clip_vision",
        "filename": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
        "url": "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors",
        "size_est": "~2.5 GB"
    },
    {
        "id": "birefnet",
        "name": "BiRefNet General (Alpha Transparency Cutout)",
        "subfolder": "birefnet",
        "filename": "BiRefNet-general-epoch_244.pth",
        "url": "https://huggingface.co/ZhengPeng7/BiRefNet/resolve/main/BiRefNet-general-epoch_244.pth",
        "size_est": "~550 MB"
    }
]


def download_file(url: str, dest_path: Path):
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(".tmp")

    print(f"--> Downloading: {dest_path.name}")
    print(f"    Source: {url}")
    print(f"    Target: {dest_path}")

    class ProgressHook:
        def __init__(self):
            self.last_percent = -1

        def __call__(self, count, block_size, total_size):
            if total_size <= 0:
                return
            percent = int(count * block_size * 100 / total_size)
            if percent != self.last_percent and percent % 5 == 0:
                self.last_percent = percent
                mb_downloaded = (count * block_size) / (1024 * 1024)
                mb_total = total_size / (1024 * 1024)
                sys.stdout.write(f"\r    Progress: {percent}% ({mb_downloaded:.1f} / {mb_total:.1f} MB)")
                sys.stdout.flush()

    try:
        hook = ProgressHook()
        urllib.request.urlretrieve(url, temp_path, reporthook=hook)
        print("\n    [DONE]")
        if dest_path.exists():
            dest_path.unlink()
        temp_path.rename(dest_path)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise RuntimeError(f"Failed to download {dest_path.name}: {e}")


def get_models(comfy_dir: Path, selected_ids: List[str] = None):
    models_root = comfy_dir / "models"
    if not models_root.exists():
        # Try checking if comfy_dir itself is models folder
        if comfy_dir.name == "models":
            models_root = comfy_dir
        else:
            models_root = comfy_dir / "models"

    print("================================================================================")
    print("COMFYUI MODEL DOWNLOADER")
    print("================================================================================")
    print(f"Target Models Directory: {models_root}")
    print("================================================================================\n")

    for spec in MODELS_SPEC:
        if selected_ids and spec["id"] not in selected_ids:
            continue

        target_folder = models_root / spec["subfolder"]
        dest_file = target_folder / spec["filename"]

        print(f"[{spec['id']}] {spec['name']} ({spec['size_est']})")
        if dest_file.exists():
            print(f"  [ALREADY EXISTS] {dest_file}\n")
            continue

        print(f"  Destination: {dest_file}")
        try:
            download_file(spec["url"], dest_file)
            print()
        except Exception as e:
            print(f"  ERROR: {e}\n")


def print_urls_and_commands(comfy_dir: Path = None):
    print("================================================================================")
    print("DIRECT DOWNLOAD LINKS & COMMANDS")
    print("================================================================================")
    for spec in MODELS_SPEC:
        sub = spec["subfolder"]
        fname = spec["filename"]
        target = f"{sub}/{fname}"
        print(f"\n# {spec['name']} ({spec['size_est']})")
        print(f"# Destination: ComfyUI/models/{target}")
        print(f"URL: {spec['url']}")
        if comfy_dir:
            full_dest = comfy_dir / "models" / sub / fname
            print(f"Invoke-WebRequest -Uri \"{spec['url']}\" -OutFile \"{full_dest}\"")


def main():
    parser = argparse.ArgumentParser(description="Download required models for ComfyUI.")
    parser.add_argument("--comfy-dir", help="Path to your local ComfyUI installation (e.g. C:/ComfyUI_windows_portable/ComfyUI)")
    parser.add_argument("--models", help="Comma-separated IDs of specific models to download (e.g. pony_fp8,sdxl_vae)")
    parser.add_argument("--list", action="store_true", help="Print direct download URLs and PowerShell commands")

    args = parser.parse_args()

    if args.list or not args.comfy_dir:
        comfy_path = Path(args.comfy_dir) if args.comfy_dir else Path("C:/ComfyUI")
        print_urls_and_commands(comfy_path)
        if not args.comfy_dir:
            print("\n--------------------------------------------------------------------------------")
            print("To run automatic download, provide your local ComfyUI path:")
            print("  python tools/comfyui/scripts/download_models.py --comfy-dir <path_to_comfyui>")
            print("--------------------------------------------------------------------------------\n")
            return

    comfy_path = Path(args.comfy_dir)
    selected = [m.strip() for m in args.models.split(",")] if args.models else None
    get_models(comfy_path, selected)


if __name__ == "__main__":
    main()
