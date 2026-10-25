import { describe, expect, it } from "vitest";
import {
  applyEvent,
  beginEvent,
  breakEvent,
  currentSituationCard,
  manualPlotEvent,
  NoStoryCopyError,
  newEvent,
  PLOT_HEADING,
  plotEvent,
  replay,
  type StoryEvent,
  worldFromStory,
} from "../src";
import { card } from "./helpers";

const T = "2026-10-25T10:00:00Z";
const world = {
  name: "lantern",
  title: "Lantern",
  tagline: "t",
  genre: [],
  tone: [],
  perspective: "second-person" as const,
  systems: { dice: "none", stats: [], inventory: true },
};
const player = (id: string, parentId: string | null): StoryEvent =>
  newEvent({ id, parentId, t: T, kind: "player", mode: "do", text: `${id} acts` });
const host = (id: string, parentId: string | null): StoryEvent =>
  newEvent({ id, parentId, t: T, kind: "host", text: `${id} answers` });

function story() {
  const begin = beginEvent({
    id: "b",
    t: T,
    world,
    cards: [
      { ...card("char.marrow", { kind: "character" }, "Keeper."), path: "characters/marrow.md" },
      { ...card("lore.the-fog", {}, "It drifts."), path: "lore/fog.md" },
      currentSituationCard(),
    ],
  });
  let state = replay([begin, player("p1", "b"), host("h1", "p1")]);
  state = applyEvent(
    state,
    plotEvent(state, {
      id: "pl1",
      t: T,
      covers: "h1",
      points: [{ card: "char.marrow", text: "Marrow opened the door." }],
    }),
  );
  state = applyEvent(state, breakEvent(state, "br1", T, "Dusk"));
  state = applyEvent(state, player("p2", "br1"));
  // the window moved past the first exchange when this reply was written
  state = applyEvent(state, newEvent({ ...host("h2", "p2"), shifted: "h1" }));
  state = applyEvent(
    state,
    manualPlotEvent(state, { id: "pl2", t: T, card: "char.marrow", text: "Marrow left." }),
  );
  return state;
}

describe("worldFromStory", () => {
  it("names the new world and keeps everything else from the story's world", () => {
    const made = worldFromStory(story(), { name: "lantern-2", title: "Lantern II" });
    expect(made.manifest).toMatchObject({ name: "lantern-2", title: "Lantern II", tagline: "t" });
  });

  it("writes each plot point into the card it happened to, and leaves the other cards alone", () => {
    const made = worldFromStory(story(), { name: "x", title: "X" });
    const marrow = made.cards.find((c) => c.fm.id === "char.marrow");
    expect(marrow?.body).toContain(PLOT_HEADING);
    expect(marrow?.body).toContain("- Marrow opened the door.");
    expect(marrow?.body).toContain("- Marrow left.");
    expect(marrow?.path).toBe("characters/marrow.md");
    expect(made.cards.find((c) => c.fm.id === "lore.the-fog")?.body).toBe(
      "# lore.the-fog\n\nIt drifts.",
    );
  });

  it("leaves out the built-in current-situation card, which every new story gets afresh", () => {
    const made = worldFromStory(story(), { name: "x", title: "X" });
    expect(made.cards.map((c) => c.fm.id).sort()).toEqual(["char.marrow", "lore.the-fog"]);
  });

  it("does not change the story's own copy of the cards", () => {
    const state = story();
    worldFromStory(state, { name: "x", title: "X" });
    const root = state.events.get("b");
    expect(root?.cards.find((c) => c.fm.id === "char.marrow")?.body).toBe(
      "# char.marrow\n\nKeeper.",
    );
  });

  it("can save the story as it stood at an earlier moment", () => {
    const made = worldFromStory(story(), { name: "x", title: "X", at: "pl1" });
    const body = made.cards.find((c) => c.fm.id === "char.marrow")?.body ?? "";
    expect(body).toContain("Marrow opened the door.");
    expect(body).not.toContain("Marrow left.");
  });

  it("brings the chapters along, and nothing else from the story's files", () => {
    const made = worldFromStory(story(), { name: "x", title: "X" });
    expect(made.files.length).toBeGreaterThan(0);
    expect(made.files.every((f) => f.path.startsWith("chapters/"))).toBe(true);
  });

  it("refuses a story with no copy of its cards", () => {
    const old = replay([player("p1", null), host("h1", "p1")]);
    expect(() => worldFromStory(old, { name: "x", title: "X" })).toThrow(NoStoryCopyError);
  });
});
