import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client, HOST_KEY, type Json, rig } from "./helpers";

async function setup() {
  const r = await rig([]);
  const c = new Client(r.app);
  expect((await c.join("ignored", { hostKey: HOST_KEY })).status).toBe(201);
  await r.world.scaffoldVn({ slug: "ch01", title: "One", source: "chapters/01.md" });
  const file = join(r.world.root, "assets", "workflow", "prompts.json");
  await mkdir(join(r.world.root, "assets", "workflow"), { recursive: true });
  const put = (type: string, name: string, body: Json) =>
    c.put(`/api/worlds/example-world/vns/ch01/asset-meta/${type}/${name}/prompt`, body);
  const detail = async (type: string, name: string) =>
    (await c.get(`/api/worlds/example-world/vns/ch01/asset-meta/${type}/${name}`)).body;
  return { r, c, file, put, detail };
}

describe("remembering an asset's prompt", () => {
  it("saves what the author typed, and shows it again when the asset is selected", async () => {
    const { put, detail, file } = await setup();
    const before = await detail("sprite", "ada_happy");
    expect(before.positivePrompt).not.toBe("my own prompt");

    const saved = await put("sprite", "ada_happy", {
      positivePrompt: "my own prompt",
      negativePrompt: "not this",
      steps: 30,
      cfg: 6,
      sampler: "euler",
      scheduler: "normal",
    });
    expect(saved.status).toBe(200);

    const after = await detail("sprite", "ada_happy");
    expect(after).toMatchObject({
      positivePrompt: "my own prompt",
      negativePrompt: "not this",
      steps: 30,
      cfg: 6,
      sampler: "euler",
      scheduler: "normal",
    });
    // and another asset is untouched
    expect((await detail("sprite", "ada_sad")).positivePrompt).not.toBe("my own prompt");
    expect(JSON.parse(await readFile(file, "utf8")).ada_happy.type).toBe("sprite");
  });

  it("keeps the other entries, and the seed the entry already had", async () => {
    const { put, file } = await setup();
    await writeFile(
      file,
      JSON.stringify({
        other: { name: "other", type: "cg", positivePrompt: "keep me" },
        ada_happy: {
          name: "ada_happy",
          type: "sprite",
          positivePrompt: "old",
          seed: 42,
          status: "approved",
        },
      }),
    );
    await put("sprite", "ada_happy", { positivePrompt: "new" });
    const data = JSON.parse(await readFile(file, "utf8"));
    expect(data.other.positivePrompt).toBe("keep me");
    expect(data.ada_happy).toMatchObject({ positivePrompt: "new", seed: 42, status: "approved" });
  });

  it("keeps a file written as a list a list", async () => {
    const { put, file, detail } = await setup();
    await writeFile(file, JSON.stringify([{ name: "a", type: "sprite", positivePrompt: "x" }]));
    await put("sprite", "ada_happy", { positivePrompt: "added" });
    await put("sprite", "a", { positivePrompt: "changed" });
    const data = JSON.parse(await readFile(file, "utf8"));
    expect(Array.isArray(data)).toBe(true);
    expect(data.map((e: Json) => [e.name, e.positivePrompt])).toEqual([
      ["a", "changed"],
      ["ada_happy", "added"],
    ]);
    expect((await detail("sprite", "ada_happy")).positivePrompt).toBe("added");
  });

  it("does not lose a save when two arrive together", async () => {
    const { put, file } = await setup();
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((n) =>
        put("sprite", `ada_${n}`, { positivePrompt: `prompt ${n}` }),
      ),
    );
    const data = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(data).sort()).toEqual(["ada_a", "ada_b", "ada_c", "ada_d", "ada_e"]);
  });

  it("leaves a file it cannot read alone, and says so", async () => {
    const { put, file } = await setup();
    await writeFile(file, "{ not json");
    const res = await put("sprite", "ada_happy", { positivePrompt: "x" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });

  it("is for the host only, and checks its input", async () => {
    const { r, put } = await setup();
    expect((await put("sprite", "ada_happy", { negativePrompt: "no text" })).status).toBe(400);
    expect((await put("sprite", "ada_happy", { positivePrompt: "x", steps: 0 })).status).toBe(400);
    const guest = new Client(r.app);
    await guest.join("Sam");
    const res = await guest.put(
      "/api/worlds/example-world/vns/ch01/asset-meta/sprite/ada_happy/prompt",
      {
        positivePrompt: "x",
      },
    );
    expect(res.status).toBe(403);
  });
});
