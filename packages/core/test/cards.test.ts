import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARD_KINDS,
  CARD_TEMPLATES,
  CardFrontmatter,
  cardBody,
  checkCards,
  fieldLabel,
  isFieldId,
  parseCard,
  parseWorldManifest,
  plainLinks,
  serializeCard,
  stripTitle,
  templateFor,
  templatesFor,
} from "../src";
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

  it("says what a file needs when it is not a card", () => {
    const r = parseCard("x.md", "# Just prose");
    expect(r).toEqual({
      ok: false,
      path: "x.md",
      errors: ["not a card: the file should start with <card …> (or an older --- block)"],
    });
  });

  it("reports schema problems with field names", () => {
    const r = parseCard(
      "x.md",
      VALID.replace("id: char.marrow", "id: Marrow").replace("kind: character", "kind: Dragon"),
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

describe("serializeCard", () => {
  it("writes a card that parses back to the same card", () => {
    const text =
      '---\nid: lore.the-fog\nkind: lore\nname: The Fog\nkeywords: [fog, mist]\nsummary: "It: listens."\n---\n# The Fog\n\nIt drifts.\n';
    const first = parseCard("lore/the_fog.md", text);
    if (!first.ok) throw new Error(first.errors.join("; "));
    const again = parseCard("lore/the_fog.md", serializeCard(first.card));
    expect(again.ok && again.card.fm).toEqual(first.ok && first.card.fm);
    expect(again.ok && again.card.body.trim()).toBe("# The Fog\n\nIt drifts.");
  });

  it("writes XML around markdown, leaving defaults out", () => {
    const first = parseCard(
      "characters/marrow.md",
      "---\nid: char.marrow\nkind: character\nname: Marrow\nkeywords: [marrow, keeper]\nsummary: A keeper.\nrole: npc\n---\n\n# Marrow\n\nGruff.\n",
    );
    if (!first.ok) throw new Error(first.errors.join("; "));
    expect(serializeCard(first.card)).toBe(
      `<card id="char.marrow" kind="character" name="Marrow" role="npc">
  <keywords>marrow, keeper</keywords>
  <summary>A keeper.</summary>

# Marrow

Gruff.
</card>
`,
    );
  });
});

describe("the XML + markdown card", () => {
  const XML = `<card id="char.marrow" kind="character" name="Marrow" role="npc" always="true">
  <keywords>marrow, keeper, lighthouse keeper</keywords>
  <summary>Gruff keeper of the north light.</summary>

# Marrow

- **Wants:** the fourth light put out. 1 < 2 & 3 > 2
</card>
`;

  it("reads fields, child tags and a markdown body that is left exactly as written", () => {
    const r = parseCard("characters/marrow.md", XML);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.card.fm).toMatchObject({
      id: "char.marrow",
      kind: "character",
      name: "Marrow",
      role: "npc",
      always: true,
      keywords: ["marrow", "keeper", "lighthouse keeper"],
      summary: "Gruff keeper of the north light.",
    });
    expect(r.card.body).toBe("# Marrow\n\n- **Wants:** the fourth light put out. 1 < 2 & 3 > 2\n");
  });

  it("round trips, including escaped text and fields it does not know", () => {
    const card = {
      path: "lore/x.md",
      fm: CardFrontmatter.parse({
        id: "lore.x",
        kind: "lore",
        name: 'Tom & "Jerry" <3',
        keywords: ["a", "b"],
        summary: "It is <b>bold</b> & loud.",
        plotMax: 2,
        plotHeading: "**Right now:**",
        mood: ["wary", "tired"],
        weird: false,
      }),
      body: "# X\n\nA body with </summary> and <data> in it.\n",
    };
    const again = parseCard("lore/x.md", serializeCard(card));
    expect(again).toEqual({ ok: true, card });
  });

  it("keeps a name that looks like a number as text", () => {
    const r = parseCard("x.md", '<card id="lore.year" kind="lore" name="1984"></card>');
    expect(r.ok && r.card.fm.name).toBe("1984");
  });

  it("takes single quotes, CRLF line endings and a byte-order mark", () => {
    const text = `﻿<card id='lore.a' kind='lore' name='A'>\r\n  <summary>Short.</summary>\r\n\r\nBody.\r\n</card>\r\n`;
    const r = parseCard("x.md", text);
    expect(r.ok && r.card.fm.summary).toBe("Short.");
    expect(r.ok && r.card.body.trim()).toBe("Body.");
  });

  it("allows a comment before the card, as the template files have", () => {
    const text = `<!-- note -->
<!-- another -->
<card id="lore.a" kind="lore" name="A">
Body.
</card>
`;
    const r = parseCard("x.md", text);
    expect(r.ok && r.card.body).toBe("Body.\n");
  });

  it("takes a card with no body, or one that closes itself", () => {
    expect(parseCard("x.md", '<card id="lore.a" kind="lore" name="A"/>').ok).toBe(true);
    const r = parseCard("x.md", '<card id="lore.a" kind="lore" name="A">\n</card>');
    expect(r.ok && r.card.body).toBe("");
  });

  it("says in plain words what is wrong", () => {
    const messages = (text: string) => {
      const r = parseCard("x.md", text);
      return r.ok ? [] : r.errors.join(" | ");
    };
    expect(messages('<card id="lore.a" kind="lore" name="A">\nBody.')).toMatch(
      /no closing <\/card>/,
    );
    expect(messages('<card id="lore.a" kind=lore name="A">\n</card>')).toMatch(/name="value"/);
    expect(messages('<card id="lore.a" id="lore.b" kind="lore" name="A">\n</card>')).toMatch(
      /"id" is written twice/,
    );
    expect(messages('<card id="Lore A" kind="lore" name="A">\n</card>')).toMatch(
      /id: id must look/,
    );
    expect(messages('<card id="lore.a" kind="lore" name="A">\n<summary>x\n</card>')).toMatch(
      /<summary> is never closed/,
    );
    expect(messages('<card id="lore.a" kind="lore" name="A">\n<data>1</data>\n</card>')).toMatch(
      /<data> needs a key/,
    );
  });
});

describe("the card templates", () => {
  it("are valid cards, so a copy works as soon as it is renamed", () => {
    const root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "test-fixtures",
      "worlds",
      "_template",
    );
    for (const f of [
      "lore/_card.template.md",
      "characters/_card.template.md",
      "setting/places/_card.template.md",
      ".agents/rules/_rule.template.md",
    ]) {
      const r = parseCard(f, readFileSync(join(root, f), "utf8"));
      expect(r.ok, f).toBe(true);
    }
  });
});

describe("named parts (fields) in a card", () => {
  const FIELDS = `<card id="char.marrow" kind="character" name="Marrow">
  <keywords>marrow</keywords>
  <age>61</age>
  <appearance>
  Weathered, oilskin coat.

  One lamp-blind eye.
  </appearance>
  <life-outside-the-story>Mends nets.</life-outside-the-story>
  <voice/>

# Marrow

Extra notes.
</card>
`;

  it("reads each part as markdown, in the order written, and the rest as the body", () => {
    const r = parseCard("characters/marrow.md", FIELDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.card.fm.fields)).toEqual(["age", "appearance", "life-outside-the-story"]);
    expect(r.card.fm.fields.appearance).toBe("Weathered, oilskin coat.\n\nOne lamp-blind eye.");
    expect(r.card.body).toBe("# Marrow\n\nExtra notes.\n");
  });

  it("writes them back as tags, short ones on one line, and round trips", () => {
    const first = parseCard("characters/marrow.md", FIELDS);
    if (!first.ok) throw new Error(first.errors.join("; "));
    const text = serializeCard(first.card);
    expect(text).toContain("  <age>61</age>\n");
    expect(text).toContain("  <appearance>\nWeathered, oilskin coat.");
    expect(parseCard("characters/marrow.md", text)).toEqual(first);
  });

  it("leaves a body that starts with ordinary HTML alone, and refuses a part written twice", () => {
    const html = parseCard(
      "x.md",
      '<card id="lore.a" kind="lore" name="A">\n<details>x</details>\n</card>',
    );
    expect(html.ok && html.card.body).toBe("<details>x</details>\n");
    expect(html.ok && html.card.fm.fields).toEqual({});
    const twice = parseCard(
      "x.md",
      '<card id="lore.a" kind="lore" name="A">\n<age>1</age><age>2</age>\n</card>',
    );
    expect(twice.ok ? [] : twice.errors.join(" ")).toMatch(/<age> is written twice/);
  });

  it("puts the parts, with their labels, ahead of the body in what the storyteller reads", () => {
    const r = parseCard("characters/marrow.md", FIELDS);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(cardBody(r.card)).toBe(
      "- **Age:** 61\n**Appearance:**\nWeathered, oilskin coat.\n\nOne lamp-blind eye.\n- **Life outside the story:** Mends nets.\n\nExtra notes.",
    );
  });
});

describe("card templates", () => {
  it("have unique ids, valid field names, and a blank for every kind", () => {
    const ids = CARD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CARD_TEMPLATES) {
      const names = t.fields.map((x) => x.id);
      expect(new Set(names).size, t.id).toBe(names.length);
      for (const n of names) expect(isFieldId(n), `${t.id}.${n}`).toBe(true);
      expect(t.id.startsWith(`${t.kind}.`)).toBe(true);
    }
    for (const kind of CARD_KINDS)
      expect(templatesFor(kind).some((t) => t.fields.length === 0)).toBe(true);
  });

  it("call the same field by the same name wherever it appears", () => {
    const seen = new Map<string, string>();
    for (const t of CARD_TEMPLATES) {
      for (const x of t.fields) {
        expect(seen.get(x.id) ?? x.label, `${t.id}.${x.id}`).toBe(x.label);
        seen.set(x.id, x.label);
      }
    }
  });

  it("are valid cards once filled in, whatever their kind", () => {
    for (const t of CARD_TEMPLATES) {
      const fields = Object.fromEntries(t.fields.map((x) => [x.id, `A ${x.label}.`]));
      const r = parseCard(
        "x.md",
        serializeCard({
          path: "x.md",
          fm: CardFrontmatter.parse({ id: "lore.x", kind: t.kind, name: "X", fields }),
          body: "",
        }),
      );
      expect(r.ok, t.id).toBe(true);
      if (r.ok) expect(r.card.fm.fields).toEqual(fields);
    }
  });

  it("offer a card the template that fits the parts it already has", () => {
    expect(templateFor("character", ["kind", "domain", "followers"]).id).toBe("character.power");
    expect(templateFor("character", ["wants", "voice"]).id).toBe("character.person");
    expect(templateFor("place", []).id).toBe("place.blank");
    expect(fieldLabel("offscreen")).toBe("Life outside the story");
    expect(fieldLabel("trade-routes")).toBe("Trade routes");
  });
});
