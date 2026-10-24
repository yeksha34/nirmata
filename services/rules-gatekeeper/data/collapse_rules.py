#!/usr/bin/env python3
"""Cluster the 87 rule files into groups of genuinely redundant rules
before training one model per group -- deliberately biased toward small,
atomic groups over few, large ones.

Correlation signal is cheap, local, and content-based only:
  Shared `keywords:` frontmatter tokens (Jaccard similarity) between two
  files, merged as a direct pairwise pair -- never transitively chained,
  and never into a group that already has a partner, so no group can grow
  past 2 files. This also means a filename-prefix family (e.g. all
  `explicit_lexicon_NN_*.md` split cards) is NOT auto-merged just because
  the files share a hub name: measured against the real corpus, that
  convention regularly groups genuinely distinct topics under one prefix
  (explicit_lexicon's 16 split cards cover female anatomy, male anatomy,
  nonhuman anatomy, fluids, acts... -- different atomic rules, not
  redundant copies of one rule) and produced a group too large to check on
  CPU-only hardware in reasonable time. Splitting those back into atomic
  per-file groups is the fix, not capping a merge that shouldn't happen.

Output is data/rule_groups.json: [{slug, title, rules: [source_rule, ...]}, ...].
"""
import argparse
import json
import os
import re
from pathlib import Path

from build_dataset import find_rule_files, parse_card  # same repo, same rules-only source
from classify_scope import classify as classify_scope


def keyword_set(card: dict) -> set:
    kw = card["frontmatter"]
    m = re.search(r"^keywords:\s*(.*)$", kw, re.MULTILINE)
    if not m:
        return set()
    return {w.strip().lower() for w in m.group(1).split(",") if w.strip()}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "rule"


# Filenames matching this are never eligible for an automatic merge,
# regardless of keyword similarity -- found by testing: two files whose
# `keywords:` frontmatter was both the single generic word "Relations"
# (chapter_prose_and_subtext_04_relations.md and
# humanoid_offspring_and_minors_04_relations.md) scored a perfect Jaccard
# match and merged, despite being completely unrelated content. A single
# shared generic word is not a reliable enough signal to risk diluting a
# minors-safety rule into an unrelated group, so these are hard-excluded
# rather than left to the similarity threshold.
SAFETY_SENSITIVE_RE = re.compile(r"minor|offspring|child", re.IGNORECASE)


def is_safety_sensitive(path: Path) -> bool:
    return bool(SAFETY_SENSITIVE_RE.search(path.name))


# Mirrors story-editor/server.mjs's UNIVERSAL_RULE_RE -- the safety/canon
# rules that must apply unconditionally regardless of scope. Found by
# testing: humanoid_offspring_and_minors_02_minors_carry_zero_sexual_
# connotation.md (a minors-safety rule) classified as scope=prose because
# its body happens to say "the prose" generically, not because it actually
# excludes cards -- classify_scope.py has no way to know the difference
# between "prose" used as an example of written text and "prose" used to
# deliberately restrict scope. Rather than trust that heuristic on the
# rules where getting it wrong is most costly, these are always forced to
# "both" regardless of what classify_scope concluded for their body text.
NEVER_PROSE_ONLY_RE = re.compile(
    r"^(canon_bias_card_|content_boundaries|content-boundaries|"
    r"humanoid_offspring_and_minors|humanoid-offspring-and-minors|"
    r"dark-fantasy|chapters-archive-off-limits)"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stories-root", default=os.environ.get("STORIES_ROOT"))
    ap.add_argument("--out", default="data/rule_groups.json")
    ap.add_argument("--keyword-threshold", type=float, default=0.5,
                     help="Jaccard similarity above which two rules' keyword sets are treated as the same concern")
    args = ap.parse_args()
    if not args.stories_root:
        raise SystemExit("Set --stories-root or STORIES_ROOT")

    stories_root = Path(args.stories_root)
    files = find_rule_files(stories_root)
    cards = [(f, parse_card(f)) for f in files]

    # Every file starts as its own atomic group. A merge is a direct,
    # non-transitive pairwise decision: once a file has a partner, neither
    # side is eligible for another merge, so no group can exceed 2 files
    # and a single shared keyword can never chain unrelated rules together
    # (the bug the previous prefix-based version hit: a minors-safety rule
    # transitively merging into an unrelated prose-formatting group).
    parent = list(range(len(cards)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def group_size(root):
        return sum(1 for i in range(len(cards)) if find(i) == root)

    kwsets = [keyword_set(c) for _, c in cards]
    safety_sensitive = [is_safety_sensitive(f) for f, _ in cards]
    for i in range(len(cards)):
        for j in range(i + 1, len(cards)):
            ri, rj = find(i), find(j)
            if ri == rj:
                continue
            if group_size(ri) != 1 or group_size(rj) != 1:
                continue
            if safety_sensitive[i] or safety_sensitive[j]:
                continue
            # Require at least 2 shared-vocabulary keywords on each side --
            # a single shared word (often a generic one like "Relations")
            # produces a perfect Jaccard score between otherwise unrelated
            # files, which is exactly the false-positive merge this whole
            # script exists to avoid.
            if len(kwsets[i]) < 2 or len(kwsets[j]) < 2:
                continue
            if jaccard(kwsets[i], kwsets[j]) >= args.keyword_threshold:
                parent[ri] = rj

    groups = {}
    for i, (f, card) in enumerate(cards):
        root = find(i)
        rel = str(f.relative_to(stories_root)).replace("\\", "/")
        entry = groups.setdefault(root, {"title": card["title"], "rules": [], "scopes": []})
        entry["rules"].append(rel)
        entry["scopes"].append(classify_scope(card)["scope"])

    out = []
    for g in groups.values():
        slug = slugify(g["title"])
        # A group's scope is its members' scope if they agree; a mixed
        # group (only possible for a 2-file merge) falls back to "both" --
        # under-scoping would silently skip a rule that does apply.
        distinct = set(g["scopes"])
        scope = distinct.pop() if len(distinct) == 1 else "both"
        if scope != "both" and any(NEVER_PROSE_ONLY_RE.match(Path(r).name) for r in g["rules"]):
            scope = "both"
        out.append({"slug": slug, "title": g["title"], "rules": sorted(g["rules"]), "scope": scope})
    out.sort(key=lambda g: g["slug"])

    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    max_size = max((len(g["rules"]) for g in out), default=0)
    multi = [g for g in out if len(g["rules"]) > 1]
    print(f"{len(cards)} rule files collapsed into {len(out)} groups -> {args.out}")
    print(f"{len(multi)} groups merged a genuinely redundant pair; max group size {max_size}")


if __name__ == "__main__":
    main()
