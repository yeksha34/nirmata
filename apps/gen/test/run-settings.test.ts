import { describe, expect, it } from "vitest";
import { readRunSettings } from "../src/run-settings";
import type { Workflow } from "../src/reference-images";

const wf = (over: Record<string, unknown> = {}): Workflow => ({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "base.safetensors" } },
  "2": {
    class_type: "LoraLoader",
    inputs: { model: ["1", 0], lora_name: "style.safetensors", strength_model: 0.8 },
  },
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: 42,
      steps: 28,
      cfg: 6.5,
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 0.55,
      ...over,
    },
  },
  "4": { class_type: "IPAdapterAdvanced", inputs: { weight: 0.7 } },
});

describe("reading what a run used from the workflow that was sent", () => {
  it("reads the sampler, model, loras, adapter and references", () => {
    const refs = [{ name: "naked", sha256: "abc" }];
    const s = readRunSettings(wf(), { references: refs, referenceStrength: 0.5 });
    expect(s).toMatchObject({
      version: 1,
      seed: 42,
      steps: 28,
      cfg: 6.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      denoise: 0.55,
      checkpoint: "base.safetensors",
      adapterWeight: 0.7,
      referenceStrength: 0.5,
      references: refs,
    });
    expect(s.loras).toEqual([{ name: "style.safetensors", strength: 0.8 }]);
    expect(s.workflow["3"]?.inputs.seed).toBe(42); // the exact graph is kept
  });

  it("leaves out what the workflow does not set, instead of guessing", () => {
    const s = readRunSettings({
      "9": { class_type: "SaveImage", inputs: {} },
    });
    expect(s).toEqual({
      version: 1,
      loras: [],
      references: [],
      workflow: { "9": { class_type: "SaveImage", inputs: {} } },
    });
  });

  it("ignores a value wired from another node", () => {
    const s = readRunSettings(wf({ seed: ["5", 0], steps: ["6", 0] }));
    expect(s.seed).toBeUndefined();
    expect(s.steps).toBeUndefined();
    expect(s.cfg).toBe(6.5);
  });
});
