---
license: unknown
base_model: Qwen/Qwen2.5-7B-Instruct
tags:
  - lora
  - fiction-writing-assistant
  - content-policy-judge
---

# rules-gatekeeper

A LoRA fine-tune trained **exclusively** on ~90 agent rule cards from a
private fiction project's `.agents/rules/` directory — canon-consistency
rules, banned-trope rules, prose/vocabulary rules, and a euphemism catalog.
It was never trained on chapter text or any other story card.

## Intended use

- **Judge**: given an excerpt, reason step by step about whether it violates
  a named rule, and state which phrase trips it.
- **Generate**: draft short passages that hold to a named rule's canon
  position, with a stated rationale.

## Training data

`data/dataset.jsonl` in the source repo (https://github.com/<fill-in>) —
verbose instruction/response pairs synthesized per-rule-card, each tagged
with `source_rule` pointing at the exact file it came from. No chapter or
other card content appears in training data by construction.

## Limitations

- Rules-only training means the model has no exposure to the story's actual
  prose voice — it is not a style/voice model, only a constraint-following
  one.
- Judge/generation accuracy against real excerpts is **unvalidated**; treat
  early outputs as advisory, not authoritative, until manually checked
  against known-good and known-bad passages.
- The source rules describe an 18+ fiction project's content boundaries
  (including an explicit-language catalog); this model reflects that
  project's specific conventions, not a general content-safety classifier.
