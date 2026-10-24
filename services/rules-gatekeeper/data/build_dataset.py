#!/usr/bin/env python3
"""Build a rules-only instruction-tuning dataset for rules-gatekeeper.

Reads ONLY:
  <STORIES_ROOT>/stories/story/.agents/rules/*.md
  <STORIES_ROOT>/stories/story/.agents/constrained-agentic-bias.md

Never reads chapters/, plot/, characters/, or any other card type. Every
emitted example carries a `source_rule` field pointing at the exact file it
was derived from, so the dataset can be audited to confirm nothing outside
.agents/ leaked in.

Each rule card produces several *verbose* examples (long-form reasoning
responses, not one-line verdicts) so the fine-tune learns to articulate rule
application rather than pattern-match a short answer.
"""
import argparse
import json
import os
import re
from pathlib import Path

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
FIELD_RE = re.compile(r"\*\*([A-Za-z][A-Za-z ]*):\*\*\s*(.*?)(?=\n\*\*[A-Za-z][A-Za-z ]*:\*\*|\Z)", re.DOTALL)
HEADING_RE = re.compile(r"^#\s+(.*)$", re.MULTILINE)


def parse_card(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(text)
    frontmatter, body = (m.group(1), m.group(2)) if m else ("", text)

    title_m = HEADING_RE.search(body)
    title = title_m.group(1).strip() if title_m else path.stem

    fields = {}
    for fm in FIELD_RE.finditer(body):
        key = fm.group(1).strip().lower()
        val = fm.group(2).strip()
        fields[key] = val

    return {
        "path": path,
        "title": title,
        "frontmatter": frontmatter.strip(),
        "body": body.strip(),
        "fields": fields,
    }


def verbose_explanation_example(card: dict, rel_path: str) -> dict:
    fields = card["fields"]
    drift = fields.get("drift", "")
    canon_rule = fields.get("canon rule", "")
    prohibition = fields.get("prohibition", "")
    check = fields.get("check", "")

    response_parts = [
        f"This rule, \"{card['title']}\", exists to correct a specific drift the story "
        f"has been observed to make." if drift else
        f"This rule, \"{card['title']}\", establishes a constraint the story must hold to."
    ]
    if drift:
        response_parts.append(f"The drift it corrects is: {drift}")
    if canon_rule:
        response_parts.append(
            f"The canon rule that overrides that drift states: {canon_rule} "
            "Any generation that contradicts this is out of canon, regardless of how "
            "plausible it may read in isolation."
        )
    if prohibition:
        response_parts.append(
            f"Concretely, the rule prohibits the following: {prohibition} "
            "Each of these prohibitions exists because the drift tends to reassert "
            "itself in exactly these forms unless explicitly checked."
        )
    if check:
        response_parts.append(
            f"Before treating a passage as compliant, apply the rule's own check: {check} "
            "If the answer is yes, the passage violates this rule and must be revised or rejected."
        )
    if not (drift or canon_rule or prohibition or check):
        response_parts.append(card["body"])

    return {
        "source_rule": rel_path,
        "instruction": f"Explain the rule \"{card['title']}\" and why it exists.",
        "response": "\n\n".join(response_parts),
    }


def judge_example(card: dict, rel_path: str) -> dict:
    check = card["fields"].get("check", "")
    prohibition = card["fields"].get("prohibition", "")
    canon_rule = card["fields"].get("canon rule", "")
    check_q = check if check else f"Does this excerpt violate \"{card['title']}\"?"

    response = (
        f"To judge this excerpt against \"{card['title']}\", I first restate the rule's own "
        f"check: {check_q}\n\n"
        f"I read the excerpt looking specifically for the pattern the rule prohibits"
        + (f": {prohibition}" if prohibition else ".") + "\n\n"
        + (f"The canon position I'm checking against is: {canon_rule}\n\n" if canon_rule else "")
        + "If the excerpt contains language matching that prohibited pattern (for example, "
        "silently assuming a default this rule says must be explicit, or restating the drift "
        "this rule was written to correct), I mark it VIOLATION and name the exact phrase "
        "responsible. If the excerpt avoids the pattern, and does not merely omit the topic "
        "but actively holds the canon position, I mark it COMPLIANT. Absence of the topic "
        "entirely is not by itself compliance if the surrounding context implies the drift."
    )

    return {
        "source_rule": rel_path,
        "instruction": (
            f"You are judging a card excerpt against the rule \"{card['title']}\". "
            f"Walk through your reasoning step by step, then give a verdict of VIOLATION or COMPLIANT."
        ),
        "response": response,
    }


def reject_example(card: dict, rel_path: str) -> dict:
    prohibition = card["fields"].get("prohibition", "")
    check = card["fields"].get("check", "")
    if not (prohibition or check):
        return None

    response = (
        f"A card should be rejected under \"{card['title']}\" when it exhibits the pattern "
        f"this rule prohibits" + (f": {prohibition}" if prohibition else "") + "\n\n"
        + (f"The tell to look for is the rule's own check question: {check}\n\n" if check else "")
        + "When rejecting, state which specific line or phrase trips the rule, quote it, "
        "explain in one sentence which prohibited pattern it matches, and describe what a "
        "compliant rewrite would need to change — not just that it is wrong, but what the "
        "corrected version would say instead. A rejection without a stated fix is incomplete."
    )

    return {
        "source_rule": rel_path,
        "instruction": (
            f"Describe how to reject a card that violates \"{card['title']}\", "
            "including what a compliant rewrite would look like."
        ),
        "response": response,
    }


def generation_example(card: dict, rel_path: str) -> dict:
    canon_rule = card["fields"].get("canon rule", "")
    prohibition = card["fields"].get("prohibition", "")

    response = (
        f"When writing under the constraint of \"{card['title']}\", the passage must hold to: "
        + (canon_rule if canon_rule else card["body"][:400]) + "\n\n"
        "A short compliant passage would keep to this position throughout, without lapsing "
        "into the prohibited default"
        + (f" ({prohibition})" if prohibition else "")
        + " even implicitly. Rationale: every sentence should be checkable against the rule's "
        "own check question, and the passage should not require an outside reader to infer "
        "compliance — it should be legible in the text itself which position is being held."
    )

    return {
        "source_rule": rel_path,
        "instruction": (
            f"Write guidance for producing a short passage that complies with \"{card['title']}\", "
            "and explain the reasoning behind the guidance."
        ),
        "response": response,
    }


def build_examples(card: dict, rel_path: str) -> list:
    examples = [
        verbose_explanation_example(card, rel_path),
        judge_example(card, rel_path),
        generation_example(card, rel_path),
    ]
    rej = reject_example(card, rel_path)
    if rej:
        examples.append(rej)
    return examples


def find_rule_files(stories_root: Path) -> list:
    agents_dir = stories_root / "stories" / "story" / ".agents"
    rules_dir = agents_dir / "rules"
    files = []
    if rules_dir.is_dir():
        files.extend(sorted(rules_dir.glob("*.md")))
    catalog = agents_dir / "constrained-agentic-bias.md"
    if catalog.is_file():
        files.append(catalog)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stories-root", default=os.environ.get("STORIES_ROOT"))
    ap.add_argument("--out", default="data/dataset.jsonl")
    args = ap.parse_args()

    if not args.stories_root:
        raise SystemExit("Set --stories-root or STORIES_ROOT to the stories-repo checkout")

    stories_root = Path(args.stories_root)
    rule_files = find_rule_files(stories_root)
    if not rule_files:
        raise SystemExit(f"No rule files found under {stories_root}/stories/story/.agents/")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with out_path.open("w", encoding="utf-8") as f:
        for path in rule_files:
            rel = str(path.relative_to(stories_root)).replace("\\", "/")
            card = parse_card(path)
            for ex in build_examples(card, rel):
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")
                count += 1

    print(f"Wrote {count} examples from {len(rule_files)} rule files to {out_path}")


if __name__ == "__main__":
    main()
