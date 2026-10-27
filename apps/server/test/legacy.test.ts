import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cardBody } from "@nirmata/core";
import { afterEach, describe, expect, it } from "vitest";
import { WorldFiles } from "../src";
import { importStory, nameForms, partId, readParts, slug } from "../src/legacy";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function scratch(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nirmata-legacy-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text, "utf8");
  }
  return dir;
}

const story = {
  "characters/human_orla_vale.md": `## Orla Vale (protagonist)

- **Kind:** human.
- **Age:** 31.
- **Owner:** the harbourmaster.
- **Voice & Registers:**
  - Dry in company.
  - Quiet when afraid.
- **Life Outside the Desk:** gardens.

### Notes

- **Kind:** stays in the body here, it is not a part.
`,
  "characters/human_orla_moss.md": "## Orla Moss\n\n- **Kind:** human.\n",
  "characters/skin_orla_vale.md": "## Orla Vale (skin)\n\n- **Kind:** a hide, worn like a coat.\n",
  "characters/human_header.md":
    "## Header\n\n- **Kind:** human.\n- **Summary:** clashes with a tag name.\n",
  "setting/places/harbour.md": `## Saltmere Harbour

- **Kind of place:** a fog-bound quay.
- **The ground:**
  - Three jetties.
  - A bell.
- **Tides:** twice a day.
`,
  "lore/world/tides.md": `## Tides

The sea comes in twice a day and goes out again. Nobody argues.

- **Why:** the moon.
- Fishers read them.

See [the checklist](../../plot/checklist.md) and [Orla](../../characters/human_orla_vale.md) and [a lost one](../../characters/gone.md).
`,
  ".agents/rules/world_01_calm.md": "---\ntrigger: always_on\n---\n\n## Calm\n\n- Nobody shouts.\n",
  ".agents/rules/world_02_tide.md": "## Tide rule\n\n- The tide is never late.\n",
  "plot/checklist.md": "# Checklist\n\nA table of things to tick.\n",
  "plot/arcs/character_arcs.md": `# Character Arcs

## People

### Orla Vale

- Left the quay at twenty.

### The harbour

- Silted up.
`,
  "plot/story_state.md": `# Story State

## People

- **Orla:** keeps the lamp now.
- **Stranger from the east:** arrived by boat.

## Who knows the lamp is lit

Only Orla, and the gulls.
`,
  "chapters/chapter_1.md": "Fog came in.\n",
  "drafts/scene1.md": "Draft prose, left exactly as it is.\n",
};

const recipe = {
  world: { name: "saltmere", title: "Saltmere" },
  notes: ["plot/checklist.md"],
  progress: { arcs: "plot/arcs/character_arcs.md", state: "plot/story_state.md" },
  avoid: ["header"],
  overrides: {
    ".agents/rules/world_02_tide.md": { check: "Is the tide on time?" },
  },
};

async function run(extra: Partial<typeof recipe> = {}) {
  const src = await scratch(story);
  const dest = join(await scratch({}), "world");
  const report = await importStory(src, dest, { ...recipe, ...extra });
  const files = new WorldFiles(dest);
  return { src, dest, report, files, cards: await files.cards() };
}

describe("reading an old card file", () => {
  it("makes part names the way the templates spell them", () => {
    const taken = new Set<string>();
    const warn = () => {};
    expect(slug("Voice & Registers")).toBe("voice-and-registers");
    expect(partId("Kind of place", taken, warn)).toBe("kind");
    expect(partId("The ground", taken, warn)).toBe("layout");
    expect(partId("Owner", taken, warn)).toBe("keeper");
    expect(partId("Body (own shape)", taken, warn)).toBe("body-own-shape");
    expect(partId("Summary", taken, warn)).toBe("summary-notes");
    expect(partId("Identity (fixed, whoever wears it)", taken, warn).length).toBeLessThanOrEqual(
      40,
    );
  });

  it("keeps nested bullets inside their part and leaves everything after a heading as it was", () => {
    const { items, body } = readParts([
      "",
      "- **Kind:** human.",
      "- **Voice:**",
      "  - Dry.",
      "  - Quiet.",
      "",
      "Some words.",
      "",
      "### More",
      "- **Kind:** again",
    ]);
    expect(items).toEqual([
      { label: "Kind", text: "human." },
      { label: "Voice", text: "- Dry.\n- Quiet." },
    ]);
    expect(body).toBe("Some words.\n\n### More\n- **Kind:** again");
  });

  it("shortens names to a first name only when the name is a person's", () => {
    expect(nameForms("Lady Orla Brandt", false)).toEqual({
      full: ["Lady Orla Brandt", "Orla Brandt"],
      short: ["Orla"],
    });
    expect(nameForms("The Late Lord", false).short).toEqual([]);
    expect(nameForms("Orla Vale (skin)", true)).toEqual({
      full: ["Orla Vale's skin"],
      short: ["Orla Vale", "Orla's skin"],
    });
  });
});

describe("importing a story", () => {
  it("writes every card in the Nirmata format, and Nirmata can read them all", async () => {
    const { files, report, cards } = await run();
    expect((await files.cardFiles()).filter((f) => f.problems)).toEqual([]);
    expect(report.cards).toBe(cards.length);
    expect(report.byKind).toEqual({ character: 4, place: 1, lore: 1, rule: 2, arc: 4 });
    expect((await files.world()).title).toBe("Saltmere");
  });

  it("turns labelled bullets into named parts and the rest into the body", async () => {
    const { cards } = await run();
    const ada = cards.find((c) => c.fm.id === "char.human-orla-vale");
    expect(ada?.fm.name).toBe("Orla Vale");
    expect(ada?.fm.role).toBe("protagonist");
    expect(ada?.fm.fields).toEqual({
      kind: "human.",
      age: "31.",
      keeper: "the harbourmaster.",
      "voice-and-registers": "- Dry in company.\n- Quiet when afraid.",
      "life-outside-the-desk": "gardens.",
    });
    expect(ada?.body).toContain("### Notes");
    expect(ada?.body).toContain("**Kind:** stays in the body here");
    expect(ada?.fm.summary).toBe("Human.");
    expect(cards.find((c) => c.fm.id === "char.human-orla-moss")?.fm.role).toBe("npc");

    const harbour = cards.find((c) => c.fm.id === "place.harbour");
    expect(harbour?.fm.fields).toEqual({
      kind: "a fog-bound quay.",
      layout: "- Three jetties.\n- A bell.",
      tides: "twice a day.",
    });
    expect(cardBody(harbour as NonNullable<typeof harbour>)).toContain("**The ground:**");
  });

  it("leaves lore as the markdown it was, with a summary from its first words", async () => {
    const { cards } = await run();
    const tides = cards.find((c) => c.fm.id === "lore.tides");
    expect(tides?.fm.fields).toEqual({});
    expect(tides?.fm.summary).toBe("The sea comes in twice a day and goes out again.");
    expect(tides?.body).toContain("- **Why:** the moon.");
    expect(tides?.body.startsWith("The sea")).toBe(true);
  });

  it("gives every person their name and first name to be found by, never a name two share", async () => {
    const { cards } = await run();
    const kw = (id: string) => cards.find((c) => c.fm.id === id)?.fm.keywords;
    // "Orla" is Orla Vale's and Orla Moss's alike, so neither takes it alone
    expect(kw("char.human-orla-vale")).toEqual(["Orla Vale"]);
    expect(kw("char.human-orla-moss")).toEqual(["Orla Moss"]);
    expect(kw("char.skin-orla-vale")).toEqual(["Orla Vale's skin", "Orla's skin"]);
    // a word the story uses for something else is not a name on its own
    expect(kw("char.human-header")).toEqual([]);
    // lore is found by the words written in the recipe, never by shortenings
    expect(kw("lore.tides")).toEqual(["Tides"]);
  });

  it("reads a rule's trigger as how firmly it holds, and takes its question from the recipe", async () => {
    const { cards } = await run();
    const calm = cards.find((c) => c.fm.id === "rule.calm");
    expect(calm?.fm.severity).toBe("must");
    expect(calm?.fm.fields.rule).toBe("- Nobody shouts.");
    const tide = cards.find((c) => c.fm.id === "rule.tide");
    expect(tide?.fm.severity).toBe("should");
    expect(tide?.fm.fields.check).toBe("Is the tide on time?");
  });

  it("makes one arc card for each character from the arc and state files together", async () => {
    const { cards } = await run();
    const ada = cards.find((c) => c.fm.id === "arc.orla-vale");
    expect(ada?.fm.name).toBe("Orla Vale (arc)");
    expect(ada?.body).toContain("Left the quay at twenty.");
    expect(ada?.fm.fields.progress).toBe("keeps the lamp now.");
    expect(ada?.fm.keywords).toEqual(["Orla Vale", "Orla"]);
    const stranger = cards.find((c) => c.fm.name === "Stranger from the east (where things stand)");
    expect(stranger?.fm.fields.progress).toBe("arrived by boat.");
    expect(cards.find((c) => c.fm.name === "Who knows the lamp is lit")?.body).toBe(
      "Only Orla, and the gulls.\n",
    );
  });

  it("copies chapters, drafts and working notes across untouched, and points links at the notes", async () => {
    const { dest, cards, report } = await run();
    expect(await readFile(join(dest, "drafts/scene1.md"), "utf8")).toBe(
      "Draft prose, left exactly as it is.\n",
    );
    expect(await readFile(join(dest, "chapters/chapter_1.md"), "utf8")).toBe("Fog came in.\n");
    expect(await readFile(join(dest, "notes/checklist.md"), "utf8")).toContain("things to tick");
    const tides = cards.find((c) => c.fm.id === "lore.tides");
    expect(tides?.body).toContain("(../../notes/checklist.md)");
    // a link that already led nowhere is reported, not hidden
    expect(report.warnings).toEqual([
      'characters/human_header.md: the label "Summary" is a reserved tag name; written as "summary-notes"',
      "characters/human_header.md: no keywords",
      "lore/world/tides.md: links to ../../characters/gone.md, which is not in the world",
    ]);
  });

  it("will not write over a world that is already there", async () => {
    const { dest } = await run();
    const src = await scratch(story);
    await expect(importStory(src, dest, recipe)).rejects.toThrow(/already holds a world/);
  });
});
