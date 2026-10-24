import { describe, expect, it } from "vitest";
import {
  type AdventureEvent,
  applyEvent,
  buildContext,
  type CardUpdate,
  chapterPath,
  chaptersOf,
  contextTurnsOf,
  gotoEvent,
  liveCardsOf,
  memoryOf,
  newEvent,
  parseCard,
  projectAdventure,
  replay,
  slugify,
  turnsOf,
} from "../src";
import { card } from "./helpers";

const T = "2026-10-25T10:00:00Z";
const ev = (e: Parameters<typeof newEvent>[0]) => newEvent(e);

const update = (over: Partial<CardUpdate> & Pick<CardUpdate, "id">): CardUpdate => ({
  kind: "state",
  name: over.id,
  keywords: [],
  summary: "",
  body: "",
  always: false,
  ...over,
});

/** p1 h1 p2 h2 p3 h3, compacted through h2 (leaving p3, h3 verbatim). */
function compacted(
  updates: CardUpdate[] = [],
  extra: Partial<Parameters<typeof newEvent>[0]> = {},
) {
  const log: AdventureEvent[] = [
    ev({ id: "p1", parentId: null, t: T, kind: "player", mode: "do", text: "one" }),
    ev({ id: "h1", parentId: "p1", t: T, kind: "host", text: "ONE" }),
    ev({ id: "p2", parentId: "h1", t: T, kind: "player", mode: "do", text: "two" }),
    ev({ id: "h2", parentId: "p2", t: T, kind: "host", text: "TWO" }),
    ev({ id: "p3", parentId: "h2", t: T, kind: "player", mode: "do", text: "three" }),
    ev({ id: "h3", parentId: "p3", t: T, kind: "host", text: "THREE" }),
    ev({
      id: "c1",
      parentId: "h3",
      t: T,
      kind: "compact",
      text: "SUMMARY ONE",
      covers: "h2",
      chapter: { title: "The Harbour Door", text: "Chapter prose." },
      cardUpdates: updates,
      ...extra,
    }),
  ];
  return { log, state: replay(log) };
}

describe("compact events", () => {
  it("must carry covers, a summary and a chapter", () => {
    const base = { id: "c", parentId: null, t: T, kind: "compact" as const };
    expect(() => newEvent({ ...base, text: "s", chapter: { title: "t", text: "x" } })).toThrow(
      /covers/,
    );
    expect(() => newEvent({ ...base, covers: "x", chapter: { title: "t", text: "x" } })).toThrow(
      /summary/,
    );
    expect(() => newEvent({ ...base, covers: "x", text: "s" })).toThrow(/chapter/);
  });

  it("must cover a turn on their own branch", () => {
    const { state } = compacted();
    const bad = ev({
      id: "c2",
      parentId: "h1",
      t: T,
      kind: "compact",
      text: "s",
      covers: "h3", // exists, but is not an ancestor of h1
      chapter: { title: "t", text: "x" },
    });
    expect(() => applyEvent(state, bad)).toThrow(/not on its branch/);
  });
});

describe("what stays in the prompt", () => {
  it("drops compacted turns from the prompt but not from the transcript", () => {
    const { state } = compacted();
    expect(turnsOf(state).map((t) => t.id)).toEqual(["p1", "h1", "p2", "h2", "p3", "h3"]);
    expect(contextTurnsOf(state).map((t) => t.id)).toEqual(["p3", "h3"]);
  });

  it("keeps everything when nothing has been compacted, and appends after the compaction", () => {
    const { state } = compacted();
    const more = applyEvent(
      state,
      ev({ id: "p4", parentId: "c1", t: T, kind: "player", mode: "do", text: "four" }),
    );
    expect(contextTurnsOf(more).map((t) => t.id)).toEqual(["p3", "h3", "p4"]);
    const before = gotoEventState(state, "h2");
    expect(contextTurnsOf(before).map((t) => t.id)).toEqual(["p1", "h1", "p2", "h2"]);
  });

  it("uses only the latest compaction", () => {
    const { state } = compacted();
    let s = applyEvent(
      state,
      ev({ id: "p4", parentId: "c1", t: T, kind: "player", mode: "do", text: "four" }),
    );
    s = applyEvent(s, ev({ id: "h4", parentId: "p4", t: T, kind: "host", text: "FOUR" }));
    s = applyEvent(
      s,
      ev({
        id: "c2",
        parentId: "h4",
        t: T,
        kind: "compact",
        text: "SUMMARY TWO",
        covers: "h3",
        chapter: { title: "Two", text: "x" },
      }),
    );
    expect(contextTurnsOf(s).map((t) => t.id)).toEqual(["p4", "h4"]);
    expect(memoryOf(s).summary).toBe("SUMMARY TWO");
  });

  it("reports the summary as memory", () => {
    expect(memoryOf(compacted().state).summary).toBe("SUMMARY ONE");
  });
});

function gotoEventState(state: ReturnType<typeof replay>, target: string) {
  return applyEvent(state, gotoEvent("g", T, target));
}

describe("chapters", () => {
  it("lists chapters in order and follows the branch", () => {
    const { state } = compacted();
    expect(chaptersOf(state)).toEqual([
      { number: 1, title: "The Harbour Door", text: "Chapter prose.", eventId: "c1", covers: "h2" },
    ]);
    expect(chaptersOf(gotoEventState(state, "h3"))).toEqual([]);
  });
});

describe("tracking cards", () => {
  it("folds updates in order, a later update replacing the earlier one", () => {
    const { state } = compacted([
      update({
        id: "state.marrow",
        name: "Marrow (now)",
        body: "Wary.",
        keywords: ["marrow"],
        entity: "character",
      }),
      update({ id: "state.now", name: "Current situation", body: "At the quay.", always: true }),
    ]);
    const later = applyEvent(
      state,
      ev({
        id: "c2",
        parentId: "c1",
        t: T,
        kind: "compact",
        text: "S2",
        covers: "h3",
        chapter: { title: "Two", text: "x" },
        cardUpdates: [
          update({
            id: "state.marrow",
            name: "Marrow (now)",
            body: "Friendly.",
            keywords: ["marrow"],
          }),
        ],
      }),
    );
    const cards = liveCardsOf(later);
    expect(cards.map((c) => c.fm.id).sort()).toEqual(["state.marrow", "state.now"]);
    expect(cards.find((c) => c.fm.id === "state.marrow")?.body).toBe("Friendly.");
    expect(cards[0]?.fm.origin).toBe("adventure");
    expect(liveCardsOf(state).find((c) => c.fm.id === "state.marrow")?.fm.entity).toBe("character");
  });

  it("disappear when you go back to before the compaction", () => {
    const { state } = compacted([update({ id: "state.now", always: true })]);
    expect(liveCardsOf(gotoEventState(state, "h2"))).toEqual([]);
  });

  it("are used in prompts: scene cards by keyword, state.now always, authored scenes never", () => {
    const { state } = compacted([
      update({
        id: "state.now",
        name: "Current situation",
        body: "At the quay at dusk.",
        always: true,
      }),
      update({
        id: "scene.ch-01",
        kind: "scene",
        name: "The Harbour Door",
        keywords: ["harbour"],
        body: "Marrow opened the door.",
      }),
    ]);
    const built = buildContext({
      world: {
        name: "w",
        title: "W",
        tagline: "",
        genre: [],
        tone: [],
        contentRating: "everyone",
        perspective: "second-person",
        systems: { dice: "none", stats: [], inventory: true },
      },
      cards: [card("scene.authored-beat", { kind: "scene", always: true }), ...liveCardsOf(state)],
      memory: memoryOf(state),
      turns: contextTurnsOf(state),
      input: { mode: "do", text: "I walk back to the harbour." },
      budget: { maxTokens: 4000, reserveReply: 300 },
    });
    const byId = Object.fromEntries(built.included.map((i) => [i.id, i]));
    expect(byId["state.now"]).toMatchObject({ section: "canon", reason: "always on" });
    expect(byId["scene.ch-01"]).toMatchObject({ section: "lore" });
    expect(byId["scene.authored-beat"]).toBeUndefined();
    expect(built.messages[0]?.content).toContain("Summary so far: SUMMARY ONE");
    // compacted turns are gone from the prompt, recent ones remain
    expect(built.included.filter((i) => i.section === "history").map((i) => i.id)).toEqual([
      "h3",
      "p3",
    ]);
  });
});

describe("projectAdventure", () => {
  const updates = [
    update({
      id: "state.marrow",
      name: "Marrow (now)",
      keywords: ["marrow"],
      summary: "Wary",
      body: "- Distrusts the player.",
      entity: "character",
    }),
    update({
      id: "scene.ch-01",
      kind: "scene",
      name: "The Harbour Door",
      keywords: ["harbour", "door"],
      body: "Marrow opened it.",
    }),
  ];

  it("lists chapter, index and card files for the current branch", () => {
    const files = projectAdventure(compacted(updates).state);
    expect(files.map((f) => f.path)).toEqual([
      "chapters/chapter-01-the-harbour-door.md",
      "chapters/index.md",
      "cards/scene.ch-01.md",
      "cards/state.marrow.md",
    ]);
    expect(files[0]?.content).toContain("# The Harbour Door\n\nChapter prose.");
    expect(files[1]?.content).toContain("1. [The Harbour Door](chapter-01-the-harbour-door.md)");
  });

  it("writes cards the editor and linter can read back unchanged", () => {
    for (const file of projectAdventure(compacted(updates).state).filter((f) =>
      f.path.startsWith("cards/"),
    )) {
      const parsed = parseCard(file.path, file.content);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.card.fm.origin).toBe("adventure");
    }
    const marrow = projectAdventure(compacted(updates).state).find((f) =>
      f.path.endsWith("state.marrow.md"),
    );
    const parsed = parseCard("x", marrow?.content ?? "");
    expect(parsed.ok && parsed.card.fm).toMatchObject({
      id: "state.marrow",
      kind: "state",
      keywords: ["marrow"],
      entity: "character",
    });
  });

  it("is deterministic and empty before any compaction", () => {
    const { state } = compacted(updates);
    expect(projectAdventure(state)).toEqual(projectAdventure(state));
    expect(projectAdventure(gotoEventState(state, "h3"))).toEqual([]);
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
