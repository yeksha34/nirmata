import type { SamplerParams } from "./types";

export type PresetName = "balanced" | "creative" | "strict";

/**
 * Friendly names for the settings most people actually want to change. Advanced users override
 * individual values; the numbers are starting points, not promises about any one model.
 */
export const PRESETS: Record<
  PresetName,
  Required<Pick<SamplerParams, "temperature" | "topP" | "maxTokens">> & SamplerParams
> = {
  balanced: { temperature: 0.8, topP: 0.95, maxTokens: 350 },
  creative: { temperature: 1.1, topP: 0.98, maxTokens: 450, extra: { min_p: 0.05 } },
  strict: { temperature: 0.5, topP: 0.9, maxTokens: 300 },
};

export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  balanced: "Steady storytelling with some surprises. A good default.",
  creative: "More surprising and descriptive, with more risk of wandering off.",
  strict: "Stays close to the facts and rules; plainer prose.",
};

/** Preset values with explicit overrides on top. `extra` entries merge rather than replace. */
export function resolveParams(preset: PresetName, overrides: SamplerParams = {}): SamplerParams {
  const base = PRESETS[preset];
  const extra = { ...base.extra, ...overrides.extra };
  return { ...base, ...overrides, ...(Object.keys(extra).length ? { extra } : {}) };
}
