import { describe, expect, it } from "vitest";
import { isClipped, place, said, tidy } from "../src/clip-tip";

describe("which text is cut short", () => {
  const fits = { scrollWidth: 200, clientWidth: 200, scrollHeight: 20, clientHeight: 20 };

  it("is not when it fits, nor for the pixel that rounding adds", () => {
    expect(isClipped(fits)).toBe(false);
    expect(isClipped({ ...fits, scrollWidth: 201 })).toBe(false);
    expect(isClipped({ ...fits, scrollHeight: 21 })).toBe(false);
  });

  it("is when a line runs past its box", () => {
    expect(isClipped({ ...fits, scrollWidth: 340 })).toBe(true);
  });

  it("is when lines are clamped away, as in a story's two-line preview", () => {
    expect(isClipped({ ...fits, scrollHeight: 66, clientHeight: 44 })).toBe(true);
  });
});

describe("where the tooltip goes", () => {
  const view = { width: 1000, height: 700 };

  it("hangs under the text, lined up with its left edge", () => {
    expect(place({ left: 120, top: 40, right: 320, bottom: 64 }, view)).toEqual({
      left: 120,
      top: 70,
      maxWidth: 480,
    });
  });

  it("is kept inside the window at the right and at the left", () => {
    const right = place({ left: 900, top: 40, right: 990, bottom: 64 }, view);
    expect(right.left + right.maxWidth).toBeLessThanOrEqual(992);
    expect(place({ left: -30, top: 40, right: 50, bottom: 64 }, view).left).toBe(8);
  });

  it("stands above the text when there is no room below it", () => {
    const up = place({ left: 100, top: 660, right: 300, bottom: 690 }, view);
    expect(up.top).toBeUndefined();
    expect(up.bottom).toBe(700 - 660 + 6);
  });

  it("is never wider than a narrow window", () => {
    expect(
      place({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 360, height: 640 }).maxWidth,
    ).toBe(344);
  });
});

describe("what the tooltip says", () => {
  it("collapses the white space that markup leaves in a label", () => {
    expect(tidy("  one \n  two\t three ")).toBe("one two three");
  });

  it("gives the Hindi, with the English under it when it differs", () => {
    expect(said("संसार\n चुनें", " Choose a world ")).toEqual({
      main: "संसार चुनें",
      english: "Choose a world",
    });
  });

  it("says a name that people wrote once", () => {
    expect(said("Marguerite Dunleavy", "Marguerite Dunleavy")).toEqual({
      main: "Marguerite Dunleavy",
    });
    expect(said("Orla", "")).toEqual({ main: "Orla" });
  });
});
