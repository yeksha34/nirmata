import { describe, expect, it } from "vitest";
import {
  compileVn,
  createStarterAdaptationMd,
  createStarterManifest,
  parseMenuChoice,
  parseStageDirectives,
  parseVarChanges,
} from "../src/vn";

describe("Visual Novel adaptation parser & compiler", () => {
  describe("parseVarChanges", () => {
    it("parses arithmetic operations", () => {
      expect(parseVarChanges("{trust_vasha +1}")).toEqual([
        { variable: "trust_vasha", op: "+", value: 1 },
      ]);
      expect(parseVarChanges("{suspicion - 3}")).toEqual([
        { variable: "suspicion", op: "-", value: 3 },
      ]);
    });

    it("parses shorthand flag operations", () => {
      expect(parseVarChanges("{+suspects_vasha}")).toEqual([
        { variable: "suspects_vasha", op: "+", value: 1 },
      ]);
      expect(parseVarChanges("{-in_hiding}")).toEqual([
        { variable: "in_hiding", op: "-", value: 1 },
      ]);
    });

    it("parses assignments", () => {
      expect(parseVarChanges('{route = "rebel"}')).toEqual([
        { variable: "route", op: "=", value: "rebel" },
      ]);
      expect(parseVarChanges("{allied = true}")).toEqual([
        { variable: "allied", op: "=", value: true },
      ]);
      expect(parseVarChanges("{gold = 50}")).toEqual([{ variable: "gold", op: "=", value: 50 }]);
    });

    it("parses multiple operations in one block", () => {
      expect(parseVarChanges("{trust + 2, +met_scout, loyalty = 10}")).toEqual([
        { variable: "trust", op: "+", value: 2 },
        { variable: "met_scout", op: "+", value: 1 },
        { variable: "loyalty", op: "=", value: 10 },
      ]);
    });
  });

  describe("parseStageDirectives", () => {
    it("parses background, music, transition directives", () => {
      const res = parseStageDirectives("[bg riverbank_dusk] [music unease] [fade in]");
      expect(res.directives).toEqual([
        { type: "bg", name: "riverbank_dusk" },
        { type: "music", name: "unease" },
        { type: "transition", name: "fade in" },
      ]);
      expect(res.remainingText).toBe("");
    });

    it("parses character show with slot and expression", () => {
      const res = parseStageDirectives("[show vasha worried left] VASHA: Watch out!");
      expect(res.directives).toEqual([
        { type: "show", character: "vasha", expression: "worried", slot: "left" },
      ]);
      expect(res.remainingText).toBe("VASHA: Watch out!");
    });

    it("parses hide, stop music and sfx", () => {
      const res = parseStageDirectives("[hide vasha] [stop music] [sfx thunder]");
      expect(res.directives).toEqual([
        { type: "hide", character: "vasha" },
        { type: "music", stop: true },
        { type: "sfx", name: "thunder" },
      ]);
    });

    it("parses cg show and hide", () => {
      const res1 = parseStageDirectives("[cg river_crossing]");
      expect(res1.directives).toEqual([{ type: "cg", name: "river_crossing" }]);

      const res2 = parseStageDirectives("[hide cg]");
      expect(res2.directives).toEqual([{ type: "hide_cg" }]);
    });
  });

  describe("parseMenuChoice", () => {
    it("parses standard menu choice with arrow and variable change", () => {
      const choice = parseMenuChoice('* "I\'ll cross." → SC-04 {trust_vasha +1}');
      expect(choice).toEqual({
        text: "I'll cross.",
        targetSceneId: "SC-04",
        varChanges: [{ variable: "trust_vasha", op: "+", value: 1 }],
      });
    });

    it("parses canon option and ascii arrow", () => {
      const choice = parseMenuChoice('* "You knew." (canon) -> SC-04b {+suspects_vasha}');
      expect(choice).toEqual({
        text: "You knew.",
        targetSceneId: "SC-04b",
        isCanon: true,
        varChanges: [{ variable: "suspects_vasha", op: "+", value: 1 }],
      });
    });
  });

  describe("compileVn", () => {
    it("compiles starter adaptation into clean slides", () => {
      const manifest = createStarterManifest({
        slug: "ch01-opening",
        title: "Chapter 1",
        source: "chapters/01.md",
        mc: "Kaelen",
      });
      const md = createStarterAdaptationMd({
        slug: "ch01-opening",
        title: "Chapter 1",
        source: "chapters/01.md",
        mc: "Kaelen",
      });

      const { deck, diagnostics } = compileVn(md, { manifest });

      expect(deck.slug).toBe("ch01-opening");
      expect(deck.initialSceneId).toBe("SC-01");
      expect(deck.sceneOrder).toEqual(["SC-01", "SC-02", "SC-03", "SC-04"]);
      expect(deck.slides.length).toBeGreaterThan(0);

      // Verify SC-01 slides
      const sc01Slides = deck.slides.filter((s) => s.sceneId === "SC-01");
      expect(sc01Slides.length).toBe(3);
      expect(sc01Slides[0]?.id).toBe("SC-01-001");
      expect(sc01Slides[0]?.stage.bg).toBe("opening_scene");
      expect(sc01Slides[0]?.stage.music).toBe("theme_ambient");
      expect(sc01Slides[0]?.stage.transition).toBe("fade in");
      expect(sc01Slides[0]?.stage.characters).toEqual([
        { character: "Kaelen", expression: "neutral", slot: "center" },
      ]);
      expect(sc01Slides[0]?.dialogue.text).toBe(
        "The road ahead is quiet, narrower than the maps promised.",
      );
      expect(sc01Slides[0]?.action).toEqual({
        type: "continue",
        nextSlideId: "SC-01-002",
      });

      // Slide 2 is inner monologue
      expect(sc01Slides[1]?.id).toBe("SC-01-002");
      expect(sc01Slides[1]?.dialogue.speaker).toBe("Kaelen");
      expect(sc01Slides[1]?.dialogue.isMonologue).toBe(true);
      expect(sc01Slides[1]?.dialogue.text).toBe(
        "Every journey begins with a breath before the first step.",
      );

      // Slide 3 jumps to SC-02
      expect(sc01Slides[2]?.action).toEqual({
        type: "jump",
        targetSceneId: "SC-02",
      });

      // SC-02 ends with MENU
      const sc02Slides = deck.slides.filter((s) => s.sceneId === "SC-02");
      const lastSc02 = sc02Slides[sc02Slides.length - 1];
      expect(lastSc02).toBeDefined();
      expect(lastSc02?.action.type).toBe("menu");
      if (lastSc02 && lastSc02.action.type === "menu") {
        expect(lastSc02.action.choices.length).toBe(2);
        expect(lastSc02.action.choices[0]?.targetSceneId).toBe("SC-03");
        expect(lastSc02.action.choices[0]?.isCanon).toBe(true);
        expect(lastSc02.action.choices[0]?.varChanges).toEqual([
          { variable: "resolve", op: "+", value: 1 },
        ]);
        expect(lastSc02.action.choices[1]?.targetSceneId).toBe("SC-04");
      }

      // No fatal diagnostics
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("inherits and updates character expressions across slides", () => {
      const script = `
## SC-01 The Encounter [route: common]
[bg clearing]
[show vasha neutral left]
[show kaelen serious right]
VASHA: Who are you?

[show vasha angry]
VASHA: Answer me!

[hide vasha]
KAELEN: A traveler.
`;
      const { deck } = compileVn(script);
      expect(deck.slides).toHaveLength(3);

      // Slide 1
      expect(deck.slides[0]?.stage.characters).toEqual([
        { character: "vasha", expression: "neutral", slot: "left" },
        { character: "kaelen", expression: "serious", slot: "right" },
      ]);

      // Slide 2: vasha becomes angry, slot stays left
      expect(deck.slides[1]?.stage.characters).toEqual([
        { character: "vasha", expression: "angry", slot: "left" },
        { character: "kaelen", expression: "serious", slot: "right" },
      ]);

      // Slide 3: vasha is hidden, kaelen remains
      expect(deck.slides[2]?.stage.characters).toEqual([
        { character: "kaelen", expression: "serious", slot: "right" },
      ]);
    });
  });

  describe("validateSlideDeck", () => {
    it("reports missing jump target", () => {
      const script = `
## SC-01 Test
[jump SC-99]
`;
      const { diagnostics } = compileVn(script);
      const errors = diagnostics.filter((d) => d.code === "missing_target_scene");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.message).toContain("SC-99");
    });

    it("reports undeclared variable when manifest is provided", () => {
      const manifest = createStarterManifest({
        slug: "test",
        title: "Test",
        source: "chapters/01.md",
      });
      const script = `
## SC-01 Test
MENU
  * "Take path" → SC-02 {unknown_stat + 5}

## SC-02 End
The end.
[end]
`;
      const { diagnostics } = compileVn(script, { manifest });
      const warnings = diagnostics.filter((d) => d.code === "undeclared_variable");
      expect(warnings.length).toBe(1);
      expect(warnings[0]?.message).toContain("unknown_stat");
    });

    it("reports unreachable scene", () => {
      const script = `
## SC-01 Start
[end]

## SC-02 Forgotten
This scene is never reached.
[end]
`;
      const { diagnostics } = compileVn(script);
      const unreachable = diagnostics.filter((d) => d.code === "unreachable_scene");
      expect(unreachable.length).toBe(1);
      expect(unreachable[0]?.sceneId).toBe("SC-02");
    });
  });
});
