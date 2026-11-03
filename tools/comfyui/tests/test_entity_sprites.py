#!/usr/bin/env python3
"""
Unit Tests for Content-Neutral Entity Sprites ComfyUI Pipeline
Validates:
1. Dynamic loading from target world without hardcoded story lore (ADR-0005)
2. Modular visual prompt architecture:
     1) object (independent descriptions; sets split into parts)
     2) adornment (independent descriptions; sets split into parts)
     3) clothe (independent descriptions; sets split into parts)
     4) expressions (at least 4 variants)
3. Proportions and sovereign poise compliance
4. Non-mammal biological discipline (rejects mammalian anatomy on non-mammal species)
5. Unclad sacred discipline (rejects hallucinated clothes, modesty garments, shame, censors)
6. ComfyUI workflow JSON schemas and node linkages (content-neutral)
7. Automated CLI payload building across backends (OpenVINO SD 1.5 and SDXL)
"""

import sys
import json
import unittest
from pathlib import Path

# Setup paths
tests_dir = Path(__file__).resolve().parent
scripts_dir = tests_dir.parent / "scripts"
workflows_dir = tests_dir.parent / "workflows"

if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

from entity_registry import (
    load_entity_registry,
    get_entity,
    list_entity_slugs,
    build_entity_prompt,
    resolve_world_path
)
from generate_entity_sprites import (
    load_workflow_template,
    build_entity_workflow_payload
)


class TestEntitySpritePipeline(unittest.TestCase):

    def test_example_world_content_neutral_entities(self):
        """Validates that example-world ships clean, content-safe entities adhering to the 3-part schema."""
        slugs = list_entity_slugs(world="example-world")
        self.assertGreaterEqual(len(slugs), 3, "example-world should have at least 3 entities")
        for s in slugs:
            ent = get_entity(s, world="example-world")
            self.assertIsNotNone(ent)
            self.assertIn("objects", ent)
            self.assertIn("adornments", ent)
            self.assertIn("clothes", ent)
            self.assertIn("expressions", ent)

            # Test prompt builder
            prompt = build_entity_prompt(ent, variant_type="base")
            self.assertIn("positive", prompt)
            self.assertIn("negative", prompt)
            self.assertTrue(len(prompt["positive"]) > 50)

    def test_world_entity_registry_schema_when_present(self):
        """
        When a private world (e.g. cuntitty) has an entity registry on disk,
        validates that all entities follow the modular 3-part architecture and poise rules.
        """
        cuntitty_path = resolve_world_path("cuntitty")
        cuntitty_reg_file = cuntitty_path / "assets" / "workflow" / "deity_registry.json"
        if not cuntitty_reg_file.exists():
            cuntitty_reg_file = cuntitty_path / "assets" / "workflow" / "entity_registry.json"

        if not cuntitty_reg_file.exists():
            self.skipTest("cuntitty entity/deity registry not present on disk; skipping private world validation.")

        registry = load_entity_registry(world="cuntitty")
        self.assertGreaterEqual(len(registry), 24, "Target world registry must contain all entities")

        for slug, entity in registry.items():
            self.assertTrue(entity.get("name"), f"Entity {slug} missing name")
            self.assertTrue(entity.get("kind"), f"Entity {slug} missing kind")
            self.assertTrue(entity.get("proportions"), f"Entity {slug} missing proportions")

            # 1) Objects: independent descriptions, at least 2 entries
            self.assertIn("objects", entity, f"Entity {slug} missing 'objects'")
            self.assertGreaterEqual(len(entity["objects"]), 2, f"Entity {slug} has too few objects")
            for obj_key, obj_desc in entity["objects"].items():
                self.assertTrue(len(obj_desc) > 15, f"Object {obj_key} too short in {slug}")

            # 2) Adornments: independent descriptions, at least 2 entries
            self.assertIn("adornments", entity, f"Entity {slug} missing 'adornments'")
            self.assertGreaterEqual(len(entity["adornments"]), 2, f"Entity {slug} has too few adornments")
            for adorn_key, adorn_desc in entity["adornments"].items():
                self.assertTrue(len(adorn_desc) > 15, f"Adornment {adorn_key} too short in {slug}")

            # 3) Clothes: independent descriptions, at least 2 entries including sacred unclad
            self.assertIn("clothes", entity, f"Entity {slug} missing 'clothes'")
            self.assertGreaterEqual(len(entity["clothes"]), 2, f"Entity {slug} has too few clothes")
            has_unclad = any("unclad" in k.lower() or "sacred" in k.lower() for k in entity["clothes"].keys())
            self.assertTrue(has_unclad, f"Entity {slug} missing sacred unclad clothes variant")

            # 4) Expressions: at least 4 independent expressions
            self.assertIn("expressions", entity, f"Entity {slug} missing 'expressions'")
            self.assertGreaterEqual(len(entity["expressions"]), 4, f"Entity {slug} has too few expressions")
            self.assertIn("neutral", entity["expressions"], f"Entity {slug} missing 'neutral' expression")

            # Proportions & Poise rule
            prop = entity.get("proportions", "").lower()
            has_vertical = any(term in prop for term in ["3:", "3.", "9", "10", "heads", "towering", "height-to-width"])
            self.assertTrue(has_vertical, f"Entity {slug} missing vertical proportion framing: {prop}")

            # Non-mammal discipline
            species_cat = entity.get("species_category", "").lower()
            prompt = build_entity_prompt(entity, variant_type="base")
            neg = prompt["negative"].lower()

            if species_cat in ("naag", "serpentine", "reptilian"):
                self.assertIn("human legs", neg, f"Reptilian/Serpentine entity {slug} must forbid human legs")
                self.assertIn("mammal vulva", neg, f"Reptilian/Serpentine entity {slug} must forbid mammal vulva")
            elif species_cat in ("vruksh", "botanical", "plant"):
                self.assertIn("human hair", neg, f"Botanical entity {slug} must forbid human hair")
                self.assertIn("mammal breasts", neg, f"Botanical entity {slug} must forbid mammal breasts")

            # Unclad sacred discipline (anti-modesty / anti-shame)
            pos = prompt["positive"].lower()
            self.assertTrue("completely nude" in pos or "unclad" in pos or "bare" in pos, f"{slug} base must be unclad")
            self.assertIn("clothes", neg, f"{slug} unclad negative must forbid clothes")
            self.assertIn("modesty", neg, f"{slug} unclad negative must forbid modesty garments")

    def test_workflow_templates_exist_and_content_neutral(self):
        """Workflow templates must exist, be valid ComfyUI JSON, and be content-neutral."""
        openvino_sd15 = workflows_dir / "openvino_entity_sprite_sd15.api.json"
        sdxl = workflows_dir / "entity_sprite_workflow.api.json"

        self.assertTrue(openvino_sd15.exists(), "OpenVINO SD 1.5 API workflow must exist")
        self.assertTrue(sdxl.exists(), "SDXL API workflow must exist")

        with open(openvino_sd15, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.assertIn("1", data)
            self.assertIn("3", data)
            self.assertIn("4", data)
            self.assertIn("6", data)
            self.assertIn("8", data)
            template_text = data["3"]["inputs"]["text"].lower()
            self.assertIn("visual novel character sprite", template_text)
            self.assertIn("standing upright", template_text)

        with open(sdxl, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.assertIn("1", data)
            self.assertIn("3", data)
            self.assertIn("4", data)
            template_text = data["3"]["inputs"]["text"].lower()
            self.assertIn("visual novel character sprite", template_text)
            self.assertIn("standing upright", template_text)

    def test_build_entity_workflow_payload(self):
        """Validates payload builder across variants for both backends."""
        target_world = "cuntitty" if (resolve_world_path("cuntitty") / "assets" / "workflow" / "deity_registry.json").exists() else "example-world"
        slugs = list_entity_slugs(world=target_world)
        self.assertTrue(len(slugs) > 0)
        test_slug = slugs[0]

        # 1. SD 1.5 OpenVINO Payload
        payload_sd15 = build_entity_workflow_payload(
            entity_slug=test_slug,
            variant_type="base",
            world=target_world,
            backend="openvino",
            model_type="sd15",
            seed=42,
            steps=20
        )
        self.assertEqual(payload_sd15["5"]["inputs"]["width"], 512)
        self.assertEqual(payload_sd15["5"]["inputs"]["height"], 896)
        self.assertEqual(payload_sd15["6"]["inputs"]["seed"], 42)

        # 2. SDXL Payload
        payload_sdxl = build_entity_workflow_payload(
            entity_slug=test_slug,
            variant_type="expression",
            variant_key="neutral",
            world=target_world,
            backend="standard",
            model_type="sdxl",
            seed=100,
            steps=25
        )
        self.assertEqual(payload_sdxl["5"]["inputs"]["width"], 832)
        self.assertEqual(payload_sdxl["5"]["inputs"]["height"], 1216)


if __name__ == "__main__":
    unittest.main()
