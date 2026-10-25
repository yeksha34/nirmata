import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { slugify } from "../src";
import { Client, HOST_KEY, rig, until } from "./helpers";

type Rig = Awaited<ReturnType<typeof rig>>;

async function host(r: Rig) {
  const c = new Client(r.app);
  expect((await c.join("x", { hostKey: HOST_KEY })).status).toBe(201);
  return c;
}

const pause = (ms = 25) => new Promise((done) => setTimeout(done, ms));

describe("making a world", () => {
  it("names the folder after the title, keeps it unique, and is for the host only", async () => {
    const r = await rig(undefined, { world: "none" });
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");

    expect((await sam.post("/api/worlds", { title: "Nope" })).status).toBe(403);
    expect((await dana.post("/api/worlds", { title: "   " })).status).toBe(400);

    const first = await dana.post("/api/worlds", {
      title: "The Salt Road!",
      tagline: "A long walk",
    });
    expect(first.status).toBe(201);
    expect(first.body.world).toEqual({
      name: "the-salt-road",
      title: "The Salt Road!",
      tagline: "A long walk",
      stories: 0,
    });
    const second = await dana.post("/api/worlds", { title: "The Salt Road" });
    expect(second.body.world.name).toBe("the-salt-road-2");

    const names = (await dana.get("/api/worlds")).body.worlds.map((w: { name: string }) => w.name);
    expect(names).toEqual(expect.arrayContaining(["the-salt-road", "the-salt-road-2"]));
    // making a world does not open it
    expect((await dana.get("/api/state")).body.world).toBeNull();
  });

  it("turns the premise into a card that is always in view, so the world can be played at once", async () => {
    const r = await rig(undefined, { world: "none" });
    const dana = await host(r);
    await dana.post("/api/worlds", {
      title: "Ashfall",
      premise: "A city under falling ash. Nobody remembers the sun.",
    });

    const detail = (await dana.get("/api/worlds/ashfall")).body;
    expect(detail.world.title).toBe("Ashfall");
    expect(detail.cards).toHaveLength(1);
    expect(detail.cards[0].fm).toMatchObject({ id: "lore.premise", kind: "lore", always: true });
    expect(detail.cards[0].body).toContain("Nobody remembers the sun.");

    const started = await dana.post("/api/worlds/ashfall/stories", {});
    expect(started.status).toBe(202);
    await r.table.idle();
    expect((await dana.get("/api/state")).body.story.turns.length).toBeGreaterThan(0);
  });

  it("makes a world with no premise too, and leaves nothing half-made behind", async () => {
    const r = await rig(undefined, { world: "none" });
    const dana = await host(r);
    await dana.post("/api/worlds", { title: "Bare" });
    expect((await dana.get("/api/worlds/bare")).body.cards).toEqual([]);
    expect((await readdir(r.library.root)).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("makes folder names from titles", () => {
    expect(slugify("The Lantern Coast")).toBe("the-lantern-coast");
    expect(slugify("  Café — Nuit  ")).toBe("cafe-nuit");
    expect(slugify("日本")).toBe("world");
    expect(slugify("x".repeat(80))).toHaveLength(40);
  });
});

describe("a world's page", () => {
  it("shows a world that is not open: its stories and cards, host only", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await dana.post("/api/stories", {});
    await r.table.idle();
    await dana.post("/api/story/close");
    await dana.post("/api/worlds", { title: "Elsewhere" }); // example-world stays the open one

    const page = (await dana.get("/api/worlds/example-world")).body;
    expect(page.world.title).toBe("The Lantern Coast");
    expect(page.stories).toHaveLength(1);
    expect(page.cards.length).toBeGreaterThan(0);

    expect((await sam.get("/api/worlds/example-world")).status).toBe(403);
    expect((await dana.get("/api/worlds/nowhere")).body.error.code).toBe("nothing_to_do");
    expect((await dana.get("/api/worlds/..%2Fetc")).status).toBe(400);
  });
});

describe("managing a world", () => {
  it("changes the title and tagline, keeps the rest of world.json, and updates the open world", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const seen = await sam.listen();
    const before = JSON.parse(await readFile(join(r.world.root, "world.json"), "utf8"));

    expect((await sam.patch("/api/worlds/example-world", { title: "Mine" })).status).toBe(403);
    expect((await dana.patch("/api/worlds/example-world", { name: "other" })).status).toBe(400);
    expect((await dana.patch("/api/worlds/example-world", { title: "" })).status).toBe(400);

    const done = await dana.patch("/api/worlds/example-world", {
      title: "The Lantern Coast, Revised",
      tagline: "Fog and light",
    });
    expect(done.body.world).toMatchObject({
      name: "example-world",
      title: "The Lantern Coast, Revised",
      tagline: "Fog and light",
    });

    const after = JSON.parse(await readFile(join(r.world.root, "world.json"), "utf8"));
    expect(after).toEqual({
      ...before,
      title: "The Lantern Coast, Revised",
      tagline: "Fog and light",
    });
    await until(() => seen.of("world").length > 0);
    expect(seen.of("world").at(-1).world.title).toBe("The Lantern Coast, Revised");
  });

  it("puts a world away by renaming its folder, not deleting it", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await dana.post("/api/worlds", { title: "Keep Me" });

    expect((await sam.post("/api/worlds/keep-me/archive")).status).toBe(403);
    expect((await dana.post("/api/worlds/nowhere/archive")).status).toBe(400);
    expect((await dana.post("/api/worlds/keep-me/archive")).status).toBe(200);

    const names = (await dana.get("/api/worlds")).body.worlds.map((w: { name: string }) => w.name);
    expect(names).not.toContain("keep-me");
    const folders = await readdir(r.library.root);
    const away = folders.find((n) => n.startsWith("_archived-keep-me-"));
    expect(away).toBeTruthy();
    expect(await readFile(join(r.library.root, away ?? "", "world.json"), "utf8")).toContain(
      "Keep Me",
    );
    // the name is free again
    expect((await dana.post("/api/worlds", { title: "Keep Me" })).body.world.name).toBe("keep-me");
  });

  it("closes the world and its story for everyone when the open world is put away", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await dana.post("/api/stories", {});
    await r.table.idle();
    const seen = await sam.listen();

    expect((await dana.post("/api/worlds/example-world/archive")).status).toBe(200);
    await until(() => seen.of("world").at(-1)?.world === null);
    const state = (await sam.get("/api/state")).body;
    expect(state.world).toBeNull();
    expect(state.story).toBeNull();
  });
});

describe("picking up where you left off", () => {
  it("lists the latest stories across every world, and continues one in a world that is not open", async () => {
    const r = await rig([{ chunks: ["Salt wind."] }, { chunks: ["Ash falls."] }]);
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await dana.post("/api/worlds", { title: "Ashfall", premise: "Falling ash." });

    expect((await sam.get("/api/recent")).status).toBe(403);
    expect((await dana.get("/api/recent")).body.stories).toEqual([]);

    const salt = (await dana.post("/api/stories", {})).body.id; // in example-world
    await r.table.idle();
    await pause();
    const ash = (await dana.post("/api/worlds/ashfall/stories", {})).body.id; // opens ashfall
    await r.table.idle();
    expect((await dana.get("/api/state")).body.world.name).toBe("ashfall");

    const recent = (await dana.get("/api/recent")).body.stories;
    expect(recent.map((s: { id: string }) => s.id)).toEqual([ash, salt]); // newest first
    expect(recent[0]).toMatchObject({
      world: "ashfall",
      worldTitle: "Ashfall",
      preview: "Ash falls.",
    });
    expect(recent[1]).toMatchObject({ world: "example-world", preview: "Salt wind." });

    await dana.post("/api/story/close");
    const back = await dana.post(`/api/worlds/example-world/stories/${salt}/resume`);
    expect(back.status).toBe(200);
    const state = (await sam.get("/api/state")).body;
    expect(state.world.name).toBe("example-world");
    expect(state.story.id).toBe(salt);
  });

  it("limits the list and leaves out damaged stories", async () => {
    const r = await rig([{ chunks: ["One."] }]);
    const dana = await host(r);
    await dana.post("/api/stories", {});
    await r.table.idle();
    expect((await r.library.recent(0)).length).toBe(0);
    expect((await r.library.recent(5)).length).toBe(1);
  });

  it("says plainly when the story to continue is not there", async () => {
    const r = await rig();
    const dana = await host(r);
    const gone = await dana.post("/api/worlds/example-world/stories/nothing-here/resume");
    expect(gone.body.error.message).toBe('There is no story "nothing-here".');
    const nowhere = await dana.post("/api/worlds/nowhere/stories", {});
    expect(nowhere.body.error.message).toBe('There is no world "nowhere".');
  });
});
