#!/usr/bin/env python3
"""Train one small LoRA adapter per rule group instead of one adapter for
all 87 rules.

Why: a single model holding all rules means every inference call either
pays for a huge context-stuffed prompt (measured: ~27min and still
silently truncated 71% of the rules on this hardware -- see README) or
relies on the model to have memorized all 87 rules simultaneously with no
retrieval boundary between them. Splitting into per-group adapters means
each one only ever needs to know ONE rule concern; at inference the rule
text isn't sent at all (it's baked into that adapter's weights), so the
prompt is just the card being judged -- small, fast, no truncation risk.

Usage:
  python data/collapse_rules.py --stories-root ... --out data/rule_groups.json
  python data/build_dataset.py --stories-root ... --out data/dataset.jsonl
  python train_per_group.py --dataset data/dataset.jsonl --groups data/rule_groups.json \
      --base-model Qwen/Qwen2.5-7B-Instruct --out out/adapters

Each group gets its own subdirectory under --out, named by its slug.
Groups with very few examples (a handful of source rules folded together
after collapse_rules.py) still train fine -- LoRA adapters are cheap and
the base model does the heavy lifting; the adapter only needs to nudge it
toward that one rule's specific position.
"""
import argparse
import json
from pathlib import Path

from datasets import Dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
    DataCollatorForLanguageModeling,
)
import torch

PROMPT_TEMPLATE = "### Instruction:\n{instruction}\n\n### Response:\n{response}"


def load_examples_by_group(dataset_path: str, groups_path: str):
    groups = json.loads(Path(groups_path).read_text(encoding="utf-8"))
    rule_to_slug = {}
    for g in groups:
        for r in g["rules"]:
            rule_to_slug[r] = g["slug"]

    examples = [json.loads(l) for l in Path(dataset_path).read_text(encoding="utf-8").splitlines() if l.strip()]
    by_slug = {g["slug"]: [] for g in groups}
    unmatched = 0
    for ex in examples:
        slug = rule_to_slug.get(ex["source_rule"])
        if slug is None:
            unmatched += 1
            continue
        by_slug[slug].append(ex)
    if unmatched:
        print(f"WARNING: {unmatched} dataset examples had no matching group (rule_groups.json out of date with dataset.jsonl?)")
    return groups, by_slug


def train_one_group(slug, group_examples, base_model, tokenizer, bnb_config, out_dir, epochs, lr, max_len):
    if not group_examples:
        print(f"[{slug}] no examples, skipping")
        return

    ds = Dataset.from_list(group_examples)

    def _fmt(ex):
        text = PROMPT_TEMPLATE.format(instruction=ex["instruction"], response=ex["response"])
        out = tokenizer(text, truncation=True, max_length=max_len)
        out["labels"] = out["input_ids"].copy()
        return out

    tokenized = ds.map(_fmt, remove_columns=ds.column_names)

    model = AutoModelForCausalLM.from_pretrained(base_model, quantization_config=bnb_config, device_map="auto")
    model = prepare_model_for_kbit_training(model)
    lora_config = LoraConfig(
        r=8, lora_alpha=16, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, lora_config)

    group_out = Path(out_dir) / slug
    training_args = TrainingArguments(
        output_dir=str(group_out),
        num_train_epochs=epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        learning_rate=lr,
        logging_steps=5,
        save_strategy="no",
        bf16=True,
        report_to=[],
    )
    collator = DataCollatorForLanguageModeling(tokenizer, mlm=False)
    trainer = Trainer(model=model, args=training_args, train_dataset=tokenized, data_collator=collator)
    trainer.train()

    model.save_pretrained(group_out)
    tokenizer.save_pretrained(group_out)
    print(f"[{slug}] saved adapter ({len(group_examples)} examples) -> {group_out}")

    # Free VRAM before the next group's model load.
    del model
    torch.cuda.empty_cache()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="data/dataset.jsonl")
    ap.add_argument("--groups", default="data/rule_groups.json")
    ap.add_argument("--base-model", default="Qwen/Qwen2.5-7B-Instruct")
    ap.add_argument("--out", default="out/adapters")
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=1024)
    ap.add_argument("--only", default=None, help="comma-separated slugs to train (default: all groups)")
    args = ap.parse_args()

    groups, by_slug = load_examples_by_group(args.dataset, args.groups)
    wanted = set(args.only.split(",")) if args.only else None

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
    )

    print(f"Training {len(groups) if not wanted else len(wanted)} of {len(groups)} rule-group adapters")
    for g in groups:
        if wanted and g["slug"] not in wanted:
            continue
        train_one_group(g["slug"], by_slug.get(g["slug"], []), args.base_model, tokenizer, bnb_config,
                         args.out, args.epochs, args.lr, args.max_len)


if __name__ == "__main__":
    main()
