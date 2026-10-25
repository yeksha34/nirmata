import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newEvent, type ProjectedFile, parseCard } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { inside, newStoryId, StoryFiles, WorldFiles } from "../src";
import { tempWorld } from "./helpers";

const T = "2026-10-25T10:00:00Z";
const host = (id: string, parentId: string | null) =>
  newEvent({ id, parentId, t: T, kind: "host", text: id });

function card(path: string, id: string, body = "# Body\n\nText.\n") {
  const parsed = parseCard(path, `---\nid: ${id}\nkind: lore\nname: ${id}\n---\n${body}`);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.card;
}

describe("a world on disk", () => {
  it("reads the manifest and every card, leaving out files that start with _", async () => {
    const world = new WorldFiles(await tempWorld());
    expect((await world.world()).name).toBeTruthy();
    const ids = (await world.cards()).map((c) => c.fm.id);
    expect(ids).toContain("char.marrow");
    expect(ids).toContain("arc.fourth-light");
    expect((await world.cards()).every((c) => !c.path.includes("/_"))).toBe(true);
  });

  it("saves a card that reads back the same, and removes it by id", async () => {
    const world = new WorldFiles(await tempWorld());
    await world.save(card("lore/tides.md", "lore.tides", "# Tides\n\nThey keep time.\n"));
    const back = (await world.cards()).find((c) => c.fm.id === "lore.tides");
    expect(back?.body).toBe("# Tides\n\nThey keep time.\n");
    expect(back?.path).toBe("lore/tides.md");
    await world.remove("lore.tides");
    expect((await world.cards()).some((c) => c.fm.id === "lore.tides")).toBe(false);
  });

  it("refuses to write a card outside the card folders", async () => {
    const world = new WorldFiles(await tempWorld());
    for (const path of [
      "../escape.md",
      "lore/../../escape.md",
      "world.json",
      "stories/x.md",
      "lore/_draft.md",
      "lore/note.txt",
      "/etc/passwd.md",
    ]) {
      await expect(world.save(card(path, "lore.x")), path).rejects.toMatchObject({
        code: "invalid_card",
      });
    }
  });

  it("names a broken card file instead of loading around it", async () => {
    const root = await tempWorld();
    await writeFile(join(root, "lore", "broken.md"), "no frontmatter here");
    await expect(new WorldFiles(root).cards()).rejects.toThrow(/lore\/broken\.md/);
  });

  it("keeps paths inside a folder", () => {
    expect(inside("/w", "a/b.md")).toMatch(/b\.md$/);
    expect(() => inside("/w", "../b.md")).toThrow();
    expect(() => inside("/w", "a\0b")).toThrow();
  });
});

describe("a story on disk", () => {
  it("saves each event as one line and reads them back in order", async () => {
    const stories = new StoryFiles(join(await tempWorld(), "stories"));
    const sink = stories.sink("one");
    await sink.append(host("a", null));
    await sink.append(host("b", "a"));
    expect((await stories.load("one")).map((e) => e.id)).toEqual(["a", "b"]);
    const text = await readFile(join(stories.folder("one"), "events.jsonl"), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it("sets aside a half-written last line, so the next event starts on a clean line", async () => {
    const stories = new StoryFiles(join(await tempWorld(), "stories"));
    const sink = stories.sink("crash");
    await sink.append(host("a", null));
    const file = join(stories.folder("crash"), "events.jsonl");
    await writeFile(file, `${await readFile(file, "utf8")}{"id":"b","parentId":"a","t":"2026`);

    expect((await stories.load("crash")).map((e) => e.id)).toEqual(["a"]);
    expect(await readFile(`${file}.dropped`, "utf8")).toContain('{"id":"b"');
    await sink.append(host("c", "a"));
    expect((await stories.load("crash")).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("adds a missing final newline instead of gluing the next event on", async () => {
    const stories = new StoryFiles(join(await tempWorld(), "stories"));
    const file = join(stories.folder("nl"), "events.jsonl");
    await mkdir(stories.folder("nl"), { recursive: true });
    await writeFile(file, JSON.stringify(host("a", null)));
    await stories.load("nl");
    await stories.sink("nl").append(host("b", "a"));
    expect((await stories.load("nl")).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not guess when a line in the middle is bad", async () => {
    const stories = new StoryFiles(join(await tempWorld(), "stories"));
    await mkdir(stories.folder("bad"), { recursive: true });
    await writeFile(
      join(stories.folder("bad"), "events.jsonl"),
      `${JSON.stringify(host("a", null))}\nnot json\n${JSON.stringify(host("c", "a"))}\n`,
    );
    await expect(stories.load("bad")).rejects.toMatchObject({ code: "bad_state" });
  });

  it("lists saved stories, newest first, and says plainly when one is missing", async () => {
    const stories = new StoryFiles(join(await tempWorld(), "stories"));
    expect(await stories.list()).toEqual([]);
    await stories.sink("older").append(host("a", null));
    await new Promise((r) => setTimeout(r, 15));
    await stories.sink("newer").append(host("a", null));
    expect((await stories.list()).map((s) => s.id)).toEqual(["newer", "older"]);
    await expect(stories.load("nope")).rejects.toMatchObject({ code: "nothing_to_do" });
  });

  it("only accepts ids that cannot leave the stories folder", () => {
    const stories = new StoryFiles("/w/stories");
    for (const id of ["../x", "a/b", "", ".hidden", "a b"]) {
      expect(() => stories.folder(id), id).toThrow();
    }
    expect(newStoryId("2026-10-25T10:15:30.123Z")).toMatch(/^20261025-101530-[0-9a-f]{4}$/);
  });

  it("writes chapter and plot files, and deletes the ones the story no longer has", async () => {
    const stories = new StoryFiles(join(await tempWorld(), "stories"));
    await stories.sink("p").append(host("a", null));
    const file = (path: string, content: string): ProjectedFile => ({ path, content });
    await stories.writeProjection("p", [
      file("chapters/chapter-01-x.md", "one"),
      file("chapters/index.md", "idx"),
      file("plot/arc.md", "plot"),
    ]);
    await stories.writeProjection("p", [file("chapters/index.md", "idx2")]);
    const root = stories.folder("p");
    expect(await readdir(join(root, "chapters"))).toEqual(["index.md"]);
    expect(await readdir(join(root, "plot"))).toEqual([]);
    expect(await readFile(join(root, "chapters", "index.md"), "utf8")).toBe("idx2");
    await expect(stories.writeProjection("p", [file("../x.md", "no")])).rejects.toThrow();
  });
});
