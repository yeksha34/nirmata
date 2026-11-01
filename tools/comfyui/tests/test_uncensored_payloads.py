#!/usr/bin/env python3
"""
Unit Tests for ComfyUI Asset Generator & Middleware Pipeline (ADR-0005)
Verifies middleware transformation, callback lifecycle hooks, and node graph structures.
"""

import os
import sys
import unittest
from pathlib import Path
from typing import Dict, Any, List

# Add scripts directory
scripts_dir = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(scripts_dir))

from test_uncensored_assets import (
    PromptPipeline,
    PayloadCallback,
    quality_tag_middleware,
    rating_middleware,
    generic_fallback_middleware,
    expression_middleware,
    create_default_pipeline,
    build_sprite_payload,
    build_cg_payload,
    DEFAULT_NEGATIVE_SDXL,
    DEFAULT_NEGATIVE_SD15,
)


class TestPromptPipelineAndCallbacks(unittest.TestCase):
    def test_middleware_chain_execution_order(self):
        """Verifies that middlewares execute sequentially to transform the prompt."""
        execution_order = []

        def mw1(ctx: Dict[str, Any], prompt: str) -> str:
            execution_order.append("mw1")
            return f"{prompt}, step1".strip(", ")

        def mw2(ctx: Dict[str, Any], prompt: str) -> str:
            execution_order.append("mw2")
            return f"{prompt}, step2".strip(", ")

        pipeline = PromptPipeline()
        pipeline.use(mw1).use(mw2)

        result = pipeline.process_prompt({"test": True}, "base")
        self.assertEqual(execution_order, ["mw1", "mw2"])
        self.assertEqual(result, "base, step1, step2")

    def test_callback_lifecycle_notifications(self):
        """Verifies that lifecycle callbacks receive prompt and payload events."""
        events: List[str] = []

        class TestCallback(PayloadCallback):
            def on_prompt_prepared(self, context: Dict[str, Any], positive: str, negative: str) -> None:
                events.append("prompt_prepared")

            def on_payload_built(self, context: Dict[str, Any], payload: Dict[str, Any]) -> None:
                events.append("payload_built")

        cb = TestCallback()
        pipeline = create_default_pipeline(callbacks=[cb])

        payload = build_sprite_payload(
            positive_prompt="test character",
            context={"mode": "sprite", "is_sdxl": True, "uncensored": True},
            pipeline=pipeline
        )

        self.assertIn("prompt_prepared", events)
        self.assertIn("payload_built", events)
        self.assertIsInstance(payload, dict)

    def test_built_in_middlewares(self):
        """Tests individual built-in middlewares for content-neutral tagging."""
        ctx = {"is_sdxl": True, "uncensored": True, "expression": "flustered", "mode": "sprite"}

        p = quality_tag_middleware(ctx, "")
        self.assertIn("score_9", p)
        self.assertIn("masterpiece", p)

        p = generic_fallback_middleware(ctx, "")
        self.assertIn("visual novel character sprite", p)

        p = expression_middleware(ctx, p)
        self.assertIn("flustered blushing face", p)

        p = rating_middleware(ctx, p)
        self.assertIn("rating_explicit, uncensored", p)


class TestPayloadNodeGraphs(unittest.TestCase):
    def test_sprite_payload_structure(self):
        """Ensure sprite payload is correctly wired for 9:16 portrait generation."""
        payload = build_sprite_payload(seed=1234, steps=25, cfg=7.0)

        # Checkpoint loader
        self.assertIn("1", payload)
        self.assertEqual(payload["1"]["class_type"], "CheckpointLoaderSimple")

        # Output resolution must be 9:16 portrait (832 x 1216)
        self.assertEqual(payload["5"]["inputs"]["width"], 832)
        self.assertEqual(payload["5"]["inputs"]["height"], 1216)

        # KSampler wiring
        self.assertEqual(payload["6"]["inputs"]["seed"], 1234)
        self.assertEqual(payload["6"]["inputs"]["steps"], 25)

        # Output save node links directly to VAE Decode (node 7)
        self.assertEqual(payload["9"]["inputs"]["images"], ["7", 0])

    def test_sprite_openvino_wrapping(self):
        """Ensure OpenVINO nodes are inserted when enabled."""
        payload = build_sprite_payload(use_openvino=True)

        self.assertIn("101", payload)
        self.assertIn("102", payload)
        self.assertEqual(payload["101"]["class_type"], "TorchCompileDiffusionOpenVINO")
        self.assertEqual(payload["102"]["class_type"], "TorchCompileVAEOpenVINO")

        # KSampler must link to compiled model node 101, not checkpoint directly
        self.assertEqual(payload["6"]["inputs"]["model"], ["101", 0])

    def test_cg_regional_conditioning_wiring(self):
        """Ensure 16:9 widescreen layout and regional conditioning isolation."""
        payload = build_cg_payload(seed=5678, steps=28, cfg=6.5)

        # Base latent resolution must be 16:9 widescreen (1344 x 768)
        self.assertEqual(payload["11"]["inputs"]["width"], 1344)
        self.assertEqual(payload["11"]["inputs"]["height"], 768)

        # Region 1 (Focal character) covers left 60%
        self.assertEqual(payload["5"]["inputs"]["x"], 0)
        self.assertEqual(payload["5"]["inputs"]["width"], 806)

        # Region 2 (Companion character) covers right 40%
        self.assertEqual(payload["7"]["inputs"]["x"], 806)
        self.assertEqual(payload["7"]["inputs"]["width"], 538)

        # Condition combine joins Region 1 and Region 2 into final positive
        self.assertEqual(payload["8"]["class_type"], "ConditioningCombine")
        self.assertEqual(payload["9"]["class_type"], "ConditioningCombine")
        self.assertEqual(payload["12"]["inputs"]["positive"], ["9", 0])

    def test_negative_prompt_anti_defect(self):
        """Ensure negative prompt includes anti-defect and anti-censorship tokens."""
        self.assertIn("lowres", DEFAULT_NEGATIVE_SDXL)
        self.assertIn("censored", DEFAULT_NEGATIVE_SDXL)
        self.assertIn("bad anatomy", DEFAULT_NEGATIVE_SD15)


if __name__ == "__main__":
    unittest.main()
