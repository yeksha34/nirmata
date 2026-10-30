import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hindi } from "../src/i18n";
import { otherTheme, parseTheme } from "../src/theme";

const css = readFileSync(join(__dirname, "..", "src", "styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The custom properties a rule declares: `--paper`, `--ink` ... */
function declared(selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return [];
  const body = css.slice(start, css.indexOf("\n}\n", start));
  return [...body.matchAll(/^\s+(--[\w-]+):/gm)].map((m) => m[1] as string).sort();
}

describe("light and dark", () => {
  it("is light unless dark was chosen, whatever else is stored", () => {
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("DARK")).toBe("light");
    expect(parseTheme("sepia")).toBe("light");
  });

  it("switches to the other one", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });

  it("says its two modes in Hindi", () => {
    expect(hindi("Dark mode")).toMatch(/[ऀ-ॿ]/);
    expect(hindi("Light mode")).toMatch(/[ऀ-ॿ]/);
  });
});

describe("the style sheet's two palettes", () => {
  it("never takes the palette from the system: the design is light, and dark is a choice", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light;/);
  });

  it("gives the dark palette every colour the light one has, and nothing else", () => {
    const light = declared(":root").filter(
      (name) => !/^--(radius|radius-lg|story-font|ui-font)$/.test(name),
    );
    const dark = declared(':root[data-theme="dark"]');
    expect(light.length).toBeGreaterThan(10);
    expect(dark).toEqual(light);
  });

  it("keeps the colours of the design in the light palette", () => {
    const light = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n"));
    for (const [name, value] of Object.entries({
      "--paper": "#fbf7ef",
      "--surface": "#fffdf8",
      "--ink": "#2a2118",
      "--muted": "#6f6253",
      "--line": "#e4d9c6",
      "--line-strong": "#cdbfa9",
      "--accent": "#9a4f04",
      "--accent-soft": "#f6e5cf",
      "--accent-deep": "#6e3600",
      "--sunk": "#f6efe1",
    })) {
      expect(light, name).toContain(`${name}: ${value};`);
    }
  });
});
