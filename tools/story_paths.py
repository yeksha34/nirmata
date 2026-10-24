"""Shared helper: which stories/<name>/ tree is the active story's content root.

Multiple stories can live side by side under stories/<name>/ (see
.agents/skills/world-lint/driver.mjs, which owns the same pointer file
and is the source of truth the story editor's UI writes to). This module just
reads that same stories/.active_story.json so every tool script here — build,
compaction, splitting — points at whichever story is actually active instead
of a path that predates the multi-story split.
"""
import json
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _resolve_worlds_dir():
    """Worlds live in <repo>/worlds/<name>/. WORLDS_DIR (or the legacy
    STORIES_ROOT, whose `stories/` subfolder is used) points at an external
    checkout instead."""
    env_dir = os.environ.get("WORLDS_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    env_root = os.environ.get("STORIES_ROOT")
    if env_root:
        return Path(env_root).resolve() / "stories"
    return REPO_ROOT / "worlds"


STORIES_DIR = _resolve_worlds_dir()
ACTIVE_STORY_PATH = STORIES_DIR / ".active_story.json"
DEFAULT_STORY = "example-world"


def list_stories():
    if not STORIES_DIR.is_dir():
        return []
    return sorted(p.name for p in STORIES_DIR.iterdir() if p.is_dir() and not p.name.startswith((".", "_")))


def active_story_name():
    try:
        saved = json.loads(ACTIVE_STORY_PATH.read_text(encoding="utf-8")).get("name")
        if saved and saved in list_stories():
            return saved
    except (OSError, ValueError):
        pass
    stories = list_stories()
    if DEFAULT_STORY in stories:
        return DEFAULT_STORY
    return stories[0] if stories else DEFAULT_STORY


def story_root():
    """The active story's own root -- falls back to REPO_ROOT itself if
    stories/ doesn't exist at all (a pre-multi-story checkout), same
    fallback driver.mjs uses."""
    candidate = STORIES_DIR / active_story_name()
    return candidate if candidate.is_dir() else REPO_ROOT
