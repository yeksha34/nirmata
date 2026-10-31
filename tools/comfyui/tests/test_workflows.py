#!/usr/bin/env python3
"""
Unit and Integration Tests for ComfyUI Workflows and CLI Tooling
"""

import os
import sys
import json
import unittest
from pathlib import Path

# Ensure scripts can be imported
scripts_dir = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(scripts_dir))

from comfy_client import ComfyClient
from generate_sprites import load_workflow_template as load_sprite_wf, build_sprite_prompt
from generate_cgs import load_workflow_template as load_cg_wf, build_cg_prompt
from generate_backgrounds import load_workflow_template as load_bg_wf, build_background_prompt


class TestComfyUIWorkflows(unittest.TestCase):
    def setUp(self):
        self.workflows_dir = Path(__file__).resolve().parent.parent / "workflows"

    def test_workflow_files_exist_and_are_valid_json(self):
        expected_files = [
            "sprite_portrait_workflow.json",
            "sprite_portrait_workflow.api.json",
            "cg_narrative_workflow.json",
            "cg_narrative_workflow.api.json",
            "background_variants_workflow.json",
            "background_variants_workflow.api.json"
        ]
        for fname in expected_files:
            file_path = self.workflows_dir / fname
            self.assertTrue(file_path.exists(), f"Workflow file missing: {fname}")
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.assertIsInstance(data, dict, f"Invalid JSON structure in {fname}")

    def test_sprite_api_workflow_nodes(self):
        wf = load_sprite_wf()
        # Ensure critical nodes exist in API format
        class_types = [node.get("class_type") for node in wf.values()]
        self.assertIn("CheckpointLoaderSimple", class_types)
        self.assertIn("CLIPTextEncode", class_types)
        self.assertIn("EmptyLatentImage", class_types)
        self.assertIn("IPAdapter", class_types)
        self.assertIn("KSampler", class_types)
        self.assertIn("FaceDetailer", class_types)
        self.assertIn("BiRefNet_Ultra", class_types)
        self.assertIn("SaveImage", class_types)

        # Check aspect ratio (832x1216)
        latent_node = wf["4"]["inputs"]
        self.assertEqual(latent_node["width"], 832)
        self.assertEqual(latent_node["height"], 1216)

    def test_build_sprite_prompt_humanoid_vs_monster(self):
        wf = load_sprite_wf()

        # 1. Humanoid mode
        humanoid = build_sprite_prompt(
            wf,
            char_prompt="officer in silver uniform",
            expression="smug",
            mode="humanoid",
            seed=1234
        )
        self.assertIn("smug", humanoid["2"]["inputs"]["text"])
        self.assertEqual(humanoid["11"]["inputs"]["seed"], 1234)
        self.assertEqual(humanoid["8"]["inputs"]["control_net_name"], "controlnet-openpose-sdxl-1.0.safetensors")
        self.assertEqual(humanoid["15"]["inputs"]["image"], ["14", 0])  # Transparency node feeds from FaceDetailer

        # 2. Adaptive Monster / Visceral mode
        monster = build_sprite_prompt(
            wf,
            char_prompt="tentacled shadow beast with glowing eyes",
            expression="neutral",
            mode="monster",
            seed=5678
        )
        self.assertIn("tentacled shadow beast", monster["2"]["inputs"]["text"])
        self.assertEqual(monster["11"]["inputs"]["seed"], 5678)
        # In monster mode: ControlNet switches to Depth
        self.assertEqual(monster["8"]["inputs"]["control_net_name"], "diffusers_xl_depth_midas.safetensors")
        # FaceDetailer is bypassed: transparency node feeds directly from VAE Decode (node 12)
        self.assertEqual(monster["15"]["inputs"]["image"], ["12", 0])

    def test_cg_api_workflow_regional_conditioning(self):
        wf = load_cg_wf()
        class_types = [node.get("class_type") for node in wf.values()]
        self.assertIn("ConditioningSetArea", class_types)
        self.assertIn("ConditioningCombine", class_types)
        self.assertIn("ImageUpscaleWithModel", class_types)

        # Base 16:9 widescreen resolution
        latent_node = wf["13"]["inputs"]
        self.assertEqual(latent_node["width"], 1344)
        self.assertEqual(latent_node["height"], 768)

        # Test prompt injection
        cg_prompt = build_cg_prompt(
            wf,
            global_prompt="moonlit council hall",
            char_a_prompt="armored knight standing left",
            char_b_prompt="mysterious hooded figure sitting right",
            seed=9999
        )
        self.assertIn("moonlit council hall", cg_prompt["2"]["inputs"]["text"])
        self.assertEqual(cg_prompt["4"]["inputs"]["text"], "armored knight standing left")
        self.assertEqual(cg_prompt["6"]["inputs"]["text"], "mysterious hooded figure sitting right")
        self.assertEqual(cg_prompt["14"]["inputs"]["seed"], 9999)

    def test_background_workflow_geometry_depth_locking(self):
        wf = load_bg_wf()
        class_types = [node.get("class_type") for node in wf.values()]
        self.assertIn("ControlNetLoader", class_types)
        self.assertIn("ControlNetApplyAdvanced", class_types)
        self.assertIn("VAEEncode", class_types)
        self.assertIn("KSampler", class_types)

        # Verify depth controlnet is configured
        self.assertEqual(wf["3"]["inputs"]["control_net_name"], "diffusers_xl_depth_midas.safetensors")

        # Test time-of-day variant prompt building
        dusk_bg = build_background_prompt(
            wf,
            location_desc="grand library hall",
            time_variant="dusk",
            denoise=0.58,
            seed=7777
        )
        self.assertIn("golden hour sunset", dusk_bg["4"]["inputs"]["text"])
        self.assertEqual(dusk_bg["8"]["inputs"]["denoise"], 0.58)
        self.assertEqual(dusk_bg["8"]["inputs"]["seed"], 7777)

    def test_comfy_client_endpoint_resolution(self):
        # Default local
        client = ComfyClient("127.0.0.1", 8188)
        self.assertEqual(client.server_address, "127.0.0.1:8188")

        # Custom remote host and port
        remote_client = ComfyClient("192.168.1.100", 9000)
        self.assertEqual(remote_client.server_address, "192.168.1.100:9000")

        # Environment variable override
        os.environ["COMFYUI_HOST"] = "remote.host.cloud:8188"
        env_client = ComfyClient()
        self.assertEqual(env_client.server_address, "remote.host.cloud:8188")
        del os.environ["COMFYUI_HOST"]


if __name__ == "__main__":
    unittest.main()
