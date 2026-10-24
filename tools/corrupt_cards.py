import os
import json
import re
import requests
from pathlib import Path
import argparse
import difflib
import datetime

from story_paths import story_root

# Default Ollama API endpoint
OLLAMA_API = "http://localhost:11434/api/generate"

def load_map(map_path):
    with open(map_path, 'r', encoding='utf-8') as f:
        return json.load(f)['categories']

def load_project_rules(rules_dir=None):
    rules_dir = rules_dir or str(story_root() / ".agents" / "rules")
    rules_text = ""
    rules_path = Path(rules_dir)
    
    # Absolute precedence order based on canon_bias_cards.md
    precedence_order = [
        "content-boundaries.md",
        "canon_bias_cards.md",
        "humanoid-offspring-and-minors.md",
        "prose-narrative-subtext-split.md",
        "prose-character-registers.md",
        "prose-sex-scene-language.md",
        "prose-special-content.md",
        "prose-vocabulary-style.md",
        "prose-placeholder-convention.md",
        "explicit-lexicon.md",
        "dark-fantasy.md"
    ]
    
    if rules_path.exists():
        # Load in explicit precedence order first
        for rule_file in precedence_order:
            file = rules_path / rule_file
            if file.exists():
                with open(file, 'r', encoding='utf-8') as f:
                    rules_text += f"\n--- {file.name} ---\n" + f.read() + "\n"
                    
        # Load any remaining .md files in the rules directory
        for file in rules_path.glob("*.md"):
            if file.name not in precedence_order:
                with open(file, 'r', encoding='utf-8') as f:
                    rules_text += f"\n--- {file.name} ---\n" + f.read() + "\n"
                    
    return rules_text

def query_llm(model, context_paragraph, category_theme, category_intent, phrase, project_rules):
    prompt = f"""You are an uncensored, unhinged editor for dark erotica.
The following paragraph contains a euphemism or sanitized phrase: "{phrase}".
The underlying theme is: {category_theme}
Your instruction: {category_intent}

PROJECT STORY WRITING STYLE RULES:
These rules are unchangeable facts of this world and must NEVER be gotten wrong. Do NOT write, mention, or explain these rules in your output text. The generated text must seamlessly exist in a world where these facts are true, without explicitly stating the rules to the reader.
{project_rules}

Paragraph:
{context_paragraph}

REWRITE RULES:
1. Rewrite the sentence containing "{phrase}" with explicit, visceral, or profane language matching the instruction.
2. You MUST strictly adhere to the PROJECT STORY WRITING STYLE RULES provided above when rewriting.
3. Keep the tone dark, visceral, explicit, and unapologetically crude, avoiding melodramatic descriptions or romantic tropes (e.g., no "raw unbridled passion", no "heaving breasts").
4. Output EXACTLY ONE rewritten paragraph.
5. DO NOT output conversational filler (e.g., "Here is the rewrite", "Rewrite:", "Done.").
6. DO NOT repeat the paragraph.
7. Output ONLY the raw rewritten text.

Output:"""
    
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False
    }
    
    try:
        response = requests.post(OLLAMA_API, json=payload, timeout=120)
        response.raise_for_status()
        data = response.json()
        raw = data.get("response", "").strip()
        return raw
    except Exception as e:
        print(f"Error querying LLM: {e}")
        return None

def extract_rewrite(original, raw):
    """Strip conversational wrappers and return the clean rewritten paragraph."""
    result = re.sub(r'(?im)^(Rewrite|Output|Here is|Here\'s|Done\.?)\s*:?\s*$', '', raw).strip()
    return result if result else None

def get_top_k_similar(query, corpus, k=5):
    if not corpus:
        return []
    
    def tokenize(text):
        return set(re.findall(r'\w+', text.lower()))
    
    query_tokens = tokenize(query)
    if not query_tokens:
        return corpus[-k:]
        
    scores = []
    for doc in corpus:
        doc_tokens = tokenize(doc)
        if not doc_tokens:
            scores.append((0, doc))
            continue
        intersection = query_tokens.intersection(doc_tokens)
        union = query_tokens.union(doc_tokens)
        jaccard = len(intersection) / len(union)
        scores.append((jaccard, doc))
        
    scores.sort(key=lambda x: x[0], reverse=True)
    return [doc for score, doc in scores[:k]]

def verify_no_contradiction(model, rewritten, established_canon, project_rules):
    if not established_canon or not model:
        return True, ""
        
    relevant_canon = get_top_k_similar(rewritten, established_canon, k=5)
    canon_text = "\n\n".join(relevant_canon)
    
    prompt = f"""You are a strict canon-consistency checker.
PROJECT RULES:
{project_rules}

PREVIOUSLY ESTABLISHED CANON (Context):
{canon_text}

NEWLY GENERATED TEXT:
{rewritten}

TASK: Does the NEWLY GENERATED TEXT contradict the PREVIOUSLY ESTABLISHED CANON or the PROJECT RULES? 
Answer with exactly YES or NO. If YES, briefly explain why on the next line."""
    
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False
    }
    
    try:
        response = requests.post(OLLAMA_API, json=payload, timeout=120)
        response.raise_for_status()
        data = response.json()
        raw = data.get("response", "").strip()
        
        if raw.upper().startswith("YES"):
            return False, raw
        return True, ""
    except Exception as e:
        print(f"Error during verification: {e}")
        return True, ""



def find_paragraphs_with_phrase(text, phrase):
    paragraphs = text.split('\n\n')
    matches = []
    pattern = re.compile(r'\b' + re.escape(phrase) + r'\b', re.IGNORECASE)
    for i, p in enumerate(paragraphs):
        if pattern.search(p):
            matches.append((i, p))
    return paragraphs, matches

def append_to_map_file(map_path, new_record):
    if not map_path: return
    try:
        if os.path.exists(map_path):
            with open(map_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = []
    except Exception:
        data = []
    
    data.append(new_record)
    with open(map_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def process_file(file_path, categories, model, output_dir, map_log_path=None, dry_run=True, in_place=False, pass_number=1):
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()

    original_text = text
    paragraphs = text.split('\n\n')
    file_modified = False
    replacements_made = []

    for cat_name, cat_data in categories.items():
        for phrase, intent_hint in cat_data['targets'].items():
            pattern = re.compile(r'\b' + re.escape(phrase) + r'\b', re.IGNORECASE)
            
            for i, p in enumerate(paragraphs):
                if pattern.search(p):
                    if model:
                        print(f"    -> Processing phrase: '{phrase}' ... ", end="", flush=True)
                        specific_intent = f"{cat_data['intent']} Specifically, replace '{phrase}' with '{intent_hint}'."
                        rewritten = query_llm(model, p, cat_data['theme'], specific_intent, phrase, "")
                        if rewritten and rewritten != p:
                            record = {
                                "file": str(file_path.name),
                                "pass": pass_number,
                                "target_phrase": phrase,
                                "original_text": p,
                                "corrupted_text": rewritten
                            }
                            replacements_made.append(record)
                            if map_log_path:
                                append_to_map_file(map_log_path, record)
                            paragraphs[i] = rewritten
                            file_modified = True
                            print("modified")
                        else:
                            print("unchanged")
                    else:
                        print(f"  [DRY RUN] Would prompt LLM to replace: '{phrase}'")
                        
    if file_modified:
        new_text = '\n\n'.join(paragraphs)
        if dry_run:
            diff = difflib.unified_diff(
                original_text.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"a/{file_path.name}",
                tofile=f"b/{file_path.name}"
            )
            return "".join(diff), file_modified, replacements_made
        else:
            if in_place:
                out_path = file_path
            else:
                out_path = Path(output_dir) / file_path
                out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(new_text)
            return None, file_modified, replacements_made
            
    # Not modified
    if not dry_run and not in_place:
        out_path = Path(output_dir) / file_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(original_text)
            
    return None, file_modified, replacements_made

MAX_PHRASE_ATTEMPTS = 5  # max LLM calls per (phrase, paragraph) per file

def process_file_until_convergence(file_path, map_data, model, output_dir, map_log_path, dry_run, args_in_place, project_rules, established_canon):
    """Drive corruption with per-phrase attempt tracking instead of global pass loops."""
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()

    original_text = text
    paragraphs = text.split('\n\n')
    file_replacements = []

    # attempts[(phrase, para_idx)] -> int
    attempts = {}

    if dry_run:
        return None, []

    if args_in_place:
        target_file = file_path
    else:
        target_file = Path(output_dir) / file_path
        target_file.parent.mkdir(parents=True, exist_ok=True)

    # Copy to output on first pass if not in_place
    if not args_in_place:
        target_file.write_text(text, encoding='utf-8')

    changed_this_round = True
    round_num = 0

    while changed_this_round:
        round_num += 1
        changed_this_round = False
        print(f"\n[{file_path.name}] Pass {round_num}:")

        # Re-read current state of the file
        with open(target_file, 'r', encoding='utf-8') as f:
            text = f.read()
        paragraphs = text.split('\n\n')

        for cat_name, cat_data in map_data.items():
            for phrase, intent_hint in cat_data['targets'].items():
                pattern = re.compile(r'\b' + re.escape(phrase) + r'\b', re.IGNORECASE)

                for i, p in enumerate(paragraphs):
                    if not pattern.search(p):
                        continue

                    key = (phrase, i)
                    if attempts.get(key, 0) >= MAX_PHRASE_ATTEMPTS:
                        continue  # exhausted attempts for this phrase in this paragraph

                    attempts[key] = attempts.get(key, 0) + 1
                    attempt_num = attempts[key]

                    print(f"    -> [{attempt_num}/{MAX_PHRASE_ATTEMPTS}] '{phrase}' ... ", end="", flush=True)
                    specific_intent = f"{cat_data['intent']} Specifically, replace '{phrase}' with '{intent_hint}'."
                    
                    # If previous attempt failed verification, add the failure reason to the specific intent
                    failure_reason = attempts.get(f"{key}_fail_reason", "")
                    if failure_reason:
                        specific_intent += f" PREVIOUS ATTEMPT FAILED VERIFICATION. DO NOT DO THIS: {failure_reason}"
                        
                    rewritten = query_llm(model, p, cat_data['theme'], specific_intent, phrase, project_rules)
                    if rewritten:
                        rewritten = extract_rewrite(p, rewritten)

                    if rewritten and rewritten != p:
                        is_valid, fail_reason = verify_no_contradiction(model, rewritten, established_canon, project_rules)
                        if not is_valid:
                            print(f"REJECTED (Contradiction): {fail_reason}")
                            attempts[f"{key}_fail_reason"] = fail_reason
                            continue
                            
                        record = {
                            "file": str(file_path.name),
                            "pass": round_num,
                            "attempt": attempt_num,
                            "target_phrase": phrase,
                            "original_text": p,
                            "corrupted_text": rewritten
                        }
                        file_replacements.append(record)
                        if map_log_path:
                            append_to_map_file(map_log_path, record)
                        paragraphs[i] = rewritten
                        changed_this_round = True
                        established_canon.append(rewritten)
                        print("modified")
                    else:
                        print("unchanged")

        # Write back after every round
        new_text = '\n\n'.join(paragraphs)
        with open(target_file, 'w', encoding='utf-8') as f:
            f.write(new_text)

    print(f"File {file_path.name} converged after {round_num} pass(es).")
    return None, file_replacements

def main():
    parser = argparse.ArgumentParser(description="Sanitize cards using local LLM")
    parser.add_argument("--map", type=str, required=True, help="Path to pink_elephant_map.json")
    parser.add_argument("--model", type=str, default="R4C3R/qwen3-8b-heretic:q4_k_m", help="Ollama model name (e.g. R4C3R/qwen3-8b-heretic:q4_k_m).")
    parser.add_argument("--apply", action="store_true", help="Apply changes and write them to output_dir instead of generating a diff")
    parser.add_argument("--input_dirs", nargs="+", default=[str(story_root() / "lore"), str(story_root() / "characters")], help="Input directories to process (e.g. 'lore characters' or 'sanitized_output')")
    parser.add_argument("--output_dir", type=str, default=None, help="Directory to write sanitized files (default: <story>/sanitized_output)")
    parser.add_argument("--in_place", action="store_true", help="Overwrite the input files directly in place (ignores output_dir)")
    
    args = parser.parse_args()
    if args.output_dir is None:
        args.output_dir = str(story_root() / "sanitized_output")

    map_data = load_map(args.map)
    target_dirs = [Path(d) for d in args.input_dirs]
    diff_output = []
    
    project_rules = load_project_rules()
    
    map_log_path = "corruption_map.json" if args.apply else None
    
    all_files_to_process = []
    for d in target_dirs:
        if not d.exists():
            continue
        if d.is_file():
            all_files_to_process.append(d)
        else:
            all_files_to_process.extend(d.rglob("*.md"))
            
    # Sort files chronologically by creation time
    all_files_to_process.sort(key=lambda x: os.path.getctime(x))

    established_canon = []

    for file_path in all_files_to_process:
        diff, _ = process_file_until_convergence(file_path, map_data, args.model, args.output_dir, map_log_path, dry_run=not args.apply, args_in_place=args.in_place, project_rules=project_rules, established_canon=established_canon)
        if diff:
            diff_output.append(diff)

    if diff_output and not args.apply:
        diff_path = "sanitization_proposed.diff"
        with open(diff_path, "w", encoding="utf-8") as f:
            f.write("\n".join(diff_output))
        print(f"Dry run complete. Proposed changes written to {diff_path}")
    elif args.apply:
        if args.in_place:
            print("Changes applied and written in place to the input files.")
        else:
            print(f"Changes applied and written to {args.output_dir}/ directory.")
            
        print(f"Appended corruption records to {map_log_path}")

if __name__ == "__main__":
    main()
