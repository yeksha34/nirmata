#!/usr/bin/env python3
"""
Utility to convert raw generated character sprites with solid/white studio backgrounds
into PNG images with true alpha transparency, preserving internal light/white colors
and applying anti-aliased edge defringing.
"""

import sys
from pathlib import Path
import numpy as np
import scipy.ndimage as ndimage
from PIL import Image

def make_transparent(input_path: Path, output_path: Path | None = None, color_tolerance: float = 35.0):
    if output_path is None:
        output_path = input_path.with_suffix(".png")

    im = Image.open(input_path).convert("RGB")
    arr = np.array(im, dtype=np.float32)

    # Sample corners to determine background color
    h, w, _ = arr.shape
    corners = np.vstack([
        arr[:10, :10, :].reshape(-1, 3),
        arr[:10, -10:, :].reshape(-1, 3),
        arr[-10:, :10, :].reshape(-1, 3),
        arr[-10:, -10:, :].reshape(-1, 3),
        arr[:10, :, :].reshape(-1, 3)
    ])
    bg_color = np.median(corners, axis=0)

    # Euclidean color distance from background
    diff = np.sqrt(np.sum((arr - bg_color) ** 2, axis=-1))
    is_candidate_bg = diff < color_tolerance

    # Connected component labeling to only remove background connected to outer borders
    labeled, _ = ndimage.label(is_candidate_bg)
    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[0, :] = True
    border_mask[-1, :] = True
    border_mask[:, 0] = True
    border_mask[:, -1] = True

    border_labels = np.unique(labeled[border_mask])
    border_labels = border_labels[border_labels > 0]
    is_true_bg = np.isin(labeled, border_labels)

    # Create raw foreground mask (0 for true bg, 1 for foreground)
    fg_mask = (~is_true_bg).astype(np.float32)

    # Soft anti-aliased edge ramp (0.8 sigma gaussian filter)
    alpha = ndimage.gaussian_filter(fg_mask, sigma=0.8)
    alpha = np.clip(alpha, 0.0, 1.0)
    # Clamp extreme background to absolute 0
    alpha[is_true_bg & (diff < (color_tolerance * 0.7))] = 0.0

    # Defringe RGB against background color for smooth boundary blending
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
