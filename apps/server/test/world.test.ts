import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PLOT_HEADING } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { WorldFiles } from "../src";
import { Client, HOST_KEY, rig } from "./helpers";

type Rig = Awaited<ReturnType<typeof rig>>;

async function liveStory(r: Rig) {
  const dana = new Client(r.app);
  await dana.join("x", { hostKey: HOST_KEY });
  const { body } = await dana.post("/api/stories", {});
  await r.table.idle();
  return { dana, id: body.id as string };
}

describe("saving a story as a world", () => {
  it("writes a new world beside the old one, with the plot written into the cards", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const { dana } = await liveStory(r);
    await dana.post("/api/story/plot-points", {
      card: "char.marrow",
      text: "Marrow lit the lamp.",
    });

    const res = await dana.post("/api/story/save-as-world", { name: "lantern-after" });
    expect(res.status).toBe(201);
    expect(res.body.world).toMatchObject({ name: "lantern-after" });

    const root = join(dirname(r.world.root), "lantern-after");
    const made = new WorldFiles(root);
    expect(await made.world()).toMatchObject({
      name: "lantern-after",
      title: "The Lantern Coast (continued)",
    });
    const cards = await made.cards();
    const marrow = cards.find((c) => c.fm.id === "char.marrow");
    expect(marrow?.body).toContain(PLOT_HEADING);
    expect(marrow?.body).toContain("- Marrow lit the lamp.");
    expect(cards.some((c) => c.fm.id === "lore.current-situation")).toBe(false);
    expect(await readdir(join(root, "stories"))).toEqual([".gitkeep"]);
    expect(await readdir(dirname(root))).not.toContain(expect.stringContaining(".tmp-"));
  });

  it("leaves the original world and the running story untouched", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const { dana, id } = await liveStory(r);
    const before = await readFile(join(r.world.root, "characters", "marrow.md"), "utf8");
    const log = await readFile(join(r.stories.folder(id), "events.jsonl"), "utf8");
    await dana.post("/api/story/plot-points", {
      card: "char.marrow",
      text: "Marrow lit the lamp.",
    });
    await dana.post("/api/story/save-as-world", { name: "copy-one", title: "A Copy" });

    expect(await readFile(join(r.world.root, "characters", "marrow.md"), "utf8")).toBe(before);
    expect((await r.stories.load(id)).length).toBe(log.trim().split("\n").length + 1); // only the plot point
    expect((await dana.get("/api/state")).body.story.turns).toHaveLength(1);
    expect((await new WorldFiles(join(dirname(r.world.root), "copy-one")).world()).title).toBe(
      "A Copy",
    );
  });

  it("starts a fresh story in the new world, which opens with the saved plot", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const { dana } = await liveStory(r);
    await dana.post("/api/story/plot-points", {
      card: "char.marrow",
      text: "Marrow lit the lamp.",
    });
    await dana.post("/api/story/save-as-world", { name: "second-act" });

    const next = await rig([{ chunks: ["A new beginning."] }], {
      root: join(dirname(r.world.root), "second-act"),
    });
    const host = new Client(next.app);
    await host.join("x", { hostKey: HOST_KEY });
    const { body } = await host.post("/api/stories", {});
    await next.table.idle();
    const begin = (await next.stories.load(body.id))[0];
    expect(begin?.cards.find((c) => c.fm.id === "char.marrow")?.body).toContain(
      "Marrow lit the lamp.",
    );
    expect(begin?.cards.some((c) => c.fm.id === "lore.current-situation")).toBe(true); // a fresh one
  });

  it("refuses a name already in use, a bad name, and anyone but the host", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const { dana } = await liveStory(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    expect((await sam.post("/api/story/save-as-world", { name: "mine" })).status).toBe(403);

    const taken = await dana.post("/api/story/save-as-world", { name: "world" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toContain("already a world");
    for (const name of ["Bad Name", "x", "../escape", "UPPER", ""]) {
      const res = await dana.post("/api/story/save-as-world", { name });
      expect(res.status, name).toBe(400);
    }
    expect((await dana.post("/api/story/save-as-world", { name: "ok-one" })).status).toBe(201);
    expect((await dana.post("/api/story/save-as-world", { name: "ok-one" })).status).toBe(409);
  });

  it("can save an earlier moment, and says plainly when there is none or no story", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const dana = new Client(r.app);
    await dana.join("x", { hostKey: HOST_KEY });
    const none = await dana.post("/api/story/save-as-world", { name: "no-story" });
    expect(none.status).toBe(409);
    expect(none.body.error.message).toContain("no story");

    await dana.post("/api/stories", {});
    await r.table.idle();
    const missing = await dana.post("/api/story/save-as-world", { name: "no-moment", at: "nope" });
    expect(missing.status).toBe(400);
    const head = (await dana.get("/api/state")).body.story.head as string;
    expect(
      (await dana.post("/api/story/save-as-world", { name: "at-head", at: head })).status,
    ).toBe(201);
  });
});
