import { type Actor, plotPointsOf } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { defaultPlot, type RuleJudge } from "../src";
import { lastContent, pick, rig, ruleCard, run, systemContent, types } from "./helpers";

const reply = (...chunks: string[]) => ({ chunks });
const player: Actor = { id: "guest", role: "player" };

describe("a story begins by duplicating the source cards", () => {
  it("saves a `begin` event, first, holding a copy of every source card", async () => {
    const r = rig(reply("Dusk."));
    const events = await run(r.session.start());

    expect(types(events).slice(0, 2)).toEqual(["begun", "context"]);
    expect(r.sink.all[0]).toBe(r.sink.begin);
    expect(r.sink.begin).toMatchObject({ kind: "begin", parentId: null });
    expect(r.sink.begin?.world?.name).toBe("example-world");
    expect(r.sink.begin?.cards.map((c) => c.fm.id).sort()).toEqual(
      [...r.cards.map((c) => c.fm.id), "lore.current-situation"].sort(),
    );
    // the opening scene grows from the copy
    expect(r.sink.events[0]?.parentId).toBe(r.sink.begin?.id);
  });

  it("begins lazily when the host acts before calling start", async () => {
    const r = rig(reply("ok"));
    const events = await run(r.session.submit({ mode: "do", text: "look" }));
    expect(types(events)[0]).toBe("begun");
    expect(r.sink.all.map((e) => e.kind)).toEqual(["begin", "player", "host"]);
  });

  it("plays on the copy: editing the source afterwards changes nothing in the story", async () => {
    const r = rig([reply("Opening."), reply("Marrow answers.")]);
    await run(r.session.start());

    // someone edits the source cards after the story began
    const marrow = r.cards.find((c) => c.fm.id === "char.marrow");
    if (marrow) marrow.body = "# Marrow\n\nREWRITTEN IN THE SOURCE.";
    r.cards.splice(0, r.cards.length, ...r.cards.filter((c) => c.fm.id !== "lore.the-fog"));

    await run(r.session.submit({ mode: "say", text: "Marrow, tell me about the fog." }));
    const system = systemContent(r.provider.requests.at(-1));
    expect(system).toContain("lamp-blind eye"); // the original text, from the copy
    expect(system).not.toContain("REWRITTEN IN THE SOURCE");
    expect(system).toContain("repeats the last thing said aloud"); // the card removed from the source is still there
  });

  it("gives a second story the source as it is then, independent of the first", async () => {
    const first = rig(reply("One."));
    await run(first.session.start());
    const marrow = first.cards.find((c) => c.fm.id === "char.marrow");
    if (marrow) marrow.body = "# Marrow\n\nEDITED BEFORE THE SECOND STORY.";

    // a second story from the (now edited) source
    const second = rig(reply("Two."));
    const copy = second.cards.find((c) => c.fm.id === "char.marrow");
    if (copy && marrow) copy.body = marrow.body;
    await run(second.session.submit({ mode: "say", text: "Marrow?" }));

    expect(systemContent(second.provider.requests[0])).toContain("EDITED BEFORE THE SECOND");
    await run(first.session.submit({ mode: "say", text: "Marrow?" }));
    expect(systemContent(first.provider.requests.at(-1))).not.toContain("EDITED BEFORE THE SECOND");
  });

  it("uses the copy for rule checking and plot points too", async () => {
    let seen: string[] = [];
    const judge: RuleJudge = async ({ rules }) => {
      seen = rules.map((x) => x.fm.id);
      return [];
    };
    const must = ruleCard("rule.no-gore", "must", "Is it free of gore?");
    const r = rig(reply("ok"), {
      extraCards: [must],
      judge,
      settings: { plot: { ...defaultPlot, enabled: false } },
    });
    await run(r.session.start());
    r.cards.splice(0); // the source is emptied entirely

    await run(r.session.submit({ mode: "do", text: "go" }));
    expect(seen).toEqual(["rule.no-gore"]);
    await r.session.addPlotPoint("char.marrow", "Marrow nodded.");
    expect(plotPointsOf(r.session.state)).toHaveLength(1);
    await expect(r.session.addPlotPoint("nope.card", "x")).rejects.toThrow(/no card/);
  });

  it("resumes from the log alone, with no source at all", async () => {
    const first = rig([reply("Opening."), reply("Reply.")]);
    await run(first.session.start());
    await run(first.session.submit({ mode: "say", text: "Marrow?" }));

    const resumed = rig(reply("Carried on."), {
      resumeFrom: first.sink.all,
      withoutSource: true,
      idPrefix: "r",
    });
    const events = await run(resumed.session.submit({ mode: "say", text: "Marrow again." }));
    expect(types(events)).toEqual(["player", "context", "text", "reply", "done"]); // no second begin
    expect(systemContent(resumed.provider.requests[0])).toContain("lamp-blind eye");
  });

  it("still resumes an older log that has no copy, using the source it is given", async () => {
    const first = rig([reply("Opening."), reply("Reply.")]);
    await run(first.session.start());
    const withoutBegin = first.sink.all
      .filter((e) => e.kind !== "begin")
      .map((e) => ({ ...e, parentId: e.parentId === first.sink.begin?.id ? null : e.parentId }));

    const legacy = rig(reply("Carried on."), { resumeFrom: withoutBegin, idPrefix: "l" });
    const events = await run(legacy.session.submit({ mode: "say", text: "Marrow?" }));
    expect(types(events)).toEqual(["player", "context", "text", "reply", "done"]);
    expect(systemContent(legacy.provider.requests[0])).toContain("lamp-blind eye");
  });

  it("fails clearly when there is neither a copy nor a source", async () => {
    const r = rig(reply("x"), { withoutSource: true });
    const events = await run(r.session.start());
    expect(pick(events, "error")[0]).toMatchObject({ code: "bad_state" });
  });

  it("jumping to before the first turn lands on the copy, and play continues from there", async () => {
    const r = rig([reply("Opening."), reply("Left."), reply("Right.")]);
    await run(r.session.start());
    await run(r.session.submit({ mode: "do", text: "go left" }));

    await r.session.goto(null);
    expect(r.session.turns).toEqual([]);
    expect(r.session.state.head).toBe(r.sink.begin?.id);

    await run(r.session.submit({ mode: "do", text: "go right" }));
    expect(r.session.turns.map((t) => t.text)).toEqual(["go right", "Right."]);
    expect(lastContent(r.provider.requests.at(-1))).toContain("go right");
    expect(r.sink.all.filter((e) => e.kind === "begin")).toHaveLength(1);
  });

  it("undoing the first action returns to the copy, not to nothing", async () => {
    const r = rig(reply("ok"));
    await run(r.session.submit({ mode: "do", text: "first" }));
    expect(await r.session.undo()).toBe(true);
    expect(r.session.state.head).toBe(r.sink.begin?.id);
    await run(r.session.submit({ mode: "do", text: "again" }));
    expect(r.sink.all.filter((e) => e.kind === "begin")).toHaveLength(1);
  });
});

describe("roles", () => {
  /** A host starts the story; the player's session resumes it with no source. */
  async function started() {
    const host = rig([reply("Opening."), reply("A reply."), reply("Another."), reply("More.")], {
      settings: { plot: { ...defaultPlot, enabled: true, everyPlayerTurns: 2 } },
    });
    await run(host.session.start());
    const guest = rig([reply("Guest reply."), reply("Guest again."), reply("Guest more.")], {
      resumeFrom: host.sink.all,
      withoutSource: true,
      actor: player,
      idPrefix: "g",
      settings: { plot: { ...defaultPlot, enabled: true, everyPlayerTurns: 2 } },
    });
    return { host, guest };
  }

  it("a player cannot start a story, or begin one by acting first", async () => {
    const r = rig(reply("x"), { actor: player });
    const start = await run(r.session.start());
    expect(pick(start, "error")[0]).toMatchObject({
      code: "forbidden",
      message: "Only the host can start a story.",
    });
    const act = await run(r.session.submit({ mode: "do", text: "go" }));
    expect(pick(act, "error")[0]).toMatchObject({
      code: "forbidden",
      message: "The host has not started this story yet.",
    });
    expect(r.sink.all).toEqual([]);
  });

  it("a player can take part: act, retry, continue, undo, edit their own turn, pin a fact", async () => {
    const { guest } = await started();
    const acted = await run(guest.session.submit({ mode: "say", text: "Hello Marrow." }));
    expect(pick(acted, "reply")).toHaveLength(1);
    expect(pick(await run(guest.session.retry()), "reply")).toHaveLength(1);
    expect(pick(await run(guest.session.continueStory()), "reply")).toHaveLength(1);
    await guest.session.pin("The player is called Sam.");
    expect(guest.session.memory.pinned).toEqual(["The player is called Sam."]);

    const playerEvent = guest.sink.events.find((e) => e.kind === "player");
    await guest.session.edit(playerEvent?.id as string, "Hello again, Marrow.");
    expect(await guest.session.undo()).toBe(true);
  });

  it("a player cannot reshape the story, and nothing is saved when refused", async () => {
    const { guest } = await started();
    await run(guest.session.submit({ mode: "do", text: "I look around." }));
    const saved = guest.sink.all.length;
    const point = guest.session.state.head as string;

    const refused: Array<[string, () => Promise<unknown> | unknown, string]> = [
      [
        "branch",
        () => guest.session.goto(point),
        "Only the host can jump to another branch of the story.",
      ],
      [
        "add point",
        () => guest.session.addPlotPoint("char.marrow", "Marrow gave the player his lamp."),
        "Only the host can add plot points.",
      ],
      [
        "revoke",
        () => guest.session.revokePlotPoint("x:0"),
        "Only the host can take back plot points.",
      ],
      ["undo plot", () => guest.session.undoLastPlot(), "Only the host can take back plot points."],
      ["break", () => guest.session.breakChapter("Mine"), "Only the host can start a new chapter."],
      [
        "settings",
        () => guest.session.updateSettings({ ruleCheck: "off" }),
        "Only the host can change settings.",
      ],
    ];
    for (const [, action, message] of refused) {
      await expect(Promise.resolve().then(action)).rejects.toMatchObject({
        code: "forbidden",
        message,
      });
    }
    const plot = await run(guest.session.plot());
    expect(pick(plot, "error")[0]).toMatchObject({
      code: "forbidden",
      message: "Only the host can update plot points.",
    });
    expect(guest.sink.all).toHaveLength(saved);
    expect(guest.settings.ruleCheck).toBe("must");
  });

  it("plot points still update automatically as the story is played", async () => {
    const { guest } = await started();
    const script = (n: number) =>
      run(guest.session.submit({ mode: "do", text: `I talk to Marrow ${n}` }));
    await script(1);
    const second = await script(2);
    // the extraction is part of play, not an action by the player, so it is not blocked
    expect(types(second)).toContain("plotting");
  });

  it("the host keeps every power", async () => {
    const { host } = await started();
    await run(host.session.submit({ mode: "do", text: "I wait." }));
    await host.session.addPlotPoint("char.marrow", "Marrow waited too.");
    await host.session.breakChapter("Night");
    host.session.updateSettings({ ruleCheck: "off" });
    await host.session.goto(host.sink.begin?.id as string);
    expect(host.sink.events.some((e) => e.kind === "break")).toBe(true);
  });
});
