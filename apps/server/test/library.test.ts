import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp, Library, StoryFiles } from "../src";
import { Client, HOST_KEY, rig, tempLibrary, until } from "./helpers";

type Rig = Awaited<ReturnType<typeof rig>>;

async function host(r: Rig) {
  const c = new Client(r.app);
  expect((await c.join("x", { hostKey: HOST_KEY })).status).toBe(201);
  return c;
}

describe("the library of worlds", () => {
  it("lists every folder with a world.json, by title, with how many stories it holds", async () => {
    const root = await tempLibrary();
    const library = new Library(root);
    const [only] = await library.list();
    expect(only).toMatchObject({ name: "example-world", title: "The Lantern Coast", stories: 0 });

    await new StoryFiles(join(root, "example-world", "stories")).sink("one").append({
      id: "a",
      parentId: null,
      t: "2026-10-25T10:00:00Z",
      kind: "host",
      text: "Hello.",
    } as never);
    expect((await library.list())[0]?.stories).toBe(1);
  });

  it("skips folders that are not worlds, and shows a broken one with its problem", async () => {
    const root = await tempLibrary();
    await mkdir(join(root, "_template"));
    await writeFile(join(root, "_template", "world.json"), "{}");
    await mkdir(join(root, "notes"));
    await mkdir(join(root, "half.tmp-ab12"));
    await writeFile(join(root, "half.tmp-ab12", "world.json"), "{}");
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken", "world.json"), "not json");

    const names = (await new Library(root).list()).map((w) => w.name);
    expect(names.sort()).toEqual(["broken", "example-world"]);
    const broken = (await new Library(root).list()).find((w) => w.name === "broken");
    expect(broken?.problem).toContain("world.json");
  });

  it("is empty, not an error, when the folder is missing; and refuses names that leave it", async () => {
    const library = new Library(join(await tempLibrary(), "nowhere"));
    expect(await library.list()).toEqual([]);
    for (const name of ["../x", "a/b", "", ".hidden"]) {
      expect(() => library.open(name), name).toThrow();
    }
  });
});

describe("choosing a world on screen", () => {
  it("starts with nothing open when asked to, and says so plainly", async () => {
    const r = await rig(undefined, { world: "none" });
    const dana = await host(r);
    expect((await dana.get("/api/table")).body.world).toBeNull();
    expect((await dana.get("/api/state")).body.world).toBeNull();
    const started = await dana.post("/api/stories", {});
    expect(started.status).toBe(409);
    expect(started.body.error.message).toBe("Choose a world first.");
    expect((await dana.get("/api/source/cards")).body.error.message).toBe("Choose a world first.");
  });

  it("lists worlds for the host, opens one, and tells everyone connected", async () => {
    const r = await rig(undefined, { world: "none" });
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const seen = await sam.listen();

    expect((await sam.get("/api/worlds")).status).toBe(403);
    expect((await sam.post("/api/worlds/open", { name: "example-world" })).status).toBe(403);
    expect(
      (await dana.get("/api/worlds")).body.worlds.map((w: { name: string }) => w.name),
    ).toEqual(["example-world"]);

    const opened = await dana.post("/api/worlds/open", { name: "example-world" });
    expect(opened.body.world).toMatchObject({ name: "example-world", title: "The Lantern Coast" });
    await until(() => seen.of("world").length === 1);
    expect(seen.of("world")[0].world.title).toBe("The Lantern Coast");
    expect((await sam.get("/api/state")).body.world.name).toBe("example-world");
    expect((await dana.post("/api/stories", {})).status).toBe(202);
  });

  it("refuses a world that does not exist or is broken", async () => {
    const r = await rig(undefined, { world: "none" });
    await mkdir(join(r.library.root, "broken"));
    await writeFile(join(r.library.root, "broken", "world.json"), "not json");
    const dana = await host(r);
    expect((await dana.post("/api/worlds/open", { name: "nope" })).status).toBe(400);
    expect((await dana.post("/api/worlds/open", { name: "../x" })).status).toBe(400);
    const broken = await dana.post("/api/worlds/open", { name: "broken" });
    expect(broken.status).toBe(409);
    expect(broken.body.error.message).toContain("world.json");
  });

  it("opens the only world by itself, but not when there is a choice", async () => {
    const one = await rig(undefined, { world: "none" });
    expect((await one.table.openOnlyWorld())?.name).toBe("example-world");

    const two = await rig(undefined, { world: "none" });
    const dana = await host(two);
    await dana.post("/api/worlds/open", { name: "example-world" });
    await dana.post("/api/stories", {});
    await two.table.idle();
    await dana.post("/api/story/save-as-world", { name: "second-act" });
    const again = await rig(undefined, { world: "none", library: two.library.root });
    expect(await again.table.openOnlyWorld()).toBeUndefined();
  });

  it("puts the story away when another world is opened, and keeps it saved", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const seen = await sam.listen();
    await dana.post("/api/stories", {});
    await r.table.idle();
    await dana.post("/api/story/save-as-world", { name: "second-act" });

    await dana.post("/api/worlds/open", { name: "second-act" });
    await until(() => seen.of("story-view").at(-1) === null);
    expect((await sam.get("/api/state")).body.story).toBeNull();
    expect((await dana.get("/api/stories")).body.stories).toEqual([]); // that world has none yet

    await dana.post("/api/worlds/open", { name: "example-world" });
    expect((await dana.get("/api/stories")).body.stories).toHaveLength(1);
  });

  it("will not switch worlds or put the story away while a reply is being written", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const r = await rig([{ chunks: ["Opening."] }], {
      wrap: (inner) => ({
        ...inner,
        stream: (req, signal) =>
          (async function* () {
            await gate;
            yield* inner.stream(req, signal);
          })(),
      }),
    });
    const dana = await host(r);
    await dana.post("/api/stories", {});
    expect((await dana.post("/api/worlds/open", { name: "example-world" })).status).toBe(409);
    expect((await dana.post("/api/story/close")).status).toBe(409);
    release();
    await r.table.idle();
    expect((await dana.post("/api/story/close")).status).toBe(200);
  });
});

describe("continuing a saved story", () => {
  it("lists stories with enough to recognise them, and continues one after closing it", async () => {
    const r = await rig([
      { chunks: ["The lamp gutters in the fog."] },
      { chunks: ["It steadies."] },
    ]);
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const { body } = await dana.post("/api/stories", {});
    await r.table.idle();
    await sam.put("/api/board/draft", { mode: "do", text: "I steady the lamp." });
    await sam.post("/api/board/ready");
    await r.table.idle();

    const [story] = (await dana.get("/api/stories")).body.stories;
    expect(story).toMatchObject({
      id: body.id,
      turns: 3,
      players: ["Sam"],
      preview: "It steadies.",
    });
    expect(story.startedAt).toBeTruthy();
    expect(story.damaged).toBeUndefined();

    expect((await sam.post("/api/story/close")).status).toBe(403);
    expect((await dana.post("/api/story/close")).status).toBe(200);
    expect((await sam.get("/api/state")).body.story).toBeNull();

    expect((await dana.post(`/api/stories/${body.id}/resume`)).status).toBe(200);
    expect((await sam.get("/api/state")).body.story.turns).toHaveLength(3);
  });

  it("marks an unreadable story as damaged instead of failing the whole list", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const dana = await host(r);
    await dana.post("/api/stories", {});
    await r.table.idle();
    await mkdir(r.stories.folder("bad-one"));
    await writeFile(join(r.stories.folder("bad-one"), "events.jsonl"), "not json\n{}\n");
    const list = (await dana.get("/api/stories")).body.stories;
    expect(list).toHaveLength(2);
    expect(list.find((s: { id: string }) => s.id === "bad-one")).toMatchObject({ damaged: true });
  });
});

describe("serving the screens", () => {
  async function withUi(files: Record<string, string>) {
    const r = await rig();
    const dir = join(await tempLibrary(), "..", "ui");
    await mkdir(join(dir, "assets"), { recursive: true });
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    return createApp({ table: r.table, ui: dir });
  }

  it("serves the front page, assets with their types, and the front page again for screen addresses", async () => {
    const app = await withUi({
      "index.html": "<h1>Nirmata</h1>",
      "assets/app.js": "console.log(1)",
    });
    const home = await app.request("/");
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toBe("<h1>Nirmata</h1>");

    const asset = await app.request("/assets/app.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect(await (await app.request("/some/screen")).text()).toBe("<h1>Nirmata</h1>");
    expect((await app.request("/missing.js")).status).toBe(404);
  });

  it("never lets an address reach outside the folder or hide the API", async () => {
    const app = await withUi({ "index.html": "<h1>x</h1>" });
    expect((await app.request("/..%2f..%2fpackage.json")).status).toBe(404);
    expect((await app.request("/%2e%2e/%2e%2e/package.json")).status).toBe(404);
    const api = await app.request("/api/nope");
    expect(api.status).toBe(404);
    expect((await api.json()).error.code).toBe("not_found");
    expect((await app.request("/api/table")).status).toBe(200);
  });
});
