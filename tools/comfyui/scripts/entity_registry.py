#!/usr/bin/env python3
"""
Content-Neutral Entity & Visual Novel Asset Prompt Engine
Framework-level schema and generator for character sprites, expressions, objects,
adornments, and clothes across any world in Nirmata.

Adheres strictly to:
- ADR-0005 (Scaffold content-neutrality: zero story lore or private text in global code)
- Modular 3-part asset prompt architecture:
    1) Objects (handheld discipline tools, vessels, trophies; supports discrete split sets)
    2) Adornments (piercings, jewelry, somatic modifications, body ornaments)
    3) Clothes (sacred unclad temple form vs. disguise wraps/attire)
    4) Expressions (sovereign neutral, climaxes, taunts, focused trances)
- Biological discipline:
    Rejects human/mammalian anatomical hallucinations on non-human / non-mammal species
    (e.g., serpentine coils reject human legs; botanical dryads reject human skin/hair).
- Proportions & Poise:
    Navatala (9-10 heads tall), vertical framing (width <= height / 3), sovereign poise.
"""

import os
import sys
import json
from pathlib import Path
from typing import Dict, Any, List, Optional


def resolve_world_path(world: str = "") -> Path:
    """
    Resolves the root directory of a target world.
    Checks explicit paths, worlds/<slug>, environment variables, or defaults to cuntitty.
    """
    if not world:
        world = os.environ.get("NIRMATA_WORLD", "cuntitty")

    candidate = Path(world)
    if candidate.exists() and candidate.is_dir():
        return candidate

    worlds_dir = Path(os.environ.get("WORLDS_DIR", "worlds"))
    sub_candidate = worlds_dir / world
    if sub_candidate.exists() and sub_candidate.is_dir():
        return sub_candidate

    # Fallback to repo root worlds/
    repo_candidate = Path(__file__).resolve().parent.parent.parent.parent / "worlds" / world
    if repo_candidate.exists() and repo_candidate.is_dir():
        return repo_candidate

    return sub_candidate


def get_world_workflow_dir(world: str = "") -> Path:
    """Returns the assets/workflow directory for a target world."""
    world_path = resolve_world_path(world)
    return world_path / "assets" / "workflow"


def load_entity_registry(world: str = "") -> Dict[str, Dict[str, Any]]:
    """
    Dynamically loads the entity/deity registry JSON for a target world.
    Looks for:
      1) worlds/<world>/assets/workflow/deity_registry.json
      2) worlds/<world>/assets/workflow/entity_registry.json
      3) worlds/example-world/assets/workflow/deity_registry.json (safe fallback)
    """
    workflow_dir = get_world_workflow_dir(world)
    candidates = [
        workflow_dir / "deity_registry.json",
        workflow_dir / "entity_registry.json",
    ]

    for cand in candidates:
        if cand.exists():
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception as err:
                print(f"[Warning] Failed to parse {cand}: {err}")

    # Fallback to example-world if primary target does not have a registry file
    example_cand = resolve_world_path("example-world") / "assets" / "workflow" / "deity_registry.json"
    if example_cand.exists():
        try:
            with open(example_cand, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass

    return {}


def get_entity(slug: str, world: str = "") -> Optional[Dict[str, Any]]:
    """Retrieves a single entity specification by slug from the target world."""
    registry = load_entity_registry(world)
    return registry.get(slug.lower().strip())


def list_entity_slugs(world: str = "") -> List[str]:
    """Returns a sorted list of entity slugs available in the target world."""
    registry = load_entity_registry(world)
    return sorted(list(registry.keys()))


def build_entity_prompt(
    entity: Dict[str, Any],
    variant_type: str = "base",
    variant_key: str = "neutral",
    object_parts: Optional[List[str]] = None,
    adornment_parts: Optional[List[str]] = None,
    clothe_parts: Optional[List[str]] = None,
    model_type: str = "sd15"
) -> Dict[str, str]:
    """
    Constructs content-neutral positive and negative prompt strings for any entity
    following the modular 3-part specification:
      1) Object
      2) Adornment
      3) Clothe
    plus Expressions, Navatala Proportions, and Biological Discipline.
    """
    pos_parts: List[str] = []
    neg_parts: List[str] = []

    # 1. Base model styling prefix
    if model_type == "sdxl":
        pos_parts.append("score_9, score_8_up, score_7_up, rating_explicit, masterpiece, best quality, visual novel character sprite, full body portrait, standing upright, crisp line art, smooth digital anime illustration, solid white background")
        neg_parts.append("score_1, score_2, score_3, lowres, bad anatomy, bad hands, bad feet, missing fingers, extra digits, blurry, cropped, watermark, signature, artifact")
    else:
        pos_parts.append("masterpiece, best quality, visual novel character sprite, full body portrait, standing upright, isolated on solid white background, crisp clean line art, professional digital illustration")
        neg_parts.append("bad anatomy, bad proportions, bad hands, extra limbs, extra fingers, missing digits, low quality, worst quality, artifact, blurry, lowres, watermark, signature, cropped")

    # 2. Canonical Proportions & Sovereign Poise
    proportions = entity.get("proportions", "towering Navatala 9.5 heads tall, vertical height-to-width ratio 3.2:1")
    poise = entity.get("poise", "effortless sovereign poise, zero mortal fatigue, unyielding sovereign ease")
    pos_parts.extend([proportions, poise])

    # 3. Base Anatomy & Physical Form
    anatomy = entity.get("anatomy_positive", "")
    if anatomy:
        pos_parts.append(anatomy)

    # 4. Expressions
    expressions_map = entity.get("expressions", {})
    if variant_type == "expression" and variant_key in expressions_map:
        pos_parts.append(expressions_map[variant_key])
    elif "neutral" in expressions_map:
        pos_parts.append(expressions_map["neutral"])
    else:
        pos_parts.append("composed sovereign neutral expression, steady calm gaze, closed mouth")

    # 5. Component 1: Objects (Carried props, tools, trophies; supports discrete split sets)
    entity_objects = entity.get("objects", {})
    if variant_type == "object":
        if variant_key in entity_objects:
            pos_parts.append(entity_objects[variant_key])
        elif object_parts:
            for p in object_parts:
                if p in entity_objects:
                    pos_parts.append(entity_objects[p])
    elif object_parts:
        for p in object_parts:
            if p in entity_objects:
                pos_parts.append(entity_objects[p])

    # 6. Component 2: Adornments (Jewelry, piercings, tattoos, somatic modifications)
    entity_adornments = entity.get("adornments", {})
    if variant_type in ("adornment", "accessory"):
        if variant_key in entity_adornments:
            pos_parts.append(entity_adornments[variant_key])
        elif adornment_parts:
            for p in adornment_parts:
                if p in entity_adornments:
                    pos_parts.append(entity_adornments[p])
    elif adornment_parts:
        for p in adornment_parts:
            if p in entity_adornments:
                pos_parts.append(entity_adornments[p])

    # 7. Component 3: Clothes (Sacred unclad temple form vs. disguise wraps/attire)
    entity_clothes = entity.get("clothes", {})
    is_unclad = True
    if variant_type == "clothe":
        if variant_key in entity_clothes:
            desc = entity_clothes[variant_key]
            pos_parts.append(desc)
            if "unclad" not in variant_key.lower() and "nude" not in desc.lower():
                is_unclad = False
        elif clothe_parts:
            for p in clothe_parts:
                if p in entity_clothes:
                    pos_parts.append(entity_clothes[p])
            is_unclad = False
    elif clothe_parts:
        for p in clothe_parts:
            if p in entity_clothes:
                pos_parts.append(entity_clothes[p])
        is_unclad = False
    else:
        # Default is sacred unclad form if available
        unclad_key = next((k for k in entity_clothes.keys() if "unclad" in k.lower() or "sacred" in k.lower()), None)
        if unclad_key:
            pos_parts.append(entity_clothes[unclad_key])
        elif "unclad_discipline" in entity:
            pos_parts.append(entity["unclad_discipline"])

    # 8. Unclad & Anti-Modesty Discipline (Suppresses clothes hallucinations and modesty shame)
    if is_unclad:
        anti_modesty_neg = (
            "clothes, clothing, shirt, pants, trousers, underwear, bra, panties, bikini, lingerie, "
            "dress, skirt, robes, drape, fabric covering body, wrap, toga, modern garments, "
            "modesty garments, modesty posture, arms crossed over chest, covering breasts, covering groin, "
            "hands blocking genitals, blushing in shame, embarrassed, timid covering, "
            "censored, bar censor, mosaic censor, white censor, black bar censor"
        )
        neg_parts.append(anti_modesty_neg)

    # 9. Biological Discipline: Species-Specific Anatomy Suppression
    species_cat = entity.get("species_category", "").lower()
    custom_species_neg = entity.get("species_negative", "")
    if custom_species_neg:
        neg_parts.append(custom_species_neg)

    if species_cat in ("naag", "serpentine", "reptilian"):
        neg_parts.append("human legs, two legs, mammal thighs, walking feet, mammal breasts with milk, human skin, mammal vulva, panties")
    elif species_cat in ("vruksh", "botanical", "plant"):
        neg_parts.append("human hair, mammal breasts with milk, human skin, mammal nipples, two human legs, panties, bra, modern fabric")
    elif species_cat in ("avian", "bird"):
        neg_parts.append("human ears, mammal lips, teeth, human nose, arms without feathers")
    elif species_cat in ("insectoid",):
        neg_parts.append("mammal skin, soft fleshy belly, human ears, human hair, mammal genitalia")

    # Clean and assemble
    positive_str = ", ".join([p.strip().rstrip(",") for p in pos_parts if p.strip()])
    negative_str = ", ".join([n.strip().rstrip(",") for n in neg_parts if n.strip()])

    return {
        "positive": positive_str,
        "negative": negative_str
    }
