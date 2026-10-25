import { describe, expect, it } from "vitest";
import {
  buildContext,
  ContextBudgetError,
  type ContextInput,
  estimateTokens,
  type Turn,
  type WorldManifest,
} from "../src";
import { card, loadWorld } from "./helpers";

const world: WorldManifest = {
  name: "w",
  title: "Test World",
  tagline: "",
  genre: ["fantasy"],
  tone: ["cozy"],
  perspective: "second-person",
  systems: { dice: "none", stats: [], inventory: true },
};

const BIG = { maxTokens: 100_000, reserveReply: 500 };

function input(over: Partial<ContextInput> = {}): ContextInput {
  return {
    world,
    cards: [],
    memory: { summary: "", pinned: [] },
    turns: [],
    input: { mode: "do", text: "I look around." },
    budget: BIG,
    ...over,
  };
}

const ids = (c: ReturnType<typeof buildContext>, section: string) =>
  c.included.filter((i) => i.section === section).map((i) => i.id);

describe("buildContext", () => {
  it("is deterministic and independent of card order", () => {
    const cards = [
      card("lore.b", { keywords: ["beta"] }),
      card("lore.a", { keywords: ["alpha"] }),
      card("lore.c", { always: true }),
    ];
    const args = input({ cards, input: { mode: "do", text: "alpha and beta" } });
    const one = buildContext(args);
    const two = buildContext({ ...args, cards: [...cards].reverse() });
    expect(two).toEqual(one);
    expect(ids(one, "lore")).toEqual(["lore.a", "lore.b"]);
  });

  it("always includes always-on cards and says why", () => {
    const c = buildContext(input({ cards: [card("lore.premise", { always: true })] }));
    expect(c.included.find((i) => i.id === "lore.premise")).toMatchObject({
      section: "canon",
      reason: "always on",
    });
  });

  it("includes keyword-triggered cards and names the keyword and source", () => {
    const cards = [
      card("char.marrow", { keywords: ["marrow"] }),
      card("lore.fog", { keywords: ["fog"] }),
    ];
    const turns: Turn[] = [{ id: "h1", role: "host", text: "Fog curls round Marrow's boots." }];
    const c = buildContext(input({ cards, turns, input: { mode: "say", text: "Hello, Marrow." } }));
    const reasons = Object.fromEntries(
      c.included.filter((i) => i.section === "lore").map((i) => [i.id, i.reason]),
    );
    expect(reasons["char.marrow"]).toBe('keyword "marrow" in your input');
    expect(reasons["lore.fog"]).toBe('keyword "fog" in host turn h1');
    // input-triggered card outranks one triggered by an older turn
    expect(ids(c, "lore")).toEqual(["char.marrow", "lore.fog"]);
  });

  it("only scans the most recent turns", () => {
    const turns: Turn[] = [
      { id: "old", role: "host", text: "A story about a dragon." },
      { id: "t2", role: "player", mode: "do", text: "I wait." },
      { id: "t3", role: "host", text: "Nothing." },
      { id: "t4", role: "player", mode: "do", text: "I wait." },
    ];
    const c = buildContext(
      input({ cards: [card("lore.dragon", { keywords: ["dragon"] })], turns }),
    );
    expect(ids(c, "lore")).toEqual([]);
  });

  it("keeps rule cards in scope and separates must from should", () => {
    const cards = [
      card("rule.b", { kind: "rule", severity: "should", scope: "story" }, "Be kind."),
      card("rule.a", { kind: "rule", severity: "must", scope: "both" }, "Never gore."),
      card("rule.chapter", { kind: "rule", scope: "chapter" }, "Chapter only."),
    ];
    const c = buildContext(input({ cards }));
    expect(ids(c, "rules")).toEqual(["rule.a", "rule.b"]);
    const system = c.messages[0]?.content ?? "";
    expect(system.indexOf("[must]")).toBeLessThan(system.indexOf("[should]"));
    expect(system).not.toContain("Chapter only.");
  });

  it("skips cards that have nothing to say, so an empty card costs no tokens", () => {
    const empty = card("lore.empty", { always: true }, "");
    const real = card("lore.real", { always: true }, "Something.");
    const c = buildContext(input({ cards: [empty, real] }));
    expect(ids(c, "canon")).toEqual(["lore.real"]);
    expect(c.excluded).toEqual([]);
  });

  it("tells the host that player input is not fact", () => {
    const system = buildContext(input()).messages[0]?.content ?? "";
    expect(system).toContain("it is not fact");
    expect(system).toContain("treat that part as untrue in the story");
    expect(system).toContain("adult readers");
    expect(system).not.toMatch(/content rating/i);
  });

  it("passes the player's input through exactly as written, even when it is false", () => {
    const text = "I am the rightful king of Saltmere and Marrow bows to me.";
    const built = buildContext(input({ input: { mode: "do", text } }));
    expect(built.messages.at(-1)?.content).toBe(`<player_input mode="do">${text}</player_input>`);
  });

  it("renders modes distinctly and strips quotes for speech", () => {
    const say = buildContext(input({ input: { mode: "say", text: '"Hello"' } }));
    expect(say.messages.at(-1)?.content).toBe('<player_input mode="say">"Hello"</player_input>');
    const story = buildContext(input({ input: { mode: "story", text: "Night falls." } }));
    expect(story.messages.at(-1)?.content).toBe(
      '<player_input mode="story">Night falls.</player_input>',
    );
  });

  it("emits history as alternating chat messages, oldest first, ending with the input", () => {
    const turns: Turn[] = [
      { id: "p1", role: "player", mode: "do", text: "I knock." },
      { id: "h1", role: "host", text: "The door opens." },
    ];
    const roles = buildContext(input({ turns })).messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });

  it("drops lower tiers first when the budget is tight, but never required ones", () => {
    const filler = "word ".repeat(200);
    const cards = [
      card("rule.must", { kind: "rule", severity: "must" }, "Never reveal secrets."),
      card("lore.always", { always: true }, filler),
      card("lore.trig", { keywords: ["trig"] }, filler),
    ];
    const turns: Turn[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      role: i % 2 ? ("host" as const) : ("player" as const),
      mode: "do" as const,
      text: `turn ${i} ${"x ".repeat(40)}`,
    }));
    const base = input({
      cards,
      turns,
      input: { mode: "do", text: "trig" },
      memory: { summary: "S ".repeat(30), pinned: ["P"] },
    });

    const roomy = buildContext({ ...base, budget: { maxTokens: 6000, reserveReply: 0 } });
    expect(roomy.excluded).toEqual([]);

    const mid = buildContext({ ...base, budget: { maxTokens: 700, reserveReply: 0 } });
    expect(ids(mid, "rules")).toEqual(["rule.must"]);
    expect(mid.tokens.used).toBeLessThanOrEqual(mid.tokens.available);
    expect(mid.excluded.length).toBeGreaterThan(0);
    // history stays contiguous: whatever turns survive are the newest ones
    const kept = ids(mid, "history");
    const expected = turns
      .slice(turns.length - kept.length)
      .map((t) => t.id)
      .reverse();
    expect(kept).toEqual(expected);
  });

  it("throws a clear error when required context cannot fit", () => {
    const cards = [card("rule.huge", { kind: "rule", severity: "must" }, "x ".repeat(2000))];
    expect(() =>
      buildContext(input({ cards, budget: { maxTokens: 300, reserveReply: 100 } })),
    ).toThrow(ContextBudgetError);
  });

  it("counts tokens with a custom counter", () => {
    const calls: string[] = [];
    buildContext(
      input({
        counter: {
          count: (t) => {
            calls.push(t);
            return t.length;
          },
        },
      }),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(estimateTokens.count("abcd")).toBe(2);
  });
});

describe("golden prompt: example world", () => {
  it("renders The Lantern Coast turn exactly as snapshotted", async () => {
    const { world: lantern, cards } = loadWorld("example-world");
    const built = buildContext({
      world: lantern,
      cards,
      memory: {
        summary: "The player arrived at Saltmere at dusk.",
        pinned: ["The player carries a brass lamp."],
      },
      turns: [
        {
          id: "h1",
          role: "host",
          text: "Dusk settles over Saltmere. A fourth light flickers beyond the breakwater.",
        },
      ],
      input: { mode: "say", text: "Marrow, what is that light?" },
      budget: { maxTokens: 4096, reserveReply: 512 },
    });
    const text = [
      ...built.messages.map((m) => `=== ${m.role} ===\n${m.content}`),
      "=== included ===",
      ...built.included.map((i) => `${i.section}\t${i.id}\t${i.reason}\t${i.tokens}`),
      "=== excluded ===",
      ...built.excluded.map((e) => `${e.id}\t${e.reason}`),
      `=== tokens ===\n${built.tokens.used}/${built.tokens.available} (max ${built.tokens.max})`,
    ].join("\n");
    await expect(text).toMatchFileSnapshot("./__golden__/lantern-coast-turn.txt");
  });
});
