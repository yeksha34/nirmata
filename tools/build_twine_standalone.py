#!/usr/bin/env python3
"""
Builds a fully self-contained variant of the reader -- every image reference
(portraits, scene backgrounds, the vine frame) inlined as a base64 data URI,
so the single output file has no external dependencies at all.

tools/twine/reader.html (built by build_twine.py, relative-path images)
    -> tools/twine/reader_standalone.html (this script, embedded images)

Why this exists as a separate builder rather than a flag on build_twine.py:
the relative-path version is what server.mjs serves and what opens cleanly
off disk on a desktop file:// browse, and it's the one to keep using for
that. This version exists for cases the relative-path one can't reach at
all -- most notably Android Chrome, where a local HTML file is frequently
opened via a content:// URI scoped to that single file, with no visibility
into sibling files on disk, so a relative path to an image next to it
simply has nothing to resolve against.

Why this is a post-process on the built reader.html rather than a second
code path through build_twine.py's own generation: every distinct asset
(there are only ~30-40 underlying image files, ~170MB combined) is
embedded exactly ONCE regardless of how many times it's referenced in the
text (a portrait can recur dozens of times across one written chapter's
mood changes; a scene background repeats across every chapter/TOC card
that shares a setting) -- naively substituting each occurrence with its
own full copy of the data URI multiplies file size by occurrence count,
not by the number of underlying images, and produced a 1GB+ file the
first time this was tried without dedup. Instead: every unique asset is
embedded once, in a single JS lookup object (window.__ASSET_DATA), and
every occurrence in the text is rewritten to a short reference into it.

An earlier version of that dedup emitted a second copy of every asset as a
<style> block of CSS custom properties, for the url() contexts that a JS
lookup can't reach directly -- which meant each image went in twice and the
output was exactly double the size it needed to be (146MB where 73MB would
do), despite the paragraph above claiming otherwise. There is now only the
one JS object: the sole static-CSS case (the TOC cards' --card-bg) is
rewritten to a data attribute and resolved at render time by the same
:passagedisplay handler that already resolves the <img> tags.

That handler resolves to a **blob: URL**, not to the data: URI itself. A
data: URI is only cheap while it sits in __ASSET_DATA once; assigning it
into a per-element property copies the whole string into the DOM at every
reference, and 22 TOC cards share one 2.8MB-base64 background -- roughly
60MB of live inline style for a single image, at which point Blink simply
stops painting it (manor_bedroom's cards rendered blank while smaller
backgrounds on the same page were fine). Decoding each asset once into a
Blob and handing out its object URL keeps every reference short, so the
bytes exist exactly once in the file AND exactly once in memory.
"""
import base64
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READER_HTML = ROOT / "tools" / "twine" / "reader.html"
OUTPUT_HTML = ROOT / "tools" / "twine" / "reader_standalone.html"
ASSETS_DIR = ROOT / "tools" / "story_editor" / "assets"
BUILD_TWINE = ROOT / "tools" / "build_twine.py"

MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

ASSET_EXT_ALT = "jpg|jpeg|png|svg|gif|webp"

# Everything below matches inside the reader's embedded twee-data blob,
# which is the *whole passage source text* run through one uniform
# HTML-entity escape (& -> &amp;, < -> &lt;, > -> &gt;, " -> &quot;,
# ' -> &#39;, in that order -- see _esc()) before SugarCube's own runtime
# JS unescapes and renders it. So every raw-source pattern below has to be
# matched in its escaped form, which _esc() generates rather than being
# hand-transcribed as literal entities (fragile and easy to get wrong).
IMG_TAG_RE = re.compile(
    r"&lt;img src=&quot;\.\./story_editor/assets/([^&]+?\.(?:" + ASSET_EXT_ALT + r"))&quot;"
    r" alt=&quot;([^&]*)&quot;&gt;"
)
# Matches the TOC card's entire inline style attribute, not just the url()
# inside it -- the replacement swaps the whole style="..." for a data
# attribute, since the custom property is set from JS at render time now.
CARD_STYLE_RE = re.compile(
    r"style=&quot;--card-bg:url\(&#39;\.\./story_editor/assets/"
    r"([^&]+?\.(?:" + ASSET_EXT_ALT + r"))&#39;\)&quot;"
)


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def build_reader_first():
    print("Running build_twine.py first to ensure reader.html is fresh...")
    subprocess.run([sys.executable, str(BUILD_TWINE)], cwd=ROOT, check=True)


def to_data_uri(rel_path: str):
    abs_path = ASSETS_DIR / rel_path
    ext = "." + rel_path.rsplit(".", 1)[-1].lower()
    mime = MIME_BY_EXT.get(ext)
    if mime is None or not abs_path.exists():
        print(f"  ! skipping missing/unrecognized asset: {rel_path}", file=sys.stderr)
        return None
    data = abs_path.read_bytes()
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def main():
    build_reader_first()

    if not READER_HTML.exists():
        print(f"No reader.html at {READER_HTML}", file=sys.stderr)
        sys.exit(1)

    html = READER_HTML.read_text(encoding="utf-8")

    distinct_paths = {p for p, _alt in IMG_TAG_RE.findall(html)} | set(CARD_STYLE_RE.findall(html))

    uris = {}
    for rel_path in sorted(distinct_paths):
        uri = to_data_uri(rel_path)
        if uri is not None:
            uris[rel_path] = uri
    print(f"Embedding {len(uris)} distinct assets (of {len(distinct_paths)} referenced).")

    # 1. <img src="...PATH..." alt="..."> -> <img data-asset="PATH" alt="...">,
    # resolved at render time by a small lookup script against __ASSET_DATA
    # (added to PassageHeader below) rather than carrying its own copy.
    def _replace_img(m):
        rel_path, alt = m.group(1), m.group(2)
        if rel_path not in uris:
            return m.group(0)
        return f'&lt;img data-asset=&quot;{_esc(rel_path)}&quot; alt=&quot;{alt}&quot;&gt;'

    html = IMG_TAG_RE.sub(_replace_img, html)

    # 2. The one static-CSS asset context is the TOC cards' inline
    # style="--card-bg:url('...PATH...')". A JS lookup can't be referenced
    # from inside a style attribute, so the whole declaration is replaced by
    # a data-card-bg="PATH" attribute and the property is set at render time
    # by the shared resolver in step 4 -- which keeps __ASSET_DATA the single
    # place any asset's bytes live.
    def _replace_card_style(m):
        rel_path = m.group(1)
        if rel_path not in uris:
            return m.group(0)
        return f"data-card-bg=&quot;{_esc(rel_path)}&quot;"

    html = CARD_STYLE_RE.sub(_replace_card_style, html)

    # 3. The PassageHeader scene-bg script builds its target path dynamically
    # (static prefix + the passage's scene-<key> tag + ".jpg"), so it can't be
    # caught by the two whole-path regexes above -- rewritten here to resolve
    # through the same __ASSET_DATA lookup instead of constructing a raw
    # relative path that no longer exists in this build.
    old_scene_script = _esc(
        "document.body.style.setProperty('--scene-bg', \"url('../story_editor/assets/backgrounds/settings/"
        "\" + _sceneTag.slice(6) + \".jpg')\");"
    )
    new_scene_script = (
        "var _u = window.__assetURL(&#39;backgrounds/settings/&#39; + _sceneTag.slice(6) + &#39;.jpg&#39;); "
        "if (_u) document.body.style.setProperty(&#39;--scene-bg&#39;, &quot;url(&#39;&quot; + _u + &quot;&#39;)&quot;);"
    )
    if old_scene_script in html:
        html = html.replace(old_scene_script, new_scene_script)
    else:
        print("  ! scene-bg script pattern not found -- reader.html format may have changed; "
              "scene backgrounds will not resolve in the standalone build.", file=sys.stderr)

    # 4. One shared lookup script resolves any [data-asset] <img> (portraits,
    # scene cues, TOC card avatars -- all of them, same attribute) left
    # unresolved. This can't just run inline in PassageHeader's own
    # <<script>> block -- that block executes as part of building the new
    # passage's markup, which happens BEFORE SugarCube inserts that markup
    # into the DOM, so a querySelectorAll at that point finds nothing (or
    # only the previous passage's now-stale images). Registering a
    # :passagedisplay handler instead -- once, guarded so re-running
    # PassageHeader on every passage doesn't re-register it -- runs the
    # actual resolution after the new passage's HTML is really in the DOM,
    # firing correctly for the very first passage too since the handler is
    # attached synchronously during that same passage's own render.
    resolver = (
        "  if (!window.__assetResolverInstalled) {\n"
        "    window.__assetResolverInstalled = true;\n"
        "    window.__assetBlobs = {};\n"
        "    window.__assetURL = function (p) {\n"
        "      if (window.__assetBlobs[p]) return window.__assetBlobs[p];\n"
        "      var uri = window.__ASSET_DATA && window.__ASSET_DATA[p];\n"
        "      if (!uri) return null;\n"
        "      var mime = uri.slice(5, uri.indexOf(&#39;;&#39;));\n"
        "      var bin = atob(uri.slice(uri.indexOf(&#39;,&#39;) + 1));\n"
        "      var bytes = new Uint8Array(bin.length);\n"
        "      for (var i = bin.length; i--; ) bytes[i] = bin.charCodeAt(i);\n"
        "      var url = URL.createObjectURL(new Blob([bytes], { type: mime }));\n"
        "      window.__assetBlobs[p] = url;\n"
        "      return url;\n"
        "    };\n"
        "    jQuery(document).on(&#39;:passagedisplay&#39;, function () {\n"
        "      Array.prototype.forEach.call(document.querySelectorAll(&#39;img[data-asset]&#39;), function (el) {\n"
        "        var url = window.__assetURL(el.getAttribute(&#39;data-asset&#39;));\n"
        "        if (url) el.src = url;\n"
        "      });\n"
        "      Array.prototype.forEach.call(document.querySelectorAll(&#39;[data-card-bg]&#39;), function (el) {\n"
        "        var url = window.__assetURL(el.getAttribute(&#39;data-card-bg&#39;));\n"
        "        if (url) el.style.setProperty(&#39;--card-bg&#39;, &quot;url(&#39;&quot; + url + &quot;&#39;)&quot;);\n"
        "      });\n"
        "    });\n"
        "  }\n"
    )
    marker = _esc("<<script>>\n")
    if marker in html:
        html = html.replace(marker, marker + resolver, 1)
    else:
        print("  ! PassageHeader script marker not found -- portrait/scene-cue images "
              "will not resolve.", file=sys.stderr)

    # 5. Vine frame border-image: plain CSS in the real <head><style>, not
    # inside the escaped twee-data blob, so this one's a direct substitution.
    vine_uri = to_data_uri("vine_frame.svg") if (ASSETS_DIR / "vine_frame.svg").exists() else None
    if vine_uri:
        html = html.replace(
            "url('../story_editor/assets/vine_frame.svg')",
            f"url('{vine_uri}')",
        )

    # 6. Emit the one shared definition block: __ASSET_DATA, holding each
    # unique asset's bytes exactly once. Every rewritten occurrence above --
    # <img data-asset>, [data-card-bg], and the dynamic scene-bg lookup --
    # reads out of this same object, so an asset's base64 never appears in
    # the output more than once no matter how it is referenced.
    script_entries = ",\n".join(
        f'    {_json_str(p)}: {_json_str(u)}' for p, u in uris.items()
    )
    injected = (
        f"<script>window.__ASSET_DATA = {{\n{script_entries}\n  }};</script>\n"
    )
    if "</head>" in html:
        html = html.replace("</head>", injected + "</head>", 1)
    else:
        html = injected + html

    OUTPUT_HTML.write_text(html, encoding="utf-8")
    size_mb = OUTPUT_HTML.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUTPUT_HTML} ({size_mb:.1f} MB, {len(uris)} images embedded once each)")


def _json_str(s: str) -> str:
    import json
    return json.dumps(s)


if __name__ == "__main__":
    main()
