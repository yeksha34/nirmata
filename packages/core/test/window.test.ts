import { describe, expect, it } from "vitest";
import {
  applyEvent,
  breakEvent,
  chapterPath,
  chaptersOf,
  contextTurnsOf,
  gotoEvent,
  newEvent,
  projectStory,
  renderTurn,
  replay,
  type StoryEvent,
  slugify,
  turnsOf,
  windowCursor,
} from "../src";

const T = "2026-10-25T10:00:00Z";
const p = (id: string, parentId: string | null, text: string): StoryEvent =>
  newEvent({ id, parentId, t: T, kind: "player", mode: "do", text });
const h = (id: string, parentId: string | null, text: string, shifted?: string): StoryEvent =>
  newEvent({ id, parentId, t: T, kind: "host", text, ...(shifted ? { shifted } : {}) });

/** p1 h1 p2 h2 p3 h3; h2 was written with p1/h1 outside the window, h3 with p1..p2 outside. */
function story() {
  const log = [
    p("p1", null, "one"),
    h("h1", "p1", "ONE"),
    p("p2", "h1", "two"),
    h("h2", "p2", "TWO", "h1"),
    p("p3", "h2", "three"),
    h("h3", "p3", "THREE", "p2"),
  ];
  return { log, state: replay(log) };
}

describe("window cursor", () => {
  it("is null until a reply records that turns left the window", () => {
    expect(windowCursor(replay([p("p1", null, "x"), h("h1", "p1", "X")]))).toBeNull();
  });

  it("follows the newest reply on the branch and never moves back", () => {
    const { state } = story();
    expect(windowCursor(state)).toBe("p2");
    expect(windowCursor(applyEvent(state, gotoEvent("g", T, "h2")))).toBe("h1");
    expect(windowCursor(applyEvent(state, gotoEvent("g2", T, "h1")))).toBeNull();
  });

  it("must point at a turn on the same branch", () => {
    const { state } = story();
    const bad = h("h9", "h2", "bad", "h3"); // h3 is not an ancestor of h2
    expect(() => applyEvent(state, bad)).toThrow(/shifted "h3" is not on its branch/);
  });
});

describe("what stays in the prompt", () => {
  it("is every turn after the cursor, while the transcript keeps all of them", () => {
    const { state } = story();
    expect(contextTurnsOf(state).map((t) => t.id)).toEqual(["h2", "p3", "h3"]);
    expect(turnsOf(state).map((t) => t.id)).toEqual(["p1", "h1", "p2", "h2", "p3", "h3"]);
  });

  it("includes everything when nothing has left the window", () => {
    const { log } = story();
    expect(contextTurnsOf(replay(log.slice(0, 2))).map((t) => t.id)).toEqual(["p1", "h1"]);
  });

  it("does not bring a turn back after the budget grows (the cursor only advances)", () => {
    // a later reply that reports nothing new shifted still inherits the earlier cursor
    const { state } = story();
    const more = applyEvent(state, p("p4", "h3", "four"));
    const again = applyEvent(more, h("h4", "p4", "FOUR"));
    expect(contextTurnsOf(again).map((t) => t.id)).toEqual(["h2", "p3", "h3", "p4", "h4"]);
  });
});

describe("chapters", () => {
  it("hold exactly the turns outside the window, verbatim and in order", () => {
    const { state } = story();
    const [chapter, ...rest] = chaptersOf(state);
    expect(rest).toEqual([]);
    expect(chapter).toMatchObject({ number: 1, title: "Chapter 1", open: true, through: "p2" });
    expect(chapter?.turns.map((t) => t.id)).toEqual(["p1", "h1", "p2"]);
    expect(chapter?.text).toBe("> **Do:** one\n\nONE\n\n> **Do:** two");
  });

  it("do not exist before anything has left the window", () => {
    expect(chaptersOf(replay([p("p1", null, "x"), h("h1", "p1", "X")]))).toEqual([]);
  });

  it("grow as the window shifts", () => {
    const { state } = story();
    const next = applyEvent(applyEvent(state, p("p4", "h3", "four")), h("h4", "p4", "FOUR", "h3"));
    expect(chaptersOf(next)[0]?.turns.map((t) => t.id)).toEqual([
      "p1",
      "h1",
      "p2",
      "h2",
      "p3",
      "h3",
    ]);
  });

  it("split at break events, with an optional title, and the last one is open", () => {
    const { log } = story();
    // break after h1, before p2
    const withBreak = [
      ...log.slice(0, 2),
      breakEvent(replay(log.slice(0, 2)), "b1", T, "Night Falls"),
    ];
    const rest = [
      p("q2", "b1", "two"),
      h("q3", "q2", "TWO", "q2"),
      p("q4", "q3", "three"),
      h("q5", "q4", "THREE", "q3"),
    ];
    const chapters = chaptersOf(replay([...withBreak, ...rest]));
    expect(chapters.map((c) => [c.number, c.title, c.open, c.turns.map((t) => t.id)])).toEqual([
      [1, "Chapter 1", false, ["p1", "h1"]],
      [2, "Night Falls", true, ["q2", "q3"]],
    ]);
  });

  it("ignore breaks that have no text after them yet, and merge back-to-back breaks", () => {
    const base = replay([
      p("p1", null, "a"),
      h("h1", "p1", "A"),
      p("p2", "h1", "b"),
      h("h2", "p2", "B", "h1"),
    ]);
    const s1 = applyEvent(base, breakEvent(base, "b1", T, "Later"));
    expect(chaptersOf(s1).map((c) => c.title)).toEqual(["Chapter 1"]);
    const s2 = applyEvent(s1, breakEvent(s1, "b2", T, "Even Later"));
    expect(chaptersOf(s2)).toHaveLength(1);
  });

  it("can be titled by a break at the very start", () => {
    const first = breakEvent(replay([]), "b0", T, "Arrival");
    const state = replay([
      first,
      p("p1", "b0", "a"),
      h("h1", "p1", "A"),
      p("p2", "h1", "b"),
      h("h2", "p2", "B", "h1"),
    ]);
    expect(chaptersOf(state).map((c) => c.title)).toEqual(["Arrival"]);
  });

  it("follow the branch", () => {
    const { state } = story();
    expect(chaptersOf(applyEvent(state, gotoEvent("g", T, "h1")))).toEqual([]);
  });
});

describe("renderTurn", () => {
  it("quotes player input by mode and keeps host prose as written", () => {
    expect(renderTurn({ id: "a", role: "player", mode: "say", text: '"Hi"' })).toBe(
      '> **Say:** "Hi"',
    );
    expect(renderTurn({ id: "a", role: "player", mode: "story", text: "Night\nfalls." })).toBe(
      "> **Story:** Night falls.",
    );
    expect(renderTurn({ id: "a", role: "player", text: "go" })).toBe("> **Do:** go");
    expect(renderTurn({ id: "a", role: "host", text: "First.\n\nSecond." })).toBe(
      "First.\n\nSecond.",
    );
  });
});

describe("projection of chapters", () => {
  it("lists a file per chapter plus an index, and nothing before the first shift", () => {
    const { state } = story();
    const files = projectStory(state);
    expect(files.map((f) => f.path)).toEqual([
      "chapters/chapter-01-chapter-1.md",
      "chapters/index.md",
    ]);
    expect(files[0]?.content).toContain("title: Chapter 1");
    expect(files[0]?.content).toContain("open: true");
    expect(files[0]?.content).toContain("# Chapter 1\n\n> **Do:** one\n\nONE\n\n> **Do:** two\n");
    expect(files[1]?.content).toContain(
      "1. [Chapter 1](chapter-01-chapter-1.md) (still being written)",
    );
    expect(projectStory(replay([p("p1", null, "x")]))).toEqual([]);
    expect(projectStory(state)).toEqual(projectStory(state));
  });

  it("rebuilds for any point in time", () => {
    const { state } = story();
    expect(projectStory(state, { at: "h1" })).toEqual([]);
    expect(projectStory(state, { at: "h2" })[0]?.content).toContain("through: h1");
  });
});

describe("slugify and chapterPath", () => {
  it("makes safe, stable file names", () => {
    expect(slugify("The Harbour Door!")).toBe("the-harbour-door");
    expect(slugify("Café à la Mer")).toBe("cafe-a-la-mer");
    expect(slugify("???")).toBe("untitled");
    expect(chapterPath(3, "A Long Night")).toBe("chapters/chapter-03-a-long-night.md");
  });
});
