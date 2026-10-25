import { contextTurnsOf, plotCursor, plotPointsOf, projectStory } from "@nirmata/core";
import { type FakeScript, type GenerateRequest, LlmError } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import { defaultPlot, HostError } from "../src";
import { lastContent, pick, rig, run, systemContent, types } from "./helpers";

const isPlot = (req: GenerateRequest) =>
  systemContent(req).includes("plot log of an interactive story");

const POINTS = JSON.stringify({
  points: [
    { card: "char.marrow", text: "Marrow opened the harbour door." },
    { card: "arc.fourth-light", text: "The fourth light was seen from the quay." },
    { card: "unknown.card", text: "This card does not exist." },
  ],
});

interface Plan {
  /** Answers to successive plot calls; the last repeats. */
  plot?: FakeScript[];
}

function script(plan: Plan = {}) {
  const answers = plan.plot ?? [{ chunks: [POINTS] }];
  let calls = 0;
  return (req: GenerateRequest): FakeScript =>
    isPlot(req)
      ? (answers[Math.min(calls++, answers.length - 1)] as FakeScript)
      : { chunks: [`Reply to: ${lastContent(req)}`] };
}

const plot = (over: Partial<typeof defaultPlot> = {}) => ({
  ...defaultPlot,
  everyPlayerTurns: 2,
  ...over,
});

async function play(r: ReturnType<typeof rig>, n: number, from = 1) {
  const rounds = [];
  for (let i = from; i < from + n; i++) {
    rounds.push(await run(r.session.submit({ mode: "do", text: `I talk to Marrow, step ${i}` })));
  }
  return rounds;
}

describe("extracting plot points", () => {
  it("reads the recent turns every few player turns and saves the points for known cards", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    const rounds = await play(r, 2);

    expect(types(rounds[0] ?? [])).not.toContain("plotting");
    const second = rounds[1] ?? [];
    expect(types(second)).toEqual([
      "player",
      "context",
      "text",
      "reply",
      "plotting",
      "plot",
      "done",
    ]);
    expect(pick(second, "plotting")[0]?.turns).toBe(4);

    const saved = pick(second, "plot")[0];
    expect(saved?.points.map((p) => [p.card, p.text])).toEqual([
      ["char.marrow", "Marrow opened the harbour door."],
      ["arc.fourth-light", "The fourth light was seen from the quay."],
    ]); // the unknown card was dropped
    const lastHost = r.sink.events.filter((e) => e.kind === "host").at(-1);
    expect(saved?.event).toMatchObject({ kind: "plot", covers: lastHost?.id });
    expect(r.session.plotPoints).toHaveLength(2);
  });

  it("shows a card's points under it in later prompts, whenever the card is recalled", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2);
    await run(r.session.submit({ mode: "say", text: "Marrow, what about the door?" }));

    const req = r.provider.requests.filter((q) => !isPlot(q)).at(-1);
    const system = systemContent(req);
    expect(system).toContain("**What has happened so far:**\n- Marrow opened the harbour door.");
    expect(system).not.toContain("fourth light was seen"); // that point belongs to a card not recalled
    expect(system).toContain("Marrow lit the fourth light himself"); // host-only secrets still reach the host
  });

  it("shows the extractor only the transcript and card names, never secrets or summaries", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2);
    const call = r.provider.requests.find(isPlot) as GenerateRequest;
    const everything = JSON.stringify(call.messages);
    expect(everything).toContain("- char.marrow: Marrow (character)");
    expect(everything).toContain("I talk to Marrow, step 1");
    expect(everything).not.toContain("lit the fourth light himself");
    expect(everything).not.toContain("Gruff keeper");
  });

  it("does not repeat what it already knows, and tells the extractor", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 4);
    const calls = r.provider.requests.filter(isPlot);
    expect(calls).toHaveLength(2);
    expect(lastContent(calls[0])).toContain("<known_points>\n(none)");
    expect(lastContent(calls[1])).toContain("- char.marrow: Marrow opened the harbour door.");
    // the model repeated itself the second time; nothing was added twice
    expect(r.session.plotPoints).toHaveLength(2);
  });

  it("only reads turns it has not read before", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 4);
    const second = r.provider.requests.filter(isPlot)[1];
    expect(lastContent(second)).not.toContain("step 1");
    expect(lastContent(second)).toContain("step 3");
  });

  it("can be asked for right now", async () => {
    const r = rig(script(), { settings: { plot: plot({ everyPlayerTurns: 99 }) } });
    await play(r, 1);
    expect(r.provider.requests.some(isPlot)).toBe(false);
    const events = await run(r.session.plot());
    expect(types(events)).toEqual(["plotting", "plot", "done"]);
    expect(r.session.plotPoints).toHaveLength(2);
  });

  it("does nothing when disabled, and says so when asked with nothing new to read", async () => {
    const off = rig(script(), { settings: { plot: plot({ enabled: false }) } });
    await play(off, 4);
    expect(off.provider.requests.some(isPlot)).toBe(false);

    const empty = rig(script());
    expect(pick(await run(empty.session.plot()), "warning")[0]?.message).toMatch(
      /nothing new to read/,
    );
  });

  it("always offers the current-situation card, even when the story mentions no other card", async () => {
    const r = rig(script(), {
      settings: { plot: plot() },
      filterCards: (c) => c.fm.kind === "rule",
    });
    await run(r.session.submit({ mode: "do", text: "I wait." }));
    await run(r.session.submit({ mode: "do", text: "I wait some more." }));
    const user = lastContent(r.provider.requests.find(isPlot));
    expect(user).toContain("- lore.current-situation: Current situation (lore)");
    expect(user.match(/^- [a-z]+\.[a-z-]+:/gm)).toHaveLength(1);
  });

  it("uses a separate model when configured", async () => {
    const r = rig(script(), { settings: { plot: plot({ model: "cheap-model" }) } });
    await play(r, 2);
    expect(r.provider.requests.find(isPlot)?.model).toBe("cheap-model");
    expect(r.sink.events.find((e) => e.kind === "plot")?.model).toBe("cheap-model");
  });
});

describe("plot extraction never breaks play", () => {
  const down = new LlmError("server", "The model had a problem on its side.");

  for (const [name, answer] of [
    ["the model is down", { error: down }],
    ["the answer is not JSON", { chunks: ["I could not find anything."] }],
    ["the answer has no points list", { chunks: ['{"other":1}'] }],
  ] as Array<[string, FakeScript]>) {
    it(`warns and tries the same turns again when ${name}`, async () => {
      const r = rig(script({ plot: [answer, { chunks: [POINTS] }] }), {
        settings: { plot: plot() },
      });
      const [, second, third] = await play(r, 3);
      expect(pick(second ?? [], "reply")).toHaveLength(1);
      expect(pick(second ?? [], "warning")[0]?.message).toMatch(
        /Plot points could not be updated this time/,
      );
      expect(r.sink.events.filter((e) => e.kind === "plot")).toHaveLength(
        r.session.plotPoints.length ? 1 : 0,
      );
      // third turn: due again, this time it succeeds and reads all the unread turns
      expect(pick(third ?? [], "plot")).toHaveLength(1);
      expect(lastContent(r.provider.requests.filter(isPlot)[1])).toContain("step 1");
    });
  }

  it("stops quietly when the caller aborts while plotting", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 1);
    const controller = new AbortController();
    const events = [];
    for await (const ev of r.session.submit(
      { mode: "do", text: "I talk to Marrow, step 2" },
      controller.signal,
    )) {
      events.push(ev);
      if (ev.type === "reply") controller.abort();
    }
    expect(types(events)).toContain("plotting");
    expect(pick(events, "plot")).toEqual([]);
    expect(pick(events, "warning")).toEqual([]);
  });
});

describe("undoing plot points", () => {
  it("undoing the turn removes the points it produced, and moving forward again restores them", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2);
    const plotId = r.sink.events.find((e) => e.kind === "plot")?.id as string;
    expect(r.session.plotPoints).toHaveLength(2);

    await r.session.undo();
    expect(r.session.plotPoints).toEqual([]);
    expect(plotCursor(r.session.state)).toBeNull();

    await r.session.goto(plotId);
    expect(r.session.plotPoints).toHaveLength(2);
  });

  it("retrying the reply that triggered the extraction discards its points, then reads again", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2);
    const events = await run(r.session.retry());
    expect(pick(events, "plot")).toHaveLength(1);
    expect(r.sink.events.filter((e) => e.kind === "plot")).toHaveLength(2);
    expect(r.session.plotPoints).toHaveLength(2);
  });

  it("revokes a single point without touching the story or the extraction cursor", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2);
    const [first, second] = r.session.plotPoints;
    const cursor = plotCursor(r.session.state);

    await r.session.revokePlotPoint(first?.id as string);
    expect(r.session.plotPoints.map((p) => p.id)).toEqual([second?.id]);
    expect(plotCursor(r.session.state)).toBe(cursor);
    expect(r.session.turns).toHaveLength(4);

    await run(r.session.submit({ mode: "say", text: "Marrow, the door?" }));
    const system = systemContent(r.provider.requests.filter((q) => !isPlot(q)).at(-1));
    expect(system).not.toContain("Marrow opened the harbour door.");

    await expect(r.session.revokePlotPoint("nope:0")).rejects.toBeInstanceOf(HostError);
  });

  it("undoes the newest batch, then the one before, then reports nothing left", async () => {
    const r = rig(
      script({
        plot: [
          { chunks: [POINTS] },
          {
            chunks: [
              JSON.stringify({
                points: [{ card: "char.marrow", text: "Marrow trusted the player." }],
              }),
            ],
          },
        ],
      }),
      {
        settings: { plot: plot() },
      },
    );
    await play(r, 4);
    expect(r.session.plotPoints).toHaveLength(3);

    expect(await r.session.undoLastPlot()).toBe(true);
    expect(r.session.plotPoints.map((p) => p.text)).toEqual([
      "Marrow opened the harbour door.",
      "The fourth light was seen from the quay.",
    ]);
    expect(await r.session.undoLastPlot()).toBe(true);
    expect(r.session.plotPoints).toEqual([]);
    expect(await r.session.undoLastPlot()).toBe(false);
  });

  it("undoing a turn also undoes a revoke made after it, so the point comes back (time travel)", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2); // the plot event lands after turn 2
    await run(r.session.submit({ mode: "do", text: "I talk to Marrow, step 3" }));
    const first = r.session.plotPoints[0];
    await r.session.revokePlotPoint(first?.id as string);
    expect(r.session.plotPoints).toHaveLength(1);

    await r.session.undo(); // takes back turn 3 and the revoke that followed it
    expect(r.session.plotPoints.map((p) => p.id)).toContain(first?.id);
    expect(r.session.plotPoints).toHaveLength(2);
  });
});

describe("adding plot points by hand", () => {
  it("attaches a point to a card without moving the extraction cursor", async () => {
    const r = rig(script(), { settings: { plot: plot({ enabled: false }) } });
    await play(r, 1);
    await r.session.addPlotPoint("place.saltmere", " The player named the quay. ");
    expect(r.session.plotPoints).toMatchObject([
      { card: "place.saltmere", text: "The player named the quay." },
    ]);
    expect(plotCursor(r.session.state)).toBeNull();

    await run(r.session.submit({ mode: "do", text: "I walk along the docks of saltmere." }));
    expect(systemContent(r.provider.requests.at(-1))).toContain("- The player named the quay.");
  });

  it("rejects unknown cards, rules, empty text, and an empty story", async () => {
    const r = rig(script());
    await expect(r.session.addPlotPoint("char.marrow", "x")).rejects.toMatchObject({
      code: "nothing_to_do",
    }); // nothing has happened yet
    await play(r, 1);
    await expect(r.session.addPlotPoint("nope.card", "x")).rejects.toThrow(/no card "nope.card"/);
    await expect(r.session.addPlotPoint("rule.host-tone", "x")).rejects.toThrow(/no card/);
    await expect(r.session.addPlotPoint("char.marrow", "  ")).rejects.toThrow(
      /Write what happened/,
    );
  });

  it("is refused while a turn is running", async () => {
    const r = rig(script());
    const running = r.session.submit({ mode: "do", text: "go" });
    await running.next();
    await expect(r.session.addPlotPoint("char.marrow", "x")).rejects.toMatchObject({
      code: "busy",
    });
    await expect(r.session.undoLastPlot()).rejects.toMatchObject({ code: "busy" });
    for await (const _ of running) {
      // drain
    }
  });
});

describe("plot files", () => {
  it("projects a file per card and drops revoked points", async () => {
    const r = rig(script(), { settings: { plot: plot() } });
    await play(r, 2);
    const names = new Map([["char.marrow", "Marrow"]]);
    const files = projectStory(r.session.state, { cardNames: names });
    expect(files.map((f) => f.path)).toEqual(["plot/arc.fourth-light.md", "plot/char.marrow.md"]);

    await r.session.undoLastPlot();
    expect(projectStory(r.session.state)).toEqual([]);
    expect(plotPointsOf(r.session.state)).toEqual([]);
    expect(contextTurnsOf(r.session.state).length).toBe(4); // the story itself is untouched
  });
});
