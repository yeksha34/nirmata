import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Recipe } from "../src/legacy";
import { describe as sentence, syncImport } from "../src/legacy-sync";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nirmata-sync-test-"));
  dirs.push(dir);
  return dir;
}
async function write(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}
const text = (root: string, path: string) => readFile(join(root, path), "utf8");
const exists = (root: string, path: string) =>
  stat(join(root, path)).then(
    () => true,
    () => false,
  );

const recipe: Recipe = { world: { name: "fog", title: "Fog" } };
const ORLA = "characters/human_orla_vale.md";
const FOG = "lore/the_fog.md";
const CHAPTER = "chapters/chapter_01.md";
const AGE_32 = "## Orla Vale\n\n- **Kind:** human.\n- **Age:** 32.\n";

/** A story, and the world made from it. */
async function setup() {
  const src = await folder();
  const world = join(await folder(), "world");
  await write(src, ORLA, "## Orla Vale\n\n- **Kind:** human.\n- **Age:** 31.\n");
  await write(src, FOG, "# The Fog\n\nIt comes in at night.\n");
  await write(src, CHAPTER, "Fog came in.\n");
  const first = await syncImport(src, world, recipe);
  return { src, world, first };
}

describe("keeping an imported world the same as its story", () => {
  it("makes the world the first time, then finds nothing to do", async () => {
    const { src, world, first } = await setup();
    expect(first.added.sort()).toEqual([CHAPTER, FOG, ORLA, "world.json"].sort());
    expect(await text(world, CHAPTER)).toBe("Fog came in.\n");
    expect(await exists(world, ".import/state.json")).toBe(true);

    const again = await syncImport(src, world, recipe);
    expect([again.added, again.updated, again.removed, again.conflicts, again.kept]).toEqual([
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(again.unchanged).toBe(4);
    expect(sentence(again)).toBe("nothing to change (4 already up to date)");
  });

  it("takes a changed file from the story, and only that one", async () => {
    const { src, world } = await setup();
    await write(src, CHAPTER, "Fog came in. Then it left.\n");
    const r = await syncImport(src, world, recipe);
    expect(r.updated).toEqual([CHAPTER]);
    expect(r.replacedEdits).toEqual([]);
    expect(await text(world, CHAPTER)).toBe("Fog came in. Then it left.\n");
    expect(r.unchanged).toBe(3);
  });

  it("brings in a new file and takes away one the story no longer has, keeping it aside", async () => {
    const { src, world } = await setup();
    await write(src, "lore/the_lamp.md", "# The Lamp\n\nIt burns low.\n");
    await rm(join(src, FOG));
    const r = await syncImport(src, world, recipe, { now: () => new Date("2026-10-28T10:00:00Z") });
    expect(r.added).toEqual(["lore/the_lamp.md"]);
    expect(r.removed).toEqual([FOG]);
    expect(await exists(world, FOG)).toBe(false);
    expect(r.replacedIn).toContain("2026-10-28T10-00-00-000Z");
    expect(await exists(r.replacedIn as string, FOG)).toBe(true);
  });

  it("replaces a card that was edited in Nirmata, keeping the edited one aside", async () => {
    const { src, world } = await setup();
    const mine = `${await text(world, ORLA)}\nMy own note.\n`;
    const original = await text(world, ORLA);
    await writeFile(join(world, ORLA), mine, "utf8");

    const r = await syncImport(src, world, recipe);
    expect(r.updated).toEqual([ORLA]);
    expect(r.replacedEdits).toEqual([ORLA]);
    expect(await text(world, ORLA)).toBe(original);
    expect(await text(r.replacedIn as string, ORLA)).toBe(mine);
    expect(sentence(r)).toContain("1 differing ones put aside");
    // and the next one has nothing left to do
    expect((await syncImport(src, world, recipe)).updated).toEqual([]);
  });

  it("puts back a card taken out of the world, and removes a dropped file even if it was edited", async () => {
    const { src, world } = await setup();
    await rm(join(world, FOG));
    await writeFile(join(world, CHAPTER), "Mine now.\n", "utf8");
    await rm(join(src, CHAPTER));
    const r = await syncImport(src, world, recipe);
    expect(r.updated).toEqual([FOG]);
    expect(await text(world, FOG)).toContain("It comes in at night.");
    expect(r.removed).toEqual([CHAPTER]);
    expect(await text(r.replacedIn as string, CHAPTER)).toBe("Mine now.\n");
  });

  it("makes a world with no record of an earlier import match the story, keeping what differed", async () => {
    const { src, world } = await setup();
    await rm(join(world, ".import"), { recursive: true });
    await writeFile(join(world, FOG), "# The Fog\n\nOlder.\n", "utf8");
    const r = await syncImport(src, world, recipe);
    expect(r.replacedEdits).toEqual([FOG]);
    expect(await text(world, FOG)).toContain("It comes in at night.");
    expect(await text(r.replacedIn as string, FOG)).toContain("Older.");
    expect(r.unchanged).toBe(3);
    expect((await syncImport(src, world, recipe)).unchanged).toBe(4);
  });

  it("never touches cards made in Nirmata or the stories played in the world", async () => {
    const { src, world } = await setup();
    await write(world, "characters/mine.md", "my own\n");
    await write(world, "stories/20261028-100000-abcd/events.jsonl", "{}\n");
    await write(src, CHAPTER, "Changed.\n");
    await syncImport(src, world, recipe);
    await rm(join(src, ORLA));
    await syncImport(src, world, recipe, { keepEdits: true });
    await syncImport(src, world, recipe);
    expect(await text(world, "characters/mine.md")).toBe("my own\n");
    expect(await text(world, "stories/20261028-100000-abcd/events.jsonl")).toBe("{}\n");
  });

  it("does not bring in an editor's scratch files", async () => {
    const { src, world } = await setup();
    await write(src, "drafts/.chapter.md.swp", "x");
    await write(src, "drafts/chapter.md~", "x");
    await write(src, "drafts/chapter.md", "real\n");
    const r = await syncImport(src, world, recipe);
    expect(r.added).toEqual(["drafts/chapter.md"]);
  });

  it("will not write into the folder of saved stories, even if the story has one", async () => {
    const { src, world } = await setup();
    await write(src, "stories/old.md", "from the source\n");
    const r = await syncImport(src, world, recipe);
    expect(await exists(world, "stories/old.md")).toBe(false);
    expect(r.notes.some((n) => n.startsWith("stories/old.md"))).toBe(true);
  });

  it("changes nothing on a dry run", async () => {
    const { src, world } = await setup();
    const before = await text(world, ".import/state.json");
    await write(src, CHAPTER, "Changed.\n");
    await rm(join(src, FOG));
    await writeFile(join(world, ORLA), "edited\n", "utf8");
    const r = await syncImport(src, world, recipe, { dryRun: true });
    expect(r.updated.sort()).toEqual([CHAPTER, ORLA].sort());
    expect(r.removed).toEqual([FOG]);
    expect(r.replacedIn).toBeDefined();
    expect(await text(world, CHAPTER)).toBe("Fog came in.\n");
    expect(await text(world, ORLA)).toBe("edited\n");
    expect(await exists(world, FOG)).toBe(true);
    expect(await text(world, ".import/state.json")).toBe(before);
    expect(await readdir(join(world, ".import"))).toEqual(["state.json"]);

    const fresh = join(await folder(), "never");
    await syncImport(src, fresh, recipe, { dryRun: true });
    expect(await exists(fresh, "world.json")).toBe(false);
  });

  it("does not leave a scratch folder or a half-written file behind", async () => {
    const { world } = await setup();
    const names = await readdir(join(world, "lore"));
    expect(names.filter((n) => n.endsWith(".import-tmp"))).toEqual([]);
  });
});

describe("letting what was done in Nirmata win (keepEdits)", () => {
  const keep = { keepEdits: true };

  it("keeps a card edited in Nirmata when the story has not changed it, and takes the rest", async () => {
    const { src, world } = await setup();
    const mine = `${await text(world, ORLA)}\nMy own note.\n`;
    await writeFile(join(world, ORLA), mine, "utf8");
    const r = await syncImport(src, world, recipe, keep);
    expect(r.kept).toEqual([ORLA]);
    expect(r.updated).toEqual([]);
    expect(await text(world, ORLA)).toBe(mine);

    await write(src, CHAPTER, "Different.\n");
    const later = await syncImport(src, world, recipe, keep);
    expect(later.updated).toEqual([CHAPTER]);
    expect(await text(world, ORLA)).toBe(mine);
  });

  it("does not overwrite a card changed in both places: the story's version is put aside to merge", async () => {
    const { src, world } = await setup();
    const mine = `${await text(world, ORLA)}\nMy own note.\n`;
    await writeFile(join(world, ORLA), mine, "utf8");
    await write(src, ORLA, AGE_32);

    const r = await syncImport(src, world, recipe, keep);
    expect(r.conflicts).toEqual([ORLA]);
    expect(await text(world, ORLA)).toBe(mine);
    expect(await text(world, `.import/incoming/${ORLA}`)).toContain("32");
    // reported again until it is settled
    expect((await syncImport(src, world, recipe, keep)).conflicts).toEqual([ORLA]);
  });

  it("leaves a card removed in Nirmata removed while the story has not changed it", async () => {
    const { src, world } = await setup();
    await rm(join(world, FOG));
    const r = await syncImport(src, world, recipe, keep);
    expect(r.kept).toEqual([FOG]);
    expect(await exists(world, FOG)).toBe(false);

    await write(src, FOG, "# The Fog\n\nIt comes in at night, and stays.\n");
    expect((await syncImport(src, world, recipe, keep)).conflicts).toEqual([FOG]);
  });

  it("does not take away a dropped file the world has changed", async () => {
    const { src, world } = await setup();
    await writeFile(join(world, FOG), "# The Fog\n\nMine now.\n", "utf8");
    await rm(join(src, FOG));
    const r = await syncImport(src, world, recipe, keep);
    expect(r.removed).toEqual([]);
    expect(r.kept).toEqual([FOG]);
    expect(await text(world, FOG)).toContain("Mine now.");
  });

  it("does not overwrite a differing file it has no record of", async () => {
    const { src, world } = await setup();
    await rm(join(world, ".import"), { recursive: true });
    await writeFile(join(world, FOG), "# The Fog\n\nOlder.\n", "utf8");
    const r = await syncImport(src, world, recipe, keep);
    expect(r.conflicts).toEqual([FOG]);
    expect(await text(world, FOG)).toContain("Older.");
  });
});
