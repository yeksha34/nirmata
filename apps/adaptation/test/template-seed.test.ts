import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// the generator is plain JavaScript beside the database tools
// @ts-expect-error no declarations for a .mjs script
import { build, bundled, forDatabase, KINDS, OUT } from "../../../tools/gen-template-migration.mjs";

type Graph = Record<string, { class_type: string; inputs: { text?: string } }>;
const kinds = KINDS as Record<string, string>;

describe("the platform workflow defaults in the database", () => {
  const sql = readFileSync(OUT as string, "utf8");

  it("are the bundled ComfyUI workflows: the migration has not drifted from the files", () => {
    expect(sql).toBe(build());
  });

  it("carry one graph per kind of asset, each equal to its bundled file", () => {
    const graphs = [...sql.matchAll(/\('(workflow_\w+)', \$tpl\$(.*?)\$tpl\$::jsonb\)/gs)];
    expect(graphs.map((g) => g[1])).toEqual(Object.keys(kinds));
    for (const [, kind, json] of graphs) {
      expect(JSON.parse(json as string)).toEqual(
        forDatabase(bundled(kinds[kind as string] as string)),
      );
    }
  });

  it("hold no prompt text", () => {
    for (const [, json] of sql.matchAll(/\$tpl\$(.*?)\$tpl\$/gs)) {
      const graph = JSON.parse(json as string) as Graph;
      for (const node of Object.values(graph)) {
        if (node.class_type === "CLIPTextEncode") expect(node.inputs.text).toBe("");
      }
    }
  });

  it("only use nodes the allow-list admits", () => {
    const admitted = new Set([
      "CheckpointLoaderSimple",
      "VAELoader",
      "LoraLoader",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage",
      "LoadImage",
      "ImageScale",
      "RMBG",
      "TorchCompileDiffusionOpenVINO",
    ]);
    for (const file of Object.values(kinds)) {
      for (const node of Object.values(bundled(file) as Graph)) {
        expect(admitted.has(node.class_type), node.class_type).toBe(true);
      }
    }
  });
});
