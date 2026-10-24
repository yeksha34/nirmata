import { chaptersOf, liveCardsOf, projectAdventure } from "@nirmata/core";
import { type FakeScript, type GenerateRequest, LlmError } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import type { HostSettings } from "../src";
import { defaultCompaction } from "../src";
import { lastContent, memorySink, pick, rig, run, systemContent, types } from "./helpers";

const RECORD = JSON.stringify({
  scene: {
    title: "The Harbour Door",
    location: "Saltmere quay",
    time: "dusk",
    participants: ["Marrow"],
    keywords: ["door"],
    events: "Marrow opened the door.",
    outcome: "The player gained entry.",
  },
  state: [
    {
      name: "Marrow",
      entity: "character",
      keywords: ["keeper"],
      status: "Wary of the player.\nHolds the key.",
    },
  ],
  now: {
    location: "Saltmere quay",
    time: "dusk",
    present: ["Marrow"],
    goals: ["Find the fourth light"],
    open_threads: ["Who lit it?"],
  },
});

const CHAPTER =
  "Title: The Harbour Door\n\nMarrow opened the door and the traveller stepped into the lamplight of Saltmere.";

type Kind = "summary" | "chapter" | "record" | "play";
const kindOf = (req: GenerateRequest): Kind => {
  const sys = systemContent(req);
  if (sys.includes("running memory")) return "summary";
  if (sys.includes("one chapter of a book")) return "chapter";
  if (sys.includes("notes that track")) return "record";
  return "play";
};

interface Plan {
  summary?: FakeScript;
  chapter?: FakeScript;
  /** Answers to successive record calls; the last repeats. */
  record?: FakeScript[];
}

function script(plan: Plan = {}) {
  const records = plan.record ?? [{ chunks: [RECORD] }];
  let recordCalls = 0;
  let summaryCalls = 0;
  return (req: GenerateRequest): FakeScript => {
    switch (kindOf(req)) {
      case "summary":
        summaryCalls++;
        return plan.summary ?? { chunks: [`SUMMARY ${summaryCalls}`] };
      case "chapter":
        return plan.chapter ?? { chunks: [CHAPTER] };
      case "record":
        return records[Math.min(recordCalls++, records.length - 1)] as FakeScript;
      default:
        return { chunks: [`Reply to: ${lastContent(req)}`] };
    }
  };
}

const compaction = (over: Partial<HostSettings["compaction"]> = {}) => ({
  ...defaultCompaction,
  keepRecent: 2,
  minTurns: 4,
  everyPlayerTurns: 3,
  pressure: 0,
  ...over,
});

async function play(r: ReturnType<typeof rig>, n: number, names = "Marrow") {
  const all = [];
  for (let i = 1; i <= n; i++) {
    all.push(await run(r.session.submit({ mode: "do", text: `${names} step ${i}` })));
  }
  return all;
}

describe("automatic compaction", () => {
  it("compacts after N player turns into a summary, a chapter and tracking cards", async () => {
    const r = rig(script(), { settings: { compaction: compaction() } });
    const rounds = await play(r, 3);

    expect(rounds[0]?.map((e) => e.type)).not.toContain("compacting");
    const third = rounds[2] ?? [];
    expect(types(third)).toEqual([
      "player",
      "context",
      "text",
      "reply",
      "compacting",
      "compacted",
      "done",
    ]);
    const compacted = pick(third, "compacted")[0];
    expect(compacted?.chapter).toEqual({ number: 1, title: "The Harbour Door" });
    expect(compacted?.cardsUpdated).toEqual(["scene.ch-01", "state.marrow", "state.now"]);
    expect(pick(third, "compacting")[0]?.turns).toBe(4);

    const event = compacted?.event;
    const hostIds = r.sink.events.filter((e) => e.kind === "host").map((e) => e.id);
    expect(event).toMatchObject({ kind: "compact", text: "SUMMARY 1", covers: hostIds[1] });
    expect(r.session.chapters.map((c) => c.title)).toEqual(["The Harbour Door"]);
    expect(r.session.liveCards.map((c) => c.fm.id).sort()).toEqual([
      "scene.ch-01",
      "state.marrow",
      "state.now",
    ]);
    // the transcript is untouched
    expect(r.session.turns).toHaveLength(6);
  });

  it("then builds prompts from the summary, the newest turns and the tracking cards", async () => {
    const r = rig(script(), { settings: { compaction: compaction() } });
    await play(r, 3);
    const events = await run(r.session.submit({ mode: "say", text: "Hello again, Marrow." }));

    const req = r.provider.requests.filter((q) => kindOf(q) === "play").at(-1) as GenerateRequest;
    expect(req.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    const system = systemContent(req);
    expect(system).toContain("Summary so far: SUMMARY 1");
    expect(system).toContain("### Current situation");
    expect(system).toContain("- **Goals:** Find the fourth light");
    expect(system).toContain("### Marrow (now)"); // triggered by the name in the input
    expect(system).not.toContain("Marrow step 1"); // compacted turns left the prompt
    const included = pick(events, "context")[0]?.context.included.map((i) => i.id) ?? [];
    expect(included).toEqual(expect.arrayContaining(["state.now", "state.marrow"]));
  });

  it("feeds the next compaction the previous chapter's ending and the existing state", async () => {
    const r = rig(script(), { settings: { compaction: compaction() } });
    await play(r, 6);

    expect(chaptersOf(r.session.state)).toHaveLength(2);
    const chapterCalls = r.provider.requests.filter((q) => kindOf(q) === "chapter");
    const recordCalls = r.provider.requests.filter((q) => kindOf(q) === "record");
    expect(lastContent(chapterCalls[0])).not.toContain("previous_chapter_ending");
    expect(lastContent(chapterCalls[1])).toContain("<previous_chapter_ending>");
    expect(lastContent(recordCalls[0])).toContain("<existing_state>\n[]");
    expect(lastContent(recordCalls[1])).toContain('"name":"Marrow"');
    expect(lastContent(recordCalls[1])).toContain("Wary of the player.");
    const summaryCalls = r.provider.requests.filter((q) => kindOf(q) === "summary");
    expect(lastContent(summaryCalls[1])).toContain("SUMMARY 1");
    // second compaction replaces, not duplicates, the Marrow card
    expect(r.session.liveCards.filter((c) => c.fm.id === "state.marrow")).toHaveLength(1);
    expect(r.session.liveCards.some((c) => c.fm.id === "scene.ch-02")).toBe(true);
  });

  it("never shows host-only world cards to the compactor", async () => {
    const r = rig(script(), { settings: { compaction: compaction() } });
    await play(r, 3);
    const compactorCalls = r.provider.requests.filter((q) => kindOf(q) !== "play");
    expect(compactorCalls).toHaveLength(3);
    for (const q of compactorCalls) {
      expect(JSON.stringify(q.messages)).not.toContain("lit the fourth light himself");
    }
    // but the play prompts do carry them
    expect(
      r.provider.requests.some(
        (q) => kindOf(q) === "play" && systemContent(q).includes("lit the fourth light himself"),
      ),
    ).toBe(true);
  });

  it("can trigger on prompt-budget pressure instead of turn count", async () => {
    const r = rig(script(), {
      settings: { compaction: compaction({ everyPlayerTurns: 0, pressure: 0.0001 }) },
    });
    const rounds = await play(r, 3);
    expect(rounds.map((e) => pick(e, "compacted").length)).toEqual([0, 0, 1]);
  });

  it("does nothing when disabled", async () => {
    const r = rig(script(), { settings: { compaction: compaction({ enabled: false }) } });
    await play(r, 6);
    expect(r.sink.events.some((e) => e.kind === "compact")).toBe(false);
    expect(r.provider.requests.every((q) => kindOf(q) === "play")).toBe(true);
  });

  it("uses a separate model for the compaction calls when configured", async () => {
    const r = rig(script(), { settings: { compaction: compaction({ model: "cheap-model" }) } });
    await play(r, 3);
    const models = r.provider.requests.map((q) => [kindOf(q), q.model]);
    expect(models.filter(([k]) => k !== "play").every(([, m]) => m === "cheap-model")).toBe(true);
    expect(models.filter(([k]) => k === "play").every(([, m]) => m === "fake-model")).toBe(true);
    expect(r.sink.events.find((e) => e.kind === "compact")?.model).toBe("cheap-model");
  });
});

describe("compaction failures never break play", () => {
  const down = new LlmError("server", "The model had a problem on its side.");

  for (const [name, plan] of [
    ["summary", { summary: { error: down } }],
    ["chapter", { chapter: { error: down } }],
    ["chapter that is empty", { chapter: { chunks: ["Title: Nothing"] } }],
  ] satisfies Array<[string, Plan]>) {
    it(`leaves the story untouched when the ${name} step fails`, async () => {
      const r = rig(script(plan), { settings: { compaction: compaction() } });
      const rounds = await play(r, 3);
      const third = rounds[2] ?? [];
      expect(pick(third, "reply")).toHaveLength(1);
      expect(pick(third, "compacted")).toEqual([]);
      expect(pick(third, "warning")[0]?.message).toMatch(/could not be compacted this time/);
      expect(r.sink.events.some((e) => e.kind === "compact")).toBe(false);
      expect(r.session.chapters).toEqual([]);
    });
  }

  it("retries the card record once and uses the second answer", async () => {
    const r = rig(script({ record: [{ chunks: ["Sorry, no."] }, { chunks: [RECORD] }] }), {
      settings: { compaction: compaction() },
    });
    const third = (await play(r, 3))[2] ?? [];
    expect(pick(third, "warning")).toEqual([]);
    expect(pick(third, "compacted")[0]?.cardsUpdated).toHaveLength(3);
  });

  it("still saves the chapter and summary when the card record fails twice", async () => {
    const r = rig(script({ record: [{ chunks: ["no"] }, { error: down }] }), {
      settings: { compaction: compaction() },
    });
    const third = (await play(r, 3))[2] ?? [];
    expect(pick(third, "compacted")[0]?.cardsUpdated).toEqual([]);
    expect(pick(third, "warning")[0]?.message).toMatch(
      /scene and state cards could not be updated/,
    );
    expect(r.session.chapters).toHaveLength(1);
    expect(r.session.liveCards).toEqual([]);
    expect(r.session.memory.summary).toBe("SUMMARY 1");
  });

  it("stops quietly when the caller aborts during compaction", async () => {
    const r = rig(script(), { settings: { compaction: compaction() } });
    await play(r, 2);
    const controller = new AbortController();
    const events = [];
    for await (const ev of r.session.submit({ mode: "do", text: "step 3" }, controller.signal)) {
      events.push(ev);
      if (ev.type === "reply") controller.abort();
    }
    expect(types(events)).toContain("compacting");
    expect(pick(events, "compacted")).toEqual([]);
    expect(pick(events, "warning")).toEqual([]);
    expect(r.sink.events.some((e) => e.kind === "compact")).toBe(false);
  });

  it("reports a save failure for the compaction event", async () => {
    const sink = memorySink();
    const r = rig(script(), { settings: { compaction: compaction() }, sink });
    await play(r, 2);
    // the 3rd turn writes player, reply, then the compact event: fail on the third append
    const original = sink.append.bind(sink);
    let n = 0;
    sink.append = async (e) => {
      if (++n === 3) throw new Error("disk full");
      return original(e);
    };
    const events = await run(r.session.submit({ mode: "do", text: "step 3" }));
    expect(pick(events, "error")[0]).toMatchObject({ code: "persist", recoverable: false });
  });
});

describe("close this chapter", () => {
  it("compacts on demand before any trigger fires", async () => {
    const r = rig(script(), { settings: { compaction: compaction({ everyPlayerTurns: 99 }) } });
    await play(r, 2);
    expect(r.sink.events.some((e) => e.kind === "compact")).toBe(false);

    const events = await run(r.session.compact());
    expect(types(events)).toEqual(["compacting", "compacted", "done"]);
    expect(r.session.chapters).toHaveLength(1);
  });

  it("explains when there is not enough story yet", async () => {
    const r = rig(script());
    const events = await run(r.session.compact());
    expect(pick(events, "warning")[0]?.message).toMatch(/not enough new story/);
    expect(r.provider.requests).toHaveLength(0);
  });
});

describe("compaction follows the branch", () => {
  it("undo, retry and goto change which chapters and cards are current", async () => {
    const r = rig(script(), { settings: { compaction: compaction() } });
    await play(r, 3);
    const compactId = r.sink.events.find((e) => e.kind === "compact")?.id as string;
    expect(r.session.chapters).toHaveLength(1);

    // undo the last action: the compaction lived after it, so it is gone from this branch
    expect(await r.session.undo()).toBe(true);
    expect(r.session.chapters).toEqual([]);
    expect(r.session.liveCards).toEqual([]);
    expect(projectAdventure(r.session.state)).toEqual([]);

    // going back to the compaction brings the chapter and cards back
    await r.session.goto(compactId);
    expect(r.session.chapters).toHaveLength(1);
    expect(projectAdventure(r.session.state).map((f) => f.path)).toEqual([
      "chapters/chapter-01-the-harbour-door.md",
      "chapters/index.md",
      "cards/scene.ch-01.md",
      "cards/state.marrow.md",
      "cards/state.now.md",
    ]);

    // retrying the reply that triggered it replaces that branch: the retried reply is written from
    // the full history, and the compaction is simply redone on the new branch
    const retried = await run(r.session.retry());
    const req = r.provider.requests.filter((q) => kindOf(q) === "play").at(-1) as GenerateRequest;
    expect(JSON.stringify(req.messages)).toContain("Marrow step 1");
    expect(pick(retried, "compacted")).toHaveLength(1);
    expect(r.session.chapters).toHaveLength(1);
    expect(r.session.chapters[0]?.eventId).not.toBe(compactId);
    expect(r.sink.events.filter((e) => e.kind === "compact")).toHaveLength(2);
    expect(liveCardsOf(r.session.state).length).toBe(3);
  });
});
