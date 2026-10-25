import { describe, expect, it } from "vitest";
import { checkCards, parseCard, parseWorldManifest, plainLinks, stripTitle } from "../src";
import { card, loadWorld } from "./helpers";

const VALID = `---
id: char.marrow
kind: character
name: Marrow
keywords: [marrow, keeper]
summary: A keeper.
---

# Marrow

Gruff.
`;

describe("parseCard", () => {
  it("parses frontmatter and applies defaults", () => {
    const r = parseCard("characters/marrow.md", VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.card.fm).toMatchObject({
      id: "char.marrow",
      kind: "character",
      always: false,
      scope: "both",
      severity: "should",
    });
    expect(r.card.fm.keywords).toEqual(["marrow", "keeper"]);
    expect(stripTitle(r.card.body)).toBe("Gruff.");
  });

  it("accepts comma-separated keywords and CRLF line endings", () => {
    const text = VALID.replace("[marrow, keeper]", "marrow, keeper").replaceAll("\n", "\r\n");
    const r = parseCard("x.md", text);
    expect(r.ok && r.card.fm.keywords).toEqual(["marrow", "keeper"]);
  });

  it("keeps unknown frontmatter keys", () => {
    const r = parseCard("x.md", VALID.replace("summary:", "mood: wary\nsummary:"));
    expect(r.ok && r.card.fm.mood).toBe("wary");
  });

  it("reports a missing frontmatter block", () => {
    const r = parseCard("x.md", "# Just prose");
    expect(r).toEqual({
      ok: false,
      path: "x.md",
      errors: ["missing frontmatter block (--- ... ---)"],
    });
  });

  it("reports schema problems with field names", () => {
    const r = parseCard(
      "x.md",
      VALID.replace("id: char.marrow", "id: Marrow").replace("kind: character", "kind: dragon"),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toMatch(/id: id must look like/);
    expect(r.errors.join("\n")).toMatch(/kind:/);
  });

  it("reports invalid YAML instead of throwing", () => {
    const r = parseCard("x.md", "---\nid: [unclosed\n---\n");
    expect(r.ok).toBe(false);
  });
});

describe("parseWorldManifest", () => {
  it("fills defaults", () => {
    const r = parseWorldManifest('{"name":"w","title":"W"}');
    expect(r.ok && r.world).toMatchObject({
      perspective: "second-person",
    });
  });

  it("rejects unreadable JSON and a missing title", () => {
    expect(parseWorldManifest("{").ok).toBe(false);
    expect(parseWorldManifest('{"name":"w"}').ok).toBe(false);
  });
});

describe("plainLinks", () => {
  it("keeps link text, drops relative paths, leaves external links alone", () => {
    expect(plainLinks("See [The Fog](../lore/the_fog.md) and [site](https://x.io/a).")).toBe(
      "See The Fog and [site](https://x.io/a).",
    );
  });
});

describe("checkCards", () => {
  it("flags duplicate ids", () => {
    const errors = checkCards([card("lore.a"), card("lore.a")]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/duplicate id "lore.a"/);
  });
});

describe("the shipped example world", () => {
  it("parses every card with no problems and unique ids", () => {
    const { cards, problems } = loadWorld("example-world");
    expect(problems).toEqual([]);
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(checkCards(cards)).toEqual([]);
  });
});
