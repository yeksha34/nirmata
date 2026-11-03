import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowSource } from "@nirmata/adaptation";
import { afterEach, describe, expect, it } from "vitest";
import { WorldFiles } from "../src/files";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OWN = { "1": { class_type: "KSampler", inputs: { steps: 99 } } };
const FILE = { "1": { class_type: "KSampler", inputs: { steps: 11 } } };

function folder(withFile: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-workflow-"));
  dirs.push(root);
  writeFileSync(
    join(root, "world.json"),
    JSON.stringify({ name: "Sample World", title: "Sample" }),
  );
  if (withFile) {
    mkdirSync(join(root, "assets", "workflow"), { recursive: true });
    writeFileSync(join(root, "assets", "workflow", "sprite.json"), JSON.stringify(FILE));
  }
  return root;
}

const source = (
  scope: "platform" | "world" | "vn" | undefined,
): WorkflowSource & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    find: async (slug, type) => {
      asked.push(`${slug}:${type}`);
      return scope ? { scope, graph: OWN } : undefined;
    },
  };
};

describe("which workflow a world uses (ADR-0035)", () => {
  it("takes the world's own copy from the database before its files", async () => {
    const found = source("world");
    const world = new WorldFiles(folder(true), undefined, { workflows: found });
    expect(await world.loadWorkflowTemplate("sprite")).toEqual(OWN);
    expect(found.asked).toEqual(["sample-world:sprite"]);
  });

  it("takes a visual novel's pin before the files too", async () => {
    const world = new WorldFiles(folder(true), undefined, { workflows: source("vn") });
    expect(await world.loadWorkflowTemplate("sprite")).toEqual(OWN);
  });

  it("leaves the platform default to the files, which are the same workflow", async () => {
    const world = new WorldFiles(folder(true), undefined, { workflows: source("platform") });
    expect(await world.loadWorkflowTemplate("sprite")).toEqual(FILE);
  });

  it("uses the files when the database has nothing, or there is no database", async () => {
    expect(
      await new WorldFiles(folder(true), undefined, {
        workflows: source(undefined),
      }).loadWorkflowTemplate("sprite"),
    ).toEqual(FILE);
    expect(await new WorldFiles(folder(true)).loadWorkflowTemplate("sprite")).toEqual(FILE);
  });

  it("falls back to the bundled workflow when nothing else has one", async () => {
    const graph = await new WorldFiles(folder(false), undefined, {
      workflows: source(undefined),
    }).loadWorkflowTemplate("bg");
    expect(
      Object.values(graph).some((n) => (n as { class_type: string }).class_type === "KSampler"),
    ).toBe(true);
  });
});
