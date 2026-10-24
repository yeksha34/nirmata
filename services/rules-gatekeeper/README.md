# rules-gatekeeper

A small LLM fine-tuned **only** on the agent rule cards from `stories-repo`
(`stories/story/.agents/rules/*.md` and `.agents/constrained-agentic-bias.md`) —
never on chapters, never on any other card type. It is meant to do two things:

1. **Generate** short passages that comply with the rule set.
2. **Judge** a card (any markdown file with frontmatter — chapter, arc,
   character, lore, plot) against the rule set and reject it with a
   rule-by-rule explanation when it violates one.

Training data, weights, and the LoRA adapter are published on Hugging Face.
A GGUF export is produced so the model can also be loaded into a local
Ollama install and called the way `story-editor` already calls its other
local model (`tools/rewrite_chapter_mistral.py`'s `query_ollama()`).

## Scope note: this is rules-only, not a style/voice model

This repo deliberately trains on rule text alone — no chapter prose ever
enters `data/dataset.jsonl`. That is a hard constraint, not a placeholder to
relax later without thinking it through. If you ever want a companion model
that also captures the story's actual prose voice (so generation reads like
the corpus, not just complies with it), that is a **separate, larger
undertaking** with its own requirements, distinct from anything in this
repo:

- **Consent and provenance**: the chapters are the user's own long-running
  creative work, not public rule text — decide explicitly whether/how a
  style model gets built, published, or shared before touching it, rather
  than defaulting to the same open Hugging Face flow used here for rules.
- **Data volume**: `stories/story/chapters/*.md` is ~76 files / ~159k words
  per the last count — enough to matter, but still small by fine-tuning
  standards for voice transfer; expect to need data augmentation
  (paraphrase/chunking passes) or a full fine-tune rather than a light LoRA
  to actually move the base model's style, not just nudge it.
- **Keep the artifacts separate**: a style-trained model must not be
  marketed or shipped as "rules-gatekeeper" — this repo's whole premise
  (verifiable in `data/build_dataset.py`, source-traceable per example) is
  that its judgments come from rules alone. A style model should be its own
  repo/adapter/model card so the rules-only claim here stays true and
  auditable.
- **Different evaluation**: rule compliance is checkable against the rule's
  own `Check` question; voice quality is not — it needs actual human
  read-through against known chapters, not an automated verdict.
- **Same hardware class, more of it**: still QLoRA/full-fine-tune-on-GPU
  territory (see Hardware requirements below), but plan for more epochs
  and/or a larger base model if the goal is voice fidelity rather than
  constraint-following.

Nothing above is implemented in this repo — noted here so a future "let's
also train on the chapters" request starts from an explicit decision, not a
silent scope creep of this rules-only dataset.

## Layout

```
data/build_dataset.py    # rules -> verbose instruction-tuning examples (rules-only, no chapters)
data/dataset.jsonl        # generated output (gitignored; push to HF instead of committing)
data/collapse_rules.py    # 87 rule files -> ~86 atomic training groups (only genuine duplicates merged)
data/rule_groups.json     # generated output of collapse_rules.py
train.py                  # single-model QLoRA fine-tune (all rules in one adapter)
train_per_group.py        # PREFERRED: one small adapter per rule group, trained separately
export/export_gguf.py     # single-model export: merge adapter -> GGUF -> `ollama create`
export/export_all_gguf.py # PREFERRED: export every per-group adapter -> one Ollama model each
export/Modelfile           # Ollama Modelfile template used by export_gguf.py
model_card.md              # HF model card (rules-only scope, intended use, limitations)
requirements.txt
```

**The working gatekeeper today needs no training at all.** `story-editor`'s
`/api/rules-check` fans a card out across the atomic rule groups from
`collapse_rules.py`, one small call per applicable group, against a stock
Ollama model (a Qwen3/heretic-family model with `/no_think` set, plus
table-type annotations so vocabulary-replacement tables read correctly) —
no fine-tune, no adapter, no GPU. Verified end-to-end on real rule content:
correct verdict, correctly-directioned mitigation. This is the current,
proven path — not a stand-in for something better.

**`train_per_group.py` → `export_all_gguf.py` is the future upgrade path**,
not yet run (needs a GPU this project doesn't currently have). Once
trained, `story-editor`'s `/api/rules-check-trained-ensemble` would query
the real per-group `rules-gatekeeper-*` Ollama models the same way
`/api/rules-check` queries a stock model today — same fan-out shape, real
learned weights instead of in-context rule text. Measured reason to avoid
ever going back to a single all-rules-in-context model: it took ~27 minutes
per card check and still silently truncated 71% of the rules text despite
an explicit large `num_ctx`. The single-model scripts (`train.py`/
`export_gguf.py`) are kept only for the generation use case (drafting a
passage against the whole rule set genuinely needs broader context), not
for judging/rejecting.

## 1. Build the dataset

```bash
STORIES_ROOT=/path/to/stories-repo python data/build_dataset.py --out data/dataset.jsonl
```

Reads only `stories/story/.agents/rules/*.md` and
`stories/story/.agents/constrained-agentic-bias.md` under `STORIES_ROOT`.
Every example in the output carries a `source_rule` field pointing at the
file it came from — nothing outside `.agents/` is ever read.

## 1b. Collapse rules into training groups (recommended before training)

```bash
STORIES_ROOT=/path/to/stories-repo python data/collapse_rules.py --out data/rule_groups.json
```

Merges two rule files only when their `keywords:` frontmatter overlaps
strongly, as a direct pairwise pair — never chained through a shared
keyword (so a minors-safety rule can never get silently folded into an
unrelated group just because it shares one keyword with something that
shares a keyword with it), and never more than 2 files per group. Every
file starts as its own atomic group; an earlier version merged all
split-cards sharing a filename prefix (e.g. all `explicit_lexicon_NN_*.md`
files) unconditionally, but those regularly cover genuinely distinct
topics rather than redundant copies of one rule, and produced a group too
large to check on CPU-only hardware in reasonable time — atomic-by-default
is both more correct and keeps every group small. 87 rules currently
collapse to 86 groups (one genuinely redundant pair merged).

## 2. Fine-tune

**Per-group (recommended):**

```bash
pip install -r requirements.txt
python train_per_group.py --dataset data/dataset.jsonl --groups data/rule_groups.json \
  --base-model Qwen/Qwen2.5-7B-Instruct --out out/adapters
```

Trains one small LoRA adapter per group, saved to `out/adapters/<slug>/`.
Use `--only slug1,slug2` to train/retrain a subset while iterating.

**Single all-rules model (generation use case only):**

```bash
pip install -r requirements.txt
python train.py --dataset data/dataset.jsonl --base-model Qwen/Qwen2.5-7B-Instruct --out out/adapter
```

Requires a CUDA GPU. This is a manual, long-running step — not wired into CI.

## 3. Publish to Hugging Face

```bash
python train.py --dataset data/dataset.jsonl --base-model Qwen/Qwen2.5-7B-Instruct \
  --out out/adapter --push-to-hub <your-hf-username>/rules-gatekeeper
```

Pushes the LoRA adapter (and dataset, via `datasets.Dataset.push_to_hub`) to
the Hub. Fill in `model_card.md` before the first push — HF requires it.

## 4. Export to GGUF / register in Ollama

**Per-group (recommended):**

```bash
python export/export_all_gguf.py --adapters-dir out/adapters --base-model Qwen/Qwen2.5-7B-Instruct \
  --out out/gguf --llama-cpp-dir /path/to/llama.cpp
```

Registers each group as its own Ollama model, named `rules-gatekeeper-<slug>`.
`story-editor`'s `/api/rules-check-trained-ensemble` auto-discovers every
model matching that prefix via `ollama list` — no config needed unless you
want to pin a specific subset via `RULES_GROUP_MODELS`.

**Single all-rules model:**

```bash
python export/export_gguf.py --adapter out/adapter --base-model Qwen/Qwen2.5-7B-Instruct --out out/gguf
ollama create rules-gatekeeper -f export/Modelfile
```

Both require a local `llama.cpp` checkout (for `convert_hf_to_gguf.py`) —
path passed via `--llama-cpp-dir`. Not vendored here.

## Hardware requirements

Verified on this project's own dev machine: CPU-only Ollama inference of an
8B q4 model with ~10k tokens of context exceeded a 5-minute round trip and
routinely timed out — training and even mock-testing this model is not
practical without a GPU.

- **QLoRA fine-tuning (`train.py`)**: a CUDA GPU with **at least 12–16GB
  VRAM** for a 7B base model in 4-bit (e.g. RTX 3060 12GB, RTX 4070 Ti,
  RTX 4080/4090, or a cloud instance such as an A10G/L4/A100). QLoRA keeps
  the base model frozen and quantized, so this is far below full fine-tune
  requirements, but bitsandbytes 4-bit still needs real VRAM headroom for
  activations + the LoRA adapter gradients.
- **GGUF export / merge (`export/export_gguf.py`)**: briefly needs the
  *unquantized* merged model in memory before llama.cpp requantizes it — a
  7B model in fp16 is ~14GB, so budget the same GPU (or run this step on a
  machine with enough system RAM to merge on CPU if VRAM is tight).
- **Inference (Ollama, judge/generate calls)**: any CUDA GPU with 6-8GB+
  VRAM will run a 4-bit 7-8B GGUF model with a real (8k+) context window at
  interactive speed. Ollama uses the GPU automatically when `nvidia-smi`
  reports one — confirm with `ollama ps` (`PROCESSOR` should read `100% GPU`
  or a GPU/CPU split, not `100% CPU`).

### Libraries / tooling

| Purpose | Library | Notes |
|---|---|---|
| Training | `torch` (CUDA build) | install the CUDA wheel matching your driver, not the CPU-only default from PyPI |
| QLoRA | `peft`, `bitsandbytes` | `bitsandbytes` requires a CUDA GPU — has no meaningful CPU fallback |
| Data | `datasets`, `huggingface_hub` | dataset/model publishing to the Hub |
| GGUF conversion | `llama.cpp` (`convert_hf_to_gguf.py`) | external checkout, not a pip package — clone separately, pass its path via `--llama-cpp-dir` |
| Local inference | `ollama` | already installed in this project's environment; `ollama pull`/`ollama create` handle GGUF loading |
| GPU driver stack | CUDA Toolkit + matching NVIDIA driver | required for both `torch`'s CUDA build and for Ollama to offload to GPU instead of falling back to CPU |

If no local GPU is available, the same `train.py`/`export_gguf.py` scripts
run unmodified on a rented GPU instance (Lambda, RunPod, Colab Pro, etc.) —
just point `--out`/`--push-to-hub` at the same paths and pull the result
back down for local Ollama use.

## Known limitation

This model is trained on rule *text* only, never on chapter prose or other
cards — it has no exposure to the story's actual voice or content, by
design. That means generation/judging quality is unproven until validated
against real chapter excerpts. Treat early `/api/rules-check` results in
`story-editor` as advisory (`force: true` override available) until you've
manually confirmed accept/reject behavior on known-good and known-bad
passages.
