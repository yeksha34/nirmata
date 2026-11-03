import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorldFiles } from "../src";
import { applyAttentionFeedback, ComfyUiClient, injectWorkflowParams } from "@nirmata/gen";
import { Client, HOST_KEY, rig, tempWorld } from "./helpers";

type Rig = Awaited<ReturnType<typeof rig>>;

async function host(r: Rig) {
  const c = new Client(r.app);
  const res = await c.join("ignored", { hostKey: HOST_KEY });
  expect(res.status).toBe(201);
  return c;
}

describe("workflow parameter injector & attention feedback", () => {
  it("injects generation parameters into ComfyUI workflow graph", () => {
    const sampleWorkflow = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "test.safetensors" },
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: { text: "old positive" },
        _meta: { title: "Positive Prompt" },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "old negative" },
        _meta: { title: "Negative Anti-Prompt" },
      },
      "4": {
        class_type: "KSampler",
        inputs: { seed: 1, steps: 10, cfg: 5.0, sampler_name: "euler", scheduler: "normal" },
      },
      "5": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "old_prefix" },
      },
    };

    const injected = injectWorkflowParams(sampleWorkflow, {
      positivePrompt: "new masterpiece prompt, 1girl",
      negativePrompt: "lowres, bad quality",
      seed: 99999,
      steps: 25,
      cfg: 7.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      filenamePrefix: "sprites/tara_walking",
    });

    expect(injected["2"]!.inputs.text).toBe("new masterpiece prompt, 1girl");
    expect(injected["3"]!.inputs.text).toBe("lowres, bad quality");
    expect(injected["4"]!.inputs.seed).toBe(99999);
    expect(injected["4"]!.inputs.steps).toBe(25);
    expect(injected["4"]!.inputs.cfg).toBe(7.5);
    expect(injected["4"]!.inputs.sampler_name).toBe("dpmpp_2m");
    expect(injected["4"]!.inputs.scheduler).toBe("karras");
    expect(injected["5"]!.inputs.filename_prefix).toBe("sprites/tara_walking");
  });

  it("applies three-option attention feedback to prompt tags", () => {
    const currentPositive = "1girl, (smile:1.4), (blush:1.2), standing";
    const currentNegative = "blurry, low quality";

    const feedback: Record<string, "better" | "keep" | "worse"> = {
      smile: "better",
      blush: "worse",
      standing: "better",
    };

    const result = applyAttentionFeedback(currentPositive, currentNegative, feedback);

    // smile weight increases by +0.2 -> 1.6
    expect(result.positivePrompt).toContain("(smile:1.6)");
    // blush weight decreases by -0.2 -> 1.0
    expect(result.positivePrompt).toContain("(blush:1)");
    // unweighted standing becomes weighted (standing:1.3)
    expect(result.positivePrompt).toContain("(standing:1.3)");
  });

  it("moves tags to negative prompt when reduced below 1.0", () => {
    const currentPositive = "1girl, (horns:1.0), wings";
    const currentNegative = "blurry";

    const feedback: Record<string, "better" | "keep" | "worse"> = {
      horns: "worse", // 1.0 - 0.2 = 0.8 (< 1.0), should move to negative
    };

    const result = applyAttentionFeedback(currentPositive, currentNegative, feedback);
    expect(result.positivePrompt).not.toContain("horns");
    expect(result.negativePrompt).toContain("horns");
  });
});

describe("ComfyUI Client API", () => {
  it("parses system_stats to detect online status and devices", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);

    const mockStats = {
      devices: [
        {
          name: "Intel(R) Iris(R) Xe Graphics",
          type: "GPU",
          vram_total: 8000000000,
          vram_free: 6000000000,
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockStats), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const status = await client.checkStatus();
    expect(status.online).toBe(true);
    expect(status.devices).toHaveLength(1);
    expect(status.devices[0]!.name).toContain("Iris");
  });

  it("handles offline status when ComfyUI is unreachable", async () => {
    const client = new ComfyUiClient("127.0.0.1", 8188);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

    const status = await client.checkStatus();
    expect(status.online).toBe(false);
    expect(status.devices).toEqual([]);
  });
});

describe("Visual Novel Asset Studio Server Endpoints", () => {
  it("lists all visual novels and assets across worlds", async () => {
    const r = await rig();
    const c = await host(r);

    // 1. Create world
    const worldRes = await c.post("/api/worlds", {
      title: "VN Test World",
      tagline: "For asset testing",
      premise: "A premise.",
    });
    expect(worldRes.status).toBe(201);
    const world = worldRes.body.world as { name: string };

    // 2. Scaffold a visual novel
    const scaffoldRes = await c.post(`/api/worlds/${world.name}/vns/scaffold`, {
      slug: "ch01-prologue",
      title: "Prologue",
      source: "chapters/01.md",
      tier: "short",
    });
    expect(scaffoldRes.status).toBe(201);

    // 3. GET /api/vns lists all VNs
    const vnsRes = await c.get("/api/vns");
    expect(vnsRes.status).toBe(200);
    const { vns } = vnsRes.body as { vns: Array<{ slug: string; worldName: string }> };
    expect(vns.some((v) => v.slug === "ch01-prologue" && v.worldName === world.name)).toBe(true);

    // 4. GET /api/worlds/:name/vns/:slug/assets returns asset items
    const assetsRes = await c.get(`/api/worlds/${world.name}/vns/ch01-prologue/assets`);
    if (assetsRes.status !== 200)
      console.error("DEBUG assetsRes:", assetsRes.status, assetsRes.body, "Logs:", r.logs);
    expect(assetsRes.status).toBe(200);
    const assetData = assetsRes.body as { sprites: any[]; cgs: any[]; backgrounds: any[] };
    expect(assetData.sprites.length).toBeGreaterThan(0);
    expect(assetData.cgs.length).toBeGreaterThan(0);
    expect(assetData.backgrounds.length).toBeGreaterThan(0);

    // 5. GET /api/worlds/:name/vns/:slug/asset-meta/:type/:name returns detail
    const detailRes = await c.get(
      `/api/worlds/${world.name}/vns/ch01-prologue/asset-meta/sprite/main_character_neutral`,
    );
    expect(detailRes.status).toBe(200);
    const detail = detailRes.body as {
      name: string;
      type: string;
      positivePrompt: string;
      negativePrompt: string;
    };
    expect(detail.name).toBe("main_character_neutral");
    expect(detail.type).toBe("sprite");
    expect(detail.positivePrompt).toContain("1girl, solo");
    expect(detail.positivePrompt).toContain("uncensored");
    expect(detail.negativePrompt).toContain("bad anatomy");

    // 6. GET /api/worlds/:name/vns/_shared/assets returns shared asset pool
    const sharedRes = await c.get(`/api/worlds/${world.name}/vns/_shared/assets`);
    expect(sharedRes.status).toBe(200);
    const sharedData = sharedRes.body as { sprites: any[]; cgs: any[]; backgrounds: any[] };
    expect(sharedData.sprites).toBeDefined();

    // 7. GET /api/worlds/:name/vns/_all/assets aggregates all assets with isShared / vnSlug metadata
    const allRes = await c.get(`/api/worlds/${world.name}/vns/_all/assets`);
    expect(allRes.status).toBe(200);
    const allData = allRes.body as { sprites: any[]; cgs: any[]; backgrounds: any[] };
    expect(allData.sprites.length).toBeGreaterThan(0);
    expect(allData.sprites.some((s) => s.vnSlug !== undefined || s.isShared !== undefined)).toBe(
      true,
    );

    // 8. GET /api/worlds/:name/dataset/:slug/:name/:ts/image streams archived generation image
    const ts = "2026-11-01T12-00-00Z";
    const datasetDir = join(
      r.library.root,
      world.name,
      "assets",
      "dataset",
      "ch01-prologue",
      "test_sprite",
      ts,
    );
    await mkdir(datasetDir, { recursive: true });
    await writeFile(join(datasetDir, "generated_image.png"), "dummy-png-data");

    const imgRes = await r.app.request(
      `/api/worlds/${world.name}/dataset/ch01-prologue/test_sprite/${ts}/image`,
    );
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toBe("image/png");
    expect(await imgRes.text()).toBe("dummy-png-data");

    // 9. Single asset archive & delete
    const assetFile = join(
      r.library.root,
      world.name,
      "vns",
      "ch01-prologue",
      "assets",
      "sprites",
      "main_character_neutral.png",
    );
    await mkdir(join(r.library.root, world.name, "vns", "ch01-prologue", "assets", "sprites"), {
      recursive: true,
    });
    await writeFile(assetFile, "dummy-sprite-image");

    const archOne = await c.post(
      `/api/worlds/${world.name}/vns/ch01-prologue/asset-meta/sprite/main_character_neutral/archive`,
      {},
    );
    expect(archOne.status).toBe(200);
    expect((archOne.body as any).ok).toBe(true);

    const delOne = await c.del(
      `/api/worlds/${world.name}/vns/ch01-prologue/asset-meta/sprite/main_character_neutral`,
    );
    expect(delOne.status).toBe(200);
    expect((delOne.body as any).ok).toBe(true);

    // 10. Bulk archive and delete
    await writeFile(assetFile, "recreated-sprite-image");
    const archAll = await c.post(
      `/api/worlds/${world.name}/vns/ch01-prologue/assets/archive-all`,
      {},
    );
    expect(archAll.status).toBe(200);
    expect((archAll.body as any).archivedCount).toBeGreaterThanOrEqual(1);

    const delAll = await c.post(
      `/api/worlds/${world.name}/vns/ch01-prologue/assets/delete-all`,
      {},
    );
    expect(delAll.status).toBe(200);
    expect((delAll.body as any).deletedCount).toBeGreaterThanOrEqual(1);

    // 11. Custom prompt spec resolution from vns/_shared/assets/prompts.json
    const promptsJsonPath = join(
      r.library.root,
      world.name,
      "vns",
      "_shared",
      "assets",
      "prompts.json",
    );
    await mkdir(join(r.library.root, world.name, "vns", "_shared", "assets"), { recursive: true });
    await writeFile(
      promptsJsonPath,
      JSON.stringify({
        main_character_neutral: {
          name: "main_character_neutral",
          type: "sprite",
          positivePrompt: "canon high fidelity character sprite from prompts.json",
          negativePrompt: "lowres, bad anatomy",
          steps: 28,
          cfg: 8.0,
        },
      }),
    );

    const customDetailRes = await c.get(
      `/api/worlds/${world.name}/vns/ch01-prologue/asset-meta/sprite/main_character_neutral`,
    );
    expect(customDetailRes.status).toBe(200);
    const customDetail = customDetailRes.body as any;
    expect(customDetail.positivePrompt).toBe(
      "canon high fidelity character sprite from prompts.json",
    );
    expect(customDetail.negativePrompt).toBe("lowres, bad anatomy");
    expect(customDetail.steps).toBe(28);
    expect(customDetail.cfg).toBe(8.0);
  });
});
