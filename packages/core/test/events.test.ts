import { describe, expect, it } from "vitest";
import {
  applyEvent,
  editEvent,
  emptyStory,
  gotoEvent,
  memoryOf,
  newEvent,
  parseLog,
  pathTo,
  replay,
  retryParent,
  type StoryEvent,
  serializeEvent,
  siblingsOf,
  turnsOf,
  undoEvent,
} from "../src";

let n = 0;
const T = "2026-10-25T10:00:00Z";
const id = () => `e${++n}`;
const player = (parentId: string | null, text = "I act.", eid = id()) =>
  newEvent({ id: eid, parentId, t: T, kind: "player", mode: "do", text });
const host = (parentId: string | null, text = "It happens.", eid = id()) =>
  newEvent({ id: eid, parentId, t: T, kind: "host", text, cardsUsed: ["lore.fog"], model: "m" });

function story() {
  n = 0;
  const events = [host(null, "Opening."), player("e1", "Knock."), host("e2", "Door opens.")];
  return { events, state: replay(events) };
}

describe("event tree", () => {
  it("replays a log into a head and a visible conversation", () => {
    const { state } = story();
    expect(state.head).toBe("e3");
    expect(turnsOf(state).map((t) => `${t.role}:${t.text}`)).toEqual([
      "host:Opening.",
      "player:Knock.",
      "host:Door opens.",
    ]);
  });

  it("applyEvent matches replay and leaves the old state untouched", () => {
    const { events, state } = story();
    const step = events.reduce(applyEvent, emptyStory);
    expect(step.head).toBe(state.head);
    expect(emptyStory.log).toEqual([]);
  });

  it("undo removes the last player action and everything after, keeping it reachable", () => {
    const { state } = story();
    const undo = undoEvent(state, "u1", T);
    expect(undo).toBeDefined();
    const after = applyEvent(state, undo as StoryEvent);
    expect(turnsOf(after).map((t) => t.text)).toEqual(["Opening."]);
    // the undone branch still exists and can be revisited
    expect(after.events.has("e3")).toBe(true);
    const back = applyEvent(after, gotoEvent("g1", T, "e3"));
    expect(turnsOf(back)).toHaveLength(3);
  });

  it("undo with nothing to undo returns undefined", () => {
    expect(undoEvent(replay([host(null)]), "u", T)).toBeUndefined();
  });

  it("retry adds a sibling reply, leaving the original as an alternative", () => {
    const { state } = story();
    const parent = retryParent(state);
    expect(parent).toEqual({ parentId: "e2" });
    const retried = applyEvent(state, host(parent?.parentId ?? null, "Door creaks.", "e4"));
    expect(turnsOf(retried).at(-1)?.text).toBe("Door creaks.");
    expect(siblingsOf(retried, "e4").map((e) => e.id)).toEqual(["e3", "e4"]);
  });

  it("edit creates a sibling with the new text and records what it replaced", () => {
    const { state } = story();
    const edit = editEvent(state, "e2", "Knock twice.", "e9", T);
    const after = applyEvent(state, edit);
    expect(edit).toMatchObject({ kind: "player", mode: "do", parentId: "e1", editOf: "e2" });
    expect(turnsOf(after).map((t) => t.text)).toEqual(["Opening.", "Knock twice."]);
    expect(siblingsOf(after, "e9").map((e) => e.id)).toEqual(["e2", "e9"]);
  });

  it("memory follows the branch it was written on", () => {
    n = 0;
    const base = replay([
      host(null, "Opening."),
      newEvent({ id: "s1", parentId: "e1", t: T, kind: "summary", text: "Arrived." }),
      newEvent({ id: "p1", parentId: "s1", t: T, kind: "pin", text: "Has a lamp" }),
      newEvent({ id: "p2", parentId: "p1", t: T, kind: "pin", text: "Owes Marrow" }),
      newEvent({ id: "x1", parentId: "p2", t: T, kind: "unpin", text: "Has a lamp" }),
    ]);
    expect(memoryOf(base)).toEqual({ summary: "Arrived.", pinned: ["Owes Marrow"] });
    const earlier = applyEvent(base, gotoEvent("g", T, "p1"));
    expect(memoryOf(earlier).pinned).toEqual(["Has a lamp"]);
  });

  it("reads turns and memory as of an earlier node", () => {
    n = 0;
    const log = replay([
      host(null, "Opening."),
      player("e1", "Knock."),
      host("e2", "Door opens."),
      newEvent({ id: "s1", parentId: "e3", t: T, kind: "summary", text: "Door opened." }),
    ]);
    expect(turnsOf(log, "e2").map((t) => t.text)).toEqual(["Opening.", "Knock."]);
    expect(memoryOf(log, "e2").summary).toBe("");
    expect(memoryOf(log).summary).toBe("Door opened.");
  });

  it("defaults host event flags to none and keeps them when set", () => {
    expect(host(null).flags).toEqual([]);
    const flagged = newEvent({
      id: "f",
      parentId: null,
      t: T,
      kind: "host",
      text: "x",
      flags: ["rule.a"],
    });
    expect(parseLog(serializeEvent(flagged))[0]?.flags).toEqual(["rule.a"]);
  });

  it("a goto to null shows an empty story", () => {
    const { state } = story();
    const cleared = applyEvent(state, gotoEvent("g", T, null));
    expect(turnsOf(cleared)).toEqual([]);
    expect(pathTo(cleared)).toEqual([]);
  });

  it("rejects duplicate ids, unknown parents and unknown goto targets", () => {
    const { state } = story();
    expect(() => applyEvent(state, host("e3", "dup", "e1"))).toThrow(/duplicate event id/);
    expect(() => applyEvent(state, host("nope"))).toThrow(/unknown parent/);
    expect(() => applyEvent(state, gotoEvent("g", T, "nope"))).toThrow(/unknown target/);
  });

  it("validates event shapes", () => {
    expect(() => newEvent({ id: "a", parentId: null, t: T, kind: "player" })).toThrow(/mode/);
    expect(() => newEvent({ id: "a", parentId: "b", t: T, kind: "goto", target: null })).toThrow(
      /no parent/,
    );
    expect(() => newEvent({ id: "a", parentId: "a", t: T, kind: "host" })).toThrow(/own parent/);
  });

  it("round-trips through events.jsonl", () => {
    const { events, state } = story();
    const text = `${events.map(serializeEvent).join("\n")}\n\n`;
    expect(replay(parseLog(text)).head).toBe(state.head);
    expect(parseLog(text)).toEqual(events);
  });

  it("reports the line number of a bad log entry", () => {
    expect(() => parseLog('{"id":"a"}\n')).toThrow(/events line 1/);
    expect(() => parseLog("not json")).toThrow(/events line 1: not valid JSON/);
  });

  it("replays thousands of events in linear time", () => {
    const events: StoryEvent[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 6000; i++) {
      const e: StoryEvent = i % 2 ? host(parent) : player(parent);
      events.push(e);
      parent = e.id;
    }
    const start = performance.now();
    const state = replay(events);
    expect(turnsOf(state)).toHaveLength(6000);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
