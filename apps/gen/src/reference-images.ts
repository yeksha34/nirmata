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

const SPRITE_DENOISE = 0.55;
const IDENTITY_WEIGHT = 0.7;

/**
 * Adds a reference slot to a plain text-to-image workflow, so a world's own customised workflow (its
 * checkpoint, sampler, size, extra nodes) is kept and only gains the reference:
 * - `sprite`: the slot's image is encoded and becomes the sampler's starting image (image-to-image);
 * - `cg`: the slot's image goes to an IPAdapter placed straight after the checkpoint, as an identity reference.
 * Returns undefined when the workflow has no checkpoint or sampler to attach to.
 */
export function addReferenceSlot(workflow: Workflow, kind: "sprite" | "cg"): Workflow | undefined {
  const cloned: Workflow = JSON.parse(JSON.stringify(workflow));
  const entries = Object.entries(cloned);
  const sampler = entries.find(([, n]) => n.class_type === "KSampler");
  const checkpoint = entries.find(([, n]) => n.class_type === "CheckpointLoaderSimple");
  if (!sampler || !checkpoint) return undefined;
  if (Object.values(cloned).some(isReferenceSlot)) return cloned; // it already has one
  const [, ks] = sampler;
  const [ckptId] = checkpoint;
  let next = Math.max(...Object.keys(cloned).map(Number).filter(Number.isFinite)) + 1;
  const add = (node: Node): string => {
    const id = String(next++);
    cloned[id] = node;
    return id;
  };

  if (kind === "sprite") {
    const decode = entries.find(([, n]) => n.class_type === "VAEDecode");
    const vae = decode?.[1].inputs.vae ?? [ckptId, 2];
    const load = add({
      class_type: "LoadImage",
      inputs: { image: "reference.png" },
      _meta: { title: "Reference Image (base sprite)" },
    });
    const encode = add({
      class_type: "VAEEncode",
      inputs: { pixels: [load, 0], vae },
      _meta: { title: "VAE Encode (reference)" },
    });
    ks.inputs.latent_image = [encode, 0];
    if (Number(ks.inputs.denoise ?? 1) >= 1) ks.inputs.denoise = SPRITE_DENOISE;
    return cloned;
  }

  const load = add({
    class_type: "LoadImage",
    inputs: { image: "reference.png" },
    _meta: { title: "Reference Image (identity)" },
  });
  const loader = add({
    class_type: "IPAdapterUnifiedLoader",
    inputs: { model: [ckptId, 0], preset: "PLUS (high strength)" },
    _meta: { title: "IPAdapter Loader" },
  });
  const adapter = add({
    class_type: "IPAdapterAdvanced",
    inputs: {
      model: [loader, 0],
      ipadapter: [loader, 1],
      image: [load, 0],
      weight: IDENTITY_WEIGHT,
      weight_type: "linear",
      combine_embeds: "concat",
      start_at: 0.0,
      end_at: 1.0,
      embeds_scaling: "V only",
    },
    _meta: { title: "IPAdapter (identity)" },
  });
  // everything that read the checkpoint's model now reads the adapted one (the adapter loader keeps the original)
  for (const [id, node] of Object.entries(cloned)) {
    if (id === loader) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (key === "model" && Array.isArray(value) && value[0] === ckptId && value[1] === 0) {
        node.inputs[key] = [adapter, 0];
      }
    }
  }
  return cloned;
}
