import type { Turn } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import {
  buildCardUpdates,
  type CompactionRecord,
  chapterMessages,
  HostError,
  parseChapter,
  parseRecord,
  planSegment,
} from "../src";

const turns = (roles: string): Turn[] =>
  [...roles].map((r, i) => ({
    id: `t${i + 1}`,
    role: r === "P" ? ("player" as const) : ("host" as const),
    ...(r === "P" ? { mode: "do" as const } : {}),
    text: `text ${i + 1}`,
  }));

describe("planSegment", () => {
  it("keeps the newest turns and starts the kept tail at a player action", () => {
    // H P H P H P H  -> keepRecent 2 would cut before "H P"; the tail must start at a player turn
    const t = turns("PHPHPH");
    const plan = planSegment(t, 2, 2);
    expect(plan?.turns.map((x) => x.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(plan?.covers).toBe("t4");
  });

  it("moves the cut back rather than splitting an action from its reply", () => {
    const t = turns("PHPHPHP"); // keepRecent 3 -> index 4 is "P"? length 7, start at 4 = 'P'
    expect(planSegment(t, 3, 2)?.covers).toBe("t4");
    const odd = turns("PHPHPH");
    expect(planSegment(odd, 3, 2)?.covers).toBe("t2"); // index 3 is a host turn, step back to the player at 2
  });

  it("returns nothing when too little would be compacted", () => {
    expect(planSegment(turns("PHPH"), 2, 4)).toBeUndefined();
    expect(planSegment(turns("PH"), 4, 2)).toBeUndefined();
    expect(planSegment([], 2, 2)).toBeUndefined();
  });
});

describe("parseChapter", () => {
  const prose = "Marrow opened the door and the traveller stepped into the lamplight.";

  it("reads a Title line and the prose after it", () => {
    expect(parseChapter(`Title: The Harbour Door\n\n${prose}`, 1)).toEqual({
      title: "The Harbour Door",
      text: prose,
    });
    expect(parseChapter(`**Title:** "A Light Beyond"\n${prose}`, 2).title).toBe("A Light Beyond");
  });

  it("falls back to Chapter N when no title is given", () => {
    expect(parseChapter(prose, 3)).toEqual({ title: "Chapter 3", text: prose });
  });

  it("rejects an empty chapter", () => {
    expect(() => parseChapter("Title: Nothing\n\n", 1)).toThrow(HostError);
  });
});

describe("chapterMessages", () => {
  it("asks for a length in proportion to the story, within bounds", () => {
    const small = chapterMessages(turns("PH"), "")[0]?.content ?? "";
    expect(small).toContain("about 150 words");
    const big = chapterMessages([{ id: "x", role: "host", text: "word ".repeat(5000) }], "")[0]
      ?.content;
    expect(big).toContain("about 700 words");
  });

  it("includes the previous chapter's ending for continuity", () => {
    const user = chapterMessages(turns("PH"), "...and the door closed.")[1]?.content ?? "";
    expect(user).toContain("<previous_chapter_ending>\n...and the door closed.");
    expect(user).toContain("Player (do): text 1");
  });
});

describe("parseRecord", () => {
  it("reads a complete record", () => {
    const record = parseRecord(
      JSON.stringify({
        scene: {
          title: "T",
          location: "Quay",
          time: "dusk",
          participants: ["Marrow"],
          keywords: ["door"],
          events: "E.",
          outcome: "O.",
        },
        state: [{ name: "Marrow", entity: "character", keywords: ["keeper"], status: "Wary." }],
        now: {
          location: "Quay",
          time: "dusk",
          present: ["Marrow"],
          goals: ["Find it"],
          open_threads: ["Who?"],
        },
      }),
    );
    expect(record.scene.title).toBe("T");
    expect(record.state).toEqual([
      { name: "Marrow", entity: "character", keywords: ["keeper"], status: "Wary." },
    ]);
    expect(record.now.openThreads).toEqual(["Who?"]);
  });

  it("is forgiving about missing fields, comma-separated lists and array statuses", () => {
    const record = parseRecord(
      'Sure!\n```json\n{"scene":{"keywords":"door, quay"},"state":[{"name":"Lamp","status":["Lit","Brass"]},{"name":"","status":"x"},{"name":"NoStatus"}]}\n```',
    );
    expect(record.scene.keywords).toEqual(["door", "quay"]);
    expect(record.state).toEqual([
      { name: "Lamp", entity: "other", keywords: [], status: "Lit\nBrass" },
    ]);
    expect(record.now.present).toEqual([]);
  });

  it("throws only when there is no readable JSON", () => {
    expect(() => parseRecord("I could not do that.")).toThrow(HostError);
    expect(() => parseRecord("{broken")).toThrow(HostError);
  });
});

describe("buildCardUpdates", () => {
  const base: CompactionRecord = {
    scene: {
      title: "",
      location: "Quay",
      time: "dusk",
      participants: ["Marrow"],
      keywords: ["Door"],
      events: "Marrow opened it.",
      outcome: "Entry gained.",
    },
    state: [
      {
        name: "Marrow",
        entity: "character",
        keywords: ["keeper"],
        status: "Wary\n- Holds the key",
      },
      {
        name: "Now",
        entity: "other",
        keywords: [],
        status: "ignored: would collide with state.now",
      },
    ],
    now: {
      location: "Quay",
      time: "dusk",
      present: ["Marrow"],
      goals: ["Find the light"],
      openThreads: [],
    },
  };

  it("makes a scene card, state cards and the always-on current situation", () => {
    const cards = buildCardUpdates(base, { number: 2, title: "The Door" });
    expect(cards.map((c) => c.id)).toEqual(["scene.ch-02", "state.marrow", "state.now"]);

    const [scene, marrow, now] = cards;
    expect(scene).toMatchObject({
      kind: "scene",
      name: "The Door",
      always: false,
      summary: "Entry gained.",
    });
    expect(scene?.keywords).toEqual(["door", "marrow", "quay"]);
    expect(scene?.body).toContain("- **Where:** Quay");
    expect(scene?.body).toContain("- **Chapter 2:** The Door");

    expect(marrow).toMatchObject({
      name: "Marrow (now)",
      entity: "character",
      always: false,
      summary: "Wary",
    });
    expect(marrow?.keywords).toEqual(["marrow", "keeper"]);
    expect(marrow?.body).toBe("- Wary\n- Holds the key");

    expect(now).toMatchObject({
      id: "state.now",
      always: true,
      name: "Current situation",
      keywords: [],
    });
    expect(now?.body).toContain("- **Goals:** Find the light");
  });

  it("skips empty sections and caps the number of state cards", () => {
    const empty: CompactionRecord = {
      scene: {
        title: "",
        location: "",
        time: "",
        participants: [],
        keywords: [],
        events: "",
        outcome: "",
      },
      state: Array.from({ length: 12 }, (_, i) => ({
        name: `Thing ${i}`,
        entity: "item",
        keywords: [],
        status: "ok",
      })),
      now: { location: "", time: "", present: [], goals: [], openThreads: [] },
    };
    const cards = buildCardUpdates(empty, { number: 1, title: "X" });
    expect(cards.every((c) => c.kind === "state")).toBe(true);
    expect(cards).toHaveLength(8);
    expect(cards.some((c) => c.id === "state.now")).toBe(false);
  });
});
