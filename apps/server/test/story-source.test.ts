import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldSource, WritingInfo, WritingSource, WritingText } from "@nirmata/adaptation";
import { afterEach, describe, expect, it } from "vitest";
import { WorldFiles } from "../src/files";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A world folder named `sample-world`, with or without a world.json and a chapter on disk. */
function folder(options: { worldJson?: boolean; chapter?: boolean } = {}): string {
  const parent = mkdtempSync(join(tmpdir(), "nirmata-story-"));
  dirs.push(parent);
  const root = join(parent, "sample-world");
  mkdirSync(root);
  if (options.worldJson) {
    writeFileSync(
      join(root, "world.json"),
      JSON.stringify({ name: "Sample World", title: "From file" }),
    );
  }
  if (options.chapter) {
    mkdirSync(join(root, "chapters"));
    writeFileSync(join(root, "chapters", "chapter_1.md"), "# On disk\n\nfile text\n");
  }
  return root;
}

const manifest: WorldSource = {
  manifest: async (slug) =>
    slug === "sample-world" ? { name: "Sample World", title: "From database" } : undefined,
};

function writings(inDatabase = true): WritingSource {
  const rows: Array<WritingInfo & { text: string }> = [
    {
      path: "chapters/chapter_2.md",
      title: "Two",
      size: 5,
      updatedAt: "2026-01-02T00:00:00.000Z",
      text: "two",
    },
    {
      path: "chapters/chapter_10.md",
      title: "Ten",
      size: 5,
      updatedAt: "2026-01-03T00:00:00.000Z",
      text: "ten",
    },
    {
      path: "chapters/scenes/s1.md",
      title: "S",
      size: 5,
      updatedAt: "2026-01-01T00:00:00.000Z",
      text: "s",
    },
    {
      path: "chapters/index.md",
      title: "I",
      size: 5,
      updatedAt: "2026-01-01T00:00:00.000Z",
      text: "i",
    },
    {
      path: "drafts/old.md",
      title: "Old",
      size: 5,
      updatedAt: "2026-01-01T00:00:00.000Z",
      text: "old",
    },
    {
      path: "drafts/new.md",
      title: "New",
      size: 5,
      updatedAt: "2026-02-01T00:00:00.000Z",
      text: "new",
    },
    // an import that keeps each plot's files together: the folder says what each one is
    {
      path: "chapters/salt/chapter/c1.md",
      title: "C1",
      size: 5,
      updatedAt: "2026-01-01T00:00:00.000Z",
      text: "c",
    },
    {
      path: "chapters/salt/draft/d1.md",
      title: "D1",
      size: 5,
      updatedAt: "2026-03-01T00:00:00.000Z",
      text: "d",
    },
    {
      path: "chapters/salt/scenes/s1.md",
      title: "S1",
      size: 5,
      updatedAt: "2026-01-01T00:00:00.000Z",
      text: "s",
    },
  ];
  return {
    list: async () => (inDatabase ? rows.map(({ text: _t, ...info }) => info) : undefined),
    get: async (_w, path): Promise<WritingText | undefined> => {
      const r = rows.find((x) => x.path === path);
      return inDatabase && r ? { path: r.path, title: r.title, text: r.text } : undefined;
    },
  };
}

describe("an imported world's manifest (ADR-0035)", () => {
  it("is read from the database, even when the folder has a world.json", async () => {
    const world = new WorldFiles(folder({ worldJson: true }), undefined, { world: manifest });
    expect((await world.world()).title).toBe("From database");
  });

  it("makes a folder with no world.json a world", async () => {
    const world = new WorldFiles(folder(), undefined, { world: manifest });
    expect(await world.exists()).toBe(true);
    expect((await world.world()).title).toBe("From database");
  });

  it("falls back to world.json, and a folder with neither is not a world", async () => {
    const none: WorldSource = { manifest: async () => undefined };
    expect(
      (await new WorldFiles(folder({ worldJson: true }), undefined, { world: none }).world()).title,
    ).toBe("From file");
    expect(await new WorldFiles(folder(), undefined, { world: none }).exists()).toBe(false);
  });
});

describe("an imported world's chapters and drafts (ADR-0035)", () => {
  it("lists them from the database in reading order, leaving out scenes and index files", async () => {
    const world = new WorldFiles(folder({ worldJson: true, chapter: true }), undefined, {
      writings: writings(),
    });
    const list = await world.writings(new Set());
    expect(list.chapters.map((c) => c.path)).toEqual([
      "chapters/chapter_2.md",
      "chapters/chapter_10.md",
      "chapters/salt/chapter/c1.md",
    ]);
    // a draft kept in its plot's folder is still a draft; a scene there is not a chapter
    expect(list.drafts.map((d) => d.path)).toEqual([
      "chapters/salt/draft/d1.md",
      "drafts/new.md",
      "drafts/old.md",
    ]);
  });

  it("reads one from the database, not the folder", async () => {
    const world = new WorldFiles(folder({ worldJson: true, chapter: true }), undefined, {
      writings: writings(),
    });
    expect((await world.writing("chapters/chapter_2.md")).text).toBe("two");
    // on disk only: not found, because the database is the copy
    await expect(world.writing("chapters/chapter_1.md")).rejects.toThrow(/no chapter or draft/);
  });

  it("uses the folder when the world is not in the database", async () => {
    const world = new WorldFiles(folder({ worldJson: true, chapter: true }), undefined, {
      writings: writings(false),
    });
    expect((await world.writings(new Set())).chapters.map((c) => c.path)).toEqual([
      "chapters/chapter_1.md",
    ]);
    expect((await world.writing("chapters/chapter_1.md")).title).toBe("On disk");
  });
});
