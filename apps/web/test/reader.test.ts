import { describe, expect, it } from "vitest";
import { hindi } from "../src/i18n";
import {
  bookFromCard,
  bookFromDraft,
  bookFromStory,
  bookFromWorld,
  bookFromWriting,
  bookFromWritings,
  inline,
  MOOD_LABEL,
  MOODS,
  parseBlocks,
} from "../src/reader/book";
import { countFor, MOOD_WEATHER, seed, step, type Weather } from "../src/reader/particles";
import { layersFor, openAmbience } from "../src/reader/sound";
import {
  clamp,
  keepPlace,
  pageAt,
  perViewFor,
  startPages,
  surfaces,
  viewCount,
  viewOf,
} from "../src/reader/spread";
import type { Card, ChapterView, TurnView } from "../src/types";

const card = (
  kind: Card["fm"]["kind"],
  name: string,
  extra: Partial<Card["fm"]> = {},
  body = "",
): Card => ({
  path: `${kind}/${name.toLowerCase()}.md`,
  fm: { id: `${kind}.${name.toLowerCase()}`, kind, name, ...extra },
  body,
});

describe("the text of a page", () => {
  it("marks bold, italic and code, and leaves the rest as written", () => {
    expect(inline("a **b** *c* `d` e")).toEqual([
      { t: "text", s: "a " },
      { t: "b", s: "b" },
      { t: "text", s: " " },
      { t: "i", s: "c" },
      { t: "text", s: " " },
      { t: "code", s: "d" },
      { t: "text", s: " e" },
    ]);
    expect(inline("2 * 3 = 6")).toEqual([{ t: "text", s: "2 * 3 = 6" }]);
    expect(inline("मैरो **रखवाला**")).toEqual([
      { t: "text", s: "मैरो " },
      { t: "b", s: "रखवाला" },
    ]);
  });

  it("reads markdown as the few blocks a page needs", () => {
    const blocks = parseBlocks(
      [
        "# Marrow",
        "",
        "Gruff keeper",
        "of the north light.",
        "",
        "---",
        "> He did not look up.",
        "> Not once.",
        "",
        "- a lamp",
        "- a coat",
        "",
        "1. first",
        "2) second",
        "",
        "### Notes",
        "Last line",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "h", level: 3, text: "Marrow" },
      { kind: "p", text: "Gruff keeper of the north light." },
      { kind: "rule" },
      { kind: "quote", text: "He did not look up. Not once." },
      { kind: "list", ordered: false, items: ["a lamp", "a coat"] },
      { kind: "list", ordered: true, items: ["first", "second"] },
      { kind: "h", level: 4, text: "Notes" },
      { kind: "p", text: "Last line" },
    ]);
  });

  it("copes with nothing, and with Windows line ends", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("one\r\n\r\ntwo")).toEqual([
      { kind: "p", text: "one" },
      { kind: "p", text: "two" },
    ]);
  });
});

describe("a card as a book", () => {
  const marrow = card(
    "character",
    "Marrow",
    {
      summary: "Gruff keeper of the north light.",
      keywords: ["marrow", "keeper"],
      fields: { appearance: "Weathered.", "life-outside-the-story": "Mends nets.", wants: "  " },
    },
    "# Marrow\n\nAnything else.",
  );

  it("puts what the card is on the cover, and each named part on its own pages", () => {
    const book = bookFromCard(marrow);
    expect(book).toMatchObject({
      kicker: "Character card",
      title: "Marrow",
      lede: "Gruff keeper of the north light.",
      tags: ["marrow", "keeper"],
      mood: "ember",
    });
    expect(book.chapters.map((c) => [c.title, c.app ?? false])).toEqual([
      ["Appearance", true],
      ["Life outside the story", true],
      ["", false],
    ]);
  });

  it("does not say the card's name twice when the body begins with it", () => {
    const body = bookFromCard(marrow).chapters.at(-1);
    expect(body?.blocks).toEqual([{ kind: "p", text: "Anything else." }]);
  });

  it("is only a cover when there is nothing else to read", () => {
    const book = bookFromCard(card("lore", "Fog", { summary: "It comes in." }));
    expect(book.chapters).toEqual([]);
    expect(book.mood).toBe("dusk");
  });

  it("reads an unsaved card from the form's own values, with no id or file", () => {
    const book = bookFromCard({
      fm: { kind: "place", name: "The Light", fields: {} },
      body: "Cold.",
    });
    expect(book.id).toBe("The Light");
    expect(book.mood).toBe("forest");
  });
});

describe("a world as a book", () => {
  const cards = [
    card("rule", "No Gods"),
    card("character", "Marrow", { fields: { wants: "Out." } }, "Keeper."),
    card("lore", "The Fog", { summary: "It comes in." }, "# The Fog\n\nCold."),
    card("place", "The Light"),
  ];
  const book = bookFromWorld(
    {
      name: "ashfall",
      title: "Ashfall",
      tagline: "Ash on the water.",
      genre: ["gothic"],
      tone: ["eerie"],
    },
    cards,
  );

  it("has a cover with the world's own words", () => {
    expect(book).toMatchObject({
      kicker: "World",
      title: "Ashfall",
      lede: "Ash on the water.",
      tags: ["gothic", "eerie"],
    });
  });

  it("reads what is true first, then places, people and the rules last", () => {
    expect(book.chapters.map((c) => c.title)).toEqual([
      "The Fog",
      "The Light",
      "Marrow",
      "No Gods",
    ]);
    expect(book.chapters.map((c) => c.kicker)).toEqual([
      "Lore entry card",
      "Place card",
      "Character card",
      "Rule card",
    ]);
  });

  it("gives each card its summary, its parts and its body", () => {
    expect(book.chapters[0]?.blocks).toEqual([
      { kind: "lede", text: "It comes in." },
      { kind: "p", text: "Cold." },
    ]);
    expect(book.chapters[2]?.blocks[0]).toEqual({ kind: "h", level: 3, text: "Wants", app: true });
  });
});

describe("a story as a book", () => {
  const turn = (id: string, role: TurnView["role"], text: string, by?: string): TurnView => ({
    id,
    role,
    text,
    ...(role === "player" ? { mode: "do" as const } : {}),
    ...(by ? { by } : {}),
  });
  const turns = [
    turn("1", "host", "The lamp gutters."),
    turn("2", "player", "I step\ninside.", "Sam"),
    turn("3", "host", "Fog.\n\nMore fog."),
    turn("4", "host", "Morning."),
  ];
  const world = { title: "Ashfall", tagline: "Ash on the water." };

  it("cuts chapters where they were cut and keeps what came after in the last", () => {
    const chapters: ChapterView[] = [
      { number: 1, title: "Chapter 1", open: false, through: "2" },
      { number: 2, title: "Night Falls", open: true, through: "3" },
    ];
    const book = bookFromStory(world, "s1", turns, chapters);
    expect(book.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Night Falls"]);
    expect(book.chapters[0]?.blocks).toEqual([
      { kind: "p", text: "The lamp gutters." },
      { kind: "quote", text: "I step inside.", by: "Sam", mode: "do" },
    ]);
    // turn 4 was written after the cut, so it is on the end of the chapter still being written
    expect(book.chapters[1]?.blocks.map((b) => b.kind)).toEqual(["p", "p", "p"]);
    expect(book).toMatchObject({ kicker: "Story", title: "Ashfall", tags: ["Sam"], mood: "dusk" });
  });

  it("is one chapter with no heading when the story has not been divided", () => {
    const book = bookFromStory(world, "s1", turns, []);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]?.title).toBe("");
  });

  it("is only a cover before anything is written", () => {
    expect(bookFromStory(null, "s1", [], []).chapters).toEqual([]);
    expect(bookFromStory(null, "s1", [], []).title).toBe("Story");
  });

  it("does not lose a turn when a chapter's last turn is no longer in the list", () => {
    const book = bookFromStory(world, "s1", turns, [
      { number: 1, title: "Chapter 1", open: true, through: "gone" },
    ]);
    expect(book.chapters[0]?.blocks).toHaveLength(5);
  });
});

describe("a draft as a book", () => {
  it("is the writer's name over their words", () => {
    const book = bookFromDraft({ nick: "Sam", mode: "say", text: "“Who is there?”" });
    expect(book).toMatchObject({ kicker: "Say", title: "Sam", id: "draft:Sam" });
    expect(book.chapters[0]?.blocks).toEqual([{ kind: "p", text: "“Who is there?”" }]);
  });
});

describe("a chapter or a draft as a book", () => {
  const chapter = {
    path: "chapters/chapter_1.md",
    title: "The Lamp Goes Out",
    text: "# The Lamp Goes Out\n\nDark came early.\n\n> “Who is there?”\n",
  };

  it("is its title and the world's on the cover, then its text without the title said twice", () => {
    const book = bookFromWriting({ title: "Ashfall" }, chapter, "chapter");
    expect(book).toMatchObject({
      id: "writing:chapters/chapter_1.md",
      kicker: "Chapter",
      title: "The Lamp Goes Out",
      lede: "Ashfall",
      mood: "dusk",
    });
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]?.blocks).toEqual([
      { kind: "p", text: "Dark came early." },
      { kind: "quote", text: "“Who is there?”" },
    ]);
  });

  it("is a draft in its own mood, and needs no world", () => {
    const book = bookFromWriting(undefined, { ...chapter, title: "Draft" }, "draft");
    expect(book.kicker).toBe("Draft");
    expect(book.mood).toBe("rain");
    expect(book.lede).toBeUndefined();
  });

  it("reads every chapter of a world one after the other, each under its own title", () => {
    const book = bookFromWritings({ name: "ashfall", title: "Ashfall" }, [
      chapter,
      { path: "chapters/chapter_2.md", title: "Morning", text: "Light.\n" },
    ]);
    expect(book).toMatchObject({ kicker: "Chapters", title: "Ashfall", id: "chapters:ashfall" });
    expect(book.chapters.map((c) => c.title)).toEqual(["The Lamp Goes Out", "Morning"]);
    expect(book.chapters[1]?.blocks).toEqual([{ kind: "p", text: "Light." }]);
  });
});

describe("the moods", () => {
  it("each have a name in Hindi, weather and a room's sound", () => {
    for (const mood of MOODS) {
      expect(hindi(MOOD_LABEL[mood]), mood).toMatch(/[ऀ-ॿ]/);
      expect(MOOD_WEATHER[mood]).toBeDefined();
      expect(layersFor(mood).length).toBeGreaterThan(0);
    }
  });

  it("have a sound that suits them", () => {
    expect(layersFor("ember")).toContain("fire");
    expect(layersFor("rain")).toContain("rain");
    expect(layersFor("forest")).toContain("crickets");
    expect(layersFor("ink")).toEqual(["pad"]);
  });

  it("make no sound where the browser has no Web Audio", () => {
    expect(openAmbience("dusk")).toBeNull();
  });
});

describe("the pages of an open book", () => {
  it("shows two pages on a wide screen and one on a narrow one", () => {
    expect(perViewFor(1280)).toBe(2);
    expect(perViewFor(859)).toBe(1);
    expect(viewCount(5, 2)).toBe(3);
    expect(viewCount(5, 1)).toBe(5);
    expect(viewCount(0, 2)).toBe(1);
    expect(viewOf(3, 2)).toBe(1);
  });

  it("finds the page in a slot, and none past the end or on the left of a single page", () => {
    expect(pageAt(1, "left", 2, 5)).toBe(2);
    expect(pageAt(1, "right", 2, 5)).toBe(3);
    expect(pageAt(2, "right", 2, 5)).toBeNull();
    expect(pageAt(2, "left", 1, 5)).toBeNull();
    expect(pageAt(2, "right", 1, 5)).toBe(2);
  });

  it("shows the view's own pages at rest", () => {
    expect(surfaces(1, null, 2, 6)).toEqual({ left: 2, right: 3 });
  });

  it("turns forward: the left stays, the right is already the next, the leaf carries the old right and the new left", () => {
    expect(surfaces(0, { from: 0, to: 1 }, 2, 6)).toEqual({ left: 0, right: 3, front: 1, back: 2 });
  });

  it("turns back the other way round", () => {
    expect(surfaces(1, { from: 1, to: 0 }, 2, 6)).toEqual({ left: 0, right: 3, front: 1, back: 2 });
  });

  it("turns a single page over blank paper", () => {
    expect(surfaces(2, { from: 2, to: 3 }, 1, 6)).toEqual({
      left: null,
      right: 3,
      front: 2,
      back: null,
    });
    expect(surfaces(3, { from: 3, to: 2 }, 1, 6)).toEqual({
      left: null,
      right: 3,
      front: 2,
      back: null,
    });
  });

  it("turns one leaf for a jump of many pages, to a view past which there is nothing blank", () => {
    expect(surfaces(0, { from: 0, to: 4 }, 2, 9)).toEqual({
      left: 0,
      right: null,
      front: 1,
      back: 8,
    });
  });

  it("keeps its place when the page count changes", () => {
    expect(keepPlace(5, 11, 21)).toBe(10);
    expect(keepPlace(0, 1, 7)).toBe(0);
    expect(keepPlace(9, 10, 4)).toBe(3);
    expect(keepPlace(3, 10, 10)).toBe(3);
  });

  it("finds the page each chapter starts on", () => {
    expect(startPages([0, 400, 1200.4], 400)).toEqual([0, 1, 3]);
    expect(clamp(9, 0, 4)).toBe(4);
  });
});

describe("the weather behind the book", () => {
  const seeded = () => {
    let s = 42;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  };
  const kinds: Weather[] = ["dust", "embers", "fireflies", "rain", "stars"];

  it("fits more into a bigger canvas, never a swarm, and nothing for none", () => {
    expect(countFor("none", 1000, 800)).toBe(0);
    expect(countFor("dust", 200, 200)).toBeGreaterThanOrEqual(12);
    expect(countFor("rain", 4000, 4000)).toBe(220);
    expect(countFor("embers", 1600, 900)).toBeGreaterThan(countFor("embers", 400, 300));
  });

  it("keeps every particle on or just beside the canvas, however long it runs", () => {
    for (const kind of kinds) {
      const rand = seeded();
      const ps = seed(kind, 800, 600, rand);
      expect(ps.length).toBeGreaterThan(0);
      for (let i = 0; i < 600; i++) step(kind, ps, 800, 600, 1 / 30, i / 30, rand);
      for (const p of ps) {
        expect(p.x, kind).toBeGreaterThanOrEqual(-30);
        expect(p.x, kind).toBeLessThanOrEqual(830);
        expect(p.y, kind).toBeGreaterThanOrEqual(-40);
        expect(p.y, kind).toBeLessThanOrEqual(660);
      }
    }
  });

  it("repeats a run from the same randomness", () => {
    const a = seed("embers", 500, 400, seeded());
    const b = seed("embers", 500, 400, seeded());
    expect(a).toEqual(b);
  });
});
