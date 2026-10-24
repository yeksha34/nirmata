#!/usr/bin/env python3
"""List every place in scenes/, drafts/ and chapters/ that mentions given lore terms.

Usage:
  python lore_impact.py <story_root> --terms "Veyra" "river-folk"
  python lore_impact.py <story_root> --from-lore lore/species/veyra.md --terms horseshoe
  python lore_impact.py <story_root> --terms Veyra --dirs scenes drafts chapters notes

Matching is case-insensitive and whole-word. Finds direct mentions only;
indirect and consequential dependencies still need a read (see SKILL.md).
"""
import argparse
import re
import sys
from pathlib import Path

TEXT_EXT = {".md", ".txt", ".markdown", ".fountain", ".rst", ""}


def terms_from_lore(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    terms = []
    fm = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if fm:
        block = fm.group(1)
        m = re.search(r"^name:\s*(.+)$", block, re.M)
        if m:
            terms.append(m.group(1).strip().strip("\"'"))
        m = re.search(r"^aliases:\s*\[(.*?)\]", block, re.M | re.S)
        if m:
            terms += [a.strip().strip("\"'") for a in m.group(1).split(",") if a.strip()]
        else:
            m = re.search(r"^aliases:\s*\n((?:\s*-\s*.+\n?)+)", block, re.M)
            if m:
                terms += [l.strip()[1:].strip().strip("\"'") for l in m.group(1).splitlines() if l.strip()]
    if not terms:
        terms.append(path.stem.replace("-", " "))
    return terms


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--terms", nargs="*", default=[])
    ap.add_argument("--from-lore", nargs="*", default=[])
    ap.add_argument("--dirs", nargs="*", default=["scenes", "drafts", "chapters"])
    ap.add_argument("--context", type=int, default=0, help="lines of context around hits")
    a = ap.parse_args()

    root = Path(a.root)
    terms = list(a.terms)
    for lf in a.from_lore:
        p = Path(lf) if Path(lf).is_absolute() else root / lf
        terms += terms_from_lore(p)
    terms = sorted({t for t in terms if t}, key=str.lower)
    if not terms:
        print("No terms given.", file=sys.stderr)
        return 2

    # whole-word, tolerating plurals and possessives (fountain/fountains, Maren/Maren's)
    pat = re.compile(
        r"(?<!\w)(" + "|".join(re.escape(t) for t in terms) + r")(?:e?s|'s|’s)?(?!\w)", re.I
    )
    print(f"Terms: {', '.join(terms)}\n")

    total_hits, files_hit = 0, 0
    for d in a.dirs:
        base = root / d
        if not base.exists():
            continue
        for f in sorted(base.rglob("*")):
            if not f.is_file() or f.suffix.lower() not in TEXT_EXT:
                continue
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
            hits = [i for i, l in enumerate(lines) if pat.search(l)]
            if not hits:
                continue
            files_hit += 1
            total_hits += len(hits)
            print(f"== {f.relative_to(root)}  ({len(hits)} hit{'s' if len(hits) != 1 else ''})")
            shown = set()
            for i in hits:
                for j in range(max(0, i - a.context), min(len(lines), i + a.context + 1)):
                    if j in shown:
                        continue
                    shown.add(j)
                    mark = ">" if j == i else " "
                    snippet = lines[j].strip()
                    if len(snippet) > 160:
                        snippet = snippet[:157] + "..."
                    print(f"  {mark}{j + 1:>5}: {snippet}")
            print()

    print(f"{total_hits} hit lines in {files_hit} files across: {', '.join(a.dirs)}")
    print("Reminder: this finds direct mentions only. Check indirect and consequential dependencies too.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
