import { describe, expect, it } from "vitest";
import {
  type Action,
  initialState,
  reducer,
  type State,
  screenFor,
  visibleTurns,
  waitingFor,
} from "../src/store";
import type { BoardMessage, Snapshot, StoryView, TurnView } from "../src/types";

const board = (over: Partial<BoardMessage> = {}): BoardMessage => ({
  host: "Dana",
  participants: [
    { nick: "Dana", seat: "host", muted: false },
    { nick: "Sam", seat: "player", muted: false },
  ],
  drafts: [],
  remarks: [],
  notices: [],
  busy: false,
  closed: false,
  online: ["Dana", "Sam"],
  ...over,
});

const turn = (id: string, role: "player" | "host", text: string, by?: string): TurnView => ({
  id,
  role,
  text,
  ...(by ? { by } : {}),
});

const story = (turns: TurnView[]): StoryView => ({
  id: "s1",
  started: true,
  busy: false,
  turns,
  chapters: [],
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  you: { nick: "Sam", seat: "player", muted: false, host: false },
  world: { name: "w", title: "W", tagline: "" },
  board: board(),
  story: null,
  ...over,
});

const apply = (actions: Action[], from: State = initialState) => actions.reduce(reducer, from);

describe("the snapshot", () => {
  it("replaces everything the connection knew and marks it live", () => {
    const state = apply([
      { type: "story", event: { type: "text", text: "half a sent" } },
      { type: "snapshot", snapshot: snapshot({ story: story([turn("a", "host", "Hi")]) }) },
    ]);
    expect(state.connection).toBe("live");
    expect(state.streaming).toBeNull();
    expect(state.story?.turns).toHaveLength(1);
    expect(state.you?.nick).toBe("Sam");
  });
});

describe("a reply arriving", () => {
  it("builds up the streamed text, and starts again when the reply is rewritten", () => {
    const state = apply([
      { type: "story", event: { type: "text", text: "The lamp " } },
      { type: "story", event: { type: "text", text: "gutters." } },
    ]);
    expect(state.streaming).toBe("The lamp gutters.");
    expect(reducer(state, { type: "story", event: { type: "attempt", n: 2 } }).streaming).toBe("");
  });

  it("shows the lines saved so far until the story's own list arrives, then no duplicates", () => {
    const line = turn("p1", "player", "I knock.", "Sam");
    const reply = turn("h1", "host", "The door opens.");
    const during = apply([
      { type: "snapshot", snapshot: snapshot({ story: story([]) }) },
      { type: "story", event: { type: "player", turn: line } },
      { type: "story", event: { type: "text", text: "The door" } },
    ]);
    expect(visibleTurns(during).map((t) => t.id)).toEqual(["p1"]);
    expect(during.streaming).toBe("The door");

    const replied = reducer(during, {
      type: "story",
      event: { type: "reply", turn: reply, finishReason: "stop" },
    });
    expect(visibleTurns(replied).map((t) => t.id)).toEqual(["p1", "h1"]);
    expect(replied.streaming).toBeNull();

    const settled = reducer(replied, {
      type: "story-view",
      story: story([line, reply]),
    });
    expect(visibleTurns(settled).map((t) => t.id)).toEqual(["p1", "h1"]);
    expect(settled.pending).toEqual([]);
  });

  it("drops the half-written text when the host stops it or it fails, and says why once", () => {
    const writing = apply([{ type: "story", event: { type: "text", text: "Half" } }]);
    expect(reducer(writing, { type: "story", event: { type: "stopped" } }).streaming).toBeNull();

    const failed = apply(
      [
        {
          type: "story",
          event: { type: "error", message: "The model is busy.", code: "x", recoverable: true },
        },
        {
          type: "story",
          event: { type: "error", message: "The model is busy.", code: "x", recoverable: true },
        },
      ],
      writing,
    );
    expect(failed.streaming).toBeNull();
    expect(failed.notices.map((n) => n.text)).toEqual(["The model is busy."]);
  });

  it("keeps host-only findings apart from the story", () => {
    const state = apply([
      { type: "story", event: { type: "warning", message: "judge offline" } },
      { type: "story", event: { type: "warning", message: "judge offline" } },
      {
        type: "story",
        event: {
          type: "rule-violation",
          violations: [{ name: "No dragons", reason: "One appeared." }],
          willRetry: true,
        },
      },
    ]);
    expect(state.warnings).toEqual([
      "judge offline",
      "A reply broke a rule (No dragons: One appeared.).",
    ]);
    expect(state.notices).toEqual([]);
  });
});

describe("the board", () => {
  it("follows renames and mutes into what this person is told about themselves", () => {
    const state = apply([
      { type: "snapshot", snapshot: snapshot() },
      {
        type: "board",
        board: board({
          participants: [
            { nick: "Dana", seat: "host", muted: false },
            { nick: "Sam", seat: "player", muted: true },
          ],
        }),
      },
    ]);
    expect(state.you?.muted).toBe(true);
  });

  it("lists who a round is waiting for", () => {
    const b = board({
      drafts: [
        { nick: "Sam", mode: "do", text: "x", ready: true, objections: 0 },
        { nick: "Robin", mode: "say", text: "y", ready: false, objections: 1 },
      ],
    });
    expect(waitingFor(b)).toEqual(["Robin"]);
    expect(waitingFor(undefined)).toEqual([]);
  });
});

describe("notices", () => {
  it("keeps only the latest few, and can be dismissed", () => {
    let state: State = initialState;
    for (let i = 0; i < 6; i++)
      state = reducer(state, { type: "notice", kind: "info", text: `n${i}` });
    expect(state.notices.map((n) => n.text)).toEqual(["n2", "n3", "n4", "n5"]);
    const first = state.notices[0];
    expect(reducer(state, { type: "dismiss", id: first?.id ?? 0 }).notices).toHaveLength(3);
  });
});

describe("being sent away", () => {
  it("forgets who you were and keeps the message", () => {
    const state = apply([
      { type: "snapshot", snapshot: snapshot() },
      { type: "kicked", message: "You were sent away from the table." },
    ]);
    expect(state.you).toBeUndefined();
    expect(state.kicked).toContain("sent away");
  });
});

describe("which screen", () => {
  const host = { nick: "Dana", seat: "host" as const, muted: false, host: true };
  const player = { nick: "Sam", seat: "player" as const, muted: false, host: false };

  it("gives the host the worlds page, with or without a story, which floats over it", () => {
    expect(screenFor({ ...initialState, you: host })).toBe("worlds");
    expect(
      screenFor({ ...initialState, you: host, world: { name: "w", title: "W", tagline: "" } }),
    ).toBe("worlds");
    expect(screenFor({ ...initialState, you: host, story: story([]) })).toBe("worlds");
  });

  it("keeps everyone else on the waiting page behind the story window", () => {
    const world = { name: "w", title: "W", tagline: "" };
    expect(screenFor({ ...initialState, you: player, world, story: story([]) })).toBe(
      "waiting-story",
    );
  });

  it("makes everyone else wait, saying what for", () => {
    expect(screenFor({ ...initialState, you: player })).toBe("waiting-world");
    expect(
      screenFor({ ...initialState, you: player, world: { name: "w", title: "W", tagline: "" } }),
    ).toBe("waiting-story");
  });
});
