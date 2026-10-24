#!/usr/bin/env python3
"""QLoRA fine-tune a small open base model on the rules-only dataset.

Usage:
  python train.py --dataset data/dataset.jsonl --base-model Qwen/Qwen2.5-7B-Instruct --out out/adapter
  python train.py ... --push-to-hub <user>/rules-gatekeeper

Requires a CUDA GPU (bitsandbytes 4-bit quantization). Manual, long-running
step -- not wired into CI.
"""
import argparse

from datasets import Dataset, load_dataset
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

PROMPT_TEMPLATE = (
    "### Instruction:\n{instruction}\n\n### Response:\n{response}"
)


def format_example(tokenizer, max_len):
    def _fn(ex):
        text = PROMPT_TEMPLATE.format(instruction=ex["instruction"], response=ex["response"])
        out = tokenizer(text, truncation=True, max_length=max_len)
        out["labels"] = out["input_ids"].copy()
        return out
    return _fn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="data/dataset.jsonl")
    ap.add_argument("--base-model", default="Qwen/Qwen2.5-7B-Instruct")
    ap.add_argument("--out", default="out/adapter")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=1024)
    ap.add_argument("--push-to-hub", default=None, help="HF repo id, e.g. user/rules-gatekeeper")
    args = ap.parse_args()

    raw = load_dataset("json", data_files=args.dataset, split="train")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    tokenized = raw.map(format_example(tokenizer, args.max_len), remove_columns=raw.column_names)

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model, quantization_config=bnb_config, device_map="auto"
    )
    model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=args.lr,
        logging_steps=10,
        save_strategy="epoch",
        bf16=True,
        report_to=[],
    )

    collator = DataCollatorForLanguageModeling(tokenizer, mlm=False)
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=collator,
    )
    trainer.train()

    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"Saved LoRA adapter to {args.out}")

    if args.push_to_hub:
        model.push_to_hub(args.push_to_hub)
        tokenizer.push_to_hub(args.push_to_hub)
        ds = Dataset.from_json(args.dataset)
        ds.push_to_hub(args.push_to_hub + "-dataset")
        print(f"Pushed adapter to https://huggingface.co/{args.push_to_hub}")
        print(f"Pushed dataset to https://huggingface.co/datasets/{args.push_to_hub}-dataset")


if __name__ == "__main__":
    main()
