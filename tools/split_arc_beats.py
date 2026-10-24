#!/usr/bin/env python3
"""
Splits each arc's "## Beats" numbered list into individually-linkable
per-beat cards under plot/arcs/beats/<arc_basename>/<NN>.md, so a chunked
chapter generation can pull just the current beat's context instead of
the whole arc every time it asks the model for the next ~150-200
characters.

Non-destructive: the arc file itself is untouched (it stays the stable
link target for the rest of the corpus) — this only adds new files.
Each beat card is the numbered item's own text, verbatim, plus a short
header naming the arc and premise for orientation, since a beat on its
own often reads as a fragment without knowing what arc it's in.

Usage: python tools/split_arc_beats.py [arc_file_or_all]
  python tools/split_arc_beats.py                                # all arcs
  python tools/split_arc_beats.py plot/arcs/31_arc_the_two_contracts.md
"""
import os
import re
import sys
from pathlib import Path

from story_paths import story_root

ROOT = Path(__file__).resolve().parent.parent
CONTENT_ROOT = story_root()  # active stories/<name>/ tree -- see story_paths.py
ARCS_DIR = CONTENT_ROOT / "plot" / "arcs"
OUT_DIR = ARCS_DIR / "beats"

H1_RE = re.compile(r"^# Arc:\s*(.+)$", re.MULTILINE)
PREMISE_RE = re.compile(r"^## Premise\n(.*?)(?=\n##|\Z)", re.MULTILINE | re.DOTALL)
BEATS_SECTION_RE = re.compile(r"^## Beats\n(.*?)(?=\n##|\Z)", re.MULTILINE | re.DOTALL)
RELATIONS_RE = re.compile(r"^## Relations\n(.*?)(?=\n##|\Z)", re.MULTILINE | re.DOTALL)
# A numbered item starts at column 0 with "N." — continuation lines are
# indented or blank; this splits on top-level numbered starts only.
BEAT_ITEM_RE = re.compile(r"^\d+\.\s+", re.MULTILINE)
LINK_RE = re.compile(r'(?<!!)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)')


def rewrite_links(text: str, new_dir: Path) -> str:
    """Relative links in the arc were resolved against ARCS_DIR; beat
    cards live one level deeper (new_dir), so re-express each relative
    target from new_dir while pointing at the exact same file."""
    def repl(m):
        label, target = m.group(1), m.group(2)
        if re.match(r"^(https?:|mailto:|#)", target):
            return m.group(0)
        t, anchor = (target.split("#", 1) + [""])[:2] if "#" in target else (target, "")
        if not t:
            return m.group(0)
        resolved = (ARCS_DIR / t).resolve()
        new_target = os.path.relpath(resolved, new_dir).replace(os.sep, "/")
        suffix = f"#{anchor}" if anchor else ""
        return f"[{label}]({new_target}{suffix})"
    return LINK_RE.sub(repl, text)


def split_beats(text):
    m = BEATS_SECTION_RE.search(text)
    if not m:
        return None
    block = m.group(1).strip("\n")
    if not block.strip():
        return None
    starts = [mm.start() for mm in BEAT_ITEM_RE.finditer(block)]
    if not starts:
        return None
    starts.append(len(block))
    items = []
    for i in range(len(starts) - 1):
        item = block[starts[i]:starts[i + 1]].rstrip("\n")
        item = re.sub(r"^\d+\.\s+", "", item)
        items.append(item.strip())
    return items


def split_file(path: Path):
    text = path.read_text(encoding="utf-8")
    h1 = H1_RE.search(text)
    title = h1.group(1).strip() if h1 else path.stem
    premise_m = PREMISE_RE.search(text)
    premise = premise_m.group(1).strip() if premise_m else ""
    relations_m = RELATIONS_RE.search(text)
    relations = relations_m.group(1).strip() if relations_m else ""

    beats = split_beats(text)
    if not beats:
        return None

    basename = path.stem
    out_subdir = OUT_DIR / basename
    out_subdir.mkdir(parents=True, exist_ok=True)

    for n, beat_text in enumerate(beats, start=1):
        beat_path = out_subdir / f"{n:02d}.md"
        content = (
            f"# Arc: {title} — Beat {n}\n\n"
            f"**Arc premise:** {rewrite_links(premise, out_subdir)}\n\n"
            f"**This beat:**\n{rewrite_links(beat_text, out_subdir)}\n\n"
            f"See [the full arc](../../{path.name}) for context, prior/later beats, and Relations.\n\n"
            f"## Relations (inherited from the full arc)\n{rewrite_links(relations, out_subdir)}\n"
        )
        beat_path.write_text(content, encoding="utf-8")

    return basename, len(beats)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    targets = [CONTENT_ROOT / arg] if arg else sorted(ARCS_DIR.glob("*.md"))
    results = []
    for path in targets:
        if not path.is_file():
            continue
        r = split_file(path)
        if r:
            results.append(r)
    for basename, n in results:
        print(f"{basename}.md -> {n} beats  (plot/arcs/beats/{basename}/)")
    print(f"\n{len(results)} arcs split into beats.")


if __name__ == "__main__":
    main()
