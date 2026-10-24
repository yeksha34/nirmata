#!/usr/bin/env python3
"""Merge + convert every per-group adapter from train_per_group.py into its
own GGUF and register it in Ollama as `rules-gatekeeper-<slug>`.

Usage:
  python export/export_all_gguf.py --adapters-dir out/adapters --base-model Qwen/Qwen2.5-7B-Instruct \
      --out out/gguf --llama-cpp-dir /path/to/llama.cpp

For each out/adapters/<slug>/ this produces out/gguf/<slug>/rules-gatekeeper-<slug>.q4_k_m.gguf
and a Modelfile, then runs `ollama create rules-gatekeeper-<slug> -f <Modelfile>`.
"""
import argparse
import subprocess
from pathlib import Path

from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

MODELFILE_TEMPLATE = """FROM {gguf_path}

TEMPLATE \"\"\"### Instruction:
{{{{ .Prompt }}}}

### Response:
\"\"\"

PARAMETER stop "### Instruction:"
PARAMETER temperature 0.3
"""


def export_one(slug, adapter_dir, base_model, out_dir, llama_cpp_dir, quant, skip_ollama):
    merged_dir = Path(out_dir) / slug / "merged"
    merged_dir.mkdir(parents=True, exist_ok=True)

    print(f"[{slug}] merging adapter into base model...")
    base = AutoModelForCausalLM.from_pretrained(base_model)
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    merged = PeftModel.from_pretrained(base, str(adapter_dir)).merge_and_unload()
    merged.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)

    gguf_out = Path(out_dir) / slug / f"rules-gatekeeper-{slug}.{quant}.gguf"
    convert_script = Path(llama_cpp_dir) / "convert_hf_to_gguf.py"
    if not convert_script.is_file():
        raise SystemExit(f"convert_hf_to_gguf.py not found at {convert_script}")
    cmd = ["python", str(convert_script), str(merged_dir), "--outfile", str(gguf_out), "--outtype", quant]
    print(f"[{slug}] converting to GGUF...")
    subprocess.run(cmd, check=True)

    modelfile = Path(out_dir) / slug / "Modelfile"
    modelfile.write_text(MODELFILE_TEMPLATE.format(gguf_path=gguf_out.resolve()), encoding="utf-8")

    model_name = f"rules-gatekeeper-{slug}"
    if not skip_ollama:
        print(f"[{slug}] registering as Ollama model '{model_name}'...")
        subprocess.run(["ollama", "create", model_name, "-f", str(modelfile)], check=True)
    print(f"[{slug}] done -> {model_name}")
    return model_name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapters-dir", default="out/adapters")
    ap.add_argument("--base-model", default="Qwen/Qwen2.5-7B-Instruct")
    ap.add_argument("--out", default="out/gguf")
    ap.add_argument("--llama-cpp-dir", required=True)
    ap.add_argument("--quant", default="q4_k_m")
    ap.add_argument("--only", default=None, help="comma-separated slugs to export (default: all)")
    ap.add_argument("--skip-ollama", action="store_true", help="produce GGUF/Modelfile only, don't run `ollama create`")
    args = ap.parse_args()

    adapters_dir = Path(args.adapters_dir)
    slugs = sorted(p.name for p in adapters_dir.iterdir() if p.is_dir())
    wanted = set(args.only.split(",")) if args.only else None

    registered = []
    for slug in slugs:
        if wanted and slug not in wanted:
            continue
        name = export_one(slug, adapters_dir / slug, args.base_model, args.out, args.llama_cpp_dir, args.quant, args.skip_ollama)
        registered.append(name)

    print(f"\nRegistered {len(registered)} models:")
    for n in registered:
        print(" -", n)
    print("\nSet RULES_GROUP_MODELS in story-editor to this comma-separated list, or leave unset to auto-discover via `ollama list`.")


if __name__ == "__main__":
    main()
