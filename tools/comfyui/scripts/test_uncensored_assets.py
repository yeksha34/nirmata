#!/usr/bin/env python3
"""
Content-Neutral ComfyUI Asset Generator & Test Runner (ADR-0005)
Uses a Middleware and Callback architecture for dynamic prompt construction,
world card extraction, and workflow payload generation.
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional, Callable

# Add parent directory for imports
scripts_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(scripts_dir))

from comfy_client import ComfyClient

# ---------------------------------------------------------------------------
# Callback Protocol & Implementations
# ---------------------------------------------------------------------------

class PayloadCallback:
    """Callback lifecycle interface for prompt preparation and payload execution."""

    def on_prompt_prepared(self, context: Dict[str, Any], positive: str, negative: str) -> None:
        """Invoked after the middleware chain has constructed final positive and negative prompts."""
        pass

    def on_payload_built(self, context: Dict[str, Any], payload: Dict[str, Any]) -> None:
        """Invoked after the ComfyUI node graph payload has been constructed."""
        pass

    def on_execution_start(self, prompt_id: str) -> None:
        """Invoked when the generation job is queued on ComfyUI."""
        pass

    def on_progress(self, current_step: int, total_steps: int) -> None:
        """Invoked periodically as sampling progress reports arrive."""
        pass

    def on_completed(self, output_files: List[Path]) -> None:
        """Invoked when image generation has finished and files are written to disk."""
        pass


class LoggingCallback(PayloadCallback):
    """Console logging callback."""

    def on_prompt_prepared(self, context: Dict[str, Any], positive: str, negative: str) -> None:
        print(f"--> [Prompt Ready] Mode: {context.get('mode', 'sprite')}")
        print(f"    Positive ({len(positive)} chars): {positive[:90]}...")
        print(f"    Negative ({len(negative)} chars): {negative[:90]}...")

    def on_payload_built(self, context: Dict[str, Any], payload: Dict[str, Any]) -> None:
        print(f"--> [Payload Built] Total Nodes: {len(payload)}")

    def on_execution_start(self, prompt_id: str) -> None:
        print(f"--> [Job Queued] Prompt ID: {prompt_id}")

    def on_progress(self, current_step: int, total_steps: int) -> None:
        print(f"    Progress: {current_step}/{total_steps} steps", end="\r")

    def on_completed(self, output_files: List[Path]) -> None:
        print(f"\n--> [Completed] Output Files ({len(output_files)}):")
        for f in output_files:
            print(f"    - {f}")


# ---------------------------------------------------------------------------
# Middleware Protocol & Implementations
# ---------------------------------------------------------------------------

PromptMiddleware = Callable[[Dict[str, Any], str], str]

def quality_tag_middleware(context: Dict[str, Any], prompt: str) -> str:
    """Injects high aesthetic quality score tags."""
    is_sdxl = context.get("is_sdxl", True)
    if is_sdxl:
        prefix = "score_9, score_8_up, score_7_up, masterpiece, best quality"
    else:
        prefix = "masterpiece, best quality, ultra-detailed"

    if prefix not in prompt:
        return f"{prefix}, {prompt}".strip(", ")
    return prompt


def rating_middleware(context: Dict[str, Any], prompt: str) -> str:
    """Injects uncensored / explicit rating tags when enabled."""
    uncensored = context.get("uncensored", True)
    if uncensored:
        rating_tag = "rating_explicit, uncensored" if context.get("is_sdxl", True) else "uncensored"
        if rating_tag not in prompt:
            return f"{prompt}, {rating_tag}".strip(", ")
    return prompt


def world_card_loader_middleware(context: Dict[str, Any], prompt: str) -> str:
    """
    Dynamically loads character prompt descriptors from /worlds/<slug>/.
    Reads character cards from worlds/<slug>/characters/ without hardcoded lore.
    """
    world = context.get("world")
    character = context.get("character")
    if not world or not character:
        return prompt

    world_path = Path(world) if Path(world).exists() else Path("worlds") / world
    if not world_path.exists():
        return prompt

    # 1. Check prompt specs in vns/_shared/assets/prompts.json or assets/workflow/prompts.json
    candidates = [
        world_path / "vns" / "_shared" / "assets" / "prompts.json",
        world_path / "assets" / "workflow" / "prompts.json"
    ]
    for cand in candidates:
        if cand.exists():
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        if character.lower() in k.lower():
                            spec_prompt = v.get("positivePrompt", "")
                            if spec_prompt:
                                return f"{prompt}, {spec_prompt}".strip(", ")
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
                        extracted = ", ".join(parts)
                        return f"{prompt}, {extracted}".strip(", ")
                except Exception:
                    pass

    return prompt


def generic_fallback_middleware(context: Dict[str, Any], prompt: str) -> str:
    """Provides content-neutral fallback descriptors if no specific card prompt was loaded."""
    mode = context.get("mode", "sprite")
    if mode == "cg":
        base = "visual novel narrative event CG, 16:9 widescreen composition, dramatic atmospheric lighting, emotional narrative focal point, highly detailed background scenery, deep depth of field"
    else:
        base = "visual novel character sprite, full body portrait, solo, anime girl, standing forward, crisp clean anatomical line art, smooth volumetric shading, isolated against solid background"

    if not prompt or prompt.strip() == "":
        return base
    if base not in prompt and "event CG" not in prompt and "character sprite" not in prompt:
        return f"{base}, {prompt}".strip(", ")
    return prompt


def expression_middleware(context: Dict[str, Any], prompt: str) -> str:
    """Appends expression and gaze tokens."""
    expr = context.get("expression", "neutral").lower()
    expr_map = {
        "neutral": "calm composed neutral expression, closed mouth, gentle direct glance",
        "smiling": "gentle friendly smile, soft happy eyes, relaxed warm expression",
        "bashful": "bashful shy expression, blushing rosy cheeks, timid downcast glance",
        "smug": "smug confident smirk, amused raised eyebrow, self-satisfied cunning expression",
        "flustered": "flustered blushing face, embarrassed, wide eyes, parted lips",
        "submissive": "submissive posture, looking down, teary eyes, obedient expression",
        "angry": "angry furrowed brow, fierce scowl, intense glare, tense jaw",
        "commanding": "stern commanding gaze, sharp look, authoritative expression"
    }
    expr_text = expr_map.get(expr, expr)
    if expr_text not in prompt:
        return f"{prompt}, {expr_text}".strip(", ")
    return prompt


class PromptPipeline:
    """Composes middleware transformations and notifies lifecycle callbacks."""

    def __init__(self, middlewares: Optional[List[PromptMiddleware]] = None, callbacks: Optional[List[PayloadCallback]] = None):
        self.middlewares: List[PromptMiddleware] = middlewares or []
        self.callbacks: List[PayloadCallback] = callbacks or []

    def use(self, middleware: PromptMiddleware) -> "PromptPipeline":
        self.middlewares.append(middleware)
        return self

    def add_callback(self, callback: PayloadCallback) -> "PromptPipeline":
        self.callbacks.append(callback)
        return self

    def process_prompt(self, context: Dict[str, Any], initial_prompt: str = "") -> str:
        prompt = initial_prompt
        for mw in self.middlewares:
            prompt = mw(context, prompt)
        return prompt

    def notify_prompt_prepared(self, context: Dict[str, Any], positive: str, negative: str) -> None:
        for cb in self.callbacks:
            cb.on_prompt_prepared(context, positive, negative)

    def notify_payload_built(self, context: Dict[str, Any], payload: Dict[str, Any]) -> None:
        for cb in self.callbacks:
            cb.on_payload_built(context, payload)


# ---------------------------------------------------------------------------
# Default Pipeline & Payloads
# ---------------------------------------------------------------------------

DEFAULT_NEGATIVE_SDXL = (
    "score_1, score_2, score_3, lowres, bad anatomy, bad hands, multiple people, "
    "blurry, cropped, worst quality, low quality, normal quality, signature, watermark, "
    "censored, bar censor, mosaic censor"
)

DEFAULT_NEGATIVE_SD15 = (
    "lowres, bad anatomy, bad hands, missing fingers, extra digits, cropped, "
    "worst quality, low quality, normal quality, signature, watermark, blurry, deformed, "
    "censored, bar censor, mosaic censor"
)


def create_default_pipeline(callbacks: Optional[List[PayloadCallback]] = None) -> PromptPipeline:
    pipeline = PromptPipeline(callbacks=callbacks)
    pipeline.use(quality_tag_middleware)
    pipeline.use(world_card_loader_middleware)
    pipeline.use(generic_fallback_middleware)
    pipeline.use(expression_middleware)
    pipeline.use(rating_middleware)
    return pipeline


def build_sprite_payload(
    ckpt_name: str = "ponyDiffusionV6XL_fp16.safetensors",
    vae_name: str = "sdxl_vae.safetensors",
    seed: int = 1024,
    steps: int = 25,
    cfg: float = 7.0,
    positive_prompt: str = "",
    negative_prompt: str = DEFAULT_NEGATIVE_SDXL,
    use_openvino: bool = False,
    context: Optional[Dict[str, Any]] = None,
    pipeline: Optional[PromptPipeline] = None
) -> Dict[str, Any]:
    """
    Builds a content-neutral ComfyUI workflow graph for sprite generation.
    Supports OpenVINO acceleration for Intel Iris Xe GPUs.
    """
    ctx = context or {"mode": "sprite", "is_sdxl": "xl" in ckpt_name.lower() or "pony" in ckpt_name.lower()}
    pipe = pipeline or create_default_pipeline()

    final_positive = pipe.process_prompt(ctx, positive_prompt)
    pipe.notify_prompt_prepared(ctx, final_positive, negative_prompt)

    model_link = ["1", 0]
    vae_link = ["2", 0]

    payload: Dict[str, Any] = {
        "1": {
            "inputs": {"ckpt_name": ckpt_name},
            "class_type": "CheckpointLoaderSimple",
            "_meta": {"title": "Load Checkpoint"}
        },
        "2": {
            "inputs": {"vae_name": vae_name},
            "class_type": "VAELoader",
            "_meta": {"title": "Load VAE"}
        },
        "3": {
            "inputs": {"text": final_positive, "clip": ["1", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Positive Prompt"}
        },
        "4": {
            "inputs": {"text": negative_prompt, "clip": ["1", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Negative Prompt"}
        },
        "5": {
            "inputs": {"width": 832, "height": 1216, "batch_size": 1},
            "class_type": "EmptyLatentImage",
            "_meta": {"title": "Empty Latent (9:16 Portrait)"}
        }
    }

    if use_openvino:
        payload["101"] = {
            "inputs": {"model": ["1", 0], "device": "GPU"},
            "class_type": "TorchCompileDiffusionOpenVINO",
            "_meta": {"title": "OpenVINO Diffusion (Intel Iris Xe GPU)"}
        }
        payload["102"] = {
            "inputs": {"vae": ["2", 0], "device": "GPU", "compile_encoder": True, "compile_decoder": True, "remove_compile": False},
            "class_type": "TorchCompileVAEOpenVINO",
            "_meta": {"title": "OpenVINO VAE (Intel Iris Xe GPU)"}
        }
        model_link = ["101", 0]
        vae_link = ["102", 0]

    payload["6"] = {
        "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": "dpmpp_2m",
            "scheduler": "karras",
            "denoise": 1.0,
            "model": model_link,
            "positive": ["3", 0],
            "negative": ["4", 0],
            "latent_image": ["5", 0]
        },
        "class_type": "KSampler",
        "_meta": {"title": "KSampler"}
    }
    payload["7"] = {
        "inputs": {
            "samples": ["6", 0],
            "vae": vae_link
        },
        "class_type": "VAEDecode",
        "_meta": {"title": "VAE Decode"}
    }
    payload["9"] = {
        "inputs": {
            "filename_prefix": "sprites/test_sprite",
            "images": ["7", 0]
        },
        "class_type": "SaveImage",
        "_meta": {"title": "Save Sprite"}
    }

    pipe.notify_payload_built(ctx, payload)
    return payload


def build_cg_payload(
    ckpt_name: str = "ponyDiffusionV6XL_fp16.safetensors",
    vae_name: str = "sdxl_vae.safetensors",
    seed: int = 2048,
    steps: int = 28,
    cfg: float = 6.5,
    global_prompt: str = "",
    region1_prompt: str = "kneeling anime character, dramatic lighting, detailed emotional illustration, uncensored",
    region2_prompt: str = "standing companion character, dramatic lighting, detailed attire, cinematic low-key shadow",
    negative_prompt: str = DEFAULT_NEGATIVE_SDXL,
    use_openvino: bool = False,
    context: Optional[Dict[str, Any]] = None,
    pipeline: Optional[PromptPipeline] = None
) -> Dict[str, Any]:
    """
    Builds a content-neutral 16:9 widescreen narrative event CG workflow with regional conditioning.
    """
    ctx = context or {"mode": "cg", "is_sdxl": "xl" in ckpt_name.lower() or "pony" in ckpt_name.lower()}
    pipe = pipeline or create_default_pipeline()

    final_global = pipe.process_prompt(ctx, global_prompt)
    pipe.notify_prompt_prepared(ctx, final_global, negative_prompt)

    model_link = ["1", 0]
    vae_link = ["2", 0]

    payload: Dict[str, Any] = {
        "1": {
            "inputs": {"ckpt_name": ckpt_name},
            "class_type": "CheckpointLoaderSimple",
            "_meta": {"title": "Load Checkpoint"}
        },
        "2": {
            "inputs": {"vae_name": vae_name},
            "class_type": "VAELoader",
            "_meta": {"title": "Load VAE"}
        },
        "3": {
            "inputs": {"text": final_global, "clip": ["1", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Global Environment Prompt"}
        },
        "4": {
            "inputs": {"text": region1_prompt, "clip": ["1", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Region 1 (Focal Character) Prompt"}
        },
        "5": {
            "inputs": {
                "conditioning": ["4", 0],
                "width": 806,
                "height": 768,
                "x": 0,
                "y": 0,
                "strength": 0.85
            },
            "class_type": "ConditioningSetArea",
            "_meta": {"title": "Region 1 Conditioning Area (Left 60%)"}
        },
        "6": {
            "inputs": {"text": region2_prompt, "clip": ["1", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Region 2 (Companion Figure) Prompt"}
        },
        "7": {
            "inputs": {
                "conditioning": ["6", 0],
                "width": 538,
                "height": 768,
                "x": 806,
                "y": 0,
                "strength": 0.75
            },
            "class_type": "ConditioningSetArea",
            "_meta": {"title": "Region 2 Conditioning Area (Right 40%)"}
        },
        "8": {
            "inputs": {
                "conditioning_to": ["3", 0],
                "conditioning_from": ["5", 0]
            },
            "class_type": "ConditioningCombine",
            "_meta": {"title": "Combine Global + Region 1"}
        },
        "9": {
            "inputs": {
                "conditioning_to": ["8", 0],
                "conditioning_from": ["7", 0]
            },
            "class_type": "ConditioningCombine",
            "_meta": {"title": "Combine Regions into Final Positive"}
        },
        "10": {
            "inputs": {"text": negative_prompt, "clip": ["1", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Negative Prompt"}
        },
        "11": {
            "inputs": {"width": 1344, "height": 768, "batch_size": 1},
            "class_type": "EmptyLatentImage",
            "_meta": {"title": "Empty Latent (16:9 Widescreen)"}
        }
    }

    if use_openvino:
        payload["101"] = {
            "inputs": {"model": ["1", 0], "device": "GPU"},
            "class_type": "TorchCompileDiffusionOpenVINO",
            "_meta": {"title": "OpenVINO Diffusion (Intel Iris Xe GPU)"}
        }
        payload["102"] = {
            "inputs": {"vae": ["2", 0], "device": "GPU", "compile_encoder": True, "compile_decoder": True, "remove_compile": False},
            "class_type": "TorchCompileVAEOpenVINO",
            "_meta": {"title": "OpenVINO VAE (Intel Iris Xe GPU)"}
        }
        model_link = ["101", 0]
        vae_link = ["102", 0]

    payload["12"] = {
        "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": "dpmpp_2m",
            "scheduler": "karras",
            "denoise": 1.0,
            "model": model_link,
            "positive": ["9", 0],
            "negative": ["10", 0],
            "latent_image": ["11", 0]
        },
        "class_type": "KSampler",
        "_meta": {"title": "KSampler (CG Composition)"}
    }
    payload["13"] = {
        "inputs": {
            "samples": ["12", 0],
            "vae": vae_link
        },
        "class_type": "VAEDecode",
        "_meta": {"title": "VAE Decode"}
    }
    payload["14"] = {
        "inputs": {
            "filename_prefix": "cgs/test_cg",
            "images": ["13", 0]
        },
        "class_type": "SaveImage",
        "_meta": {"title": "Save CG Scene"}
    }

    pipe.notify_payload_built(ctx, payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description="Test runner for ComfyUI sprite and CG assets using middleware & callbacks.")
    parser.add_argument("--mode", choices=["sprite", "cg"], default="sprite", help="Generation mode: sprite or cg")
    parser.add_argument("--world", default="", help="Optional world slug or folder (e.g. worlds/<slug>)")
    parser.add_argument("--character", default="", help="Optional character name to dynamically extract from world cards")
    parser.add_argument("--expression", default="neutral", help="Expression state (neutral, smiling, bashful, smug, etc.)")
    parser.add_argument("--prompt", default="", help="Custom prompt override")
    parser.add_argument("--dry-run", action="store_true", help="Build and print payload without executing ComfyUI queue")
    parser.add_argument("--openvino", action="store_true", help="Wrap model and VAE in OpenVINO torch compile nodes")
    parser.add_argument("--host", default="127.0.0.1", help="ComfyUI host")
    parser.add_argument("--port", type=int, default=8188, help="ComfyUI port")

    args = parser.parse_args()

    pipeline = create_default_pipeline(callbacks=[LoggingCallback()])
    context = {
        "mode": args.mode,
        "world": args.world,
        "character": args.character,
        "expression": args.expression,
        "is_sdxl": True,
        "uncensored": True
    }

    if args.mode == "cg":
        payload = build_cg_payload(
            global_prompt=args.prompt,
            use_openvino=args.openvino,
            context=context,
            pipeline=pipeline
        )
    else:
        payload = build_sprite_payload(
            positive_prompt=args.prompt,
            use_openvino=args.openvino,
            context=context,
            pipeline=pipeline
        )

    if args.dry_run:
        print("\n[Dry Run Complete] Generated payload JSON snippet:")
        print(json.dumps({k: payload[k] for k in list(payload.keys())[:4]}, indent=2))
        return

    client = ComfyClient(host=args.host, port=args.port)
    prompt_id = client.queue_prompt(payload)
    print(f"Queued job successfully: {prompt_id}")


if __name__ == "__main__":
    main()
