#!/usr/bin/env python3
"""
Splits each always_on rule file in .agents/rules/ into individually
linkable flat per-section cards, directly in .agents/rules/ — matching
the convention already established there for canon_bias_cards.md and
explicit-lexicon.md (canon_bias_card_01.md, explicit_lexicon_01_*.md):
flat files, underscore-separated names, `trigger: always_on` + a
`keywords:` frontmatter line, one topic per file.

Non-destructive for files that still have real corpus cross-references
to their monolithic filename (checked automatically): the original
.agents/rules/<basename>.md is left in place unless it has zero
external references, in which case it's redundant with its own split
cards and is removed (matching the precedent). No content is omitted or
reworded — every split card is the original ## section's heading and
body, verbatim, with only its internal relative links rewritten to
still resolve from the new (flat, same-directory) location.

Usage: python tools/split_rules.py
"""
import os
import re
import subprocess
from pathlib import Path

from story_paths import story_root

ROOT = Path(__file__).resolve().parent.parent
CONTENT_ROOT = story_root()  # active stories/<name>/ tree -- see story_paths.py
RULES_DIR = CONTENT_ROOT / ".agents" / "rules"

ALWAYS_ON_RE = re.compile(r"^trigger:\s*always_on\s*$", re.MULTILINE)
H1_RE = re.compile(r"^# (.+)$", re.MULTILINE)
H2_SPLIT_RE = re.compile(r"^(## .+)$", re.MULTILINE)
LINK_RE = re.compile(r'(?<!!)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)')

# Files already split by hand into flat cards under a different scheme —
# skip them, don't re-split or touch their (already-deleted) originals.
ALREADY_SPLIT = {"canon_bias_cards.md", "explicit-lexicon.md"}


def slugify(heading: str) -> str:
    s = heading.strip().lower()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    return s or "section"


def keywords_for(heading: str) -> str:
    # Cheap, non-inventive keyword line: the heading's own clauses.
    parts = re.split(r",| and ", heading.strip().strip("*"))
    return ", ".join(p.strip().rstrip(".") for p in parts if p.strip())[:200]


def rewrite_links(text: str) -> str:
    """Split cards live in the same directory (.agents/rules/) as the
    originals did, so relative link targets don't need re-basing — this
    only normalizes 'link points at the file we just deleted' cases by
    leaving them as-is; corpus-wide reference fixing is handled
    separately, not by this script."""
    return text


def referenced_elsewhere(basename: str) -> bool:
    """True if any .md file other than this rule's own split cards still
    links to the monolithic filename by name — including other rule
    files (rule-to-rule cross-references are real references too)."""
    try:
        out = subprocess.run(
            ["git", "grep", "-l", "-F", basename, "--", "*.md"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        ).stdout
    except FileNotFoundError:
        out = ""
    own_prefix = f".agents/rules/{basename[:-3].replace('-', '_')}_"
    hits = [
        l for l in out.splitlines()
        if l != f".agents/rules/{basename}" and not l.startswith(own_prefix)
    ]
    return len(hits) > 0


def split_file(path: Path):
    if path.name in ALREADY_SPLIT:
        return None
    text = path.read_text(encoding="utf-8")
    if not ALWAYS_ON_RE.search(text):
        return None
    h1_match = H1_RE.search(text)
    title = h1_match.group(1).strip() if h1_match else path.stem

    body = text[h1_match.end():] if h1_match else text
    pieces = H2_SPLIT_RE.split(body)
    sections = []
    for i in range(1, len(pieces), 2):
        heading_line = pieces[i].strip()
        content = pieces[i + 1] if i + 1 < len(pieces) else ""
        sections.append((heading_line, content.rstrip() + "\n"))

    if not sections:
        return None  # nothing to split (e.g. dark-fantasy.md has no ## headings)

    basename = path.stem
    prefix = basename.replace("-", "_")
    written = []
    for n, (heading_line, content) in enumerate(sections, start=1):
        heading_text = heading_line[3:].strip()
        slug = slugify(heading_text).replace("-", "_")
        fname = f"{prefix}_{n:02d}_{slug}.md"
        card_path = RULES_DIR / fname
        card_text = (
            "---\n"
            "trigger: always_on\n"
            f"keywords: {keywords_for(heading_text)}\n"
            "---\n\n"
            f"# {title} — {heading_text}\n\n"
            f"{rewrite_links(heading_line)}\n"
            f"{rewrite_links(content)}"
        )
        card_path.write_text(card_text, encoding="utf-8")
        written.append(fname)

    kept_original = True
    if not referenced_elsewhere(path.name):
        path.unlink()
        kept_original = False

    return basename, written, kept_original


def main():
    results = []
    for path in sorted(RULES_DIR.glob("*.md")):
        r = split_file(path)
        if r:
            results.append(r)
    for basename, written, kept_original in results:
        status = "original kept (still linked)" if kept_original else "original removed (no external links)"
        print(f"{basename}.md -> {len(written)} cards, {status}")
    print(f"\n{len(results)} rule files split.")


if __name__ == "__main__":
    main()
