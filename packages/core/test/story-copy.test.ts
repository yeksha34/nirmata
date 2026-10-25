import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  type Action,
  type Actor,
  applyEvent,
  assertCan,
  beginEvent,
  can,
  gotoEvent,
  newEvent,
  PermissionError,
  parseLog,
  replay,
  serializeEvent,
  sourceOf,
  turnsOf,
  undoEvent,
  type WorldManifest,
} from "../src";
import { card } from "./helpers";

const T = "2026-10-25T10:00:00Z";
const world: WorldManifest = {
  name: "w",
  title: "W",
  tagline: "",
  genre: [],
  tone: [],
  perspective: "second-person",
  systems: { dice: "none", stats: [], inventory: true },
};

describe("begin", () => {
  it("holds a deep copy of the world and the source cards", () => {
    const source = [card("char.marrow", { kind: "character" }, "Original body.")];
    const begin = beginEvent({ id: "b", t: T, world, cards: source });

    // later changes to the source cannot reach the copy
    (source[0] as { body: string }).body = "Edited in the source.";
    source[0]?.fm.keywords.push("new");
    world.title = "Renamed";

    const state = replay([begin]);
    const own = sourceOf(state);
    expect(own?.world.title).toBe("W");
    expect(own?.cards[0]?.body).toContain("Original body.");
    expect(own?.cards[0]?.fm.keywords).toEqual([]);
    world.title = "W";
  });

  it("must be the root and carry the world", () => {
    expect(() => newEvent({ id: "b", parentId: null, t: T, kind: "begin" })).toThrow(
      /world manifest/,
    );
    expect(() => newEvent({ id: "b", parentId: "x", t: T, kind: "begin", world })).toThrow(
      /root of the story/,
    );
  });

  it("can only happen once", () => {
    const state = replay([beginEvent({ id: "b1", t: T, world, cards: [] })]);
    expect(() => applyEvent(state, beginEvent({ id: "b2", t: T, world, cards: [] }))).toThrow(
      /already begun/,
    );
  });

  it("survives the events.jsonl round trip", () => {
    const begin = beginEvent({
      id: "b",
      t: T,
      world,
      cards: [card("lore.fog", { keywords: ["fog"], always: true }, "A sentient fog.")],
    });
    const [back] = parseLog(serializeEvent(begin));
    expect(back).toEqual(begin);
    expect(sourceOf(replay([back as typeof begin]))?.cards[0]?.fm).toMatchObject({
      id: "lore.fog",
      keywords: ["fog"],
      always: true,
    });
  });

  it("is invisible in the story but is the root every branch grows from", () => {
    const begin = beginEvent({ id: "b", t: T, world, cards: [] });
    const p1 = newEvent({ id: "p1", parentId: "b", t: T, kind: "player", mode: "do", text: "go" });
    const h1 = newEvent({ id: "h1", parentId: "p1", t: T, kind: "host", text: "GO" });
    const state = replay([begin, p1, h1]);

    expect(turnsOf(state).map((t) => t.id)).toEqual(["p1", "h1"]);
    expect(sourceOf(state)?.world.name).toBe("w");

    // undo goes back to the beginning, which still has the copy
    const undone = applyEvent(state, undoEvent(state, "u", T) as never);
    expect(turnsOf(undone)).toEqual([]);
    expect(sourceOf(undone)).toBeDefined();
    // and so does jumping to the root
    expect(sourceOf(applyEvent(state, gotoEvent("g", T, "b")))).toBeDefined();
  });

  it("is absent from a log that has none", () => {
    expect(
      sourceOf(replay([newEvent({ id: "h", parentId: null, t: T, kind: "host", text: "x" })])),
    ).toBeUndefined();
    expect(sourceOf(replay([]))).toBeUndefined();
  });
});

describe("permissions", () => {
  const host: Actor = { id: "h", role: "host" };
  const player: Actor = { id: "p", role: "player" };

  it("lets hosts do everything", () => {
    for (const action of ACTIONS) expect(can(host, action)).toBe(true);
  });

  it("never lets a player edit the source cards", () => {
    expect(can(player, "source.edit")).toBe(false);
    expect(() => assertCan(player, "source.edit")).toThrow(PermissionError);
    expect(() => assertCan(player, "source.edit")).toThrow(
      "Only the host can edit the source cards.",
    );
  });

  it("lets players take part, and nothing that reshapes the story", () => {
    const allowed: Action[] = ["story.play", "story.undo", "story.edit-turn", "story.pin"];
    expect(ACTIONS.filter((a) => can(player, a)).sort()).toEqual([...allowed].sort());
  });

  it("explains every refusal in plain language", () => {
    for (const action of ACTIONS.filter((a) => !can(player, a))) {
      try {
        assertCan(player, action);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(PermissionError);
        expect((e as PermissionError).message).toMatch(/^Only the host can .+\.$/);
        expect((e as PermissionError).action).toBe(action);
        expect((e as PermissionError).role).toBe("player");
      }
    }
  });
});
