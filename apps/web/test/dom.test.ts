import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A <div> or <span> says nothing about what it holds. Where HTML has an element for the thing
// (a header, a list of commands, a status, a number, a person's name, a quote), that one is used.
// What is left here is a layout or text hook for which no element exists.
const SRC = join(__dirname, "..", "src");

const ALLOWED: Record<string, { count: number; why: string }> = {
  "i18n.tsx": {
    count: 6,
    why: "the Hindi/English pair: one inline wrapper and one span per language, each with its lang",
  },
  "controls.tsx": {
    count: 3,
    why: "a tooltip and a field's drawn placeholder each need a positioned inline wrapper (and the bubble)",
  },
  "header.tsx": {
    count: 1,
    why: "the jump box's words are hidden on a phone while its icon stays",
  },
  "story-window.tsx": {
    count: 1,
    why: "the window's scroll container, which is also the container the table's layout queries",
  },
  "screens/Workspace.tsx": {
    count: 1,
    why: "the three-pane grid of rail, list and editor (an aside and two sections)",
  },
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith(".tsx")
        ? [join(dir, e.name)]
        : [],
  );
}

/** The markup of a file, without the comments (which may talk about divs and spans). */
function markup(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the markup of the screens", () => {
  const found = sources(SRC)
    .map((file) => ({
      file: relative(SRC, file).replaceAll("\\", "/"),
      count: (markup(file).match(/<(div|span)[\s>/]/g) ?? []).length,
    }))
    .filter((f) => f.count > 0);

  it("uses a <div> or <span> only where no other element fits", () => {
    const over = found
      .filter((f) => f.count > (ALLOWED[f.file]?.count ?? 0))
      .map((f) => `${f.file}: ${f.count} (allowed ${ALLOWED[f.file]?.count ?? 0})`);
    expect(over).toEqual([]);
  });

  it("keeps the list of allowed ones honest: none is allowed more than it uses", () => {
    const used = Object.fromEntries(found.map((f) => [f.file, f.count]));
    const slack = Object.entries(ALLOWED)
      .filter(([file, a]) => (used[file] ?? 0) < a.count)
      .map(([file, a]) => `${file}: allowed ${a.count}, uses ${used[file] ?? 0}`);
    expect(slack).toEqual([]);
  });
});
