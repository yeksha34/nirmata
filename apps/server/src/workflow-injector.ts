export interface GenerationParams {
  positivePrompt: string;
  negativePrompt?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  filenamePrefix?: string;
}

/**
 * Injects user-specified prompt, negative prompt, seed, sampler parameters,
 * and output filename prefix into a ComfyUI API format workflow dictionary.
 */
export function injectWorkflowParams(
  workflow: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }>,
  params: GenerationParams,
): Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }> {
  // Deep clone to avoid mutating input
  const cloned: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }> =
    JSON.parse(JSON.stringify(workflow));

  let posNodeFound = false;
  let negNodeFound = false;

  // Pass 1: Find text encoders by _meta title or naming
  for (const [id, node] of Object.entries(cloned)) {
    if (node.class_type === "CLIPTextEncode") {
      const title = (node._meta?.title as string || "").toLowerCase();
      if (!negNodeFound && (title.includes("negative") || title.includes("anti"))) {
        if (params.negativePrompt !== undefined) {
          node.inputs.text = params.negativePrompt;
        }
        negNodeFound = true;
      } else if (!posNodeFound && (title.includes("positive") || title.includes("prompt") || !title)) {
        node.inputs.text = params.positivePrompt;
        posNodeFound = true;
      }
    }
  }

  // Pass 2: Fallback if title did not distinguish positive/negative
  if (!posNodeFound) {
    const textNodes = Object.values(cloned).filter((n) => n.class_type === "CLIPTextEncode");
    const firstNode = textNodes[0];
    if (firstNode) {
      firstNode.inputs.text = params.positivePrompt;
    }
    const secondNode = textNodes[1];
    if (secondNode && params.negativePrompt !== undefined) {
      secondNode.inputs.text = params.negativePrompt;
    }
  }

  // Inject into KSampler
  for (const node of Object.values(cloned)) {
    if (node.class_type === "KSampler") {
      if (params.seed !== undefined) node.inputs.seed = params.seed;
      if (params.steps !== undefined) node.inputs.steps = params.steps;
      if (params.cfg !== undefined) node.inputs.cfg = params.cfg;
      if (params.sampler !== undefined) node.inputs.sampler_name = params.sampler;
      if (params.scheduler !== undefined) node.inputs.scheduler = params.scheduler;
    }

    if (node.class_type === "SaveImage" && params.filenamePrefix) {
      node.inputs.filename_prefix = params.filenamePrefix;
    }
  }

  return cloned;
}

/**
 * Recalculate prompt string attention weights based on questionnaire feedback.
 * - "better": increases weight by +0.2 or wraps in parentheses if unweighted
 * - "worse": decreases weight by -0.2 (if below 1.0, removes or moves to negative)
 * - "keep": preserves current tag weight
 */
export function applyAttentionFeedback(
  currentPrompt: string,
  currentNegative: string,
  feedback: Record<string, "better" | "keep" | "worse">,
): { positivePrompt: string; negativePrompt: string } {
  let nextPositive = currentPrompt;
  const negativeAdditions: string[] = [];

  for (const [tag, action] of Object.entries(feedback)) {
    if (action === "keep") continue;

    const trimmedTag = tag.trim();
    if (!trimmedTag) continue;

    // Check if tag currently has weight syntax: (tag:weight) or ((tag:weight))
    const escapedTag = trimmedTag.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const weightedRegex = new RegExp(`\\(([\\s\\w-,]+):([0-9.]+)\\)`, "gi");

    let found = false;
    nextPositive = nextPositive.replace(weightedRegex, (match, term, weightStr) => {
      if (term.trim().toLowerCase() === trimmedTag.toLowerCase()) {
        found = true;
        const curWeight = parseFloat(weightStr);
        if (action === "better") {
          const newWeight = Math.min(2.0, Number((curWeight + 0.2).toFixed(2)));
          return `(${term}:${newWeight})`;
        } else if (action === "worse") {
          const newWeight = Number((curWeight - 0.2).toFixed(2));
          if (newWeight < 1.0) {
            negativeAdditions.push(term);
            return ""; // remove from positive
          }
          return `(${term}:${newWeight})`;
        }
      }
      return match;
    });

    if (!found) {
      // Unweighted tag in prompt
      const rawTagRegex = new RegExp(`\\b${escapedTag}\\b`, "i");
      if (rawTagRegex.test(nextPositive)) {
        if (action === "better") {
          nextPositive = nextPositive.replace(rawTagRegex, `(${trimmedTag}:1.3)`);
        } else if (action === "worse") {
          negativeAdditions.push(trimmedTag);
          nextPositive = nextPositive.replace(rawTagRegex, "");
        }
      }
    }
  }

  // Clean up any double commas or stray spaces
  nextPositive = nextPositive
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "")
    .trim();

  let nextNegative = currentNegative;
  if (negativeAdditions.length > 0) {
    const existing = nextNegative.split(",").map((s) => s.trim().toLowerCase());
    const toAdd = negativeAdditions.filter((term) => !existing.includes(term.toLowerCase()));
    if (toAdd.length > 0) {
      nextNegative = nextNegative ? `${nextNegative}, ${toAdd.join(", ")}` : toAdd.join(", ");
    }
  }

  return { positivePrompt: nextPositive, negativePrompt: nextNegative };
}
