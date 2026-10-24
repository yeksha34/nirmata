#!/usr/bin/env python3
"""Imports a story .zip into the active story's folder.

Desktop counterpart to the Android app's CorpusZip.import -- same two
accepted shapes (a zip rooted at the story itself, i.e. a top-level
`chapters/` entry, or one wrapping it in `stories/<name>/`), the same
zip-slip guard (an entry naming `../../whatever` is skipped rather than
written, since the archive is untrusted input even when the user picked
it themselves), and the same replace-existing-by-default behaviour.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

from story_paths import story_root


def detect_prefix(names):
    """Shallowest directory containing a top-level `chapters/` -- the same
    marker the Android importer keys off of."""
    candidates = set()
    for name in names:
        idx = name.find("chapters/")
        if idx >= 0:
            candidates.add(name[:idx])
    if not candidates:
        return ""
    return min(candidates, key=lambda p: p.count("/"))


def safe_resolve(root: Path, relative: str):
    """Resolves a zip entry path under root, or None if it would escape --
    absolute paths, `..` segments, or anything that canonicalizes outside."""
    if relative.startswith("/"):
        return None
    parts = [p for p in relative.replace("\\", "/").split("/") if p and p != "."]
    if not parts or ".." in parts:
        return None
    target = (root / Path(*parts)).resolve()
    root_resolved = root.resolve()
    if target == root_resolved or str(target).startswith(str(root_resolved) + "\\") \
            or str(target).startswith(str(root_resolved) + "/"):
        return target
    return None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: import_zip.py <input.zip> [--replace]"}))
        sys.exit(1)
    zip_path = Path(sys.argv[1])
    replace = "--replace" in sys.argv[2:]
    root = story_root()

    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        print(json.dumps({"error": "That file isn't a valid zip."}))
        sys.exit(1)

    with zf:
        infos = zf.infolist()
        if not infos:
            print(json.dumps({"error": "That zip contains no files."}))
            sys.exit(1)

        names = [info.filename.replace("\\", "/") for info in infos]
        prefix = detect_prefix(names)

        relevant = []
        for info in infos:
            name = info.filename.replace("\\", "/")
            if name.endswith("/"):
                continue  # directory entry
            if name.startswith("__MACOSX/") or name.endswith("/.DS_Store"):
                continue
            if prefix:
                if not name.startswith(prefix):
                    continue
                rel = name[len(prefix):]
            else:
                rel = name
            if not rel:
                continue
            relevant.append((rel, info))

        if not relevant:
            print(json.dumps({"error": "That zip doesn't look like a story folder."}))
            sys.exit(1)

        if replace and root.exists():
            shutil.rmtree(root)
        root.mkdir(parents=True, exist_ok=True)

        skipped = []
        written = 0
        md_count = 0
        for rel, info in relevant:
            target = safe_resolve(root, rel)
            if target is None:
                skipped.append(rel)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            written += 1
            if rel.lower().endswith(".md"):
                md_count += 1

    print(json.dumps({"fileCount": written, "markdownCount": md_count, "skippedEntries": skipped}))


if __name__ == "__main__":
    main()
