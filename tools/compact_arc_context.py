#!/usr/bin/env python3
"""
Generates a compacted context file for a specific arc.
It includes all global rules, the arc file itself, and any markdown files referenced in the arc.

Usage: python tools/compact_arc_context.py stories/story/plot/arcs/10_arc_the_remembered_birth.md
(path is relative to the repo root, same as any other shell argument — not
relative to the story root the way driver.mjs's own CLI paths are)
Output: sanitized_output/arc_10_context.txt
"""
import re
import sys
from pathlib import Path

from story_paths import story_root

ROOT = Path(__file__).resolve().parent.parent
CONTENT_ROOT = story_root()  # active stories/<name>/ tree — see story_paths.py

def get_keywords(text: str) -> str:
    match = re.search(r'^keywords:\s*(.+)$', text, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return "No keywords defined."

def get_referenced_files(arc_path: Path):
    if not arc_path.exists():
        return []
    
    text = arc_path.read_text(encoding="utf-8")
    # match markdown links like [Text](../../path/to/file.md)
    # ignoring fragment identifiers #...
    links = re.findall(r'\[.*?\]\((.*?.md)(?:#.*?)?\)', text)
    
    refs = []
    for link in links:
        # resolve relative to arc_path's parent
        ref_path = (arc_path.parent / link).resolve()
        if ref_path.exists():
            refs.append(ref_path)
    return refs

def get_keywords(text: str) -> str:
    match = re.search(r'^keywords:\s*(.+)$', text, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return "No keywords defined."

def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/compact_arc_context.py <path_to_arc_file>")
        sys.exit(1)
        
    arc_path = Path(sys.argv[1]).resolve()
    if not arc_path.exists():
        print(f"Error: {arc_path} does not exist.")
        sys.exit(1)
        
    # Build list of files to include
    # 1. Global rules
    rules_dir = CONTENT_ROOT / ".agents" / "rules"
    files_to_include = list(rules_dir.glob("*.md"))
    
    # 2. Referenced files
    refs = get_referenced_files(arc_path)
    files_to_include.extend(refs)
    
    # 3. The arc itself
    files_to_include.append(arc_path)
    
    # Remove duplicates while preserving order
    seen = set()
    unique_files = []
    for f in files_to_include:
        if f not in seen:
            seen.add(f)
            unique_files.append(f)
            
    # Output file
    arc_name = arc_path.stem
    out_path = story_root() / "sanitized_output" / f"{arc_name}_context.txt"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    
    parts = []
    for path in unique_files:
        try:
            rel = path.relative_to(CONTENT_ROOT).as_posix()
        except ValueError:
            rel = path.name
            
        text = path.read_text(encoding="utf-8")
        
        # If it's the arc file itself, include full text?
        # The user said "use those [keywords] in arc context compacting script"
        # I'll use the keywords extraction for rules and lore, but the full text for the arc itself.
        if path == arc_path:
            parts.append(f"### {rel}\n{text}")
        else:
            keywords = get_keywords(text)
            parts.append(f"### {rel}\nKeywords: {keywords}")
            
    out_path.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({len(unique_files)} files)")

if __name__ == "__main__":
    main()
