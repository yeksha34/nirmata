#!/usr/bin/env python3
"""Merge the LoRA adapter into the base model and convert to GGUF.

Usage:
  python export/export_gguf.py --adapter out/adapter --base-model Qwen/Qwen2.5-7B-Instruct \
      --out out/gguf --llama-cpp-dir /path/to/llama.cpp

Requires a local llama.cpp checkout (for convert_hf_to_gguf.py) -- not
vendored in this repo. After this completes, run:
  ollama create rules-gatekeeper -f export/Modelfile
"""
import argparse
import subprocess
from pathlib import Path

from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", default="out/adapter")
    ap.add_argument("--base-model", default="Qwen/Qwen2.5-7B-Instruct")
    ap.add_argument("--out", default="out/gguf")
    ap.add_argument("--llama-cpp-dir", required=True, help="path to a llama.cpp checkout")
    ap.add_argument("--quant", default="q4_k_m")
    args = ap.parse_args()

    merged_dir = Path(args.out) / "merged"
    merged_dir.mkdir(parents=True, exist_ok=True)

    print("Loading base model + adapter for merge...")
    base = AutoModelForCausalLM.from_pretrained(args.base_model)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    merged = PeftModel.from_pretrained(base, args.adapter).merge_and_unload()
    merged.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)
    print(f"Merged model saved to {merged_dir}")

    gguf_out = Path(args.out) / f"rules-gatekeeper.{args.quant}.gguf"
    convert_script = Path(args.llama_cpp_dir) / "convert_hf_to_gguf.py"
    if not convert_script.is_file():
        raise SystemExit(f"convert_hf_to_gguf.py not found at {convert_script}")

    cmd = [
        "python", str(convert_script),
        str(merged_dir),
        "--outfile", str(gguf_out),
        "--outtype", args.quant,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)
    print(f"GGUF written to {gguf_out}")
    print("Next: ollama create rules-gatekeeper -f export/Modelfile")


if __name__ == "__main__":
    main()
