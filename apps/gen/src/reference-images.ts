type Node = { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> };
export type Workflow = Record<string, Node>;

export interface ReferenceOptions {
  /** How strongly the reference counts: the sampler's denoise for image-to-image, the adapter's weight for identity. */
  strength?: number | undefined;
}

const isReferenceSlot = (node: Node) =>
  node.class_type === "LoadImage" && String(node._meta?.title ?? "").toLowerCase().includes("reference");

/**
 * Fills a workflow's reference slots with images already uploaded to ComfyUI (their file names).
 * A slot is a `LoadImage` node whose title says "Reference". An image-to-image workflow (the slot feeds
 * a `VAEEncode`) uses the first image only. An identity workflow (the slot feeds an IPAdapter node)
 * takes any number: the extra ones are added as more `LoadImage` nodes joined by `ImageBatch`.
 * Returns the workflow and how many images it used; none when it has no slot, and the caller says so.
 */
export function injectReferences(
  workflow: Workflow,
  files: readonly string[],
  options: ReferenceOptions = {},
): { workflow: Workflow; applied: number } {
  const cloned: Workflow = JSON.parse(JSON.stringify(workflow));
  const slot = Object.entries(cloned).find(([, n]) => isReferenceSlot(n));
  if (!slot || files.length === 0) return { workflow: cloned, applied: 0 };
  const [slotId, slotNode] = slot;
  slotNode.inputs.image = files[0];

  const feeds = (cls: (c: string) => boolean) =>
    Object.entries(cloned).filter(
      ([, n]) =>
        cls(n.class_type) &&
        Object.values(n.inputs).some((v) => Array.isArray(v) && v[0] === slotId),
    );

  const adapters = feeds((c) => c.startsWith("IPAdapter"));
  if (adapters.length > 0) {
    let last: [string, number] = [slotId, 0];
    let next = Math.max(...Object.keys(cloned).map(Number).filter(Number.isFinite)) + 1;
    for (const file of files.slice(1)) {
      const load = String(next++);
      cloned[load] = {
        class_type: "LoadImage",
        inputs: { image: file },
        _meta: { title: "Reference Image (extra)" },
      };
      const batch = String(next++);
      cloned[batch] = {
        class_type: "ImageBatch",
        inputs: { image1: last, image2: [load, 0] },
        _meta: { title: "Reference Images" },
      };
      last = [batch, 0];
    }
    for (const [, adapter] of adapters) {
      for (const [key, value] of Object.entries(adapter.inputs)) {
        if (Array.isArray(value) && value[0] === slotId) adapter.inputs[key] = last;
      }
      if (options.strength !== undefined && "weight" in adapter.inputs) {
        adapter.inputs.weight = options.strength;
      }
    }
    return { workflow: cloned, applied: files.length };
  }

  if (options.strength !== undefined && feeds((c) => c === "VAEEncode").length > 0) {
    for (const node of Object.values(cloned)) {
      if (node.class_type === "KSampler") node.inputs.denoise = options.strength;
    }
  }
  return { workflow: cloned, applied: 1 };
}
