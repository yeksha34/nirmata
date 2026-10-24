#!/usr/bin/env python3
"""Zips the active story's whole folder for backup/transfer.

Desktop counterpart to the Android app's CorpusZip.export -- same shape
(everything under the story root, no exclusions) so a zip made on one side
imports cleanly on the other.
"""
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from story_paths import story_root


def main():
    if len(sys.argv) != 2:
        print("usage: export_zip.py <output.zip>", file=sys.stderr)
        sys.exit(1)
    out_path = Path(sys.argv[1])
    root = story_root()
    if not root.is_dir():
        print("error: no story to export", file=sys.stderr)
        sys.exit(1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(out_path, "w", ZIP_DEFLATED) as zf:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(root).as_posix())
    print(str(out_path))


if __name__ == "__main__":
    main()
