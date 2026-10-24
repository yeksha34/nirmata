import { chaptersOf, contextTurnsOf, pathTo, projectAdventure, turnsOf } from "@nirmata/core";
import type { GenerateRequest } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import { lastContent, pick, rig, run, systemContent } from "./helpers";

const FILLER = "w ".repeat(100); // ~58 tokens a turn
const play = (req: GenerateRequest) => ({
  chunks: [`Reply to ${lastContent(req).slice(-30)} ${FILLER}`],
});

/** Small enough that only a few turns fit once the host instructions and rules are in. */
const TIGHT = { maxTokens: 700, reserveReply: 100 };

async function turns(r: ReturnType<typeof rig>, n: number, from = 1) {
  const rounds = [];
  for (let i = from; i < from + n; i++) {
    rounds.push(await run(r.session.submit({ mode: "do", text: `Marrow step ${i}` })));
  }
  return rounds;
}

const ownTurnIds = (r: ReturnType<typeof rig>) => turnsOf(r.session.state).map((t) => t.id);

describe("the context window shifts live into the chapter", () => {
  it("records, on the reply, where the window now begins", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    const rounds = await turns(r, 8);

    const replies = rounds.flatMap((e) => pick(e, "reply").map((x) => x.event));
    expect(replies[0]?.shifted).toBeUndefined(); // everything still fits
    expect(replies.at(-1)?.shifted).toBeDefined();

    // the cursor only ever moves forward
    const order = ownTurnIds(r);
    const cursors = replies.flatMap((e) => (e.shifted ? [order.indexOf(e.shifted)] : []));
    expect(cursors.length).toBeGreaterThan(1);
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
  });

  it("writes exactly the turns outside the window to the chapter, and the rest stay in the prompt", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 8);

    const all = ownTurnIds(r);
    const inChapter = chaptersOf(r.session.state).flatMap((c) => c.turns.map((t) => t.id));
    const inWindow = contextTurnsOf(r.session.state).map((t) => t.id);
    expect(inChapter.length).toBeGreaterThan(0);
    expect([...inChapter, ...inWindow]).toEqual(all);

    const chapter = r.session.chapters[0];
    expect(chapter?.text).toContain("> **Do:** Marrow step 1");
    expect(chapter?.open).toBe(true);
    expect(chapter?.text).not.toContain("Marrow step 8");

    // the latest prompt never repeats anything that has left the window
    const last = r.provider.requests.at(-1) as GenerateRequest;
    expect(JSON.stringify(last.messages)).not.toContain("Marrow step 1");
    expect(r.session.turns).toHaveLength(16); // the transcript keeps all
  });

  it("makes no model call to shift the window", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 8);
    expect(r.provider.requests).toHaveLength(8);
  });

  it("does not bring turns back when the budget grows", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 8);
    r.session.updateSettings({ budget: { maxTokens: 100_000, reserveReply: 100 } });
    await turns(r, 1, 9);
    const last = r.provider.requests.at(-1) as GenerateRequest;
    expect(JSON.stringify(last.messages)).not.toContain("Marrow step 1");
    expect(JSON.stringify(last.messages)).toContain("Marrow step 8");
  });

  it("keeps everything in the prompt, and no chapter, while it all fits", async () => {
    const r = rig(play, { settings: { budget: { maxTokens: 100_000, reserveReply: 100 } } });
    await turns(r, 6);
    expect(r.session.chapters).toEqual([]);
    expect(contextTurnsOf(r.session.state)).toHaveLength(12);
  });

  it("splits the chapter at a break, and keeps filling the open one", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 4);
    await r.session.breakChapter("Night Falls");
    await turns(r, 6, 5);

    const chapters = r.session.chapters;
    expect(chapters.map((c) => c.title)).toEqual(["Chapter 1", "Night Falls"]);
    expect(chapters.map((c) => c.open)).toEqual([false, true]);
    expect(chapters[0]?.text).not.toContain("Marrow step 5");
    expect(chapters[1]?.text).toContain("Marrow step 5");
  });

  it("rejects a chapter break when nothing has happened", async () => {
    const r = rig(play);
    await expect(r.session.breakChapter()).rejects.toMatchObject({ code: "nothing_to_do" });
  });

  it("follows undo: the chapter shrinks with the window", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 8);
    const before = r.session.chapters[0]?.turns.length ?? 0;
    await r.session.undo();
    await r.session.undo();
    const after = r.session.chapters[0]?.turns.length ?? 0;
    expect(after).toBeLessThan(before);
    expect(contextTurnsOf(r.session.state).length + after).toBe(r.session.turns.length);
  });

  it("recomputes the window for a retried reply", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 8);
    const first = pathTo(r.session.state).at(-1);
    await run(r.session.retry());
    const second = pathTo(r.session.state).at(-1);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.shifted).toBe(first?.shifted);
  });

  it("projects the chapter to a file that grows with the story", async () => {
    const r = rig(play, { settings: { budget: TIGHT } });
    await turns(r, 8);
    const files = projectAdventure(r.session.state);
    const chapter = files.find((f) => f.path.startsWith("chapters/chapter-01"));
    expect(chapter?.content).toContain("> **Do:** Marrow step 1");
    expect(systemContent(r.provider.requests.at(-1))).toContain("game master");
  });
});
