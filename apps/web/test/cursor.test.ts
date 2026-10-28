import { describe, expect, it } from "vitest";
import {
  emitAlong,
  fade,
  MAX_SHEETS,
  REST_SPEED,
  type Sheet,
  SPACING,
  step,
} from "../src/reader/cursor";

const seeded = () => {
  let s = 7;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

describe("pages coming off a moving pointer", () => {
  it("lets go of one for each stretch of travel, and carries the rest over", () => {
    const sheets: Sheet[] = [];
    const carry = emitAlong(sheets, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 400, seeded());
    expect(sheets).toHaveLength(Math.floor(100 / SPACING));
    expect(carry).toBeCloseTo(100 - Math.floor(100 / SPACING) * SPACING);
  });

  it("adds up short moves: a mouse moving slowly still sheds pages", () => {
    const sheets: Sheet[] = [];
    let carry = 0;
    for (let x = 0; x < 30; x += 10) {
      carry = emitAlong(sheets, { x, y: 0 }, { x: x + 10, y: 0 }, carry, 200, seeded());
    }
    expect(sheets).toHaveLength(1);
    expect(carry).toBeCloseTo(30 - SPACING);
  });

  it("lets go of none when the pointer has not moved", () => {
    const sheets: Sheet[] = [];
    expect(emitAlong(sheets, { x: 5, y: 5 }, { x: 5, y: 5 }, 9, 0)).toBe(9);
    expect(sheets).toEqual([]);
  });

  it("starts each on the line the pointer travelled", () => {
    const sheets: Sheet[] = [];
    emitAlong(sheets, { x: 100, y: 50 }, { x: 300, y: 250 }, 0, 800, seeded());
    expect(sheets.length).toBeGreaterThan(3);
    for (const s of sheets) {
      expect(s.x).toBeGreaterThanOrEqual(100);
      expect(s.x).toBeLessThanOrEqual(300);
      expect(s.y - 50).toBeCloseTo(s.x - 100, 5);
    }
  });

  it("blows them back the way the pointer came, harder the faster it went", () => {
    const back = (speed: number) => {
      const sheets: Sheet[] = [];
      emitAlong(sheets, { x: 0, y: 0 }, { x: 400, y: 0 }, 0, speed, seeded());
      return sheets.map((s) => s.vx);
    };
    const slow = back(100);
    const fast = back(1800);
    expect(slow.every((v) => v < 0)).toBe(true);
    expect(fast.every((v) => v < 0)).toBe(true);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(fast)).toBeLessThan(mean(slow));
  });

  it("never has more in the air than the limit, however far the pointer flies", () => {
    const sheets: Sheet[] = [];
    emitAlong(sheets, { x: 0, y: 0 }, { x: 20_000, y: 3_000 }, 0, 2000, seeded());
    expect(sheets).toHaveLength(MAX_SHEETS);
  });

  it("takes its randomness as an argument, so a run can be repeated", () => {
    const run = () => {
      const sheets: Sheet[] = [];
      emitAlong(sheets, { x: 0, y: 0 }, { x: 200, y: 80 }, 0, 600, seeded());
      step(sheets, 0.016, 0.3, { x: 400, y: 160 });
      return sheets;
    };
    expect(run()).toEqual(run());
  });
});

describe("the gust", () => {
  it("carries the pages back along the way the pointer went, and they fall away", () => {
    const sheets: Sheet[] = [];
    emitAlong(sheets, { x: 500, y: 300 }, { x: 800, y: 300 }, 0, 1200, seeded());
    const startX = sheets.map((s) => s.x);
    for (let t = 0; t < 0.3; t += 0.016) step(sheets, 0.016, t, { x: 1200, y: 0 });
    // each has been blown to the left of where it started (the pointer went right)
    // (a page lives longer than the 0.3 seconds run here, so none has dropped out of the list)
    for (const [i, s] of sheets.entries()) expect(s.x).toBeLessThan((startX[i] as number) + 1);
    expect(sheets.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
  });

  it("lets every page go in the end, and leaves none behind when the mouse rests", () => {
    const sheets: Sheet[] = [];
    emitAlong(sheets, { x: 0, y: 0 }, { x: 600, y: 200 }, 0, 1500, seeded());
    expect(sheets.length).toBeGreaterThan(0);
    for (let t = 0; t < 2.5; t += 0.016) step(sheets, 0.016, t);
    expect(sheets).toEqual([]);
  });

  it("fades a page out over its life, from whole to gone", () => {
    const sheets: Sheet[] = [];
    emitAlong(sheets, { x: 0, y: 0 }, { x: 60, y: 0 }, 0, 500, seeded());
    const s = sheets[0] as Sheet;
    expect(fade(s)).toBe(1);
    let before = 1;
    for (let age = 0.1; age < s.life; age += 0.1) {
      s.age = age;
      expect(fade(s)).toBeLessThanOrEqual(before);
      before = fade(s);
    }
    s.age = s.life;
    expect(fade(s)).toBe(0);
  });

  it("counts a pointer that is barely moving as at rest", () => {
    expect(REST_SPEED).toBeGreaterThan(0);
    expect(REST_SPEED).toBeLessThan(100);
  });
});
