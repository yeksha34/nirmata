import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addReferenceSlot,
  ComfyUiClient,
  injectReferences,
  injectWorkflowParams,
  type Workflow,
} from "../src";

const template = (name: string): Workflow =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "tools", "comfyui", "templates", name), "utf8"),
  );

afterEach(() => vi.unstubAllGlobals());

const derived = (name: string, kind: "sprite" | "cg"): Workflow => {
  const wf = addReferenceSlot(template(name), kind);
  if (!wf) throw new Error("no reference slot could be added");
  return wf;
};

describe("adding a reference slot to a workflow", () => {
  it("sprite: starts from the reference image (image-to-image) and keeps everything else", () => {
    const plain = template("sprite.template.api.json");
    const wf = derived("sprite.template.api.json", "sprite");
    const sampler = Object.values(wf).find((n) => n.class_type === "KSampler");
    const encode = Object.entries(wf).find(([, n]) => n.class_type === "VAEEncode");
    expect(encode?.[1].inputs.vae).toEqual(["1", 2]);
    expect(sampler?.inputs.latent_image).toEqual([encode?.[0], 0]);
    expect(sampler?.inputs.denoise).toBeLessThan(1);
    // the original nodes are all still there, and the plain template itself is not changed
    for (const id of Object.keys(plain)) expect(wf[id]?.class_type).toBe(plain[id]?.class_type);
    expect(plain["6"]?.inputs.denoise).toBe(1);
    // prompts still inject as for any other workflow
    const done = injectWorkflowParams(wf, { positivePrompt: "p", negativePrompt: "n", seed: 5 });
    expect(
      Object.values(done)
        .filter((n) => n.class_type === "CLIPTextEncode")
        .map((n) => n.inputs.text),
    ).toEqual(["p", "n"]);
  });

  it("cg: routes the model through an IPAdapter placed straight after the checkpoint", () => {
    const wf = derived("cg.template.api.json", "cg");
    const adapter = Object.entries(wf).find(([, n]) => n.class_type === "IPAdapterAdvanced");
    const loader = Object.entries(wf).find(([, n]) => n.class_type === "IPAdapterUnifiedLoader");
    expect(loader?.[1].inputs.model).toEqual(["1", 0]);
    expect(adapter?.[1].inputs.ipadapter).toEqual([loader?.[0], 1]);
    // what read the checkpoint's model now reads the adapted model; the sampler is untouched
    expect(wf["9"]?.inputs.model).toEqual([adapter?.[0], 0]);
    expect(wf["6"]?.inputs.model).toEqual(["9", 0]);
  });

  it("keeps a customised workflow's own settings", () => {
    const custom = template("sprite.template.api.json");
    (custom["1"] as { inputs: Record<string, unknown> }).inputs.ckpt_name = "my_own.safetensors";
    (custom["6"] as { inputs: Record<string, unknown> }).inputs.denoise = 0.8; // already below 1: left as it is
    const wf = addReferenceSlot(custom, "sprite");
    expect(wf?.["1"]?.inputs.ckpt_name).toBe("my_own.safetensors");
    expect(wf?.["6"]?.inputs.denoise).toBe(0.8);
  });

  it("does not add a second slot, and gives up on a workflow it cannot attach to", () => {
    const once = derived("sprite.template.api.json", "sprite");
    const twice = addReferenceSlot(once, "sprite");
    expect(Object.keys(twice ?? {}).length).toBe(Object.keys(once).length);
    expect(addReferenceSlot({ "1": { class_type: "SaveImage", inputs: {} } }, "cg")).toBeUndefined();
  });

  it("the plain templates have no reference slot, so injecting into them does nothing", () => {
    for (const name of ["sprite", "cg", "background"]) {
      expect(injectReferences(template(`${name}.template.api.json`), ["a.png"]).applied).toBe(0);
    }
  });
});

describe("injecting reference images", () => {
  it("image-to-image takes the first image and sets the strength", () => {
    const wf = derived("sprite.template.api.json", "sprite");
    const slot = Object.keys(wf).find((id) => wf[id]?.class_type === "LoadImage") as string;
    const { workflow, applied } = injectReferences(wf, ["base.png", "ignored.png"], { strength: 0.4 });
    expect(applied).toBe(1);
    expect(workflow[slot]?.inputs.image).toBe("base.png");
    expect(workflow["6"]?.inputs.denoise).toBe(0.4);
    expect(wf[slot]?.inputs.image).toBe("reference.png"); // the workflow given is not changed
  });

  it("identity takes any number of images, joined into one batch for the adapter", () => {
    const wf = derived("cg.template.api.json", "cg");
    const slot = Object.keys(wf).find((id) => wf[id]?.class_type === "LoadImage") as string;
    const adapterId = Object.keys(wf).find((id) => wf[id]?.class_type === "IPAdapterAdvanced") as string;
    const { workflow, applied } = injectReferences(wf, ["a.png", "b.png", "c.png"], { strength: 0.5 });
    expect(applied).toBe(3);
    expect(workflow[slot]?.inputs.image).toBe("a.png");
    const loads = Object.values(workflow)
      .filter((n) => n.class_type === "LoadImage")
      .map((n) => n.inputs.image);
    expect(loads).toEqual(["a.png", "b.png", "c.png"]);
    const batches = Object.entries(workflow).filter(([, n]) => n.class_type === "ImageBatch");
    expect(batches).toHaveLength(2);
    // the adapter reads the last batch, and the first batch starts from the template's own slot
    const [firstId, first] = batches[0] ?? [];
    const [lastId] = batches[1] ?? [];
    expect(first?.inputs.image1).toEqual([slot, 0]);
    expect(workflow[adapterId]?.inputs.image).toEqual([lastId, 0]);
    expect(workflow[adapterId]?.inputs.weight).toBe(0.5);
    expect(firstId).not.toBe(lastId);
  });

  it("one identity image needs no batch", () => {
    const wf = derived("cg.template.api.json", "cg");
    const slot = Object.keys(wf).find((id) => wf[id]?.class_type === "LoadImage") as string;
    const adapterId = Object.keys(wf).find((id) => wf[id]?.class_type === "IPAdapterAdvanced") as string;
    const { workflow } = injectReferences(wf, ["a.png"]);
    expect(Object.values(workflow).some((n) => n.class_type === "ImageBatch")).toBe(false);
    expect(workflow[adapterId]?.inputs.image).toEqual([slot, 0]);
  });

  it("does nothing without images", () => {
    expect(injectReferences(derived("sprite.template.api.json", "sprite"), []).applied).toBe(0);
  });
});

describe("uploading a reference image to ComfyUI", () => {
  it("sends the image as an input file and returns the name ComfyUI gives it", async () => {
    let seen: { url: string; form: FormData } | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url, form: init.body as FormData };
      return new Response(JSON.stringify({ name: "ref.png", subfolder: "", type: "input" }));
    });
    const name = await new ComfyUiClient().uploadImage("ref.png", new Uint8Array([1, 2, 3]));
    expect(name).toBe("ref.png");
    expect(seen?.url).toMatch(/\/upload\/image$/);
    expect(seen?.form.get("type")).toBe("input");
    expect((seen?.form.get("image") as File).name).toBe("ref.png");
  });

  it("says plainly when ComfyUI is not there or refuses", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    await expect(new ComfyUiClient().uploadImage("a.png", new Uint8Array([1]))).rejects.toMatchObject({
      code: "comfyui_offline",
    });
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 400 }));
    await expect(new ComfyUiClient().uploadImage("a.png", new Uint8Array([1]))).rejects.toMatchObject({
      code: "comfyui_error",
    });
  });
});
