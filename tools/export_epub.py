#!/usr/bin/env python3
"""Exports the story as an EPUB 3 file.

Desktop counterpart to the Android app's EpubExporter.kt -- same structure
(mimetype/container/OEBPS layout, one XHTML file per chapter, optional
embedded scene image up front). Reuses build_twine.py's own chapter loader
(frontmatter parsing, reading-order sort, scene-background resolution)
rather than re-deriving it, so this and the Twine/standalone readers can
never quietly drift out of narrative sync with each other.
"""
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_STORED, ZIP_DEFLATED

from build_twine import CHAPTERS_DIR, SETTINGS_DIR, load_chapter

BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
ITALIC_RE = re.compile(r"(?<![*\w])\*([^*\n]+?)\*(?![*\w])")
SUBTEXT_OPEN_RE = re.compile(r'&lt;span class="subtext" data-subtext="([^"]*)"&gt;')


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline(text: str) -> str:
    s = escape(text)
    s = SUBTEXT_OPEN_RE.sub(lambda m: f'<span class="subtext" data-subtext="{m.group(1)}">', s)
    s = s.replace("&lt;/span&gt;", "</span>")
    s = BOLD_RE.sub(r"<strong>\1</strong>", s)
    s = ITALIC_RE.sub(r"<em>\1</em>", s)
    return s


def chapter_xhtml(title: str, body: str, image_href: str | None) -> str:
    parts = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        trimmed = block.strip()
        if not trimmed:
            continue
        if trimmed.startswith("### "):
            parts.append(f"<h3>{inline(trimmed[4:])}</h3>")
        elif trimmed.startswith("## "):
            parts.append(f"<h2>{inline(trimmed[3:])}</h2>")
        elif trimmed.startswith("# "):
            parts.append(f"<h1>{inline(trimmed[2:])}</h1>")
        elif trimmed == "---":
            parts.append("<hr/>")
        else:
            parts.append(f"<p>{inline(trimmed).replace(chr(10), '<br/>')}</p>")
    image_tag = f'<img class="scene-image" src="{image_href}" alt=""/>' if image_href else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>{escape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section epub:type="chapter">
{image_tag}
{''.join(parts)}
</section>
</body>
</html>
"""


STYLE_CSS = """
body { font-family: Georgia, serif; line-height: 1.5; margin: 1em; }
h1, h2, h3 { font-family: Georgia, serif; line-height: 1.2; }
p { margin: 0 0 0.85em; text-indent: 0; }
hr { border: 0; border-top: 1px solid #999; margin: 1.5em 20%; }
.subtext { border-bottom: 1px dotted #888; }
.scene-image { display: block; max-width: 100%; margin: 0 auto 1.5em; }
"""

CONTAINER_XML = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""


def content_opf(title: str, author: str, chapters, book_id: str, image_hrefs) -> str:
    manifest = "\n".join(
        f'    <item id="chap{i}" href="{href}" media-type="application/xhtml+xml"/>'
        for i, (href, _) in enumerate(chapters)
    )
    image_manifest = "\n".join(
        f'    <item id="img{i}" href="{href}" media-type="image/jpeg"/>'
        for i, href in enumerate(image_hrefs)
    )
    spine = "\n".join(f'    <itemref idref="chap{i}"/>' for i in range(len(chapters)))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">{book_id}</dc:identifier>
    <dc:title>{escape(title)}</dc:title>
    <dc:creator>{escape(author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">{now}</meta>
  </metadata>
  <manifest>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
{manifest}
{image_manifest}
  </manifest>
  <spine>
{spine}
  </spine>
</package>
"""


def toc_xhtml(title: str, chapters) -> str:
    items = "\n".join(f'      <li><a href="{href}">{escape(t)}</a></li>' for href, t in chapters)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>{escape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
{items}
    </ol>
  </nav>
</body>
</html>
"""


def main():
    if len(sys.argv) < 3:
        print("usage: export_epub.py <output.epub> <story_title> [--no-images]", file=sys.stderr)
        sys.exit(1)
    out_path = Path(sys.argv[1])
    title = sys.argv[2]
    include_images = "--no-images" not in sys.argv[3:]

    if not CHAPTERS_DIR.is_dir():
        print("error: no chapters to export", file=sys.stderr)
        sys.exit(1)

    chapters_raw = [load_chapter(p) for p in sorted(CHAPTERS_DIR.glob("*.md"))]
    chapters_raw = [c for c in chapters_raw if c["body"].strip()]
    if not chapters_raw:
        print("error: no chapters with content to export", file=sys.stderr)
        sys.exit(1)
    # Same reading_order_sort key the Twine reader walks the story in --
    # narrative order, not filename/`order` order (this is told non-linearly).
    chapters_raw.sort(key=lambda c: (c["reading_order_sort"], c["path"].name))

    book_id = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, title)}"

    written_images = {}  # scene key -> href within OEBPS/
    chapter_entries = []  # (href, title, body, image_href)
    for i, c in enumerate(chapters_raw):
        href = f"chapter_{i + 1:04d}.xhtml"
        image_href = None
        if include_images and c["scene"]:
            image_href = written_images.get(c["scene"])
            if image_href is None:
                image_href = f"images/{len(written_images)}_{c['scene']}.jpg"
                written_images[c["scene"]] = image_href
        chapter_entries.append((href, c["title"], c["body"], image_href))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(out_path, "w", ZIP_DEFLATED) as zf:
        # mimetype must be first and STORED (uncompressed) -- readers
        # identify an EPUB by reading this exact entry at a fixed offset.
        zf.writestr(ZipInfo("mimetype"), "application/epub+zip", ZIP_STORED)
        zf.writestr("META-INF/container.xml", CONTAINER_XML)
        zf.writestr("OEBPS/style.css", STYLE_CSS)
        for key, href in written_images.items():
            zf.write(SETTINGS_DIR / f"{key}.jpg", f"OEBPS/{href}")
        for href, ch_title, body, image_href in chapter_entries:
            zf.writestr(f"OEBPS/{href}", chapter_xhtml(ch_title, body, image_href))
        titled = [(href, t) for href, t, _, _ in chapter_entries]
        zf.writestr("OEBPS/content.opf", content_opf(title, "Cuntswell Corpus", titled, book_id, written_images.values()))
        zf.writestr("OEBPS/toc.xhtml", toc_xhtml(title, titled))

    print(str(out_path))


if __name__ == "__main__":
    main()
