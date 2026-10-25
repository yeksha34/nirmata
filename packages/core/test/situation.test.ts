import { describe, expect, it } from "vitest";
import {
  applyEvent,
  CURRENT_SITUATION_ID,
  cardsWithPlot,
  currentSituationCard,
  gotoEvent,
  newEvent,
  plotEvent,
  plotPointsOf,
  projectStory,
  replay,
  type StoryEvent,
  undoLastPlotEvent,
  unplotEvent,
  withCurrentSituation,
} from "../src";
import { card } from "./helpers";

const T = "2026-10-25T10:00:00Z";
const p = (id: string, parentId: string | null): StoryEvent =>
  newEvent({ id, parentId, t: T, kind: "player", mode: "do", text: id });
const h = (id: string, parentId: string | null): StoryEvent =>
  newEvent({ id, parentId, t: T, kind: "host", text: id.toUpperCase() });
const point = (n: number, cardId = "char.marrow") => ({
  id: `e:${n}`,
  card: cardId,
  text: `point ${n}`,
  eventId: "e",
});

describe("the current-situation card", () => {
  it("is always on, empty, and shows only its newest point under its own heading", () => {
    const situation = currentSituationCard();
    expect(situation.fm).toMatchObject({
      id: CURRENT_SITUATION_ID,
      kind: "lore",
      always: true,
      plotMax: 1,
    });
    expect(situation.body).toBe("");

    const [shown] = cardsWithPlot(
      [situation],
      [
        point(1, CURRENT_SITUATION_ID),
        point(2, CURRENT_SITUATION_ID),
        point(3, CURRENT_SITUATION_ID),
      ],
    );
    expect(shown?.body).toContain("**Right now:**\n- point 3\n");
    expect(shown?.body).not.toContain("point 2");
    expect(shown?.body).not.toContain("What has happened so far");
  });

  it("is added to a list of cards once, and a world's own version wins", () => {
    const once = withCurrentSituation([card("lore.a")]);
    expect(once.map((c) => c.fm.id)).toEqual(["lore.a", CURRENT_SITUATION_ID]);
    expect(withCurrentSituation(once)).toHaveLength(2);
    const own = card(CURRENT_SITUATION_ID, {}, "Mine.");
    expect(withCurrentSituation([own])[0]).toBe(own);
  });

  it("does not change the cards it was given", () => {
    const list = [card("lore.a")];
    withCurrentSituation(list);
    expect(list).toHaveLength(1);
  });
});

describe("plotMax and plotHeading on any card", () => {
  it("let a card show fewer points under a heading of its choice", () => {
    const custom = card("lore.tide", { plotMax: 2, plotHeading: "**Lately:**" }, "The tide.");
    const [out] = cardsWithPlot(
      [custom],
      [1, 2, 3, 4].map((n) => point(n, "lore.tide")),
    );
    expect(out?.body).toContain("**Lately:**\n- point 3\n- point 4\n");
    expect(out?.body).not.toContain("point 2");
  });
});

describe("revokes surviving undo", () => {
  /** p1 h1, plot point, p2 h2, then a revoke of that point, all on one branch. */
  function story() {
    const base = replay([p("p1", null), h("h1", "p1")]);
    const withPlot = applyEvent(
      base,
      plotEvent(base, {
        id: "pl",
        t: T,
        covers: "h1",
        points: [{ card: "char.marrow", text: "Marrow opened the door." }],
      }),
    );
    const later = applyEvent(applyEvent(withPlot, p("p2", "pl")), h("h2", "p2"));
    const revoked = applyEvent(later, unplotEvent(later, { id: "ur", t: T, revokes: ["pl:0"] }));
    return { revoked, later };
  }

  it("by default a revoke is only on the branch it was made on", () => {
    const { revoked } = story();
    expect(plotPointsOf(revoked)).toEqual([]);
    const back = applyEvent(revoked, gotoEvent("g", T, "h2")); // before the revoke
    expect(plotPointsOf(back)).toHaveLength(1);
  });

  it("with the setting on, it stays revoked everywhere", () => {
    const { revoked } = story();
    const back = applyEvent(revoked, gotoEvent("g", T, "h2"));
    expect(plotPointsOf(back, back.head, { revokesSurviveUndo: true })).toEqual([]);
    const earlier = applyEvent(revoked, gotoEvent("g2", T, "h1"));
    expect(plotPointsOf(earlier, earlier.head, { revokesSurviveUndo: true })).toEqual([]);
  });

  it("applies to undoing the newest batch, and to the plot files", () => {
    const { revoked } = story();
    const back = applyEvent(revoked, gotoEvent("g", T, "h2"));
    expect(undoLastPlotEvent(back, "u", T)).toBeDefined();
    expect(undoLastPlotEvent(back, "u", T, { revokesSurviveUndo: true })).toBeUndefined();
    expect(projectStory(back).map((f) => f.path)).toEqual(["plot/char.marrow.md"]);
    expect(projectStory(back, { revokesSurviveUndo: true })).toEqual([]);
  });
});
