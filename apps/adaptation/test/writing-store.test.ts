import { describe, expect, it } from "vitest";
import { parseWritingPath, WritingError, writingTitle } from "../src";

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
