import type { Workflow } from "./reference-images";

/** A reference image a run used: its name and the hash of the bytes sent. */
export interface UsedReference {
  name: string;
  sha256: string;
}

/**
 * What made an image, read from the workflow that was actually sent to ComfyUI (not from what was
 * asked for): a value the workflow does not set is left out, so it stays unknown instead of being
 * guessed. Kept with the image so the pair can be reproduced, compared or used for training.
 */
export interface RunSettings {
  version: 1;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  /** The sampler's denoise: below 1 when an image starts the render (image-to-image). */
  denoise?: number;
  checkpoint?: string;
  loras: Array<{ name: string; strength: number }>;
  /** The identity adapter's weight, when the workflow has one. */
  adapterWeight?: number;
  references: UsedReference[];
  /** The strength the caller asked for, if any; what the graph applied is `denoise` or `adapterWeight`. */
  referenceStrength?: number;
  /** The exact graph sent to ComfyUI. */
  workflow: Workflow;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export function readRunSettings(
  workflow: Workflow,
  used: { references?: UsedReference[]; referenceStrength?: number | undefined } = {},
): RunSettings {
  const nodes = Object.values(workflow);
  const sampler = nodes.find((n) => n.class_type === "KSampler" || n.class_type === "KSamplerAdvanced");
  const checkpoint = nodes.find((n) => /^CheckpointLoader/.test(n.class_type));
  const adapter = nodes.find((n) => n.class_type.startsWith("IPAdapter") && "weight" in n.inputs);
  const out: RunSettings = {
    version: 1,
    loras: nodes
      .filter((n) => /^LoraLoader/.test(n.class_type) && str(n.inputs.lora_name))
      .map((n) => ({
        name: String(n.inputs.lora_name),
        strength: num(n.inputs.strength_model) ?? 1,
      })),
    references: used.references ?? [],
    workflow,
  };
  const set = <K extends keyof RunSettings>(key: K, value: RunSettings[K] | undefined) => {
    if (value !== undefined) out[key] = value as RunSettings[K];
  };
  set("seed", num(sampler?.inputs.seed ?? sampler?.inputs.noise_seed));
  set("steps", num(sampler?.inputs.steps));
  set("cfg", num(sampler?.inputs.cfg));
  set("sampler", str(sampler?.inputs.sampler_name));
  set("scheduler", str(sampler?.inputs.scheduler));
  set("denoise", num(sampler?.inputs.denoise));
  set("checkpoint", str(checkpoint?.inputs.ckpt_name));
  set("adapterWeight", num(adapter?.inputs.weight));
  set("referenceStrength", used.referenceStrength);
  return out;
}
