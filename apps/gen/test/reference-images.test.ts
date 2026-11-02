import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyUiClient, injectReferences, injectWorkflowParams, type Workflow } from "../src";

const template = (name: string): Workflow =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "tools", "comfyui", "templates", name), "utf8"),
  );

afterEach(() => vi.unstubAllGlobals());

describe("the reference workflows", () => {
  it("sprite_ref starts from the reference image (image-to-image) and keeps the usual nodes", () => {
    const wf = template("sprite_ref.template.api.json");
    const encode = Object.values(wf).find((n) => n.class_type === "VAEEncode");
    const sampler = Object.values(wf).find((n) => n.class_type === "KSampler");
    expect(encode?.inputs.pixels).toEqual(["11", 0]);
    expect(sampler?.inputs.latent_image).toEqual(["12", 0]);
    expect(sampler?.inputs.denoise).toBeLessThan(1);
    // prompts still inject as for any other workflow
    const done = injectWorkflowParams(wf, { positivePrompt: "p", negativePrompt: "n", seed: 5 });
    expect(Object.values(done).filter((n) => n.class_type === "CLIPTextEncode").map((n) => n.inputs.text)).toEqual(["p", "n"]);
  });

  it("cg_ref routes the model through an IPAdapter fed by the reference image", () => {
    const wf = template("cg_ref.template.api.json");
    expect(wf["13"]?.class_type).toBe("IPAdapterAdvanced");
    expect(wf["13"]?.inputs.image).toEqual(["11", 0]);
    expect(wf["9"]?.inputs.model).toEqual(["13", 0]);
    expect(wf["6"]?.inputs.model).toEqual(["9", 0]);
  });

  it("the plain templates have no reference slot, so they are left alone", () => {
    for (const name of ["sprite", "cg", "background"]) {
      const wf = template(`${name}.template.api.json`);
      expect(injectReferences(wf, ["a.png"]).applied).toBe(0);
    }
  });
});

describe("injecting reference images", () => {
  it("image-to-image takes the first image and sets the strength", () => {
    const wf = template("sprite_ref.template.api.json");
    const { workflow, applied } = injectReferences(wf, ["base.png", "ignored.png"], { strength: 0.4 });
    expect(applied).toBe(1);
    expect(workflow["11"]?.inputs.image).toBe("base.png");
    expect(workflow["6"]?.inputs.denoise).toBe(0.4);
    expect(wf["11"]?.inputs.image).toBe("reference.png"); // the template itself is not changed
  });

  it("identity takes any number of images, joined into one batch for the adapter", () => {
    const wf = template("cg_ref.template.api.json");
    const { workflow, applied } = injectReferences(wf, ["a.png", "b.png", "c.png"], { strength: 0.5 });
    expect(applied).toBe(3);
    expect(workflow["11"]?.inputs.image).toBe("a.png");
    const loads = Object.values(workflow).filter((n) => n.class_type === "LoadImage").map((n) => n.inputs.image);
    expect(loads).toEqual(["a.png", "b.png", "c.png"]);
    const batches = Object.entries(workflow).filter(([, n]) => n.class_type === "ImageBatch");
    expect(batches).toHaveLength(2);
    // the adapter reads the last batch, and the first batch starts from the template's own slot
    const [firstId, first] = batches[0] ?? [];
    const [lastId] = batches[1] ?? [];
    expect(first?.inputs.image1).toEqual(["11", 0]);
    expect(workflow["13"]?.inputs.image).toEqual([lastId, 0]);
    expect(workflow["13"]?.inputs.weight).toBe(0.5);
    expect(firstId).not.toBe(lastId);
  });

  it("one identity image needs no batch", () => {
    const { workflow } = injectReferences(template("cg_ref.template.api.json"), ["a.png"]);
    expect(Object.values(workflow).some((n) => n.class_type === "ImageBatch")).toBe(false);
    expect(workflow["13"]?.inputs.image).toEqual(["11", 0]);
  });

  it("does nothing without images", () => {
    expect(injectReferences(template("sprite_ref.template.api.json"), []).applied).toBe(0);
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
