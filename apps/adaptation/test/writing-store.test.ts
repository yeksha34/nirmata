import { describe, expect, it } from "vitest";
import { parseWritingPath, WritingError, writingKind, writingTitle } from "../src";

describe("chapters and drafts", () => {
  it("accepts markdown under chapters/ or drafts/", () => {
    expect(parseWritingPath("chapters/chapter_1.md")).toBe("chapters/chapter_1.md");
    expect(parseWritingPath("drafts/arc one/draft.md")).toBe("drafts/arc one/draft.md");
    expect(parseWritingPath("chapters\\scenes\\s1.md")).toBe("chapters/scenes/s1.md");
  });

  it("refuses anything else", () => {
    for (const bad of [
      undefined,
      "",
      "lore/a.md",
      "chapters/a.txt",
      "chapters/../lore/a.md",
      "chapters//a.md",
      "/chapters/a.md",
      `chapters/${"x".repeat(300)}.md`,
      "chapters/a\u0001.md",
    ]) {
      expect(() => parseWritingPath(bad), String(bad)).toThrow(WritingError);
    }
  });

  it("titles a text by its first heading, else its file name", () => {
    expect(writingTitle("# The Quay\n\ntext", "chapters/c1.md")).toBe("The Quay");
    expect(writingTitle("## Second\n", "chapters/c1.md")).toBe("Second");
    expect(writingTitle("no heading", "chapters/chapter_1_part-2.md")).toBe("Chapter 1 part 2");
  });
});

describe("what a writing is, from where it sits", () => {
  it("takes drafts/ for drafts and chapters/scenes/ for scenes, as ever", () => {
    expect(writingKind("drafts/old.md")).toBe("draft");
    expect(writingKind("drafts/arc/new.md")).toBe("draft");
    expect(writingKind("chapters/scenes/s1.md")).toBe("scene");
    expect(writingKind("chapters/chapter_1.md")).toBe("chapter");
  });

  it("reads a plot's own folders: draft or drafts, scene or scenes, else a chapter", () => {
    expect(writingKind("chapters/salt/draft/d1.md")).toBe("draft");
    expect(writingKind("chapters/salt/drafts/d1.md")).toBe("draft");
    expect(writingKind("chapters/salt/scene/s1.md")).toBe("scene");
    expect(writingKind("chapters/salt/scenes/s1.md")).toBe("scene");
    expect(writingKind("chapters/salt/chapter/c1.md")).toBe("chapter");
    expect(writingKind("chapters/salt/chapters/c1.md")).toBe("chapter");
    expect(writingKind("chapters/salt/translations.md")).toBe("chapter");
  });

  it("does not take a file named draft for a folder", () => {
    expect(writingKind("chapters/salt/draft.md")).toBe("chapter");
    expect(writingKind("chapters/scene.md")).toBe("chapter");
  });
});
