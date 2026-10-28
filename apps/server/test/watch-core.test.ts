import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNoise, settle } from "../src/watch-core";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ms = (n: number) => vi.advanceTimersByTimeAsync(n);

describe("settling many changes into one run", () => {
  it("runs once, after the changes have been quiet, with everything that changed", async () => {
    const runs: string[][] = [];
    const s = settle(async (what) => void runs.push(what), { quietMs: 1000 });
    s.poke("a.md");
    await ms(600);
    s.poke("b.md");
    await ms(600);
    s.poke("a.md");
    expect(runs).toEqual([]);
    await ms(999);
    expect(runs).toEqual([]);
    await ms(2);
    expect(runs).toEqual([["a.md", "b.md"]]);
    await ms(5000);
    expect(runs).toHaveLength(1);
  });

  it("does not wait for ever when changes keep coming", async () => {
    const runs: string[][] = [];
    const s = settle(async (what) => void runs.push(what), { quietMs: 1000, maxWaitMs: 4000 });
    for (let i = 0; i < 6; i++) {
      s.poke(`f${i}.md`);
      await ms(800);
    }
    expect(runs.length).toBe(1);
    expect((runs[0] ?? []).length).toBeGreaterThanOrEqual(4);
    await ms(2000);
    expect(runs.length).toBe(2);
  });

  it("never runs two at once: changes during a run are followed by one more run", async () => {
    let active = 0;
    let most = 0;
    const runs: string[][] = [];
    const s = settle(
      async (what) => {
        active++;
        most = Math.max(most, active);
        runs.push(what);
        await new Promise((r) => setTimeout(r, 3000));
        active--;
      },
      { quietMs: 500 },
    );
    s.poke("a.md");
    await ms(600);
    expect(runs).toEqual([["a.md"]]);
    s.poke("b.md");
    await ms(600);
    s.poke("c.md");
    await ms(600);
    expect(runs).toHaveLength(1);
    await ms(3000);
    expect(runs).toEqual([["a.md"], ["b.md", "c.md"]]);
    await ms(4000);
    expect(runs).toHaveLength(2);
    expect(most).toBe(1);
  });

  it("reports a failed run and carries on with the next", async () => {
    const errors: unknown[] = [];
    let n = 0;
    const s = settle(
      async () => {
        if (++n === 1) throw new Error("boom");
      },
      { quietMs: 100, onError: (e) => errors.push(e) },
    );
    s.poke("a");
    await ms(200);
    s.poke("b");
    await ms(200);
    expect(n).toBe(2);
    expect(errors).toHaveLength(1);
  });

  it("can be flushed, and stopped", async () => {
    const runs: string[][] = [];
    const s = settle(async (what) => void runs.push(what), { quietMs: 10_000 });
    s.poke("a.md");
    await s.flush();
    expect(runs).toEqual([["a.md"]]);
    await s.flush();
    expect(runs).toHaveLength(1);
    s.poke("b.md");
    s.stop();
    await ms(20_000);
    expect(runs).toHaveLength(1);
  });
});

describe("what is not a change to the story", () => {
  it("skips version control, caches and editors' scratch files", () => {
    for (const p of [
      ".git/index",
      ".git",
      "lore/.git/x",
      "__pycache__/a.pyc",
      "drafts/chapter.md~",
      "drafts/.chapter.md.swp",
      "drafts/chapter.md.tmp",
      "drafts/~$chapter.docx",
      ".DS_Store",
      "x/Thumbs.db",
      "plot/4913",
      "plot\\.git\\HEAD",
    ])
      expect(isNoise(p), p).toBe(true);
  });

  it("keeps the files that are the story", () => {
    for (const p of [
      "characters/human_orla_vale.md",
      "drafts/news_debate_episode_1.md",
      ".agents/rules/world_01.md",
      "assets/map.png",
      "lore/git_notes.md",
    ])
      expect(isNoise(p), p).toBe(false);
  });
});
