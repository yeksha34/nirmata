import os
import re
from pathlib import Path
import argparse
import difflib

from story_paths import story_root

# Dictionary mapping explicit words to their glyph-masked counterparts
# following the prose-placeholder-convention.md rules.
MASK_MAP = {
    r'\bcunt\b': 'c**t',
    r'\bcunts\b': 'c***s',
    r'\bcock\b': 'c**k',
    r'\bcocks\b': 'c***s',
    r'\bfuck\b': 'f**k',
    r'\bfucking\b': 'f*****g',
    r'\bfucked\b': 'f****d',
    r'\bfucks\b': 'f***s',
    r'\bwhore\b': 'w***e',
    r'\bwhores\b': 'w****s',
    r'\bbitch\b': 'b***h',
    r'\bbitches\b': 'b*****s',
    r'\bshit\b': 's**t',
    r'\bcum\b': 'c*m',
    r'\bcumming\b': 'c*****g',
    r'\bsuck\b': 's**k',
    r'\bsucking\b': 's*****g',
    r'\bsucked\b': 's****d'
}

def mask_text(text):
    for pattern, replacement in MASK_MAP.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text

def process_file(file_path, output_dir, dry_run=True):
    with open(file_path, 'r', encoding='utf-8') as f:
        original_text = f.read()

    new_text = mask_text(original_text)
    
    if new_text != original_text:
        print(f"Masked explicit terms in {file_path.name}")
        if dry_run:
            diff = difflib.unified_diff(
                original_text.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"a/{file_path.name}",
                tofile=f"b/{file_path.name}"
            )
            return "".join(diff)
        else:
            out_path = Path(output_dir) / file_path
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(new_text)
            return None
    else:
        # If no changes and not a dry run, copy file exactly to output to maintain completeness
        if not dry_run:
            out_path = Path(output_dir) / file_path
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(original_text)
    return None

def main():
    parser = argparse.ArgumentParser(description="Mask explicit terms for Commercial AI consumption")
    parser.add_argument("--apply", action="store_true", help="Apply changes and write them to output_dir instead of generating a diff")
    parser.add_argument("--input_dirs", nargs="+", default=[str(story_root() / "lore"), str(story_root() / "characters")], help="Input directories to process")
    parser.add_argument("--output_dir", type=str, default="safe_for_ai", help="Directory to write masked files")
    
    args = parser.parse_args()
    
    target_dirs = [Path(d) for d in args.input_dirs]
    diff_output = []

    for d in target_dirs:
        if not d.exists():
            continue
        for file_path in d.rglob("*.md"):
            diff = process_file(file_path, args.output_dir, dry_run=not args.apply)
            if diff:
                diff_output.append(diff)

    if diff_output and not args.apply:
        diff_path = "masking_proposed.diff"
        with open(diff_path, "w", encoding="utf-8") as f:
            f.write("\n".join(diff_output))
        print(f"Dry run complete. Proposed masks written to {diff_path}")
    elif args.apply:
        print(f"Files masked and written to {args.output_dir}/ directory.")

if __name__ == "__main__":
    main()
