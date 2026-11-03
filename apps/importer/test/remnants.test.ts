import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { remnants } from "../../../.agents/skills/story-import/remnants.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A source of two files, and a ledger directory with the given lanes. */
function setup(ledgers: Record<string, string[]>) {
  const root = mkdtempSync(join(tmpdir(), "nirmata-remnants-"));
  dirs.push(root);
  const source = join(root, "source");
  const ledger = join(root, "ledger");
  mkdirSync(join(source, "characters"), { recursive: true });
  mkdirSync(ledger);
  writeFileSync(join(source, "characters", "a.md"), "name\nlooks\n\ncoat\nring\n\nlater event\n");
  writeFileSync(join(source, "notes.md"), "one\ntwo\n");
  writeFileSync(join(source, "readme.txt"), "not markdown");
  for (const [lane, lines] of Object.entries(ledgers)) {
    writeFileSync(join(ledger, `${lane}.jsonl`), `${lines.join("\n")}\n`);
  }
  return { source, ledger };
}

describe("what is left after the lanes", () => {
  it("takes out the lines every lane used, whatever order they worked in", () => {
    const { source, ledger } = setup({
      characters: ['{"file":"characters/a.md","from":1,"to":2,"card":"character.a"}'],
      accessories: ['{"file":"characters/a.md","from":4,"to":5,"card":"clothes.a-coat"}'],
    });
    const { left, problems, empty } = remnants(source, ledger);
    expect(problems).toEqual([]);
    expect(left.get("characters/a.md")).toBe("later event\n");
    expect(left.get("notes.md")).toBe("one\ntwo\n"); // nobody took anything from it
    expect(empty).toEqual([]);
    expect([...left.keys()]).not.toContain("readme.txt");
  });

  it("counts a line two lanes took only once, and lists a file with nothing left", () => {
    const { source, ledger } = setup({
      a: ['{"file":"notes.md","from":1,"to":2}'],
      b: ['{"file":"notes.md","from":2,"to":2}'],
    });
    const { left, empty } = remnants(source, ledger);
    expect(empty).toEqual(["notes.md"]);
    expect(left.has("notes.md")).toBe(false);
  });

  it("reports ledger lines that cannot be used, and files that are not in the source", () => {
    const { source, ledger } = setup({
      a: [
        "not json",
        '{"file":"notes.md","from":0,"to":1}',
        '{"file":"notes.md","from":1,"to":99}',
        '{"file":"gone.md","from":1,"to":1}',
      ],
    });
    const { problems } = remnants(source, ledger);
    expect(problems.join("\n")).toMatch(/a\.jsonl:1/);
    expect(problems.join("\n")).toMatch(/a\.jsonl:2/);
    expect(problems.join("\n")).toMatch(/has 3 lines, the ledger says 99/);
    expect(problems.join("\n")).toMatch(/gone\.md, which is not in the source/);
  });

  it("with no ledgers leaves every file whole", () => {
    const { source, ledger } = setup({});
    expect([...remnants(source, ledger).left.keys()].sort()).toEqual(["characters/a.md", "notes.md"]);
  });
});
