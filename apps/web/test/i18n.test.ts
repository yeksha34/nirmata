import { describe, expect, it } from "vitest";
import { CARD_TEMPLATES } from "../../../packages/core/src/templates";
import { bilingual, entries, fill, hindi } from "../src/i18n";

describe("labels in Hindi", () => {
  it("has Hindi for the words the design shows, and none for what people write", () => {
    expect(hindi("Worlds")).toBe("संसार");
    expect(hindi("Play")).toBe("खेलें");
    expect(hindi("Marrow")).toBeUndefined();
  });

  it("gives Hindi and English together where markup cannot go", () => {
    expect(bilingual("Cards")).toBe("पत्रक · Cards");
    expect(bilingual("Something with no Hindi")).toBe("Something with no Hindi");
  });

  it("covers every template's name and every part's name", () => {
    const missing: string[] = [];
    for (const t of CARD_TEMPLATES) {
      if (!hindi(t.label)) missing.push(t.label);
      for (const f of t.fields) if (!hindi(f.label)) missing.push(f.label);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("is Devanagari, not a copy of the English", () => {
    for (const t of CARD_TEMPLATES) {
      const text = hindi(t.label);
      if (text) expect(text).toMatch(/[ऀ-ॿ]/);
    }
  });

  it("covers every template's description and every part's hint", () => {
    const missing: string[] = [];
    for (const t of CARD_TEMPLATES) {
      if (!hindi(t.description)) missing.push(t.description);
      for (const f of t.fields) if (!hindi(f.hint)) missing.push(f.hint);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps every {mark} of the English in the Hindi, and adds none", () => {
    const marks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const wrong = entries().filter(([en, hi]) => marks(en).join() !== marks(hi).join());
    expect(wrong.map(([en]) => en)).toEqual([]);
  });

  it("fills the marks in", () => {
    expect(fill("{n} turns", { n: 3 })).toBe("3 turns");
    expect(bilingual("{n} min ago", { n: 5 })).toBe("5 मिनट पहले · 5 min ago");
    expect(fill("{unknown} stays", {})).toBe("{unknown} stays");
  });

  it("finds the sentence a finished message from the server came from", () => {
    expect(bilingual('There is no world "ashfall".')).toBe(
      '"ashfall" नाम का कोई संसार नहीं है। · There is no world "ashfall".',
    );
    expect(
      bilingual(
        "A banishing sigil flares under Sam's feet, and with a pop of sulphur they are whisked out of the room.",
      ),
    ).toContain("Sam");
    expect(bilingual("That card is not valid: name: A card needs a name.")).toContain(
      "वह पत्रक मान्य नहीं है",
    );
    expect(bilingual("Some message nobody wrote Hindi for.")).toBe(
      "Some message nobody wrote Hindi for.",
    );
  });
});
