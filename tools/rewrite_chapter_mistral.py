#!/usr/bin/env python3
"""
Agentic full-chapter rewrite via Mistral (local Ollama or the hosted Mistral API).

Loads *just enough* context to write or revise one chapter instead of the
whole corpus: the house-style rules, the chapter's own frontmatter/arc,
its immediate neighbors (for continuity), and the top-K most relevant
character/lore/setting/arc cards by lexical overlap with the chapter text
and instruction. Then does a second, separate "rules pass" call that checks
the draft against the rules and selected canon before accepting it.

Usage:
  # Local Ollama (default backend):
  python tools/rewrite_chapter_mistral.py --chapter chapters/08.50_the_wild_game.md \
      --instruction "Slow the opening down, more sensory detail before the hunt starts" \
      --model "R4C3R/qwen3-8b-heretic:q4_k_m"

  # Hosted Mistral API (plain chat model):
  python tools/rewrite_chapter_mistral.py --chapter chapters/08.50_the_wild_game.md \
      --instruction "..." --api mistral --model mistral-large-latest \
      --api-key "$MISTRAL_API_KEY"

  # Hosted Mistral Agents API (a pre-configured agent, referenced by agent_id):
  python tools/rewrite_chapter_mistral.py --chapter chapters/08.50_the_wild_game.md \
      --instruction "..." --api mistral-agent --agent-id ag_01a035030f1d77c4bae04d09d8fc9251 \
      --api-key "$MISTRAL_API_KEY"

  # Apply in place once you're happy with the diff:
  python tools/rewrite_chapter_mistral.py --chapter chapters/08.50_the_wild_game.md \
      --instruction "..." --apply

  # Quick smoke test of the pipeline (rules + explicit-language enforcement)
  # against a short euphemistic sample, no chapter file needed:
  python tools/rewrite_chapter_mistral.py --test-corruption
"""
import argparse
import difflib
import os
import re
from pathlib import Path

import requests

from story_paths import story_root

ROOT = Path(__file__).resolve().parent.parent
CONTENT_ROOT = story_root()  # active stories/<name>/ tree -- see story_paths.py
OLLAMA_API = "http://localhost:11434/api/generate"
MISTRAL_API = "https://api.mistral.ai/v1/chat/completions"
MISTRAL_AGENTS_API = "https://api.mistral.ai/v1/agents/completions"
DEFAULT_AGENT_ID = "ag_01a035030f1d77c4bae04d09d8fc9251"

# A deliberately euphemism-riddled sample (same register as the corpus's old
# corruption-pipeline test fixture) for exercising the rewrite+rules-pass
# pipeline without touching real chapter files.
CORRUPTION_TEST_SAMPLE = (
    "He pressed his weight against the bench. She felt a building warmth as "
    "his manhood finally breached her core. They shared a moment of quiet "
    "intensity before he was spent, sending a shuddering wave through her "
    "trembling frame."
)

RULES_DIR = CONTENT_ROOT / ".agents" / "rules"
CONTEXT_DIRS = ["characters", "lore", "setting", "plot/arcs"]
CHAPTERS_DIR = CONTENT_ROOT / "chapters"
ARCS_DIR = CONTENT_ROOT / "plot" / "arcs"
MISTRAL_DIR = CONTENT_ROOT / "chapters" / "mistral"

ARC_ORDER_RE = re.compile(r"^(\d+(?:\.\d+)?)_")


def sorted_arc_names():
    """plot/arcs/*.md basenames (no extension) in reading order, by the
    numeric/decimal prefix in the filename — same convention as the arc
    numbering itself (10, 21, 24.10, 24.80, 31, 58.60...)."""
    def key(p):
        m = ARC_ORDER_RE.match(p.name)
        return float(m.group(1)) if m else float("inf")
    return [p.stem for p in sorted(ARCS_DIR.glob("*.md"), key=key)]


def neighbor_prose(arc_rel_path, mistral_dir=MISTRAL_DIR):
    """Raw prose text (no rules/context compacting — this is for tone and
    flow continuity only) of the previous and next arc's generated
    chapter, by arc reading order, whichever of those exist and are
    non-empty. Returns (prev_text, next_text), each "" if unavailable."""
    basename = Path(arc_rel_path).stem
    names = sorted_arc_names()
    if basename not in names:
        return "", ""
    idx = names.index(basename)

    def read_if_present(name):
        f = mistral_dir / f"{name}.md"
        if f.is_file():
            text = f.read_text(encoding="utf-8").strip()
            if text:
                return text
        return ""

    prev_text = read_if_present(names[idx - 1]) if idx > 0 else ""
    next_text = read_if_present(names[idx + 1]) if idx + 1 < len(names) else ""
    return prev_text, next_text

RULES_PRECEDENCE = [
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
    "dark-fantasy.md",
    "chapter-prose-and-subtext.md",
]


CARD_RE = re.compile(r"^(.+?)_\d\d_")


def load_rules():
    """Most rule files were split (see tools/split_rules.py) into flat
    per-section cards alongside their monolithic original. Loading both
    would double every one of those rules and roughly double the total
    rules payload — skip a card whenever its own monolithic original is
    still present and will be loaded in full anyway; only fall back to
    the cards for the two rules (canon_bias_cards, explicit-lexicon)
    whose originals were removed because nothing else referenced them."""
    text = ""
    if not RULES_DIR.exists():
        return text
    all_names = {f.name for f in RULES_DIR.glob("*.md")}
    seen = set()
    for name in RULES_PRECEDENCE:
        f = RULES_DIR / name
        if f.exists():
            text += f"\n--- {f.name} ---\n{f.read_text(encoding='utf-8')}\n"
            seen.add(f.name)
    for f in sorted(RULES_DIR.glob("*.md")):
        if f.name in seen:
            continue
        m = CARD_RE.match(f.name)
        if m:
            original = m.group(1).replace("_", "-") + ".md"
            if original in all_names:
                continue  # redundant with the monolithic file loaded above
        text += f"\n--- {f.name} ---\n{f.read_text(encoding='utf-8')}\n"
    return text


def parse_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    fm_raw, body = m.groups()
    fm = {}
    for line in fm_raw.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip().strip('"')
    return fm, body


def tokenize(text):
    return set(re.findall(r"[a-z']+", text.lower()))


def jaccard(a_tokens, b_tokens):
    if not a_tokens or not b_tokens:
        return 0.0
    inter = len(a_tokens & b_tokens)
    union = len(a_tokens | b_tokens)
    return inter / union if union else 0.0


def collect_corpus():
    docs = []
    for rel in CONTEXT_DIRS:
        base = CONTENT_ROOT / rel
        if not base.exists():
            continue
        for f in sorted(base.rglob("*.md")):
            docs.append(f)
    return docs


def top_k_relevant(query_tokens, docs, k, min_score=0.02):
    scored = []
    for f in docs:
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            continue
        score = jaccard(query_tokens, tokenize(text))
        scored.append((score, f, text))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [(f, text) for score, f, text in scored[:k] if score >= min_score]


def load_all_chapters():
    chapters = []
    for f in sorted(CHAPTERS_DIR.glob("*.md")):
        fm, body = parse_frontmatter(f.read_text(encoding="utf-8"))
        try:
            order = float(fm.get("order", "inf"))
        except ValueError:
            order = float("inf")
        chapters.append({"path": f, "fm": fm, "body": body, "order": order})
    chapters.sort(key=lambda c: c["order"])
    return chapters


def neighbor_blurbs(chapter_path, chapters, window=1):
    idx = next((i for i, c in enumerate(chapters) if c["path"] == chapter_path), None)
    if idx is None:
        return ""
    lo, hi = max(0, idx - window), min(len(chapters), idx + window + 1)
    parts = []
    for c in chapters[lo:hi]:
        tag = "THIS CHAPTER" if c["path"] == chapter_path else ("PREV" if chapters.index(c) < idx else "NEXT")
        blurb = c["fm"].get("blurb", "")
        parts.append(f"[{tag}] {c['path'].name} (order {c['fm'].get('order','?')}, arc: {c['fm'].get('arc','?')}): {blurb}")
    return "\n".join(parts)


def query_ollama(model, prompt, timeout=240):
    payload = {"model": model, "prompt": prompt, "stream": False}
    try:
        response = requests.post(OLLAMA_API, json=payload, timeout=timeout)
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except Exception as e:
        print(f"Error querying Ollama: {e}")
        return None


def query_mistral_api(model, prompt, api_key, timeout=240):
    if not api_key:
        print("Error: --api mistral requires --api-key (or MISTRAL_API_KEY env var).")
        return None
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": [{"role": "user", "content": prompt}]}
    try:
        response = requests.post(MISTRAL_API, headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"Error querying Mistral API: {e}")
        return None


def query_mistral_agent(agent_id, prompt, api_key, timeout=240):
    if not api_key:
        print("Error: --api mistral-agent requires --api-key (or MISTRAL_API_KEY env var).")
        return None
    if not agent_id:
        print("Error: --api mistral-agent requires --agent-id.")
        return None
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"agent_id": agent_id, "messages": [{"role": "user", "content": prompt}]}
    try:
        response = requests.post(MISTRAL_AGENTS_API, headers=headers, json=payload, timeout=timeout)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"Error querying Mistral Agents API: {e}")
        return None


def query_llm(backend, model, prompt, api_key=None, agent_id=None, timeout=240):
    if backend == "mistral-agent":
        return query_mistral_agent(agent_id, prompt, api_key, timeout=timeout)
    if backend == "mistral":
        return query_mistral_api(model, prompt, api_key, timeout=timeout)
    return query_ollama(model, prompt, timeout=timeout)


DRIVER_JS = ROOT / ".claude" / "skills" / "world-lint" / "driver.mjs"


def load_compacted_context(arc_rel_path, depth=2, max_words=8000, beat=None):
    """Runs the lore driver's `context` command for the given arc (or,
    with `beat`, just that beat's card — see tools/split_arc_beats.py)
    and returns its stdout: the arc/beat itself plus every card actually
    reachable from it (weighted by how many places reference it), and
    every always_on rule section actually relevant to it — instead of
    dumping every rule file and a lexical top-k guess. Raises if node or
    the arc file isn't found; caller decides whether to fall back."""
    import subprocess
    cmd = ["node", str(DRIVER_JS), "context", arc_rel_path, "--depth", str(depth), "--max-words", str(max_words)]
    if beat is not None:
        cmd += ["--beat", str(beat)]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)
    return result.stdout


def count_beats(arc_rel_path):
    """How many beat cards exist for this arc (0 if it wasn't split)."""
    basename = Path(arc_rel_path).stem
    beats_dir = CONTENT_ROOT / "plot" / "arcs" / "beats" / basename
    if not beats_dir.is_dir():
        return 0
    return len(list(beats_dir.glob("[0-9][0-9].md")))


def strip_wrapper(raw):
    # Reasoning models (this project's default, R4C3R/qwen3-8b-heretic, among
    # them) emit a <think>...</think> block of scratch reasoning before the
    # actual answer — strip it (and a stray unterminated opening tag if the
    # response got cut off mid-thought) before anything else touches the text.
    raw = re.sub(r'(?is)<think>.*?</think>\s*', '', raw)
    raw = re.sub(r'(?is)^<think>.*', '', raw).strip()
    raw = re.sub(r'(?im)^(Here is|Here\'s|Rewrite|Output|Done\.?)\s*:?\s*\n?', '', raw).strip()
    raw = re.sub(r'^```(?:markdown)?\n', '', raw)
    raw = re.sub(r'\n```$', '', raw)
    return raw.strip()


CHAPTER_COMPLETE_TOKEN = "[CHAPTER COMPLETE]"
BEAT_COMPLETE_TOKEN = "[BEAT COMPLETE]"


def build_neighbor_block(prev_text, next_text, tail_words=600, head_words=600):
    """Raw prev/next chapter prose for tone-and-flow continuity — not run
    through the rules/context compactor, just the actual neighboring text
    trimmed to the end/start closest to this chapter."""
    parts = []
    if prev_text:
        words = prev_text.split()
        excerpt = " ".join(words[-tail_words:]) if len(words) > tail_words else prev_text
        parts.append(f"--- END OF PREVIOUS CHAPTER (for tone/flow only, do not repeat or re-narrate this) ---\n{excerpt}")
    if next_text:
        words = next_text.split()
        excerpt = " ".join(words[:head_words]) if len(words) > head_words else next_text
        parts.append(f"--- START OF NEXT CHAPTER (for tone/flow only — this chapter must lead into it, but do not write into it) ---\n{excerpt}")
    if not parts:
        return ""
    return "\nCONTINUITY (raw neighboring prose, unprocessed):\n" + "\n\n".join(parts) + "\n"


def build_chunk_prompt(rules, chapter_fm, context_block, instruction, draft_so_far, chunk_chars,
                        beat_info=None, is_last_beat=True, neighbor_block=""):
    complete_token = CHAPTER_COMPLETE_TOKEN if is_last_beat else BEAT_COMPLETE_TOKEN
    complete_meaning = (
        "the chapter is now complete" if is_last_beat
        else "the CURRENT BEAT specifically is now fully dramatized (the chapter continues into the next beat after this)"
    )
    beat_block = f"\nCURRENT BEAT (write only this beat's content right now, nothing from later beats):\n{beat_info}\n" if beat_info else ""
    return f"""You are the sole prose writer for a serialized dark-fantasy erotica story, writing ONE chapter
in small, tightly-controlled increments so each piece stays precise and on-model.

PROJECT STORY WRITING STYLE RULES:
{rules}

CHAPTER METADATA:
arc: {chapter_fm.get('arc', '?')}
blurb: {chapter_fm.get('blurb', '?')}

{context_block}
{beat_block}{neighbor_block}
INSTRUCTION FOR THE WHOLE CHAPTER:
{instruction}

CHAPTER SO FAR (everything written up to this point — continue directly from the end of this, do not repeat or restart it):
{draft_so_far if draft_so_far.strip() else '[nothing written yet — write the opening]'}

TASK: Write the NEXT continuation only, roughly {chunk_chars} characters (about one to two sentences) —
short, but a complete thought, not cut off mid-word or mid-clause. Stay in the current scene, voice, and
register the chapter has already established. Do not summarize, do not skip ahead, do not restate anything
already written. Explicit, direct, anatomical language per the lexicon/sex-scene rules above — no euphemism,
no fade-to-black.

If {complete_meaning}, output exactly `{complete_token}` and nothing else instead of continuing.

Output ONLY the next continuation (or the completion token), no meta-commentary, no "Here is the next part":"""


def build_smoothing_prompt(rules, chapter_fm, context_block, draft, neighbor_block=""):
    return f"""You are copyediting ONE chapter of a serialized dark-fantasy erotica story. This chapter was
written in many small, separately-generated increments and pasted together — it will read choppy: abrupt
sentence-to-sentence transitions, occasional repeated phrasing or restated beats where one continuation
picked up slightly wrong, inconsistent tense or POV distance from seam to seam.

PROJECT STORY WRITING STYLE RULES:
{rules}

CHAPTER METADATA:
arc: {chapter_fm.get('arc', '?')}
blurb: {chapter_fm.get('blurb', '?')}

{context_block}
{neighbor_block}
DRAFT TO SMOOTH (assembled from small increments):
{draft}

TASK: Rewrite this as one smooth, continuous chapter. Fix transitions between what were separate
continuations, remove any repetition or restated beats, correct tense/POV drift, and make it read as if
one person wrote it start to finish in a single pass. Do NOT summarize, shorten, cut content, or soften
anything explicit — preserve every beat, every explicit detail, and the full length. This is a polish
pass for flow and consistency only, not a content edit.

Output ONLY the smoothed chapter body markdown (the "# Title" heading plus prose), no meta-commentary."""


def _run_chunk_loop(backend, model, rules, chapter_fm, context_block, instruction, draft,
                     chunk_chars, max_chunks, api_key, agent_id, beat_info=None, is_last_beat=True,
                     neighbor_block="", timeout=240):
    complete_token = CHAPTER_COMPLETE_TOKEN if is_last_beat else BEAT_COMPLETE_TOKEN
    for i in range(1, max_chunks + 1):
        prompt = build_chunk_prompt(rules, chapter_fm, context_block, instruction, draft, chunk_chars,
                                     beat_info=beat_info, is_last_beat=is_last_beat, neighbor_block=neighbor_block)
        piece = query_llm(backend, model, prompt, api_key=api_key, agent_id=agent_id, timeout=timeout)
        if not piece:
            print(f"    chunk {i}: no response, stopping.")
            break
        piece = strip_wrapper(piece)
        if complete_token in piece:
            print(f"    chunk {i}: model signaled {'chapter' if is_last_beat else 'beat'} complete.")
            break
        if not piece:
            print(f"    chunk {i}: empty continuation, stopping.")
            break
        sep = "" if not draft or draft.endswith(("\n", " ")) or piece.startswith(("\n", " ")) else " "
        draft += sep + piece
        print(f"    chunk {i}: +{len(piece)} chars (total {len(draft)} chars, {len(draft.split())} words)")
    else:
        print(f"    Reached --max-chunks-per-beat ({max_chunks}) without a completion signal; moving on anyway.")
    return draft


def generate_chunked(backend, model, chapter_fm, instruction,
                      rules="", context_block="", arc_rel_path=None,
                      context_depth=1, context_max_words=2500,
                      chunk_chars=175, max_chunks_per_beat=15, api_key=None, agent_id=None,
                      timeout=240):
    """Generates the chapter in small ~chunk_chars-character continuations
    instead of one large generation, then returns the raw concatenated
    draft (smoothing happens separately, after this returns).

    When `arc_rel_path` has beat cards (see tools/split_arc_beats.py),
    loops beat by beat, reloading a small compacted context scoped to
    just that beat each time — a chunked generation calls the model
    dozens of times, and resending the whole arc's ~10k-word context on
    every single call would multiply that cost for no benefit; a beat's
    own compacted context is usually under 5k words. Falls back to the
    single static `rules`/`context_block` passed in when the arc has no
    beat cards."""
    n_beats = count_beats(arc_rel_path) if arc_rel_path else 0
    draft = ""

    neighbor_block = ""
    if arc_rel_path:
        prev_text, next_text = neighbor_prose(arc_rel_path)
        neighbor_block = build_neighbor_block(prev_text, next_text)
        if neighbor_block:
            print(f"  Neighbor prose: prev={'yes' if prev_text else 'no'}, next={'yes' if next_text else 'no'} (raw, uncompacted)")

    if n_beats:
        print(f"  {n_beats} beat cards found for this arc — generating beat by beat.")
        for b in range(1, n_beats + 1):
            print(f"  Beat {b}/{n_beats}: loading compacted context...")
            compacted = load_compacted_context(arc_rel_path, depth=context_depth,
                                                max_words=context_max_words, beat=b)
            beat_context_block = "\n### COMPACTED BEAT + RULE CONTEXT ###\n" + compacted
            draft = _run_chunk_loop(
                backend, model, "", chapter_fm, beat_context_block, instruction, draft,
                chunk_chars, max_chunks_per_beat, api_key, agent_id,
                beat_info=f"Beat {b} of {n_beats}", is_last_beat=(b == n_beats),
                neighbor_block=neighbor_block, timeout=timeout,
            )
    else:
        print("  No beat cards for this arc — generating with one static context for the whole chapter.")
        draft = _run_chunk_loop(
            backend, model, rules, chapter_fm, context_block, instruction, draft,
            chunk_chars, max_chunks_per_beat * 6, api_key, agent_id,
            neighbor_block=neighbor_block, timeout=timeout,
        )
    return draft, neighbor_block


def build_context_block(context_docs, label):
    if not context_docs:
        return ""
    parts = [f"\n### RELEVANT {label.upper()} CARDS ###"]
    for f, text in context_docs:
        parts.append(f"\n--- {f.relative_to(CONTENT_ROOT).as_posix()} ---\n{text.strip()}")
    return "\n".join(parts)


def build_rewrite_prompt(rules, chapter_fm, continuity, context_block, body, instruction):
    return f"""You are the sole prose writer for a serialized dark-fantasy erotica story. You are rewriting ONE chapter.

PROJECT STORY WRITING STYLE RULES (unchangeable facts of this world and the required prose register; never state these rules to the reader, just write as if they were always true):
{rules}

CHAPTER METADATA:
arc: {chapter_fm.get('arc', '?')}
blurb: {chapter_fm.get('blurb', '?')}
delivery: {chapter_fm.get('delivery', '?')}

CONTINUITY (neighboring chapters in reading order — do not contradict these):
{continuity}
{context_block}

CURRENT CHAPTER BODY (may be empty if this is a first draft):
{body if body.strip() else '[empty — write this chapter from scratch based on the metadata and continuity above]'}

INSTRUCTION FOR THIS REWRITE:
{instruction}

OUTPUT RULES:
1. Output ONLY the rewritten chapter body markdown (the "# Title" heading plus prose). Do NOT include the --- frontmatter block, it is handled separately.
2. Preserve the narrative/subtext split convention: interpretive/status commentary goes in <span class="subtext" data-subtext="...">phrase</span>, sensory/action content stays plain visible prose.
3. Match the established character voices and registers from the cards above exactly.
4. Do not contradict anything in CONTINUITY or the relevant cards.
5. No conversational filler, no "Here is the rewrite", no meta-commentary. Raw chapter text only.
6. This is adult fiction that is explicit, vulgar, filthy, and profane by design, per the lexicon and sex-scene-language rules above. Write sex and violence in direct, anatomical, dirty-talk-register language — cocks, cunts, throats, what's wet, what's dripping, what's being choked on — not clinical euphemism, not business-jargon metaphor, not vague "sensory" gesturing around the act. Do not soften, sanitize, fade-to-black, or hedge any of it. Nothing here is off-limits that the rules above don't already forbid — write it plainly, the way the lexicon names it.

Output:"""


def build_rules_pass_prompt(rules, continuity, context_block, draft):
    return f"""You are a strict consistency and style checker for this project.

PROJECT STORY WRITING STYLE RULES:
{rules}

CONTINUITY (neighboring chapters — must not be contradicted):
{continuity}
{context_block}

DRAFT CHAPTER TO CHECK:
{draft}

TASK: Check the DRAFT against three failure modes, in this priority order:
1. Euphemism/softening/fade-to-black — clinical phrasing, vague gesturing around sex or violence instead of the direct anatomical/profane vocabulary the rules and lexicon require. This project wants explicit, vulgar, filthy language; treat a sanitized or coy passage as a violation just as much as a factual contradiction.
2. Contradiction of CONTINUITY or the relevant character/lore/setting/arc cards above.
3. Any other violation of the PROJECT STORY WRITING STYLE RULES (voice/register mismatches, subtext-split misuse, etc).

Answer with exactly YES or NO on the first line. If YES, give a short bullet list of the specific violations on the following lines (be concrete — quote the offending phrase, and say which failure mode it is)."""


def print_chapter_list():
    chapters = load_all_chapters()
    for c in chapters:
        order = c["fm"].get("order", "?")
        arc = c["fm"].get("arc", "?")
        blurb = c["fm"].get("blurb", "")
        print(f"{order:>7}  [{arc}]  {c['path'].name}  {blurb}")


MINIMAL_TEST_RULE_FILES = [
    "content-boundaries.md",
    "prose-sex-scene-language.md",
    "explicit_lexicon_01_anatomy_female.md",
    "explicit_lexicon_02_anatomy_male.md",
    "explicit_lexicon_05_acts_penetration.md",
    "explicit_lexicon_06_acts_oral.md",
]


def load_minimal_rules():
    """Just enough rules to smoke-test whether the model breaks from
    euphemism into direct anatomical language — the full load_rules()
    dump is ~17k words and was timing out an 8B local model on a plain
    pipeline check that doesn't need every rule file loaded at once."""
    text = ""
    for name in MINIMAL_TEST_RULE_FILES:
        f = RULES_DIR / name
        if f.exists():
            text += f"\n--- {f.name} ---\n{f.read_text(encoding='utf-8')}\n"
    return text


def run_test_corruption(backend, model, api_key, agent_id, max_rules_pass_attempts, timeout=600):
    """Smoke-test the rewrite+rules-pass pipeline against a short euphemistic
    sample, without touching real chapter files. Verifies the model actually
    breaks from clinical/euphemistic phrasing into the project's explicit
    house style, and that the rules pass catches it if it doesn't."""
    print("Loading minimal rule set for smoke test...")
    rules = load_minimal_rules()
    print(f"  {len(rules.split())} words of rules (vs ~17k for the full set) — should be fast even on a local 8B model.")

    fake_fm = {"arc": "(test)", "blurb": "Pipeline smoke test", "delivery": "test"}
    instruction = (
        "Rewrite this sample in the project's explicit house style: direct anatomical "
        "vocabulary from the lexicon, no euphemism, natural flowing prose."
    )

    print(f"Requesting rewrite from {backend}:{model}...")
    prompt = build_rewrite_prompt(rules, fake_fm, "", "", CORRUPTION_TEST_SAMPLE, instruction)
    draft = query_llm(backend, model, prompt, api_key=api_key, agent_id=agent_id, timeout=timeout)
    if not draft:
        print("No response from model. Aborting test.")
        return
    draft = strip_wrapper(draft)

    print("\n--- ORIGINAL (euphemistic) ---")
    print(CORRUPTION_TEST_SAMPLE)
    print("\n--- REWRITE ---")
    print(draft)

    attempt = 0
    while attempt < max_rules_pass_attempts:
        attempt += 1
        print(f"\nRunning rules pass (attempt {attempt}/{max_rules_pass_attempts})...")
        check_prompt = build_rules_pass_prompt(rules, "", "", draft)
        verdict = query_llm(backend, model, check_prompt, api_key=api_key, agent_id=agent_id, timeout=timeout)
        if not verdict:
            print("  Rules pass produced no response.")
            break
        verdict = strip_wrapper(verdict)
        print(f"  Verdict:\n{verdict}")
        if verdict.strip().upper().startswith("NO"):
            break
        if attempt >= max_rules_pass_attempts:
            break
        fix_prompt = prompt + f"\n\nPREVIOUS DRAFT FAILED THE RULES PASS FOR THESE REASONS, FIX THEM:\n{verdict}\n\nPREVIOUS DRAFT:\n{draft}"
        redraft = query_llm(backend, model, fix_prompt, api_key=api_key, agent_id=agent_id, timeout=timeout)
        if redraft:
            draft = strip_wrapper(redraft)
            print("\n--- REDRAFT ---")
            print(draft)

    word_count = len(draft.split())
    print(f"\nWord count: {word_count}")


def main():
    parser = argparse.ArgumentParser(description="Agentic chapter rewrite via Mistral (Ollama or hosted API)")
    parser.add_argument("--chapter", type=str, help="Path to the chapter file under chapters/")
    parser.add_argument("--instruction", type=str, help="What to change/write for this chapter")
    parser.add_argument("--list-chapters", action="store_true", help="Print all chapters in true reading order (by frontmatter 'order', not filename) and exit")
    parser.add_argument("--test-corruption", action="store_true", help="Run the pipeline against a short euphemistic sample to smoke-test rewrite+rules-pass, no chapter file needed")
    parser.add_argument("--api", choices=["ollama", "mistral", "mistral-agent"], default="ollama", help="Backend: local Ollama, the hosted Mistral chat API, or a Mistral Agent (by agent_id)")
    parser.add_argument("--api-key", type=str, default=os.environ.get("MISTRAL_API_KEY"), help="Mistral API key (used with --api mistral / mistral-agent); defaults to MISTRAL_API_KEY env var")
    parser.add_argument("--agent-id", type=str, default=DEFAULT_AGENT_ID, help="Mistral agent_id (only used with --api mistral-agent)")
    parser.add_argument("--model", type=str, default=None, help="Model name. Default is 'R4C3R/qwen3-8b-heretic:q4_k_m' for --api ollama, 'mistral-large-latest' for --api mistral. Ignored for --api mistral-agent (use --agent-id instead)")
    parser.add_argument("--k-characters", type=int, default=4)
    parser.add_argument("--k-lore", type=int, default=3)
    parser.add_argument("--k-setting", type=int, default=2)
    parser.add_argument("--k-arcs", type=int, default=2)
    parser.add_argument("--neighbor-window", type=int, default=1, help="How many chapters before/after to include for continuity")
    parser.add_argument("--arc", type=str, default=None, help="Path to the plot/arcs/*.md file this chapter dramatizes. When given, replaces the wholesale rules dump + lexical top-k card search with the lore driver's `context` compactor (arc + only the cards/rule sections actually reachable from it) — much smaller prompt, and the rules loaded are scoped to what's actually relevant instead of everything.")
    parser.add_argument("--context-depth", type=int, default=2, help="--depth passed to the driver's context command (only used with --arc)")
    parser.add_argument("--context-max-words", type=int, default=8000, help="--max-words passed to the driver's context command (only used with --arc)")
    parser.add_argument("--chunked", action="store_true", help="Generate in small ~--chunk-chars continuations (beat by beat if the arc has beat cards, see tools/split_arc_beats.py) instead of one large generation, then run a final smoothing pass over the assembled draft. Requires --arc.")
    parser.add_argument("--chunk-chars", type=int, default=175, help="Target size of each continuation in --chunked mode, in characters (~150-200 is one to two sentences)")
    parser.add_argument("--max-chunks-per-beat", type=int, default=15, help="Safety cap on continuations per beat (or for the whole chapter, x6, if the arc has no beat cards) in --chunked mode")
    parser.add_argument("--beat-context-depth", type=int, default=1, help="--depth for each beat's compacted context in --chunked mode")
    parser.add_argument("--beat-context-max-words", type=int, default=2500, help="--max-words for each beat's compacted context in --chunked mode")
    parser.add_argument("--max-rules-pass-attempts", type=int, default=2)
    parser.add_argument("--apply", action="store_true", help="Write the rewrite back to the chapter file; default is dry-run diff")
    parser.add_argument("--timeout", type=int, default=240, help="Per-call timeout in seconds. Local CPU-bound inference on a reasoning model can be very slow (observed 20+ min for a 4-call smoke test) — raise this well above the default for --chunked runs or slow hardware.")
    args = parser.parse_args()

    model = args.model or ("mistral-large-latest" if args.api == "mistral" else "R4C3R/qwen3-8b-heretic:q4_k_m")

    if args.list_chapters:
        print_chapter_list()
        return

    if args.test_corruption:
        run_test_corruption(args.api, model, args.api_key, args.agent_id, args.max_rules_pass_attempts, timeout=args.timeout)
        return

    if not args.chapter or not args.instruction:
        parser.error("--chapter and --instruction are required unless --list-chapters/--test-corruption is given")

    chapter_path = Path(args.chapter)
    if not chapter_path.is_absolute():
        chapter_path = CONTENT_ROOT / chapter_path
    original_text = chapter_path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(original_text)

    print("Loading chapter corpus for continuity...")
    chapters = load_all_chapters()
    continuity = neighbor_blurbs(chapter_path, chapters, window=args.neighbor_window)

    if args.arc:
        print(f"Loading compacted context for arc {args.arc}...")
        compacted = load_compacted_context(args.arc, depth=args.context_depth, max_words=args.context_max_words)
        # The compactor's output already includes the arc's own body text as
        # its first section and the relevant rule sections/cards after it —
        # feed it as the context block and leave `rules` empty so it isn't
        # duplicated in the prompt.
        rules = ""
        context_block = "\n### COMPACTED ARC + RULE CONTEXT ###\n" + compacted
    else:
        print("Loading rules...")
        rules = load_rules()

        print("Selecting relevant context cards...")
        query_tokens = tokenize(body + " " + args.instruction + " " + fm.get("blurb", ""))
        docs_by_dir = {}
        for rel in CONTEXT_DIRS:
            base = CONTENT_ROOT / rel
            docs_by_dir[rel] = sorted(base.rglob("*.md")) if base.exists() else []

        char_docs = top_k_relevant(query_tokens, docs_by_dir["characters"], args.k_characters)
        lore_docs = top_k_relevant(query_tokens, docs_by_dir["lore"], args.k_lore)
        setting_docs = top_k_relevant(query_tokens, docs_by_dir["setting"], args.k_setting)
        arc_docs = top_k_relevant(query_tokens, docs_by_dir["plot/arcs"], args.k_arcs)

        for label, docs in [("characters", char_docs), ("lore", lore_docs), ("setting", setting_docs), ("arcs", arc_docs)]:
            names = ", ".join(f.relative_to(CONTENT_ROOT).as_posix() for f, _ in docs) or "(none matched)"
            print(f"  {label}: {names}")

        context_block = "".join([
            build_context_block(char_docs, "character"),
            build_context_block(lore_docs, "lore"),
            build_context_block(setting_docs, "setting"),
            build_context_block(arc_docs, "arc"),
        ])

    if args.chunked:
        if not args.arc:
            parser.error("--chunked requires --arc")
        print(f"Generating chunked from {args.api}:{model} ({args.chunk_chars} chars/chunk)...")
        draft, neighbor_block = generate_chunked(
            args.api, model, fm, args.instruction,
            arc_rel_path=args.arc, context_depth=args.beat_context_depth,
            context_max_words=args.beat_context_max_words,
            chunk_chars=args.chunk_chars, max_chunks_per_beat=args.max_chunks_per_beat,
            api_key=args.api_key, agent_id=args.agent_id,
        )
        if not draft.strip():
            print("No content generated. Aborting.")
            return
        print(f"\nAssembled draft: {len(draft)} chars, {len(draft.split())} words. Running smoothing pass...")
        smooth_prompt = build_smoothing_prompt(rules, fm, context_block, draft, neighbor_block=neighbor_block)
        smoothed = query_llm(args.api, model, smooth_prompt, api_key=args.api_key, agent_id=args.agent_id, timeout=args.timeout)
        if smoothed:
            draft = strip_wrapper(smoothed)
        else:
            print("  Smoothing pass produced no response; keeping the unsmoothed assembled draft.")
        rewrite_prompt = ""  # not used by the rules-pass fix loop below in chunked mode
    else:
        print(f"Requesting rewrite from {args.api}:{model}...")
        rewrite_prompt = build_rewrite_prompt(rules, fm, continuity, context_block, body, args.instruction)
        draft = query_llm(args.api, model, rewrite_prompt, api_key=args.api_key, agent_id=args.agent_id, timeout=args.timeout)
        if not draft:
            print("No response from model. Aborting.")
            return
        draft = strip_wrapper(draft)

    attempt = 0
    while attempt < args.max_rules_pass_attempts:
        attempt += 1
        print(f"Running rules pass (attempt {attempt}/{args.max_rules_pass_attempts})...")
        check_prompt = build_rules_pass_prompt(rules, continuity, context_block, draft)
        verdict = query_llm(args.api, model, check_prompt, api_key=args.api_key, agent_id=args.agent_id, timeout=args.timeout)
        if not verdict:
            print("  Rules pass produced no response; keeping draft as-is.")
            break
        verdict = strip_wrapper(verdict)
        if verdict.strip().upper().startswith("NO"):
            print("  Rules pass: clean.")
            break
        print(f"  Rules pass flagged issues:\n{verdict}")
        if attempt >= args.max_rules_pass_attempts:
            print("  Max rules-pass attempts reached; keeping last draft despite flagged issues. Review the diff manually.")
            break
        fix_prompt = rewrite_prompt + f"\n\nPREVIOUS DRAFT FAILED THE RULES PASS FOR THESE REASONS, FIX THEM:\n{verdict}\n\nPREVIOUS DRAFT:\n{draft}"
        redraft = query_llm(args.api, model, fix_prompt, api_key=args.api_key, agent_id=args.agent_id, timeout=args.timeout)
        if redraft:
            draft = strip_wrapper(redraft)

    fm_lines = "\n".join(f"{k}: {v}" if k not in ("blurb",) else f'{k}: "{v}"' for k, v in fm.items())
    new_text = f"---\n{fm_lines}\n---\n{draft}\n" if fm else draft

    if args.apply:
        chapter_path.write_text(new_text, encoding="utf-8")
        print(f"Applied rewrite to {chapter_path}")
    else:
        diff = difflib.unified_diff(
            original_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"a/{chapter_path.name}",
            tofile=f"b/{chapter_path.name}",
        )
        diff_text = "".join(diff)
        out_path = CONTENT_ROOT / "sanitized_output" / f"{chapter_path.stem}.rewrite.diff"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(diff_text, encoding="utf-8")
        print(f"Dry run complete. Diff written to {out_path}")


if __name__ == "__main__":
    main()
