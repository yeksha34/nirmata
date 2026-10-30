#!/usr/bin/env python3
"""
Utility to convert raw generated character sprites with solid/white studio backgrounds
into PNG images with true alpha transparency and anti-aliased edge defringing.
"""

import sys
from pathlib import Path
import numpy as np
from PIL import Image

def make_transparent(input_path: Path, output_path: Path | None = None, threshold_low: float = 8.0, threshold_high: float = 32.0):
    if output_path is None:
        output_path = input_path.with_suffix(".png")

    im = Image.open(input_path).convert("RGB")
    arr = np.array(im, dtype=np.float32)

    # Estimate background color from border margins (corners + top edge)
    top_margin = arr[:15, :, :]
    bg_color = np.median(top_margin, axis=(0, 1))

    # Euclidean color distance from estimated background
    diff = np.sqrt(np.sum((arr - bg_color) ** 2, axis=-1))

    # Soft alpha ramp for smooth anti-aliasing
    alpha = np.clip((diff - threshold_low) / (threshold_high - threshold_low), 0.0, 1.0)

    # Defringe RGB against background color
    eps = 1e-3
    alpha_safe = np.maximum(alpha, eps)
    rgb_defringed = (arr - (1.0 - alpha[:, :, None]) * bg_color[None, None, :]) / alpha_safe[:, :, None]
    rgb_defringed = np.clip(rgb_defringed, 0, 255).astype(np.uint8)

    rgba = np.dstack([rgb_defringed, (alpha * 255).astype(np.uint8)])
    out = Image.fromarray(rgba, "RGBA")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path, "PNG")
    print(f"Saved transparent sprite: {output_path} (alpha min={np.min(alpha):.2f}, max={np.max(alpha):.2f})")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tools/make_transparent.py <input_image> [output_image]")
        sys.exit(1)
    in_file = Path(sys.argv[1])
    out_file = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    make_transparent(in_file, out_file)
