import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LlmError } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import { describeError } from "../src";
import { Client, HOST_KEY, type Json, rig, until } from "./helpers";

const SECRET = "Marrow lit the fourth light himself";

type Rig = Awaited<ReturnType<typeof rig>>;

async function host(r: Rig) {
  const c = new Client(r.app);
  const res = await c.join("ignored", { hostKey: HOST_KEY });
  expect(res.status).toBe(201);
  return c;
}

async function started(r: Rig) {
  const dana = await host(r);
  const res = await dana.post("/api/stories", {});
  expect(res.status).toBe(202);
  await r.table.idle();
  return { dana, id: res.body.id as string };
}

/** `nick` writes a turn and marks it ready; waits for the story to answer. */
async function takeTurn(r: Rig, who: Client, text: string, mode = "do") {
  await who.put("/api/board/draft", { mode, text });
  await who.post("/api/board/ready");
  await r.table.idle();
}

describe("joining", () => {
  it("tells anyone what the table is, without joining", async () => {
    const r = await rig();
    const { status, body } = await new Client(r.app).get("/api/table");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      host: "Dana",
      requiresAdultConfirmation: false,
      story: false,
      world: { title: expect.any(String) },
    });
  });

  it("seats a joiner as a spectator, and needs a token for everything else", async () => {
    const r = await rig();
    const sam = new Client(r.app);
    const joined = await sam.join("Sam");
    expect(joined.status).toBe(201);
    expect(joined.body.you).toEqual({
      nick: "Sam",
      seat: "spectator",
      muted: false,
      host: false,
      account: false,
    });

    const nobody = await new Client(r.app).get("/api/state");
    expect(nobody.status).toBe(401);
    expect(nobody.body.error.code).toBe("not_joined");
    expect((await new Client(r.app, "forged").get("/api/state")).status).toBe(401);
  });

  it("refuses bad and taken nicknames in plain words", async () => {
    const r = await rig();
    await new Client(r.app).join("Sam");
    const taken = await new Client(r.app).join("sam");
    expect(taken.status).toBe(400);
    expect(taken.body.error).toMatchObject({ code: "bad_nickname" });
    expect(taken.body.error.message).toContain("already taken");
    expect((await new Client(r.app).join("has space")).body.error.code).toBe("bad_nickname");
    expect((await new Client(r.app).join("Dana")).body.error.code).toBe("bad_nickname");
    expect((await new Client(r.app).call("POST", "/api/join", {})).body.error.message).toContain(
      "nickname",
    );
  });

  it("gives the host's seat only to whoever holds the host key", async () => {
    const r = await rig();
    const wrong = await new Client(r.app).join("Dana", { hostKey: "guess" });
    expect(wrong.status).toBe(403);
    const dana = await host(r);
    expect((await dana.get("/api/state")).body.you).toMatchObject({ nick: "Dana", host: true });
  });

  it("asks for an adult confirmation only when the server requires it", async () => {
    const r = await rig(undefined, { requireAdultConfirmation: true });
    expect((await new Client(r.app).get("/api/table")).body.requiresAdultConfirmation).toBe(true);
    const without = await new Client(r.app).join("Sam");
    expect(without.status).toBe(400);
    expect(without.body.error).toMatchObject({ code: "age_unconfirmed" });
    expect((await new Client(r.app).join("Sam", { confirmedAdult: true })).status).toBe(201);
    expect((await host(r)).token).toBeTruthy(); // the host is not asked
  });

  it("caps how many people one table seats", async () => {
    const r = await rig();
    for (let i = 0; i < 64; i++) await new Client(r.app).join(`p${i}`);
    const late = await new Client(r.app).join("late");
    expect(late.status).toBe(409);
    expect(late.body.error.message).toContain("full");
  });

  it("answers bad requests with the same plain error shape", async () => {
    const r = await rig();
    const sam = await new Client(r.app).asPlayer("Sam");
    expect((await sam.put("/api/board/draft", { mode: "yell", text: "x" })).status).toBe(400);
    expect((await sam.get("/api/nope")).body.error.code).toBe("not_found");
    const big = await sam.put("/api/board/draft", { mode: "do", text: "x".repeat(300_000) });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe("too_big");
  });
});

describe("telling a story", () => {
  it("lets only the host start one, copying the cards into the saved log", async () => {
    const r = await rig();
    const sam = await new Client(r.app).asPlayer("Sam");
    const refused = await sam.post("/api/stories", {});
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe("Only the host can start a story.");

    const { id } = await started(r);
    const events = await r.stories.load(id);
    expect(events[0]?.kind).toBe("begin");
    expect(events[0]?.cards.length).toBeGreaterThan(3);
    expect(events.at(-1)).toMatchObject({ kind: "host", text: "The lamp gutters." });
  });

  it("streams the opening to everyone as it is written, then sends the finished story", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const wren = new Client(r.app);
    await wren.join("Wren");
    const forSam = await sam.listen();
    const forWren = await wren.listen();

    await dana.post("/api/stories", {});
    await r.table.idle();
    await until(() => forWren.story("done").length === 1 && forSam.story("done").length === 1);

    for (const l of [forSam, forWren]) {
      expect(
        l
          .story("text")
          .map((t) => t.text)
          .join(""),
      ).toBe("The lamp gutters.");
      expect(l.story("reply")[0].turn).toMatchObject({ role: "host", text: "The lamp gutters." });
      expect(l.of("story-view").at(-1).turns).toHaveLength(1);
    }
  });

  it("runs a round written on the board: nothing goes until everyone who wrote is ready", async () => {
    const r = await rig([{ chunks: ["Opening."] }, { chunks: ["The door opens."] }]);
    const { dana } = await started(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const robin = await new Client(r.app).asPlayer("Robin");
    const seen = await robin.listen();

    await sam.put("/api/board/draft", { mode: "do", text: "I knock." });
    await robin.put("/api/board/draft", { mode: "say", text: "Anyone home?" });
    await sam.post("/api/board/ready");
    expect(r.provider.requests).toHaveLength(1);
    expect((await sam.get("/api/state")).body.board.drafts).toHaveLength(2);

    await robin.post("/api/board/ready");
    await r.table.idle();
    expect(r.provider.requests).toHaveLength(2);

    await until(() => seen.of("story-view").at(-1)?.turns.length === 4);
    const turns = seen.of("story-view").at(-1).turns;
    expect(turns.map((t: Json) => [t.role, t.by, t.text])).toEqual([
      ["host", undefined, "Opening."],
      ["player", "Sam", "I knock."],
      ["player", "Robin", "Anyone home?"],
      ["host", undefined, "The door opens."],
    ]);
    expect(turns[1].round).toBe(turns[2].round);
    expect((await dana.get("/api/state")).body.board.drafts).toEqual([]);
  });

  it("holds a round that closes while the story is writing until it has finished", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const r = await rig([{ chunks: ["Opening."] }, { chunks: ["Then."] }], {
      wrap: (inner) => ({
        ...inner,
        stream: (req, signal) =>
          (async function* () {
            await gate;
            yield* inner.stream(req, signal);
          })(),
      }),
    });
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await dana.post("/api/stories", {});

    await sam.put("/api/board/draft", { mode: "do", text: "I wait." });
    await sam.post("/api/board/ready");
    expect((await sam.get("/api/state")).body.board).toMatchObject({ busy: true, closed: false });
    expect(r.provider.requests).toHaveLength(0);

    release();
    await until(() => r.provider.requests.length === 2, "the round to follow the opening");
    await r.table.idle();
    const turns = r.table.snapshot(r.table.seat(sam.token)).story?.turns ?? [];
    expect(turns.map((t) => t.text)).toEqual(["Opening.", "I wait.", "Then."]);
  });

  it("lets the host close a round early; players cannot", async () => {
    const r = await rig([{ chunks: ["Opening."] }, { chunks: ["Reply."] }]);
    const { dana } = await started(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await sam.put("/api/board/draft", { mode: "do", text: "Not ready yet." });
    expect((await sam.post("/api/board/close")).status).toBe(403);
    expect((await dana.post("/api/board/close")).status).toBe(202);
    await r.table.idle();
    expect(r.provider.requests.at(-1)?.messages.at(-1)?.content).toContain("Not ready yet.");
    expect((await dana.post("/api/board/close")).body.error.code).toBe("nothing_to_do");
  });

  it("keeps spectators and the hushed from doing anything to the story", async () => {
    const r = await rig([{ chunks: ["Opening."] }, { chunks: ["Reply."] }]);
    const { dana } = await started(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const wren = new Client(r.app);
    await wren.join("Wren");

    for (const path of ["/api/story/undo", "/api/story/retry", "/api/story/continue"]) {
      const res = await wren.post(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.message).toContain("Opt in to play");
    }
    expect((await wren.put("/api/board/draft", { mode: "do", text: "hi" })).status).toBe(400);

    await dana.post("/api/board/moderate", { action: "mute", nick: "Sam" });
    const hushed = await sam.post("/api/story/undo");
    expect(hushed.status).toBe(403);
    expect(hushed.body.error.message).toContain("hushed");
  });

  it("lets players undo, edit and retry, but not branch, break chapters or touch plot", async () => {
    const r = await rig([
      { chunks: ["Opening."] },
      { chunks: ["First."] },
      { chunks: ["Second."] },
    ]);
    const { dana } = await started(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await takeTurn(r, sam, "I act.");

    for (const [path, body] of [
      ["/api/story/goto", { id: null }],
      ["/api/story/break", {}],
      ["/api/story/plot", {}],
      ["/api/story/plot-points", { card: "arc.fourth-light", text: "x" }],
      ["/api/story/plot-points/undo", {}],
    ] as const) {
      expect((await sam.post(path, body)).status, path).toBe(403);
    }
    expect((await sam.del("/api/story/plot-points/x:0")).status).toBe(403);

    expect((await sam.post("/api/story/retry")).status).toBe(202);
    await r.table.idle();
    expect((await sam.post("/api/story/undo")).body).toEqual({ undone: true });
    const turns = r.table.snapshot(r.table.seat(dana.token)).story?.turns ?? [];
    expect(turns.map((t) => t.text)).toEqual(["Opening."]);
    expect((await dana.post("/api/story/break", { title: "Dusk" })).status).toBe(200);
  });

  it("saves the log and rewrites the chapter files as the window shifts past old turns", async () => {
    const filler = "w ".repeat(120);
    const r = await rig(() => ({ chunks: [`Reply. ${filler}`] }), {
      settings: { budget: { maxTokens: 700, reserveReply: 100 } },
    });
    const dana = await host(r);
    const { body } = await dana.post("/api/stories", {});
    await r.table.idle();
    const sam = await new Client(r.app).asPlayer("Sam");
    for (let i = 0; i < 6; i++) await takeTurn(r, sam, `Step ${i}. ${filler}`);

    const index = await readFile(join(r.stories.folder(body.id), "chapters", "index.md"), "utf8");
    expect(index).toContain("# Chapters");
    const story = r.table.snapshot(r.table.seat(dana.token)).story;
    expect(story?.chapters.length).toBeGreaterThan(0);
    // each chapter says which turn it was cut at, so a reader can lay the turns out in chapters
    const ids = new Set(story?.turns.map((t) => t.id));
    for (const c of story?.chapters ?? []) expect(ids.has(c.through), c.title).toBe(true);
  });

  it("resumes a saved story in a new server, and carries on from it", async () => {
    const first = await rig([{ chunks: ["Opening."] }, { chunks: ["First."] }]);
    const { id } = await started(first);
    const sam = await new Client(first.app).asPlayer("Sam");
    await takeTurn(first, sam, "I act.");

    const second = await rig([{ chunks: ["Later."] }], { library: first.library.root });
    const again = await host(second);
    expect((await again.get("/api/stories")).body.stories.map((s: Json) => s.id)).toEqual([id]);
    expect((await again.post(`/api/stories/${id}/resume`)).status).toBe(200);
    const turns = (await again.get("/api/state")).body.story.turns;
    expect(turns.map((t: Json) => t.text)).toEqual(["Opening.", "I act.", "First."]);

    const wren = await new Client(second.app).asPlayer("Wren");
    await takeTurn(second, wren, "Hello again.", "say");
    expect((await again.get("/api/state")).body.story.turns).toHaveLength(5);
    expect((await again.post("/api/stories/nope/resume")).status).toBe(400);
  });

  it("tells everyone plainly when the model fails, and any player can ask it to try again", async () => {
    const r = await rig([
      { chunks: ["Opening."] },
      { error: new LlmError("server", "The model server had a problem.", "C:\\secret\\path") },
      { chunks: ["Better."] },
    ]);
    await started(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const seen = await sam.listen();
    await takeTurn(r, sam, "I act.");
    await until(() => seen.story("error").length === 1);
    expect(seen.story("error")[0].message).not.toContain("secret");

    expect((await sam.post("/api/story/retry")).status).toBe(202);
    await r.table.idle();
    await until(() => seen.story("reply").length === 1);
    expect(seen.story("reply")[0].turn.text).toBe("Better.");
  });
});

describe("what each person is shown", () => {
  it("keeps the cards, the Secrets and the prompt from everyone but the host", async () => {
    const r = await rig([{ chunks: ["Opening."] }, { chunks: ["The fog parts."] }]);
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const wren = new Client(r.app);
    await wren.join("Wren");
    const heard = [await sam.listen(), await wren.listen()];
    const hostHeard = await dana.listen();

    await dana.post("/api/stories", {});
    await r.table.idle();
    await takeTurn(r, sam, "I ask Marrow about the fourth light.");
    await until(() => heard.every((l) => l.of("story-view").at(-1)?.turns.length === 3));

    const everything = [
      ...heard.map((l) => JSON.stringify(l.messages)),
      JSON.stringify((await sam.get("/api/state")).body),
      JSON.stringify((await wren.get("/api/state")).body),
    ].join("\n");
    expect(everything).toContain("The fog parts.");
    for (const leak of [
      SECRET,
      "Secrets",
      "host-only",
      "lore.the-fog",
      "char.marrow",
      '"cards"',
      "included",
      "player_input",
      "Anything marked",
    ]) {
      expect(everything, leak).not.toContain(leak);
    }
    expect(heard.every((l) => l.story("context").length === 0)).toBe(true);

    // The host, who owns those cards, is shown how the prompt was built.
    await until(() => hostHeard.story("context").length === 2);
    expect(JSON.stringify(hostHeard.story("context")[1])).toContain("char.marrow");
    expect((await dana.get("/api/state")).body.story.head).toBeTruthy();
    expect("head" in (await sam.get("/api/state")).body.story).toBe(false);
  });

  it("hides rule findings and plot work from the table, and shows them to the host", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const forSam = await sam.listen();
    const forDana = await dana.listen();
    const send = (r.table as unknown as { fanOut(e: unknown): void }).fanOut.bind(r.table);
    send({ type: "warning", message: "judge is down" });
    send({
      type: "rule-violation",
      violations: [{ ruleId: "rule.x", name: "No dragons", reason: "A dragon appeared." }],
      willRetry: false,
    });
    send({ type: "plotting", turns: 4 });
    await until(() => forDana.story("rule-violation").length === 1);
    expect(forDana.story("warning")).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(forSam.of("story")).toEqual([]);
  });

  it("keeps the source cards from players until the host allows it", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    expect((await sam.get("/api/source/cards")).status).toBe(403);
    expect((await sam.get("/api/source/world")).status).toBe(403);
    expect((await dana.get("/api/source/cards")).body.cards.length).toBeGreaterThan(3);

    expect((await sam.patch("/api/settings", { playersMayRead: true })).status).toBe(403);
    expect((await dana.patch("/api/settings", { playersMayRead: true })).body.playersMayRead).toBe(
      true,
    );
    expect((await sam.get("/api/source/cards")).status).toBe(200);
  });
});

describe("the host's own tools", () => {
  it("edits source cards from markdown, refuses invalid ones, and never touches stories already begun", async () => {
    const r = await rig([{ chunks: ["Opening."] }]);
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");

    const card = "---\nid: lore.tides\nkind: lore\nname: Tides\n---\n# Tides\n\nThey keep time.\n";
    const asPlayer = await sam.put("/api/source/cards", { path: "lore/tides.md", text: card });
    expect(asPlayer.status).toBe(403);
    const saved = await dana.put("/api/source/cards", { path: "lore/tides.md", text: card });
    expect(saved.body).toEqual({ card: { path: "lore/tides.md", id: "lore.tides" } });

    const bad = await dana.put("/api/source/cards", {
      path: "lore/bad.md",
      text: "no frontmatter",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_card");
    const clash = await dana.put("/api/source/cards", { path: "lore/other.md", text: card });
    expect(clash.body.error.message).toContain("duplicate");

    const { body } = await dana.post("/api/stories", {});
    await r.table.idle();
    const edited = card.replace("They keep time.", "They keep secrets.");
    await dana.put("/api/source/cards", { path: "lore/tides.md", text: edited });
    const begin = (await r.stories.load(body.id))[0];
    expect(begin?.cards.find((c) => c.fm.id === "lore.tides")?.body).toContain("They keep time.");

    expect((await sam.del("/api/source/cards/lore.tides")).status).toBe(403);
    expect((await dana.del("/api/source/cards/lore.tides")).status).toBe(200);
    expect((await dana.del("/api/source/cards/lore.tides")).body.error.code).toBe("nothing_to_do");
  });

  it("changes settings within limits, for the host only", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    expect((await sam.patch("/api/settings", { model: "x" })).status).toBe(403);
    expect((await sam.get("/api/settings")).status).toBe(403);

    const res = await dana.patch("/api/settings", {
      model: "other-model",
      params: { temperature: 1.2 },
      plot: { everyPlayerTurns: 5 },
    });
    expect(res.body.settings).toMatchObject({
      model: "other-model",
      params: { temperature: 1.2, topP: 0.95 },
      plot: { everyPlayerTurns: 5, maxPoints: 6 },
    });
    expect(r.settings.model).toBe("other-model");
    for (const bad of [
      { params: { temperature: 99 } },
      { ruleCheck: "sometimes" },
      { apiKey: "x" },
    ]) {
      expect((await dana.patch("/api/settings", bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("moderating the table", () => {
  it("announces each power in the story's voice and applies its plain effect", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const robin = await new Client(r.app).asPlayer("Robin");

    const byPlayer = await sam.post("/api/board/moderate", { action: "mute", nick: "Robin" });
    expect(byPlayer.status).toBe(403);
    const mute = { action: "mute", nick: "Robin", style: "tape" };
    expect((await dana.post("/api/board/moderate", mute)).status).toBe(200);
    const hushed = await robin.put("/api/board/draft", { mode: "do", text: "hi" });
    expect(hushed.status).toBe(400);
    expect(hushed.body.error.message).toContain("hushed");
    const board = (await sam.get("/api/state")).body.board;
    expect(board.notices[0].text).toContain("Robin");
    expect(board.participants.find((p: Json) => p.nick === "Robin").muted).toBe(true);

    await dana.post("/api/board/moderate", { action: "unmute", nick: "Robin" });
    expect((await robin.put("/api/board/draft", { mode: "do", text: "hi" })).status).toBe(200);
    const onHost = await dana.post("/api/board/moderate", { action: "kick", nick: "Dana" });
    expect(onHost.body.error.message).toContain("host");
  });

  it("sends a kicked person away: their token stops working and their stream ends", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const seen = await sam.listen();
    await until(() => seen.of("snapshot").length === 1);

    await dana.post("/api/board/moderate", { action: "kick", nick: "Sam", style: "weapon" });
    await until(() => seen.of("kicked").length === 1);
    await until(() => seen.ended);
    expect((await sam.get("/api/state")).status).toBe(401);
    const nicks = (await dana.get("/api/state")).body.board.participants.map((p: Json) => p.nick);
    expect(nicks).toEqual(["Dana"]);
    expect((await new Client(r.app).join("Sam")).status).toBe(201); // kick is not a ban
  });

  it("renames someone everywhere, including the token they already hold", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await sam.put("/api/board/draft", { mode: "do", text: "I wait." });
    await dana.post("/api/board/moderate", { action: "rename", nick: "Sam", newNick: "Sparrow" });
    const state = (await sam.get("/api/state")).body;
    expect(state.you.nick).toBe("Sparrow");
    expect(state.board.drafts[0].nick).toBe("Sparrow");
  });

  it("shows who is connected", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    const seen = await dana.listen();
    await until(() => seen.of("board").at(-1)?.online.length === 1);
    const samSees = await sam.listen();
    await until(() => seen.of("board").at(-1)?.online.sort().join() === "Dana,Sam");
    await samSees.close();
    await until(() => seen.of("board").at(-1)?.online.join() === "Dana");
  });
});

describe("leaving", () => {
  it("lets a player leave, and the host stay", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    expect((await sam.post("/api/leave")).status).toBe(200);
    expect((await sam.get("/api/state")).status).toBe(401);
    expect((await dana.post("/api/leave")).status).toBe(400);
  });

  it("lets a player step back to watching, dropping what they wrote", async () => {
    const r = await rig();
    const sam = await new Client(r.app).asPlayer("Sam");
    await sam.put("/api/board/draft", { mode: "do", text: "I act." });
    expect((await sam.post("/api/watch")).body.you.seat).toBe("spectator");
    expect((await sam.get("/api/state")).body.board.drafts).toEqual([]);
  });
});

describe("errors", () => {
  it("never tells a caller anything about the machine", () => {
    const { status, body } = describeError(new Error("ENOENT C:\\Users\\yesha\\secret.txt"));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("yesha");
  });
});
