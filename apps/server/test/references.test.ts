import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  characterOf,
  DEFAULT_REFERENCE_SETTINGS,
  parseReferenceSettings,
  suggestReferences,
} from "../src/reference-rules";
import { Client, HOST_KEY, type Json, rig } from "./helpers";

const png = (marker: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(marker)]);
const NAKED = { ...DEFAULT_REFERENCE_SETTINGS, baseSprite: "naked", cgSprite: "naked" };

describe("which images should influence a new one", () => {
  it("names a sprite's character from the part before its last underscore", () => {
    expect(characterOf("tina_happy")).toBe("tina");
    expect(characterOf("main_character_neutral")).toBe("main_character");
    expect(characterOf("tina")).toBe("tina");
  });

  it("a character's base sprite influences the character's other sprites, and only theirs", () => {
    const sprites = ["tina_naked", "tina_happy", "ravi_naked", "ravi_happy"];
    const forHappy = suggestReferences({
      type: "sprite",
      name: "tina_happy",
      positivePrompt: "",
      sprites,
      settings: NAKED,
    });
    expect(forHappy.suggested).toEqual(["tina_naked"]);
    expect(forHappy.available).toEqual(["tina_naked", "ravi_naked", "ravi_happy"]);
    // the base sprite itself has nothing to start from, and a character without one gets nothing
    expect(
      suggestReferences({
        type: "sprite",
        name: "tina_naked",
        positivePrompt: "",
        sprites,
        settings: NAKED,
      }).suggested,
    ).toEqual([]);
    expect(
      suggestReferences({
        type: "sprite",
        name: "mira_happy",
        positivePrompt: "",
        sprites,
        settings: NAKED,
      }).suggested,
    ).toEqual([]);
  });

  it("a CG is influenced by the sprites of the characters it shows", () => {
    const sprites = ["tina_naked", "tina_happy", "ravi_naked", "mira_naked"];
    const both = suggestReferences({
      type: "cg",
      name: "cg_garden",
      positivePrompt: "Tina and Ravi in a garden, evening light",
      sprites,
      settings: NAKED,
    });
    expect(both.suggested).toEqual(["tina_naked", "ravi_naked"]);
    // a name inside another word is not a mention
    expect(
      suggestReferences({
        type: "cg",
        name: "cg_x",
        positivePrompt: "a ravine at dusk",
        sprites,
        settings: NAKED,
      }).suggested,
    ).toEqual([]);
    // the CG sprite can be another expression than the base one
    expect(
      suggestReferences({
        type: "cg",
        name: "cg_tina_garden",
        positivePrompt: "",
        sprites: ["tina_naked", "tina_dressed"],
        settings: { baseSprite: "naked", cgSprite: "dressed" },
      }).suggested,
    ).toEqual(["tina_dressed"]);
  });

  it("a background is influenced by nothing", () => {
    expect(
      suggestReferences({
        type: "bg",
        name: "bg_hall",
        positivePrompt: "tina",
        sprites: ["tina_naked"],
        settings: NAKED,
      }),
    ).toEqual({ suggested: [], available: [] });
  });

  it("reads the world's setting, and falls back when it is missing or wrong", () => {
    expect(parseReferenceSettings('{"baseSprite":"Naked"}')).toEqual({
      baseSprite: "naked",
      cgSprite: "naked",
    });
    expect(parseReferenceSettings('{"baseSprite":"naked","cgSprite":"dressed"}')).toEqual({
      baseSprite: "naked",
      cgSprite: "dressed",
    });
    expect(parseReferenceSettings("not json")).toEqual(DEFAULT_REFERENCE_SETTINGS);
    expect(parseReferenceSettings('{"baseSprite":"../x"}')).toEqual(DEFAULT_REFERENCE_SETTINGS);
    expect(parseReferenceSettings(undefined)).toEqual(DEFAULT_REFERENCE_SETTINGS);
  });
});

/** The table with a fake ComfyUI, a visual novel and some sprites on disk. */
async function setup() {
  const r = await rig([]);
  const c = new Client(r.app);
  expect((await c.join("ignored", { hostKey: HOST_KEY })).status).toBe(201);
  await r.world.scaffoldVn({ slug: "ch01", title: "One", source: "chapters/01.md" });
  const sprites = join(r.world.root, "vns", "ch01", "assets", "sprites");
  await mkdir(sprites, { recursive: true });
  const files: Record<string, Buffer> = {
    tina_naked: png("naked"),
    tina_happy: png("happy"),
    ravi_naked: png("ravi"),
  };
  for (const [name, data] of Object.entries(files))
    await writeFile(join(sprites, `${name}.png`), data);
  await mkdir(join(r.world.root, "assets", "workflow"), { recursive: true });
  await writeFile(
    join(r.world.root, "assets", "workflow", "references.json"),
    '{"baseSprite":"naked"}',
  );

  const queued: Json[] = [];
  const uploads: Array<{ name: string; data: Uint8Array }> = [];
  const fake = {
    uploadImage: async (name: string, data: Uint8Array) => {
      uploads.push({ name, data });
      return `in_${name}`;
    },
    queuePrompt: async (wf: Json) => {
      queued.push(wf);
      return "prompt-1";
    },
    waitForCompletion: async () => ({
      outputImages: [{ filename: "o.png", subfolder: "", type: "output" }],
    }),
    fetchImage: async () => png("made"),
    cancel: async () => undefined,
    checkStatus: async () => ({ online: true }),
  };
  (r.table as unknown as { comfy: unknown }).comfy = fake;

  const generate = async (body: Json) => {
    const started = await c.post("/api/worlds/example-world/vns/ch01/assets/generate", {
      positivePrompt: "a figure",
      ...body,
    });
    expect(started.status).toBe(202);
    for (let i = 0; i < 200; i++) {
      const job = (await c.get(`/api/vn-jobs/${started.body.id}`)).body;
      if (job.state === "done" || job.state === "error") return job;
      await new Promise((res) => setTimeout(res, 10));
    }
    throw new Error("the job did not finish");
  };
  return { r, c, files, queued, uploads, generate };
}

describe("generating with reference sprites", () => {
  it("suggests the base sprite for a sprite, and the characters' sprites for a CG", async () => {
    const { c } = await setup();
    const sprite = await c.get("/api/worlds/example-world/vns/ch01/asset-meta/sprite/tina_happy");
    expect(sprite.body.references.suggested).toEqual(["tina_naked"]);
    expect(sprite.body.references.available).toEqual(
      expect.arrayContaining(["tina_naked", "ravi_naked"]),
    );
    expect(sprite.body.references.available).not.toContain("tina_happy");
    const cg = await c.get("/api/worlds/example-world/vns/ch01/asset-meta/cg/cg_tina_and_ravi");
    expect([...cg.body.references.suggested].sort()).toEqual(["ravi_naked", "tina_naked"]);
  });

  it("starts a sprite from its base sprite: the image is uploaded and the sampler starts from it", async () => {
    const { files, queued, uploads, generate } = await setup();
    const job = await generate({
      type: "sprite",
      name: "tina_happy",
      references: ["tina_naked"],
      referenceStrength: 0.5,
    });
    expect(job.state).toBe("done");
    const hash = createHash("sha256")
      .update(files.tina_naked as Buffer)
      .digest("hex")
      .slice(0, 16);
    expect(uploads.map((u) => u.name)).toEqual([`nirmata_ref_${hash}.png`]);
    expect(Buffer.from(uploads[0]?.data ?? []).equals(files.tina_naked as Buffer)).toBe(true);
    const wf = queued[0];
    const load = Object.values(wf).find((n: Json) => n.class_type === "LoadImage") as Json;
    expect(load.inputs.image).toBe(`in_nirmata_ref_${hash}.png`);
    const sampler = Object.values(wf).find((n: Json) => n.class_type === "KSampler") as Json;
    expect(sampler.inputs.denoise).toBe(0.5);
    expect(Object.values(wf).some((n: Json) => n.class_type === "VAEEncode")).toBe(true);
  });

  it("guides a CG with every character's sprite, through an identity adapter", async () => {
    const { queued, uploads, generate } = await setup();
    const job = await generate({
      type: "cg",
      name: "cg_tina_and_ravi",
      references: ["tina_naked", "ravi_naked"],
    });
    expect(job.state).toBe("done");
    expect(uploads).toHaveLength(2);
    const wf = queued[0];
    expect(Object.values(wf).some((n: Json) => n.class_type === "IPAdapterAdvanced")).toBe(true);
    expect(Object.values(wf).filter((n: Json) => n.class_type === "LoadImage")).toHaveLength(2);
    expect(Object.values(wf).filter((n: Json) => n.class_type === "ImageBatch")).toHaveLength(1);
  });

  it("uses the plain workflow, and uploads nothing, when no reference is asked for", async () => {
    const { queued, uploads, generate } = await setup();
    const job = await generate({ type: "sprite", name: "tina_neutral" });
    expect(job.state).toBe("done");
    expect(uploads).toEqual([]);
    expect(Object.values(queued[0]).some((n: Json) => n.class_type === "LoadImage")).toBe(false);
  });

  it("stops before anything is queued when a reference sprite does not exist", async () => {
    const { queued, uploads, generate } = await setup();
    const job = await generate({ type: "sprite", name: "tina_sad", references: ["mira_naked"] });
    expect(job.state).toBe("error");
    expect(job.error).toContain("reference sprite does not exist");
    expect(queued).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("says so when the workflow has no place for a reference image", async () => {
    const { generate } = await setup();
    const plain = {
      "1": {
        class_type: "CLIPTextEncode",
        inputs: { text: "x" },
        _meta: { title: "Positive Prompt" },
      },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const job = await generate({
      type: "sprite",
      name: "tina_happy",
      references: ["tina_naked"],
      workflowOverride: plain,
    });
    expect(job.state).toBe("error");
    expect(job.error).toContain("no place for a reference image");
  });
});

describe("the record kept beside each image", () => {
  /** The one run folder of an asset in the dataset. */
  async function runFolder(root: string, name: string): Promise<string> {
    const base = join(root, "assets", "dataset", "ch01", name);
    const runs = await readdir(base);
    expect(runs).toHaveLength(1);
    return join(base, runs[0] as string);
  }

  it("keeps the inputs, the exact workflow, the references and the output together", async () => {
    const { r, files, generate } = await setup();
    const job = await generate({
      type: "sprite",
      name: "tina_happy",
      references: ["tina_naked"],
      referenceStrength: 0.5,
    });
    expect(job.state).toBe("done");
    const dir = await runFolder(r.world.root, "tina_happy");
    const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
    expect(run.status).toBe("succeeded");
    expect(run.positive).toBe("a figure");
    expect(run.settings.denoise).toBe(0.5); // what the graph applied
    expect(run.settings.referenceStrength).toBe(0.5); // what was asked
    expect(run.settings.references).toEqual([
      {
        name: "tina_naked",
        sha256: createHash("sha256")
          .update(files.tina_naked as Buffer)
          .digest("hex"),
      },
    ]);
    expect(run.settings.workflow).toBeUndefined(); // the graph is its own file
    expect(run.output.sha256).toBe(createHash("sha256").update(png("made")).digest("hex"));
    const workflow = JSON.parse(await readFile(join(dir, "workflow.json"), "utf8"));
    expect(Object.values(workflow).some((n) => (n as Json).class_type === "VAEEncode")).toBe(true);
    expect(
      (await readFile(join(dir, "references", "1-tina_naked.png"))).equals(
        files.tina_naked as Buffer,
      ),
    ).toBe(true);
    expect(await readFile(join(dir, "generated_image.png"))).toBeTruthy();
  });

  it("marks a run that failed, keeping its inputs", async () => {
    const { r, generate } = await setup();
    const plain = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "x" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const job = await generate({
      type: "sprite",
      name: "tina_happy",
      references: ["tina_naked"],
      workflowOverride: plain,
    });
    expect(job.state).toBe("error");
    const run = JSON.parse(
      await readFile(join(await runFolder(r.world.root, "tina_happy"), "run.json"), "utf8"),
    );
    expect(run.status).toBe("failed");
    expect(run.error).toContain("no place for a reference image");
    expect(run.positive).toBe("a figure");
    expect(run.output).toBeUndefined();
  });
});
