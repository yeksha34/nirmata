import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildContext,
  formatPlayerInput,
  newEvent,
  renderTurn,
  replay,
  roundLines,
  turnsOf,
  undoEvent,
} from "../src";

const T = "2026-10-25T10:00:00Z";
const line = (id: string, parentId: string | null, by: string, round?: string) =>
  newEvent({
    id,
    parentId,
    t: T,
    kind: "player",
    mode: "do",
    text: `${by} acts`,
    by,
    ...(round ? { round } : {}),
  });
const host = (id: string, parentId: string | null) =>
  newEvent({ id, parentId, t: T, kind: "host", text: id.toUpperCase() });

/** h0, then a round of three lines (Sam, Robin, Kit) answered by h1, then a lone line answered by h2. */
function story() {
  return replay([
    host("h0", null),
    line("a", "h0", "Sam", "r1"),
    line("b", "a", "Robin", "r1"),
    line("c", "b", "Kit", "r1"),
    host("h1", "c"),
    newEvent({ id: "d", parentId: "h1", t: T, kind: "player", mode: "say", text: "alone" }),
    host("h2", "d"),
  ]);
}

describe("rounds", () => {
  it("find all the lines written together, oldest first", () => {
    const state = story();
    expect(roundLines(state, "c").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(roundLines(state, "b").map((e) => e.id)).toEqual(["a", "b"]);
    expect(roundLines(state, "d").map((e) => e.id)).toEqual(["d"]);
    expect(roundLines(state, "h1")).toEqual([]);
    expect(roundLines(state, "nope")).toEqual([]);
  });

  it("are taken back whole by undo", () => {
    const state = story();
    // undo the lone line: back to h1
    const once = applyEvent(state, undoEvent(state, "u1", T) as never);
    expect(turnsOf(once).at(-1)?.id).toBe("h1");
    // undo again: the whole round of three goes, back to h0
    const twice = applyEvent(once, undoEvent(once, "u2", T) as never);
    expect(turnsOf(twice).map((t) => t.id)).toEqual(["h0"]);
  });

  it("carry who wrote each line into the turns", () => {
    expect(turnsOf(story()).map((t) => t.by)).toEqual([
      undefined,
      "Sam",
      "Robin",
      "Kit",
      undefined,
      undefined,
      undefined,
    ]);
    expect(turnsOf(story())[1]?.round).toBe("r1");
  });
});

describe("attribution in prompts and chapters", () => {
  it("adds who wrote a line to the input tag, and leaves a solo line exactly as before", () => {
    expect(formatPlayerInput("do", "I knock.", "Sam")).toBe(
      '<player_input mode="do" by="Sam">I knock.</player_input>',
    );
    expect(formatPlayerInput("do", "I knock.")).toBe(
      '<player_input mode="do">I knock.</player_input>',
    );
    expect(formatPlayerInput("do", "x", 'Sa"m<>')).toBe(
      '<player_input mode="do" by="Sam">x</player_input>',
    );
  });

  it("puts each writer's line into the final message, in order, and into history", () => {
    const built = buildContext({
      world: {
        name: "w",
        title: "W",
        tagline: "",
        genre: [],
        tone: [],
        perspective: "second-person",
        systems: { dice: "none", stats: [], inventory: true },
      },
      cards: [],
      memory: { summary: "", pinned: [] },
      turns: [{ id: "t1", role: "player", mode: "do", text: "earlier", by: "Kit" }],
      input: [
        { mode: "do", text: "I knock.", by: "Sam" },
        { mode: "say", text: "Hello?", by: "Robin" },
      ],
      budget: { maxTokens: 4000, reserveReply: 300 },
    });
    expect(built.messages.at(-1)?.content).toBe(
      '<player_input mode="do" by="Sam">I knock.</player_input>\n<player_input mode="say" by="Robin">"Hello?"</player_input>',
    );
    expect(built.messages[1]?.content).toContain('by="Kit"');
  });

  it("names the writer in a chapter", () => {
    expect(renderTurn({ id: "a", role: "player", mode: "say", text: "Hi", by: "Robin" })).toBe(
      "> **Robin (Say):** Hi",
    );
    expect(renderTurn({ id: "a", role: "player", mode: "say", text: "Hi" })).toBe("> **Say:** Hi");
  });
});
