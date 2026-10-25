import { chaptersOf, contextTurnsOf, roundLines, turnsOf } from "@nirmata/core";
import type { FakeScript, GenerateRequest } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import { Board, defaultPlot } from "../src";
import { lastContent, pick, rig, run, systemContent, types } from "./helpers";

const reply = (...chunks: string[]): FakeScript => ({ chunks });
const isPlot = (req: GenerateRequest) =>
  systemContent(req).includes("plot log of an interactive story");

const round = [
  { by: "Sam", mode: "do" as const, text: "I knock on the door." },
  { by: "Robin", mode: "say" as const, text: "Let me do the talking." },
];

describe("several players, one reply", () => {
  it("saves each line as its own attributed turn, sharing a round, then writes one reply", async () => {
    const r = rig(reply("Marrow opens."));
    const events = await run(r.session.submitRound(round));

    expect(types(events)).toEqual([
      "begun",
      "player",
      "player",
      "context",
      "text",
      "reply",
      "done",
    ]);
    const [a, b, host] = r.sink.events;
    expect(a).toMatchObject({ kind: "player", by: "Sam", mode: "do", parentId: r.sink.begin?.id });
    expect(b).toMatchObject({ kind: "player", by: "Robin", mode: "say", parentId: a?.id });
    expect(a?.round).toBeDefined();
    expect(b?.round).toBe(a?.round);
    expect(host).toMatchObject({ kind: "host", parentId: b?.id });
    expect(r.provider.requests).toHaveLength(1);
  });

  it("shows the host every line, with who wrote it, and keeps the writers in history", async () => {
    const r = rig([reply("Marrow opens."), reply("The door creaks.")]);
    await run(r.session.submitRound(round));
    expect(lastContent(r.provider.requests[0])).toBe(
      '<player_input mode="do" by="Sam">I knock on the door.</player_input>\n' +
        '<player_input mode="say" by="Robin">"Let me do the talking."</player_input>',
    );
    await run(r.session.submit({ mode: "do", text: "I step inside.", by: "Sam" }));
    const history = r.provider.requests[1]?.messages.map((m) => m.content) ?? [];
    expect(history.join("\n")).toContain('by="Robin"');
    expect(turnsOf(r.session.state).map((t) => t.by)).toEqual([
      "Sam",
      "Robin",
      undefined,
      "Sam",
      undefined,
    ]);
  });

  it("matches keywords in any player's line", async () => {
    const r = rig(reply("ok"));
    const events = await run(
      r.session.submitRound([
        { by: "Sam", mode: "do", text: "I look at the sea." },
        { by: "Robin", mode: "say", text: "Where is Marrow?" },
      ]),
    );
    const included = pick(events, "context")[0]?.context.included.map((i) => i.id) ?? [];
    expect(included).toContain("char.marrow");
  });

  it("answers a one-line round exactly like a single submit, with no round tag", async () => {
    const r = rig(reply("ok"));
    await run(r.session.submitRound([{ by: "Sam", mode: "do", text: "Alone." }]));
    expect(r.sink.events[0]?.round).toBeUndefined();
    expect(r.sink.events[0]?.by).toBe("Sam");
  });

  it("skips empty lines and refuses a round with nothing in it", async () => {
    const r = rig(reply("ok"));
    const events = await run(
      r.session.submitRound([
        { by: "Sam", mode: "do", text: "   " },
        { by: "Robin", mode: "do", text: "I wave." },
      ]),
    );
    expect(r.sink.events.filter((e) => e.kind === "player")).toHaveLength(1);
    expect(pick(events, "reply")).toHaveLength(1);
    const none = await run(r.session.submitRound([{ by: "Sam", mode: "do", text: " " }]));
    expect(pick(none, "error")[0]?.code).toBe("nothing_to_do");
  });

  it("treats the whole round as one turn for undo", async () => {
    const r = rig([reply("Opening."), reply("A reply.")]);
    await run(r.session.start());
    await run(r.session.submitRound(round));
    expect(roundLines(r.session.state, r.sink.events[2]?.id as string)).toHaveLength(2);

    expect(await r.session.undo()).toBe(true);
    expect(r.session.turns.map((t) => t.text)).toEqual(["Opening."]); // both lines and the reply are gone
  });

  it("answers every line again on retry, including when the reply failed", async () => {
    const r = rig([reply("First."), reply("Second.")]);
    await run(r.session.submitRound(round));
    await run(r.session.retry());
    const retried = r.provider.requests[1] as GenerateRequest;
    expect(lastContent(retried)).toContain('by="Sam"');
    expect(lastContent(retried)).toContain('by="Robin"');
    expect(r.session.turns.map((t) => t.text).slice(-3)).toEqual([
      "I knock on the door.",
      "Let me do the talking.",
      "Second.",
    ]);
  });

  it("recovers a failed reply to a round by retrying the whole round", async () => {
    const r = rig([
      { error: new (await import("@nirmata/llm")).LlmError("server", "down") },
      reply("Better."),
    ]);
    const failed = await run(r.session.submitRound(round));
    expect(pick(failed, "error")).toHaveLength(1);
    const recovered = await run(r.session.retry());
    expect(pick(recovered, "reply")).toHaveLength(1);
    expect(lastContent(r.provider.requests[1])).toContain('by="Robin"');
  });

  it("writes who said what into the chapter once the window shifts past it", async () => {
    const filler = "w ".repeat(100);
    const r = rig((req) => reply(`Reply ${lastContent(req).length} ${filler}`), {
      settings: { budget: { maxTokens: 700, reserveReply: 100 } },
    });
    for (let i = 0; i < 6; i++) {
      await run(r.session.submitRound(round.map((l) => ({ ...l, text: `${l.text} (${i})` }))));
    }
    const text = chaptersOf(r.session.state)[0]?.text ?? "";
    expect(text).toContain("> **Sam (Do):** I knock on the door. (0)");
    expect(text).toContain("> **Robin (Say):** Let me do the talking. (0)");
    expect(contextTurnsOf(r.session.state).length).toBeLessThan(r.session.turns.length);
  });

  it("counts a round as one turn for the plot trigger and shows the extractor who wrote what", async () => {
    const script = (req: GenerateRequest): FakeScript =>
      isPlot(req) ? reply('{"points":[]}') : reply("ok");
    const r = rig(script, { settings: { plot: { ...defaultPlot, everyPlayerTurns: 2 } } });
    await run(r.session.submitRound(round)); // three lines would be 2+ if counted per line
    expect(r.provider.requests.some(isPlot)).toBe(false);
    await run(r.session.submitRound(round));
    const call = r.provider.requests.find(isPlot) as GenerateRequest;
    expect(lastContent(call)).toContain("Player Sam (do): I knock on the door.");
    expect(lastContent(call)).toContain("Player Robin (say): Let me do the talking.");
  });
});

describe("the board feeding the story", () => {
  it("runs a full round: write, object, revise, ready, submit, then the board is empty", async () => {
    const r = rig(reply("The door swings wide."));
    const board = new Board({
      host: "Dana",
      ports: { newId: () => crypto.randomUUID(), now: () => "t" },
      requireAdultConfirmation: false,
    });
    for (const nick of ["Sam", "Robin"]) {
      board.join(nick);
      board.play(nick);
    }
    board.setDraft("Sam", "do", "I kick the door in.");
    board.object("Robin", "Sam", "Marrow sleeps behind it.");
    board.setDraft("Sam", "do", "I knock softly on the door.");
    board.setDraft("Robin", "say", "Marrow? It's us.");
    board.ready("Sam");
    expect(board.takeRound()).toBeUndefined();
    board.ready("Robin");

    const lines = board.takeRound();
    board.setBusy(true);
    expect(lines).toEqual([
      { by: "Sam", mode: "do", text: "I knock softly on the door." },
      { by: "Robin", mode: "say", text: "Marrow? It's us." },
    ]);
    const events = await run(r.session.submitRound(lines ?? []));
    board.setBusy(false);

    expect(pick(events, "reply")).toHaveLength(1);
    expect(board.view().drafts).toEqual([]);
    expect(board.view().remarks).toEqual([]);
  });
});
