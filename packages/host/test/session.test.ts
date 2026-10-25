import { type GenerateRequest, LlmError } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import { HostError, type RuleJudge } from "../src";
import {
  lastContent,
  loadWorld,
  memorySink,
  pick,
  rig,
  ruleCard,
  run,
  systemContent,
  types,
} from "./helpers";

const reply = (...chunks: string[]) => ({ chunks });

describe("start", () => {
  it("writes an opening scene as the first event, pinning the chosen arc", async () => {
    const { session, sink, provider } = rig(reply("Dusk ", "settles."));
    const events = await run(session.start({ arcId: "arc.fourth-light" }));

    expect(types(events)).toEqual(["begun", "context", "text", "text", "reply", "done"]);
    expect(pick(events, "begun")[0]?.cards).toBe(loadWorld("example-world").cards.length + 1); // + the current-situation card
    const ctx = pick(events, "context")[0]?.context;
    expect(ctx?.included.find((i) => i.id === "arc.fourth-light")?.reason).toBe(
      "pinned for this turn",
    );
    const saved = pick(events, "reply")[0]?.event;
    expect(saved).toMatchObject({
      kind: "host",
      parentId: sink.begin?.id,
      text: "Dusk settles.",
      model: "fake-model",
    });
    expect(saved?.cardsUsed).toContain("arc.fourth-light");
    expect(sink.events).toEqual([saved]);
    expect(lastContent(provider.requests[0])).toContain("Begin the story");
    expect(lastContent(provider.requests[0])).toContain("The Fourth Light");
    expect(session.turns.map((t) => t.text)).toEqual(["Dusk settles."]);
  });

  it("refuses to start an adventure twice", async () => {
    const { session } = rig(reply("Hi."));
    await run(session.start());
    const again = await run(session.start());
    expect(types(again)).toEqual(["error", "done"]);
    expect(pick(again, "error")[0]).toMatchObject({ code: "bad_state", recoverable: true });
  });
});

describe("submit", () => {
  it("saves the player's action, streams the reply, and saves it", async () => {
    const { session, sink } = rig([reply("Opening."), reply("Marrow ", "squints.")]);
    await run(session.start());
    const events = await run(session.submit({ mode: "say", text: "Hello, Marrow." }));

    expect(types(events)).toEqual(["player", "context", "text", "text", "reply", "done"]);
    expect(pick(events, "text").map((e) => e.text)).toEqual(["Marrow ", "squints."]);
    expect(sink.events.map((e) => e.kind)).toEqual(["host", "player", "host"]);
    const [opening, player, host] = sink.events;
    expect(player).toMatchObject({ parentId: opening?.id, mode: "say", text: "Hello, Marrow." });
    expect(host).toMatchObject({ parentId: player?.id, text: "Marrow squints." });
    expect(session.state.head).toBe(host?.id);
  });

  it("builds each prompt from the conversation so far and the cards the input triggers", async () => {
    const { session, provider } = rig([reply("Opening."), reply("Reply.")]);
    await run(session.start());
    const events = await run(session.submit({ mode: "do", text: "I ask Marrow about the fog." }));

    const second = provider.requests[1] as GenerateRequest;
    expect(second.messages.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
    expect(second.messages[1]?.content).toBe("Opening.");
    expect(lastContent(second)).toBe(
      '<player_input mode="do">I ask Marrow about the fog.</player_input>',
    );
    const included = pick(events, "context")[0]?.context.included.map((i) => i.id);
    expect(included).toEqual(expect.arrayContaining(["char.marrow", "lore.the-fog"]));
    expect(systemContent(second)).toContain("Marrow lit the fourth light himself");
  });

  it("rejects empty input without saving anything", async () => {
    const { session, sink } = rig(reply("x"));
    const events = await run(session.submit({ mode: "do", text: "   " }));
    expect(pick(events, "error")[0]?.code).toBe("nothing_to_do");
    expect(sink.events).toEqual([]);
  });
});

describe("failures", () => {
  it("keeps the player's action when the model is unreachable, and retry recovers", async () => {
    const down = new LlmError("unreachable", "Can't reach the model at http://localhost:5001.");
    const { session, sink } = rig([{ error: down }, reply("Better now.")]);

    const failed = await run(session.submit({ mode: "do", text: "I wait." }));
    expect(types(failed)).toEqual(["begun", "player", "context", "error", "done"]);
    expect(pick(failed, "error")[0]).toMatchObject({
      code: "unreachable",
      message: "Can't reach the model at http://localhost:5001.",
      recoverable: true,
    });
    expect(sink.events.map((e) => e.kind)).toEqual(["player"]);

    const recovered = await run(session.retry());
    expect(types(recovered)).toEqual(["context", "text", "reply", "done"]);
    expect(sink.events.map((e) => e.kind)).toEqual(["player", "host"]);
    expect(sink.events[1]?.parentId).toBe(sink.events[0]?.id);
  });

  it("reports a stopped generation with its partial text and saves no reply", async () => {
    const { session, sink } = rig(reply("a", "b", "c"));
    const controller = new AbortController();
    const events: Awaited<ReturnType<typeof run>> = [];
    for await (const ev of session.submit({ mode: "do", text: "go" }, controller.signal)) {
      events.push(ev);
      if (ev.type === "text") controller.abort();
    }
    expect(pick(events, "stopped")).toEqual([{ type: "stopped", partial: "a" }]);
    expect(pick(events, "reply")).toEqual([]);
    expect(sink.events.map((e) => e.kind)).toEqual(["player"]);
  });

  it("treats an empty model reply as a recoverable error", async () => {
    const { session, sink } = rig(reply("  ", "\n"));
    const events = await run(session.submit({ mode: "do", text: "go" }));
    expect(pick(events, "error")[0]).toMatchObject({ code: "empty_reply", recoverable: true });
    expect(sink.events.map((e) => e.kind)).toEqual(["player"]);
  });

  it("explains a prompt that cannot fit instead of throwing", async () => {
    const { session } = rig(reply("x"), {
      settings: { budget: { maxTokens: 120, reserveReply: 100 } },
    });
    const events = await run(session.submit({ mode: "do", text: "go" }));
    expect(pick(events, "error")[0]).toMatchObject({ code: "context_budget", recoverable: true });
    expect(types(events).at(-1)).toBe("done");
  });

  it("warns when a reply hit the length limit", async () => {
    const { session } = rig({ chunks: ["Cut off mid"], finishReason: "length" });
    const events = await run(session.submit({ mode: "do", text: "go" }));
    expect(pick(events, "warning")[0]?.message).toMatch(/Use Continue/);
    expect(pick(events, "reply")).toHaveLength(1);
  });

  it("stops with a clear error when saving fails, leaving state untouched", async () => {
    const sink = memorySink();
    sink.failNext = true;
    const { session } = rig(reply("x"), { sink });
    const events = await run(session.submit({ mode: "do", text: "go" }));
    expect(pick(events, "error")[0]).toMatchObject({ code: "persist", recoverable: false });
    expect(pick(events, "error")[0]?.message).toMatch(/Could not save the story: disk full/);
    expect(session.state.head).toBeNull();
  });

  it("allows only one turn at a time", async () => {
    const { session } = rig(reply("slow", " reply"));
    const first = session.submit({ mode: "do", text: "one" });
    await first.next(); // the turn is now running
    expect(session.isBusy).toBe(true);

    const second = await run(session.submit({ mode: "do", text: "two" }));
    expect(pick(second, "error")[0]).toMatchObject({ code: "busy" });
    await expect(session.undo()).rejects.toBeInstanceOf(HostError);

    for await (const _ of first) {
      // drain
    }
    expect(session.isBusy).toBe(false);
  });
});

describe("retry, continue, undo, edit", () => {
  it("retry writes a sibling reply and leaves the old one reachable", async () => {
    const { session, sink, provider } = rig([reply("Opening."), reply("First."), reply("Second.")]);
    await run(session.start());
    await run(session.submit({ mode: "do", text: "act" }));
    const events = await run(session.retry());

    expect(types(events)).toEqual(["context", "text", "reply", "done"]);
    const [, player, first, second] = sink.events;
    expect(second?.parentId).toBe(player?.id);
    expect(first?.parentId).toBe(player?.id);
    expect(session.turns.map((t) => t.text)).toEqual(["Opening.", "act", "Second."]);
    // the retried reply is not in the prompt that writes its replacement
    expect(JSON.stringify(provider.requests[2]?.messages)).not.toContain("First.");
  });

  it("retry on an empty adventure has nothing to do", async () => {
    const { session } = rig(reply("x"));
    expect(pick(await run(session.retry()), "error")[0]?.code).toBe("nothing_to_do");
  });

  it("retry on the opening scene writes a new opening", async () => {
    const { session, sink } = rig([reply("Opening A."), reply("Opening B.")]);
    await run(session.start());
    await run(session.retry());
    expect(sink.events.map((e) => e.parentId)).toEqual([sink.begin?.id, sink.begin?.id]);
    expect(session.turns.map((t) => t.text)).toEqual(["Opening B."]);
  });

  it("continue extends the story from the latest reply without a player action", async () => {
    const { session, sink, provider } = rig([reply("Door opens."), reply("Light spills out.")]);
    await run(session.submit({ mode: "do", text: "knock" }));
    const events = await run(session.continueStory());

    expect(types(events)).toEqual(["context", "text", "reply", "done"]);
    expect(lastContent(provider.requests[1])).toContain("Continue the scene");
    expect(provider.requests[1]?.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(sink.events.map((e) => e.kind)).toEqual(["player", "host", "host"]);
    expect(session.turns.map((t) => t.text)).toEqual(["knock", "Door opens.", "Light spills out."]);
  });

  it("undo removes the last action and its reply, and reports nothing to undo", async () => {
    const { session } = rig([reply("Opening."), reply("Reply.")]);
    expect(await session.undo()).toBe(false);
    await run(session.start());
    await run(session.submit({ mode: "do", text: "act" }));
    expect(await session.undo()).toBe(true);
    expect(session.turns.map((t) => t.text)).toEqual(["Opening."]);
  });

  it("editing a player action then retrying answers the new wording", async () => {
    const { session, sink, provider } = rig([reply("Old answer."), reply("New answer.")]);
    await run(session.submit({ mode: "do", text: "I open the door" }));
    const playerId = sink.events[0]?.id as string;

    const edited = await session.edit(playerId, "I close the door");
    expect(edited).toMatchObject({ kind: "player", mode: "do", editOf: playerId });
    await run(session.retry());

    expect(lastContent(provider.requests[1])).toContain("I close the door");
    expect(session.turns.map((t) => t.text)).toEqual(["I close the door", "New answer."]);
  });
});

describe("memory and branches", () => {
  it("pinned facts appear in later prompts and can be removed", async () => {
    const { session, provider } = rig(reply("ok"));
    await session.pin("The player owes Marrow a favour.");
    await run(session.submit({ mode: "do", text: "wait" }));
    expect(systemContent(provider.requests[0])).toContain("- The player owes Marrow a favour.");

    await session.unpin("The player owes Marrow a favour.");
    expect(session.memory.pinned).toEqual([]);
  });

  it("goto browses back to an earlier moment and play continues from there as a branch", async () => {
    const { session, sink } = rig([reply("Opening."), reply("Path A."), reply("Path B.")]);
    await run(session.start());
    await run(session.submit({ mode: "do", text: "go left" }));
    const opening = sink.events[0]?.id as string;

    await session.goto(opening);
    expect(session.turns.map((t) => t.text)).toEqual(["Opening."]);
    await run(session.submit({ mode: "do", text: "go right" }));
    expect(session.turns.map((t) => t.text)).toEqual(["Opening.", "go right", "Path B."]);
    // the other branch is still saved
    expect(sink.events.some((e) => e.text === "Path A.")).toBe(true);
  });
});

describe("rule checking", () => {
  const must = ruleCard("rule.no-gore", "must", "Is the passage free of graphic gore?");
  const wrote = (req: GenerateRequest | undefined) => lastContent(req);

  it("rewrites a reply that breaks a must rule, keeping the flagged draft as a sibling", async () => {
    let judged = 0;
    const judge: RuleJudge = async () =>
      ++judged === 1
        ? [
            {
              ruleId: "rule.no-gore",
              name: "rule.no-gore",
              reason: "It describes a wound in detail.",
            },
          ]
        : [];
    const { session, sink, provider } = rig([reply("Gory draft."), reply("Gentle rewrite.")], {
      extraCards: [must],
      judge,
    });

    const events = await run(session.submit({ mode: "do", text: "attack" }));
    expect(types(events)).toEqual([
      "begun",
      "player",
      "context",
      "text",
      "reply",
      "rule-violation",
      "attempt",
      "context",
      "text",
      "reply",
      "done",
    ]);
    expect(pick(events, "rule-violation")[0]).toMatchObject({ willRetry: true });
    expect(pick(events, "attempt")[0]?.n).toBe(2);

    const [player, draft, final] = sink.events;
    expect(draft).toMatchObject({
      text: "Gory draft.",
      flags: ["rule.no-gore"],
      parentId: player?.id,
    });
    expect(final).toMatchObject({ text: "Gentle rewrite.", flags: [], parentId: player?.id });
    expect(wrote(provider.requests[1])).toContain("<editor_note>");
    expect(wrote(provider.requests[1])).toContain("It describes a wound in detail.");
    expect(wrote(provider.requests[0])).not.toContain("editor_note");
    expect(session.turns.at(-1)?.text).toBe("Gentle rewrite.");
  });

  it("accepts a still-violating rewrite, flagged, after the allowed regenerations", async () => {
    const judge: RuleJudge = async () => [
      { ruleId: "rule.no-gore", name: "rule.no-gore", reason: "Still gory." },
    ];
    const { session, sink } = rig([reply("Draft one."), reply("Draft two.")], {
      extraCards: [must],
      judge,
    });
    const events = await run(session.submit({ mode: "do", text: "attack" }));

    expect(pick(events, "rule-violation").map((e) => e.willRetry)).toEqual([true, false]);
    expect(sink.events.filter((e) => e.kind === "host").map((e) => e.flags)).toEqual([
      ["rule.no-gore"],
      ["rule.no-gore"],
    ]);
    expect(session.turns.at(-1)?.text).toBe("Draft two.");
  });

  it("does not regenerate when maxRegenerations is 0", async () => {
    const judge: RuleJudge = async () => [
      { ruleId: "rule.no-gore", name: "rule.no-gore", reason: "Gory." },
    ];
    const { session, provider } = rig(reply("Draft."), {
      extraCards: [must],
      judge,
      settings: { maxRegenerations: 0 },
    });
    const events = await run(session.submit({ mode: "do", text: "attack" }));
    expect(provider.requests).toHaveLength(1);
    expect(pick(events, "rule-violation")[0]?.willRetry).toBe(false);
  });

  it("keeps the reply and warns when the judge itself fails", async () => {
    const judge: RuleJudge = async () => {
      throw new Error("judge offline");
    };
    const { session, sink } = rig(reply("Fine."), { extraCards: [must], judge });
    const events = await run(session.submit({ mode: "do", text: "go" }));
    expect(pick(events, "warning")[0]?.message).toMatch(/rule check could not run.*judge offline/);
    expect(sink.events.at(-1)).toMatchObject({ text: "Fine.", flags: [] });
  });

  it("only hands the judge the rules it is meant to check", async () => {
    let seen: string[] = [];
    const judge: RuleJudge = async ({ rules }) => {
      seen = rules.map((r) => r.fm.id);
      return [];
    };
    const should = ruleCard("rule.be-kind", "should", "Is it kind?");
    const { session } = rig(reply("ok"), { extraCards: [must, should], judge });
    await run(session.submit({ mode: "do", text: "go" }));
    expect(seen).toEqual(["rule.no-gore"]);

    session.updateSettings({ ruleCheck: "all" });
    await run(session.submit({ mode: "do", text: "again" }));
    expect(seen).toEqual(["rule.be-kind", "rule.host-tone", "rule.no-gore"]);

    session.updateSettings({ ruleCheck: "off" });
    seen = [];
    await run(session.submit({ mode: "do", text: "once more" }));
    expect(seen).toEqual([]);
  });
});

describe("resume", () => {
  it("rebuilds a session from saved events and carries on", async () => {
    const first = rig([reply("Opening."), reply("Reply.")]);
    await run(first.session.start());
    await run(first.session.submit({ mode: "do", text: "act" }));

    const resumed = rig(reply("Carried on."), {
      resumeFrom: first.sink.all,
      idPrefix: "r",
    });
    expect(resumed.session.state.head).toBe(first.session.state.head);
    expect(resumed.session.turns.map((t) => t.text)).toEqual(["Opening.", "act", "Reply."]);

    const events = await run(resumed.session.submit({ mode: "do", text: "more" }));
    expect(types(events)).toEqual(["player", "context", "text", "reply", "done"]);
    expect(resumed.provider.requests[0]?.messages.map((m) => m.role)).toEqual([
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
  });
});
