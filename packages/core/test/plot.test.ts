import { describe, expect, it } from "vitest";
import {
  type AdventureEvent,
  applyEvent,
  buildContext,
  cardsWithPlot,
  gotoEvent,
  manualPlotEvent,
  newEvent,
  PLOT_HEADING,
  parseCard,
  plotCursor,
  plotEvent,
  plotPointsOf,
  projectAdventure,
  replay,
  turnsSincePlot,
  undoEvent,
  undoLastPlotEvent,
  unplotEvent,
} from "../src";
import { card } from "./helpers";

const T = "2026-10-25T10:00:00Z";
const p = (id: string, parentId: string | null, text: string): AdventureEvent =>
  newEvent({ id, parentId, t: T, kind: "player", mode: "do", text });
const h = (id: string, parentId: string | null, text: string): AdventureEvent =>
  newEvent({ id, parentId, t: T, kind: "host", text });

/** p1 h1 p2 h2, then a plot event covering through h2 with two points. */
function withPlot() {
  const base = replay([
    p("p1", null, "a"),
    h("h1", "p1", "A"),
    p("p2", "h1", "b"),
    h("h2", "p2", "B"),
  ]);
  const plot = plotEvent(base, {
    id: "pl1",
    t: T,
    covers: "h2",
    points: [
      { card: "char.marrow", text: "Marrow opened the harbour door." },
      { card: "arc.fourth-light", text: "The fourth light was seen from the quay." },
    ],
  });
  return { base, state: applyEvent(base, plot) };
}

describe("plot events", () => {
  it("fold into points with stable ids, oldest first", () => {
    const { state } = withPlot();
    expect(plotPointsOf(state)).toEqual([
      { id: "pl1:0", card: "char.marrow", text: "Marrow opened the harbour door.", eventId: "pl1" },
      {
        id: "pl1:1",
        card: "arc.fourth-light",
        text: "The fourth light was seen from the quay.",
        eventId: "pl1",
      },
    ]);
  });

  it("track an extraction cursor, and the turns still to read", () => {
    const { base, state } = withPlot();
    expect(plotCursor(base)).toBeNull();
    expect(turnsSincePlot(base).map((t) => t.id)).toEqual(["p1", "h1", "p2", "h2"]);
    expect(plotCursor(state)).toBe("h2");
    const later = applyEvent(applyEvent(state, p("p3", "pl1", "c")), h("h3", "p3", "C"));
    expect(turnsSincePlot(later).map((t) => t.id)).toEqual(["p3", "h3"]);
  });

  it("must have read turns that are on their own branch", () => {
    const { base } = withPlot();
    const bad = plotEvent(applyEvent(base, gotoEvent("g", T, "h1")), {
      id: "x",
      t: T,
      covers: "h2",
      points: [],
    });
    expect(() => applyEvent(applyEvent(base, gotoEvent("g", T, "h1")), bad)).toThrow(
      /covers "h2" is not on its branch/,
    );
  });

  it("may be empty and still move the cursor", () => {
    const { base } = withPlot();
    const empty = applyEvent(base, plotEvent(base, { id: "e", t: T, covers: "h2", points: [] }));
    expect(plotPointsOf(empty)).toEqual([]);
    expect(plotCursor(empty)).toBe("h2");
  });

  it("added by hand never move the cursor", () => {
    const { state } = withPlot();
    const manual = applyEvent(
      state,
      manualPlotEvent(state, {
        id: "m",
        t: T,
        card: "place.saltmere",
        text: "The player named the quay.",
      }),
    );
    expect(plotCursor(manual)).toBe("h2");
    expect(plotPointsOf(manual).at(-1)).toMatchObject({ id: "m:0", card: "place.saltmere" });
    expect(() => manualPlotEvent(replay([]), { id: "m", t: T, card: "a.b", text: "x" })).toThrow(
      /nothing in the adventure/,
    );
  });
});

describe("undoing plot points", () => {
  it("undoing the turn that produced them removes them, and going forward again restores them", () => {
    const { state } = withPlot();
    const undo = undoEvent(state, "u", T);
    const after = applyEvent(state, undo as AdventureEvent);
    expect(plotPointsOf(after)).toEqual([]);
    expect(plotCursor(after)).toBeNull();
    expect(plotPointsOf(applyEvent(after, gotoEvent("g", T, "pl1")))).toHaveLength(2);
  });

  it("revokes one point and leaves the rest", () => {
    const { state } = withPlot();
    const revoked = applyEvent(state, unplotEvent(state, { id: "u1", t: T, revokes: ["pl1:0"] }));
    expect(plotPointsOf(revoked).map((x) => x.id)).toEqual(["pl1:1"]);
    // the extraction cursor is untouched, so the revoked point is not re-extracted
    expect(plotCursor(revoked)).toBe("h2");
    expect(turnsSincePlot(revoked)).toEqual([]);
  });

  it("undoes the newest batch, then the one before it", () => {
    const { state } = withPlot();
    const second = applyEvent(
      applyEvent(applyEvent(state, p("p3", "pl1", "c")), h("h3", "p3", "C")),
      newEvent({
        id: "pl2",
        parentId: "h3",
        t: T,
        kind: "plot",
        covers: "h3",
        points: [{ card: "char.marrow", text: "Marrow trusted the player." }],
      }),
    );
    expect(plotPointsOf(second)).toHaveLength(3);

    const one = applyEvent(second, undoLastPlotEvent(second, "u1", T) as AdventureEvent);
    expect(plotPointsOf(one).map((x) => x.id)).toEqual(["pl1:0", "pl1:1"]);

    const two = applyEvent(one, undoLastPlotEvent(one, "u2", T) as AdventureEvent);
    expect(plotPointsOf(two)).toEqual([]);
    expect(undoLastPlotEvent(two, "u3", T)).toBeUndefined();
  });

  it("only revokes the points of that batch that are still in force", () => {
    const { state } = withPlot();
    const partly = applyEvent(state, unplotEvent(state, { id: "u1", t: T, revokes: ["pl1:1"] }));
    const event = undoLastPlotEvent(partly, "u2", T);
    expect(event?.revokes).toEqual(["pl1:0"]);
  });

  it("rejects revoking something that is not a point on this branch", () => {
    const { state } = withPlot();
    for (const id of ["pl1:5", "nope:0", "pl1", "pl1:-1", "pl1:x"]) {
      expect(() => applyEvent(state, unplotEvent(state, { id: "u", t: T, revokes: [id] }))).toThrow(
        /not a plot point/,
      );
    }
    const elsewhere = applyEvent(state, gotoEvent("g", T, "h1"));
    expect(() =>
      applyEvent(elsewhere, unplotEvent(elsewhere, { id: "u", t: T, revokes: ["pl1:0"] })),
    ).toThrow(/not a plot point/);
  });

  it("needs something to revoke", () => {
    expect(() => newEvent({ id: "u", parentId: null, t: T, kind: "unplot" })).toThrow(/revokes/);
  });
});

describe("cardsWithPlot", () => {
  const marrow = card("char.marrow", { kind: "character", keywords: ["marrow"] }, "Gruff keeper.");
  const fog = card("lore.fog", { keywords: ["fog"] }, "A sentient fog.");

  it("appends points to the cards they belong to and leaves the others and the inputs alone", () => {
    const points = plotPointsOf(withPlot().state);
    const out = cardsWithPlot([marrow, fog], points);
    expect(out[0]?.body).toContain(`${PLOT_HEADING}\n- Marrow opened the harbour door.`);
    expect(out[0]?.body.startsWith("# char.marrow\n\nGruff keeper.")).toBe(true);
    expect(out[1]).toBe(fog);
    expect(marrow.body).not.toContain(PLOT_HEADING);
  });

  it("shows only the newest points per card and ignores points for unknown cards", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `x:${i}`,
      card: "char.marrow",
      text: `point ${i}`,
      eventId: "x",
    }));
    const out = cardsWithPlot(
      [marrow],
      [...many, { id: "y:0", card: "gone.card", text: "orphan", eventId: "y" }],
      3,
    );
    expect(out[0]?.body).toContain("- point 9\n- point 10\n- point 11\n");
    expect(out[0]?.body).not.toContain("point 8");
    expect(out[0]?.body).not.toContain("orphan");
  });

  it("returns the cards unchanged when there are no points", () => {
    expect(cardsWithPlot([marrow], [])).toEqual([marrow]);
  });

  it("shows up in prompts whenever the card is recalled", () => {
    const points = plotPointsOf(withPlot().state);
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
      cards: cardsWithPlot([marrow, fog], points),
      memory: { summary: "", pinned: [] },
      turns: [],
      input: { mode: "say", text: "Marrow, about the door?" },
      budget: { maxTokens: 4000, reserveReply: 300 },
    });
    const system = built.messages[0]?.content ?? "";
    expect(system).toContain("- Marrow opened the harbour door.");
    expect(system).not.toContain("fourth light was seen"); // that point belongs to a card not recalled here
  });
});

describe("plot files", () => {
  it("lists a file per card with its points, readable by the card parser", () => {
    const { state } = withPlot();
    const files = projectAdventure(state, { cardNames: new Map([["char.marrow", "Marrow"]]) });
    expect(files.map((f) => f.path)).toEqual(["plot/arc.fourth-light.md", "plot/char.marrow.md"]);
    const marrow = files.find((f) => f.path.endsWith("char.marrow.md"));
    expect(marrow?.content).toContain("# Marrow\n\n- Marrow opened the harbour door.\n");
    expect(marrow?.content).toContain("card: char.marrow");
    expect(parseCard("x", "---\nid: a.b\nkind: lore\nname: n\n---\n").ok).toBe(true);
  });

  it("drops revoked points and rebuilds for earlier times", () => {
    const { state } = withPlot();
    const revoked = applyEvent(
      state,
      unplotEvent(state, { id: "u", t: T, revokes: ["pl1:0", "pl1:1"] }),
    );
    expect(projectAdventure(revoked)).toEqual([]);
    expect(projectAdventure(state, { at: "h2" })).toEqual([]);
  });
});
