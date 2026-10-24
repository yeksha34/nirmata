#!/usr/bin/env python3
"""Classify each rule file's scope: does it apply to prose (chapters), to
cards (arc/character/lore/plot cards), or both?

Why this matters: a rule like `00_story_progression.md` is explicitly about
how to write chapter prose -- checking a lore/character/arc card against it
is a category error, not a useful gate. Treating every always_on rule as
applicable to every kind of content (the previous behavior) produces false
positives on card checks.

Heuristic, content-based, no embeddings: count occurrences of prose-scope
vocabulary (chapter, prose, narrative, dialogue, scene, paragraph) vs
cards-scope vocabulary (card, arc, lore, character sheet, plot card) in
each rule's body text (frontmatter excluded). Whichever count dominates
wins; if both appear meaningfully, or neither does, the rule is scoped to
both -- the safe default, since under-scoping (checking a card against a
rule that doesn't really apply) is a wasted call, but over-scoping (never
checking a card against a rule that DOES apply) is a missed rejection.

Usage:
  STORIES_ROOT=/path/to/stories-repo python data/classify_scope.py --out data/rule_scopes.json
"""
import argparse
import json
import os
import re
from pathlib import Path

from build_dataset import find_rule_files, parse_card

PROSE_TERMS = [
    r"\bchapter\b", r"\bchapters\b", r"\bprose\b", r"\bnarrative\b",
    r"\bdialogue\b", r"\bscene\b", r"\bparagraph\b", r"\bwriting a chapter\b",
]
CARDS_TERMS = [
    r"\bcard\b", r"\bcards\b", r"\barc card\b", r"\bcharacter card\b",
    r"\block card\b", r"\bplot card\b", r"\bcharacter sheet\b",
]

# A count ratio below this is "not meaningfully present" -- a single
# incidental mention (e.g. "canon_bias_card_01.md" referencing its own
# filename) shouldn't tip a rule into a scope it isn't really about.
MIN_HITS = 2


SELF_REFERENCE_RE = re.compile(r"\bthis card\b|\bcard\s*\d+\b", re.IGNORECASE)


def count_hits(text: str, patterns: list) -> int:
    # Every rule file IS itself a "card" in this repo's own terminology, so
    # "this card defines..." is near-universal self-reference, not a
    # signal that the rule applies to story cards (arc/character/lore).
    # Strip that phrase before counting, or a rule with zero real
    # cards-scope content (like 00_story_progression.md, which is
    # explicitly prose-only) gets misclassified as "both" on the strength
    # of its own opening sentence.
    text = SELF_REFERENCE_RE.sub("", text)
    return sum(len(re.findall(p, text, re.IGNORECASE)) for p in patterns)


HEADING_LINE_RE = re.compile(r"^#[^\n]*\n?", re.MULTILINE)


def classify(card: dict) -> dict:
    # Strip the H1 heading before counting -- this repo's own rule-card
    # naming scheme puts "Card NN" in nearly every title (e.g. "Canon Bias
    # Card 09"), which would otherwise count as a cards-scope signal on
    # every single rule regardless of what the rule is actually about.
    body = HEADING_LINE_RE.sub("", card["body"], count=1)
    prose_hits = count_hits(body, PROSE_TERMS)
    cards_hits = count_hits(body, CARDS_TERMS)
    prose_strong = prose_hits >= MIN_HITS
    cards_strong = cards_hits >= MIN_HITS
    if prose_strong and not cards_strong:
        scope = "prose"
    elif cards_strong and not prose_strong:
        scope = "cards"
    else:
        scope = "both"
    return {"scope": scope, "prose_hits": prose_hits, "cards_hits": cards_hits}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stories-root", default=os.environ.get("STORIES_ROOT"))
    ap.add_argument("--out", default="data/rule_scopes.json")
    args = ap.parse_args()
    if not args.stories_root:
        raise SystemExit("Set --stories-root or STORIES_ROOT")

    stories_root = Path(args.stories_root)
    files = find_rule_files(stories_root)

    out = {}
    counts = {"prose": 0, "cards": 0, "both": 0}
    for f in files:
        card = parse_card(f)
        rel = str(f.relative_to(stories_root)).replace("\\", "/")
        result = classify(card)
        out[rel] = result
        counts[result["scope"]] += 1

    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Classified {len(files)} rule files -> {args.out}")
    print(f"prose: {counts['prose']}, cards: {counts['cards']}, both: {counts['both']}")


if __name__ == "__main__":
    main()
