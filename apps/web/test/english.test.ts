import { describe, expect, it } from "vitest";
// @ts-expect-error a plain script, shared with the command line
import { findEnglish } from "../scripts/find-english.mjs";
import { hasHindi } from "../src/i18n";

interface Found {
  file: string;
  line: number;
  kind: string;
  text: string;
}

// English that is meant to stay: said only to screen readers (hidden on screen), or a starting value
// in a field that a person then edits.
const ALLOWED: Array<{ file: string; text: string; why: string }> = [
  { file: "header.tsx", text: "Connected", why: "screen readers only (sr-only)" },
  {
    file: "header.tsx",
    text: "Connection lost, trying again",
    why: "screen readers only (sr-only)",
  },
  { file: "api.ts", text: "Bearer {seat}", why: "a request header, never shown" },
  {
    file: "screens/Table.tsx",
    text: "My world",
    why: "the starting title in a field that is then edited",
  },
  {
    file: "vn/VnCanvas.tsx",
    text: "VnStageScene",
    why: "internal Phaser scene key, never shown on screen",
  },
];

describe("static text in the screens", () => {
  it("is all in Hindi (with its English on hover), except what is allowed", () => {
    const left = (findEnglish() as Found[])
      .map((f) => ({
        ...f,
        text: f.text.replace(/^`|`$/g, "").replace(/\$\{(\w+)[^}]*\}/g, "{$1}"),
      }))
      .filter((f) => !hasHindi(f.text))
      .filter((f) => !ALLOWED.some((a) => a.file === f.file && a.text === f.text));
    expect(left.map((f) => `${f.file}:${f.line} ${f.kind} ${JSON.stringify(f.text)}`)).toEqual([]);
  });
});
