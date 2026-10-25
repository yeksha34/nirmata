import { describe, expect, it } from "vitest";
import {
  clampBox,
  defaultBox,
  isNarrow,
  MIN_H,
  MIN_W,
  moveBox,
  parseSaved,
  resizeBox,
} from "../src/window-geometry";

const inside = (b: { x: number; y: number; w: number; h: number }, vw: number, vh: number) =>
  b.x >= 0 && b.y >= 0 && b.x + b.w <= vw && b.y + b.h <= vh;

describe("where the story window starts", () => {
  it("docks to the right, under the page's bar, inside the screen", () => {
    const b = defaultBox(1440, 900);
    expect(b).toMatchObject({ w: 560, y: 56 });
    expect(b.x + b.w).toBe(1440 - 16);
    expect(inside(b, 1440, 900)).toBe(true);
  });

  it("shrinks to fit a small screen", () => {
    const b = defaultBox(700, 500);
    expect(inside(b, 700, 500)).toBe(true);
    expect(b.w).toBeLessThanOrEqual(700 - 32);
  });
});

describe("moving and resizing", () => {
  const start = { x: 100, y: 100, w: 500, h: 400 };

  it("moves by the distance dragged", () => {
    expect(moveBox(start, 30, -20, 1440, 900)).toEqual({ x: 130, y: 80, w: 500, h: 400 });
  });

  it("can't be dragged out of the screen", () => {
    expect(moveBox(start, -999, -999, 1440, 900)).toMatchObject({ x: 0, y: 0 });
    const far = moveBox(start, 9999, 9999, 1440, 900);
    expect(inside(far, 1440, 900)).toBe(true);
    expect(far).toMatchObject({ x: 1440 - 500, y: 900 - 400 });
  });

  it("resizes from the bottom right and never below the minimum or past the screen", () => {
    expect(resizeBox(start, 50, 60, 1440, 900)).toEqual({ x: 100, y: 100, w: 550, h: 460 });
    expect(resizeBox(start, -999, -999, 1440, 900)).toMatchObject({ w: MIN_W, h: MIN_H });
    const big = resizeBox(start, 9999, 9999, 1440, 900);
    expect(inside(big, 1440, 900)).toBe(true);
  });

  it("is pulled back in when the screen gets smaller", () => {
    const b = clampBox({ x: 900, y: 600, w: 560, h: 700 }, 800, 600);
    expect(inside(b, 800, 600)).toBe(true);
  });

  it("is smaller than the minimum only when the screen is", () => {
    const b = clampBox({ x: 0, y: 0, w: 500, h: 500 }, 300, 250);
    expect(b).toEqual({ x: 0, y: 0, w: 300, h: 250 });
  });
});

describe("what is remembered", () => {
  it("reads back what was stored", () => {
    const saved = parseSaved(
      JSON.stringify({ box: { x: 1, y: 2, w: 400, h: 300 }, view: "minimized" }),
    );
    expect(saved).toEqual({ box: { x: 1, y: 2, w: 400, h: 300 }, view: "minimized" });
  });

  it("treats anything else as nothing stored", () => {
    for (const bad of [null, undefined, "", "nope", "{}", '{"box":{"x":"1"}}', '{"box":null}']) {
      expect(parseSaved(bad), String(bad)).toBeUndefined();
    }
  });

  it("falls back to open for an unknown view", () => {
    expect(
      parseSaved(JSON.stringify({ box: { x: 0, y: 0, w: 400, h: 300 }, view: "weird" }))?.view,
    ).toBe("open");
  });

  it("is a bottom sheet on a phone", () => {
    expect(isNarrow(375)).toBe(true);
    expect(isNarrow(1024)).toBe(false);
  });
});
