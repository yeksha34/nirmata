#!/usr/bin/env python3
"""
Builds the Twine/SugarCube reader from chapters/*.md.

chapters/*.md -> tools/twine/build/story.tw (Twee3 source) -> tools/twine/reader.html (via Tweego)

See README.md for the chapter formatting convention this script expects.
"""
import re
import subprocess
import sys
from pathlib import Path

from story_paths import story_root

ROOT = Path(__file__).resolve().parent.parent
CHAPTERS_DIR = story_root() / "chapters"
BUILD_DIR = ROOT / "tools" / "twine" / "build"
TWEE_PATH = BUILD_DIR / "story.tw"
OUTPUT_HTML = ROOT / "tools" / "twine" / "reader.html"
TWEEGO_BIN = ROOT / "tools" / "vendor" / "tweego" / "tweego.exe"
STORYFORMATS = ROOT / "tools" / "vendor" / "tweego" / "storyformats"
HEAD_HTML = ROOT / "tools" / "reader_head.html"

# Relative, not absolute ('/assets/...') -- reader.html lives at
# tools/twine/reader.html, so this is the disk-relative path from there to
# tools/story_editor/assets/. Relative paths mean the built reader can be
# opened directly off disk (file://) with images intact, with no server
# needed at all. Server-served access still works too: server.mjs serves
# this route at /tools/twine/reader.html specifically (not the shorter
# /reader, which just redirects there) so the URL's directory depth
# matches the file's real depth and this same relative path resolves to
# the server's /tools/story_editor/assets/ alias for ASSETS_DIR.
ASSET_PREFIX = "../story_editor/assets"

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)

# ---------------------------------------------------------------------------
# Portrait cues: whenever Cuntessa's mood or Tittiana's form changes from one
# paragraph to the next, insert that character's portrait before the
# paragraph where the change first shows up. Reuses the exact art already
# dropped into tools/story_editor/assets/portraits/<slug>/ for the editor's
# own portrait box (see resolvePortrait()/resolveTittianaPortrait() in
# tools/story_editor/server.mjs) -- served at build time via the same
# /assets/ route the editor already exposes, so this only resolves correctly
# when the reader is viewed through the server (http://localhost:8787/reader),
# same as the rest of the reader already assumes.
#
# These two lexicons are intentionally duplicated from server.mjs's
# EMOTION_LEXICON / TITTIANA_FORM_LEXICON rather than shared across the
# Node/Python boundary -- keep them in sync by hand if either changes.
PORTRAITS_DIR = ROOT / "tools" / "story_editor" / "assets" / "portraits"
SETTINGS_DIR = ROOT / "tools" / "story_editor" / "assets" / "backgrounds" / "settings"
PORTRAIT_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")

CUNTESSA_SLUG = "cuntessa_cuntswell"
EMOTION_LEXICON = {
    "angry": ["snarl", "seethe", "rage", "fury", "furious", "spat", "spit", "shaking with anger", "struck", "backhand", "shouted", "roared"],
    "sneer": ["sneer", "contempt", "beneath her", "disdain", "scorn", "curled her lip", "a look reserved for", "imperious", "command"],
    "amused": ["smirk", "amused", "chuckle", "laugh", "wry", "quirked", "dry amusement", "raised an eyebrow"],
    "sulky": ["pout", "pouted", "sulk", "sulky", "sulking", "petulant", "crossed her arms", "muttered sourly"],
    "afraid": ["afraid", "fear", "terror", "trembling", "flinched back", "eyes wide with fear", "dread", "cowered"],
    "pained": ["wince", "winced", "flinch", "flinched", "cried out in pain", "ached", "throbbed with pain", "hissed in pain", "gritted her teeth"],
    "aroused": ["wet", "ache", "aching", "breath caught", "hungry", "want", "hips", "flushed", "dripping", "moan"],
    "aroused_crying": ["tears slipping", "sobbed as she came", "crying out as", "overwhelmed, tears", "tears streaking"],
    "sad_crying": ["sob", "sobbing", "weep", "weeping", "tears", "cried", "crying", "choked back a sob"],
    "joy_crying": ["tears of joy", "laughing through tears", "overjoyed", "wept with relief", "happy tears"],
    "ahegao": ["eyes rolled back", "tongue lolling", "mindless with pleasure", "drooling", "fucked stupid", "utterly undone"],
}

TITTIANA_SLUG = "tittiana_titsworth"
TITTIANA_FORM_LEXICON = {
    "chimera": ["chimera", "all three", "natural state", "unbound", "binding thinned", "binding eased"],
    "wyvern": ["wyvern", "wings", "winged", "hind legs", "talons", "draconic", "leathery", "serpentine scaling", "scales"],
    "kitsune": ["kitsune", "muzzle", "fox ears", "vixen", "fangs", "tail flicked", "kitsune tail"],
}

# ---------------------------------------------------------------------------
# Scene backgrounds: each chapter gets the setting art from
# tools/story_editor/assets/backgrounds/settings/ (see
# SETTING_BACKGROUND_PROMPTS.md there) applied as a low-opacity, whole-page
# background for as long as that passage is showing -- see
# insert_scene_cue()/PassageHeader wiring below. A chapter's setting is
# resolved two ways, in order:
#   1. An explicit `scene: <setting-key>` frontmatter field (see
#      load_chapter()) -- always wins when present.
#   2. Automatic match against SCENE_BACKGROUNDS, keyed the same way
#      board.js's ARC_SETTINGS is (plot/arcs/*.md filename stems) -- works
#      whenever a chapter's own filename lines up with its arc-outline
#      counterpart once "arc_" is spliced back in after the leading number
#      (e.g. chapter "61.05_the_canid_litters_cost" <->
#      arc "61.05_arc_the_canid_litters_cost"). Most of the numbered
#      breeding-cycle chapters (61.xx/62.xx) line up this way; nothing else
#      does, since chapter numbering and plot/arcs/ numbering are otherwise
#      independent sequences. A chapter matching neither gets no scene
#      background -- silent no-op, same convention as everywhere else this
#      art is optional.
#
# This dict is intentionally duplicated from board.js's ARC_SETTINGS rather
# than shared across the Node/Python boundary -- keep the two in sync by
# hand if either changes, same policy as the EMOTION_LEXICON duplication
# above.
SCENE_BACKGROUNDS = {
    "05.50_arc_the_first_rut": "pens_yard",
    "05.60_arc_the_weaker_claim": "pens_yard",
    "05.80_arc_the_pretend_clothed": "pens_yard",
    "06.25_arc_the_bad_catch": "mundane_street",
    "07.40_arc_the_rotted_floor": "mundane_institution",
    "08.35_arc_the_rivals_dog": "pens_yard",
    "09_arc_the_manors_bite": "manor_bathing_wing",
    "10_arc_the_remembered_birth": "pens_burrow",
    "11_arc_the_hill_that_never_asked": "coven_hall",
    "12_arc_the_take": "mundane_street",
    "13_arc_the_easy_supply": "mundane_institution",
    "14_arc_the_wyvern_whole": "night_sky_cliffs",
    "15_arc_the_first_convert": "manor_grounds",
    "16_arc_the_channel_and_the_rim": "pens_quarters",
    "20_arc_the_practice_marks": "ritual_chamber",
    "21_arc_the_steadying_draught": "apothecary",
    "24.10_arc_the_gala_circuit": "gala_hall",
    "24.20_arc_second_reading": "gala_hall",
    "24.30_arc_the_first_slip": "gala_alcove",
    "24.40_arc_the_cleanup": "gala_washroom",
    "24.50_arc_second_skin": "gala_hall",
    "24.60_arc_the_serpents_charm": "gala_alcove",
    "24.65_arc_the_denied_request": "gala_alcove",
    "24.66_arc_the_referred_request": "gala_alcove",
    "24.70_arc_the_steady_hand": "gala_hall",
    "24.80_arc_last_gala_before_the_doorstep": "gala_hall",
    "31_arc_the_two_contracts": "manor_study",
    "40_arc_the_sleep_tenancy": "manor_bedroom",
    "41.20_arc_the_clitheroe_lessons": "law_office",
    "41_arc_the_proof": "manor_study",
    "42_arc_the_borrowed_hours": "manor_bedroom",
    "44.50_arc_the_unclad_pressing": "pens_stall",
    "44.70_arc_the_old_maids_price": "servant_quarters",
    "44_arc_the_folding_halfbreed": "mundane_institution",
    "45_arc_the_advance_grant": "manor_study",
    "46.50_arc_the_breakers_other_trade": "curse_breaker_workroom",
    "46_arc_cunts_idle_hour": "manor_grounds",
    "47_arc_the_shared_stall": "pens_stall",
    "48_arc_the_gushmere_stunt": "gushmere_slimepool",
    "49_arc_the_owed_kill": "mundane_street",
    "50_arc_the_sealed_shop": "gushmere_shopfronts",
    "51.50_arc_the_price_of_knowing": "ritual_chamber",
    "51_arc_the_second_anchor": "manor_study",
    "52_arc_the_two_circles": "mundane_street",
    "53_arc_the_unread_binding": "curse_breaker_workroom",
    "54_arc_the_waking_house": "manor_exterior_night",
    "55.50_arc_the_short_yield": "pens_burrow",
    "55_arc_an_ordinary_tuesday": "manor_hearth",
    "56_arc_off_hours": "manor_hearth",
    "57_arc_the_shared_hearth": "manor_hearth",
    "58.30_arc_milfs_inscription": "ritual_chamber",
    "58.60_arc_milfs_dealing": "gushmere_boards",
    "58_arc_undedicated_understanding": "curse_breaker_workroom",
    "59.10_arc_working_the_old_ground": "mundane_street",
    "59.20_arc_sport_pet": "arena_pit",
    "59.30_arc_show_pet": "noble_estate_hall",
    "59.40_arc_parlour_pet_lent_out": "manor_hearth",
    "59.50_arc_the_draught": "apothecary",
    "59.60_arc_the_bad_ground": "forest_trail",
    "59.70_arc_the_hunt_masters_due": "forest_trail",
    "59.80_arc_the_crews_custom": "mundane_institution",
    "59.90_arc_the_bestiary_detail": "pens_yard",
    "59_arc_the_long_con": "mundane_street",
    "60_arc_the_terms_end": "servant_quarters",
    "61.05_arc_the_canid_litters_cost": "pens_burrow",
    "61.10_arc_the_serpentine_arrangement": "noble_estate_hall",
    "61.15_arc_the_clutchs_reckoning": "gestation_serpentine",
    "61.20_arc_the_drakes_due": "arena_pit",
    "61.25_arc_the_pit_that_didnt_hold": "gestation_drake",
    "61.30_arc_the_giants_weight": "noble_estate_hall",
    "61.35_arc_the_weight_she_carried": "gestation_giant",
    "61.405_arc_what_the_roost_kept": "wind_roost",
    "61.40_arc_the_quiet_pairing": "pens_yard",
    "61.415_arc_what_the_current_took": "underwater_cave",
    "61.41_arc_the_underdock_arrangement": "underdock_water",
    "61.425_arc_the_den_she_defended": "gestation_direwolf",
    "61.42_arc_the_wrackholt_den": "gestation_feline",
    "61.435_arc_the_favor_settled": "pens_yard",
    "61.43_arc_the_wrenmoor_favor": "gestation_feline",
    "61.445_arc_the_first_stand": "open_field",
    "61.44_arc_the_stable_arrangement": "pens_stall",
    "61.455_arc_the_ash_that_settled": "pens_forge",
    "61.45_arc_the_forge_pairing": "pens_forge",
    "61.465_arc_the_web_that_thinned": "gestation_arachnid",
    "61.46_arc_the_web_chamber": "gestation_arachnid",
    "61.475_arc_the_venom_that_told_her": "gestation_doxy",
    "61.48_arc_the_stud_she_became": "pens_stall",
    "61.495_arc_concentrating_the_line": "manor_study",
    "61.49_arc_the_pens_own_nerve": "pens_yard",
    "61.50_arc_the_ordinary_consignment": "rendering_room",
    "61.51_arc_the_commission": "rendering_room",
    "61.52_arc_the_full_render": "rendering_room",
    "61.60_arc_the_open_board": "auction_block",
    "61.65_arc_favors_of_any_kind": "gushmere_boards",
    "61.70_arc_the_blood_tier_card": "arena_pit",
    "61.80_arc_the_walk_in": "mundane_street",
    "61.85_arc_the_ambush_on_the_lowroad": "lowroad_ambush",
    "61.90_arc_the_wrackholt_lesson": "breeding_house_floor",
    "61_arc_lord_ashgroves_kennel": "breeding_house_floor",
    "62.01_arc_raising_the_serpentine_clutch": "nursery_serpentine",
    "62.02_arc_raising_the_draconic_hatchling": "nursery_draconic",
    "62.03_arc_raising_the_giants_line": "nursery_giant",
    "62.04_arc_raising_the_avian_fledgling": "nursery_avian",
    "62.05_arc_raising_the_aquatic_brood": "nursery_aquatic",
    "62.06_arc_raising_the_direwolf_pup": "nursery_direwolf",
    "62.07_arc_raising_the_feline_kit": "nursery_feline",
    "62.08_arc_raising_the_equine_foal": "nursery_equine",
    "62.09_arc_raising_the_infernal_cub": "nursery_infernal",
    "62.10_arc_raising_the_arachnid_brood": "nursery_arachnid",
    "62.11_arc_raising_the_insectoid_brood": "nursery_insectoid",
    "62_arc_raising_the_canid_litter": "nursery_canid",
    "63.50_arc_the_favor_returned": "gala_alcove",
    "63_arc_claiming_fuxannas_patronage": "gala_alcove",
    "99_arc_death's_omen_halfbreed": "rival_wilds",
}

_ARC_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)?)_(.*)$")


# Chapters whose resolved scene key had no art on disk, collected across the
# whole build so main() can report them as one summary line rather than a
# warning buried per-chapter in the middle of the run.
_UNRESOLVED_SCENES: list[tuple[str, str]] = []


def _scene_key_for_chapter(chapter_slug: str, explicit_scene: str | None):
    key = explicit_scene
    if key is None:
        m = _ARC_NUMBER_RE.match(chapter_slug)
        if not m:
            return None
        key = SCENE_BACKGROUNDS.get(f"{m.group(1)}_arc_{m.group(2)}")
        if key is None:
            return None
    # A key that names art which was never drawn has to degrade to the same
    # no-op an unmatched chapter already gets. Emitting it anyway put a
    # broken-image icon in the scene cue and a dead url() in --scene-bg, and
    # nothing downstream noticed: build_twine.py exited 0 and only the
    # standalone builder mentioned it, as a stderr line nobody reads.
    if not (SETTINGS_DIR / f"{key}.jpg").exists():
        _UNRESOLVED_SCENES.append((chapter_slug, key))
        return None
    return key


def _score(text_lower: str, lexicon: dict) -> dict:
    scores = {}
    for key, words in lexicon.items():
        n = sum(len(re.findall(re.escape(w), text_lower)) for w in words)
        if n:
            scores[key] = n
    return scores


def _top(scores: dict):
    return max(scores.items(), key=lambda kv: kv[1])[0] if scores else None


def _find_portrait(slug: str, base_no_ext: str):
    """base_no_ext is the bare filename (no slug prefix) for Cuntessa's
    emotion files, or slug_form for Tittiana's -- matches the two different
    on-disk naming conventions findAssetFile() already has to handle in
    server.mjs."""
    d = PORTRAITS_DIR / slug
    for ext in PORTRAIT_IMAGE_EXTS:
        p = d / f"{base_no_ext}{ext}"
        if p.exists():
            return f"{ASSET_PREFIX}/portraits/{slug}/{base_no_ext}{ext}"
    return None


def _portrait_cue_html(character: str, css_class: str, url: str, label: str) -> str:
    return (
        f'<div class="portrait-cue {css_class}">'
        f'<img src="{url}" alt="{character} — {label}">'
        f"</div>"
    )


def insert_portrait_cues(paragraphs: list) -> list:
    """Given already-sc_escape()'d paragraphs (in original order), returns a
    new list with a portrait-cue <div> inserted before whichever paragraph
    first shows a change in Cuntessa's mood or Tittiana's form, tracked as
    two independent running states across the whole chapter. A paragraph
    with no scoring signal for a character leaves that character's state
    exactly where it was -- silence isn't a "change to neutral"."""
    out = []
    mood_state = None
    form_state = None
    for escaped_para, raw_para in paragraphs:
        lower = raw_para.lower()

        mood_scores = _score(lower, EMOTION_LEXICON)
        new_mood = _top(mood_scores)
        if new_mood and new_mood != mood_state:
            url = _find_portrait(CUNTESSA_SLUG, new_mood) or _find_portrait(CUNTESSA_SLUG, "neutral")
            if url:
                out.append(_portrait_cue_html("Cuntessa", "portrait-cuntessa", url, new_mood))
            mood_state = new_mood

        form_scores = _score(lower, TITTIANA_FORM_LEXICON)
        new_form = _top(form_scores)
        if new_form and new_form != form_state:
            url = _find_portrait(TITTIANA_SLUG, f"{TITTIANA_SLUG}_{new_form}")
            if url:
                out.append(_portrait_cue_html("Tittiana", "portrait-tittiana", url, new_form))
            form_state = new_form

        out.append(escaped_para)
    return out


def sc_escape(text: str) -> str:
    """Escape sequences that SugarCube/Harlowe markup would otherwise interpret.

    Inline `<span class="subtext" data-subtext="...">...</span>` tags are left
    alone (they don't contain any of the escaped tokens) so they pass through
    as raw HTML.
    """
    text = text.replace("\\", "\\\\")
    for token in ("<<", ">>", "[[", "]]", "//", "''", "^^", "~~", "==="):
        text = text.replace(token, "\\" + token)
    return text


def parse_frontmatter(raw: str):
    meta = {}
    m = FRONTMATTER_RE.match(raw)
    body = raw
    if m:
        body = raw[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line:
                key, _, val = line.partition(":")
                meta[key.strip()] = val.strip()
    return meta, body


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_")
    return slug or "chapter"




def load_chapter(path: Path):
    raw = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)

    title_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    title = meta.get("title") or (title_match.group(1).strip() if title_match else path.stem)
    body = re.sub(r"^#\s+.+\n", "", body, count=1, flags=re.MULTILINE) if title_match else body

    order = meta.get("order")
    order = float(order) if order is not None else None

    reading_order_raw = meta.get("reading_order", "").strip()
    reading_order_simple_match = re.fullmatch(r"(\d+(?:\.\d+)?)", reading_order_raw) if reading_order_raw else None
    if reading_order_simple_match:
        reading_order = f"#{reading_order_simple_match.group(1)}"
    elif reading_order_raw:
        # Non-numeric or multi-instance value (e.g. a card reused at more than one point in the
        # reading order via different delivery channels) -- keep the full note rather than
        # silently collapsing it to the first number.
        reading_order = reading_order_raw
    else:
        reading_order = None

    # The story is told non-linearly (in media res, with flashbacks/anachronies) -- the reader
    # must be walked through it in the order the *narrative* reveals things, per `reading_order`,
    # not the in-world chronological `order` field and not grouped by `arc`. Take the first
    # number out of reading_order_raw (handles both a bare "4" and a multi-instance note like
    # "3, and again ~The Amendment") as the sort key; a chapter with no reading_order at all
    # falls back to `order` so it doesn't vanish from the sequence, and only truly unplaced
    # chapters sink to the end.
    reading_order_number_match = re.search(r"\d+(?:\.\d+)?", reading_order_raw) if reading_order_raw else None
    if reading_order_number_match:
        reading_order_sort = float(reading_order_number_match.group(0))
    elif order is not None:
        reading_order_sort = order
    else:
        reading_order_sort = float("inf")

    blurb = meta.get("blurb", "").strip()
    if blurb.startswith('"') and blurb.endswith('"') and len(blurb) >= 2:
        blurb = blurb[1:-1]

    slug = slugify(path.stem)
    scene = _scene_key_for_chapter(slug, meta.get("scene", "").strip() or None)

    return {
        "path": path,
        "slug": slug,
        "title": title,
        "arc": meta.get("arc", ""),
        "blurb": blurb,
        "order": order,
        "reading_order": reading_order,
        "reading_order_sort": reading_order_sort,
        "status": meta.get("status", "").strip() or "written",
        "body": body.strip(),
        "scene": scene,
    }


def render_passage_body(chapter) -> str:
    # Split on blank lines (this corpus's paragraph convention), escape each
    # paragraph independently, then interleave portrait-cue <div>s -- raw
    # HTML that must NOT go through sc_escape, unlike the prose around it.
    raw_paragraphs = re.split(r"\n\s*\n", chapter["body"])
    pairs = [(sc_escape(p), p) for p in raw_paragraphs if p.strip()]
    pieces = insert_portrait_cues(pairs)
    return "\n\n".join(pieces)


def build_twee(chapters) -> str:
    out = []

    out.append(
        ":: StoryData\n"
        "{\n"
        '  "ifid": "9C6F6C10-6B0C-4E5B-9B0A-2C6C8B5B7A11",\n'
        '  "format": "SugarCube",\n'
        '  "format-version": "2.36.1",\n'
        '  "start": "Table of Contents"\n'
        "}\n"
    )

    out.append(":: StoryTitle\nCuntessa Cuntswell & Tittiana Titsworth — Chapter Reader\n")

    out.append(
        ":: PassageHeader\n"
        '<div class="reader-bar">\n'
        "[[≡ Table of Contents->Table of Contents]]\n"
        "</div>\n"
        "----\n"
        "<<script>>\n"
        "  var _tags = Story.get(State.passage).tags || [];\n"
        "  var _sceneTag = _tags.find(function (t) { return t.indexOf('scene-') === 0; });\n"
        "  if (_sceneTag) {\n"
        f"    document.body.style.setProperty('--scene-bg', \"url('{ASSET_PREFIX}/backgrounds/settings/\" + _sceneTag.slice(6) + \".jpg')\");\n"
        "    document.body.classList.add('has-scene-bg');\n"
        "  } else {\n"
        "    document.body.style.removeProperty('--scene-bg');\n"
        "    document.body.classList.remove('has-scene-bg');\n"
        "  }\n"
        "<</script>>\n"
    )

    out.append(
        ":: StoryCaption\n"
        "Cuntessa Cuntswell & Tittiana Titsworth — Chapter Reader\n"
    )

    # SugarCube's own UI bar (the sidebar with Saves/Settings/Restart/
    # Restore) picks up anything in this special passage as extra links
    # under its Story menu -- this is the one place a link can live
    # without being embedded in page content, so it's where "exit" goes.
    # window.close() only actually closes a window JS opened (true for
    # this reader when reached via the editor/storyboard's window.open()
    # calls, or the Electron popup path); a reader opened as a normal
    # top-level browser tab can't be closed by script, so this falls back
    # to sending it back to the table of contents instead of doing nothing.
    out.append(
        ":: StoryMenu\n"
        '<<link "Exit">>\n'
        "  <<script>>\n"
        "    if (window.opener || (window.WINDOW_KIND && window.name)) { window.close(); }\n"
        "    else { Engine.play('Table of Contents'); }\n"
        "  <</script>>\n"
        "<</link>>\n"
    )

    # The reader walks the story in narrative order (in media res, flashbacks and anachronies
    # included) -- chapters arrive here already sorted by `reading_order_sort` (see load_chapter),
    # not by in-world chronological `order` and not bucketed by `arc`. One flat sequence, arc kept
    # only as a small per-card label so the setting/thread is still legible without regrouping the
    # list around it.
    toc_parts = [
        '<div class="toc-intro">',
        "<h1>Cuntessa Cuntswell &amp; Tittiana Titsworth</h1>",
        '<p class="toc-tagline">A chapter reader, in the order the story tells itself -- not '
        "chronological order. Phrases with a dotted underline carry hidden subtext — hover to "
        "read it.</p>",
        "</div>",
        '<div class="card-grid">',
    ]

    for ch in chapters:
        blurb_html = f'<p class="card-blurb">{ch["blurb"]}</p>' if ch["blurb"] else ""
        card_class = "chapter-card" if ch["status"] == "outline" else "chapter-card chapter-card-written"
        arc_html = f'<span class="card-arc">{sc_escape(ch["arc"])}</span>' if ch["arc"] else ""
        reading_order_html = (
            f'<span class="card-reading-order">Read {sc_escape(ch["reading_order"])}</span>'
            if ch["reading_order"] is not None
            else ""
        )
        # Same setting art the storyboard shows on its arc nodes (see
        # board.js's --arc-bg), applied the same way here: a low-
        # opacity ::before layer set via inline custom property, so a
        # chapter card in the table of contents reads as the same
        # place as its node on the board.
        card_style = f' style="--card-bg:url(\'{ASSET_PREFIX}/backgrounds/settings/{ch["scene"]}.jpg\')"' if ch["scene"] else ""
        toc_parts.append(
            f'<div class="{card_class}"{card_style}>\n'
            f'<h3 class="card-title">[[{sc_escape(ch["title"])}->{ch["slug"]}]]</h3>\n'
            f"{reading_order_html}\n"
            f"{arc_html}\n"
            f"{blurb_html}\n"
            "</div>"
        )
    toc_parts.append("</div>")

    out.append(":: Table of Contents\n" + "\n".join(toc_parts))

    for i, ch in enumerate(chapters):
        body = render_passage_body(ch)
        prev_ch = chapters[i - 1] if i > 0 else None
        next_ch = chapters[i + 1] if i < len(chapters) - 1 else None

        nav_parts = ['<div class="chapter-nav">']
        if prev_ch:
            nav_parts.append(f'[[‹ {sc_escape(prev_ch["title"])}->{prev_ch["slug"]}]]')
        else:
            nav_parts.append('<span class="nav-spacer"></span>')
        if next_ch:
            nav_parts.append(f'[[{sc_escape(next_ch["title"])} ›->{next_ch["slug"]}]]')
        else:
            nav_parts.append('<span class="nav-spacer"></span>')
        nav_parts.append("</div>")
        nav_html = "\n".join(nav_parts)

        arc_label = f'<p class="arc-label">{ch["arc"]}</p>' if ch["arc"] else ""
        reading_order_label = (
            f'<p class="reading-order-label">Intended reading order: {sc_escape(ch["reading_order"])}</p>'
            if ch["reading_order"] is not None
            else ""
        )
        # Inline scene-cue: same treatment as a portrait cue (see
        # insert_portrait_cues), but only shown when the scene actually
        # changed from the immediately-preceding chapter in reading order --
        # a chapter that opens in the same place the last one ended doesn't
        # need to re-announce it.
        scene_changed = ch["scene"] and (not prev_ch or prev_ch["scene"] != ch["scene"])
        scene_cue = (
            f'<div class="scene-cue"><img src="{ASSET_PREFIX}/backgrounds/settings/{ch["scene"]}.jpg" '
            f'alt="Scene: {ch["scene"]}"></div>\n'
            if scene_changed else ""
        )
        tag = f' [scene-{ch["scene"]}]' if ch["scene"] else ""
        out.append(
            f':: {ch["slug"]}{tag}\n'
            f"{arc_label}\n"
            f"{reading_order_label}\n"
            f'! {sc_escape(ch["title"])}\n\n'
            f"{scene_cue}"
            f"{body}\n\n"
            f"{nav_html}\n"
        )

    return "\n\n".join(out) + "\n"


def main():
    if not CHAPTERS_DIR.exists():
        print(f"No chapters directory at {CHAPTERS_DIR}", file=sys.stderr)
        sys.exit(1)

    chapters = [load_chapter(p) for p in sorted(CHAPTERS_DIR.glob("*.md"))]
    # Sort by narrative reading order, not in-world chronological order -- see the
    # reading_order_sort comment in load_chapter for why.
    chapters.sort(key=lambda c: (c["reading_order_sort"], c["path"].name))

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    twee_source = build_twee(chapters)
    TWEE_PATH.write_text(twee_source, encoding="utf-8")
    print(f"Wrote {TWEE_PATH} ({len(chapters)} chapters)")

    if _UNRESOLVED_SCENES:
        print(
            f"{len(_UNRESOLVED_SCENES)} chapter(s) had an unresolved scene key "
            f"(no art in {SETTINGS_DIR.name}/) and render with no scene background:",
            file=sys.stderr,
        )
        for slug, key in sorted(_UNRESOLVED_SCENES):
            print(f"  {slug}: scene '{key}' -> {key}.jpg missing", file=sys.stderr)

    if not TWEEGO_BIN.exists():
        print(f"Tweego binary not found at {TWEEGO_BIN}; skipping HTML build.", file=sys.stderr)
        sys.exit(0)

    # Tweego auto-discovers story formats in a "storyformats" dir next to the binary.
    cmd = [
        str(TWEEGO_BIN),
        "-f", "sugarcube-2",
        "-o", str(OUTPUT_HTML),
    ]
    if HEAD_HTML.exists():
        cmd += ["--head", str(HEAD_HTML)]
    cmd += [str(BUILD_DIR)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    print(f"Built {OUTPUT_HTML}")


if __name__ == "__main__":
    main()
