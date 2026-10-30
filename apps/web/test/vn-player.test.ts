import { describe, expect, it } from "vitest";
import type { VnSlideDeck } from "../src/types";
import { applyVarOps } from "../src/vn/types";

describe("visual novel presentation engine (client)", () => {
  describe("applyVarOps", () => {
    it("handles assignment, addition and subtraction", () => {
      const initial = { trust: 5, suspicion: 2, flag: false };

      const step1 = applyVarOps(initial, [
        { variable: "trust", op: "+", value: 2 },
        { variable: "suspicion", op: "-", value: 1 },
        { variable: "flag", op: "=", value: true },
      ]);

      expect(step1).toEqual({
        trust: 7,
        suspicion: 1,
        flag: true,
      });
    });

    it("initializes missing variables to 0 before arithmetic", () => {
      const initial = {};
      const next = applyVarOps(initial, [{ variable: "affinity", op: "+", value: 3 }]);
      expect(next).toEqual({ affinity: 3 });
    });

    it("returns clone unchanged if no operations provided", () => {
      const initial = { count: 10 };
      expect(applyVarOps(initial)).toEqual({ count: 10 });
    });
  });

  describe("slide deck navigation simulation", () => {
    const mockDeck: VnSlideDeck = {
      slug: "test-deck",
      title: "Test Deck",
      initialSceneId: "SC-01",
      sceneOrder: ["SC-01", "SC-02", "SC-03"],
      slides: [
        {
          id: "SC-01-001",
          sceneId: "SC-01",
          route: "common",
          stage: { characters: [] },
          dialogue: { text: "Slide 1" },
          action: { type: "continue", nextSlideId: "SC-01-002" },
        },
        {
          id: "SC-01-002",
          sceneId: "SC-01",
          route: "common",
          stage: { characters: [] },
          dialogue: { text: "Slide 2" },
          action: {
            type: "menu",
            choices: [
              { text: "Path A", targetSceneId: "SC-02" },
              {
                text: "Path B",
                targetSceneId: "SC-03",
                varChanges: [{ variable: "bravery", op: "+", value: 1 }],
              },
            ],
          },
        },
        {
          id: "SC-02-001",
          sceneId: "SC-02",
          route: "path_a",
          stage: { characters: [] },
          dialogue: { text: "Scene 2 Path A" },
          action: { type: "end", endingName: "ending_a" },
        },
        {
          id: "SC-03-001",
          sceneId: "SC-03",
          route: "path_b",
          stage: { characters: [] },
          dialogue: { text: "Scene 3 Path B" },
          action: { type: "end", endingName: "ending_b" },
        },
      ],
    };

    it("correctly identifies scene targets for branching choices", () => {
      const sceneStartIndexMap = new Map<string, number>();
      for (let i = 0; i < mockDeck.slides.length; i++) {
        const s = mockDeck.slides[i];
        if (s && !sceneStartIndexMap.has(s.sceneId)) {
          sceneStartIndexMap.set(s.sceneId, i);
        }
      }

      expect(sceneStartIndexMap.get("SC-01")).toBe(0);
      expect(sceneStartIndexMap.get("SC-02")).toBe(2);
      expect(sceneStartIndexMap.get("SC-03")).toBe(3);

      const menuSlide = mockDeck.slides[1];
      expect(menuSlide?.action.type).toBe("menu");
      if (menuSlide?.action.type === "menu") {
        const choiceB = menuSlide.action.choices[1];
        expect(choiceB?.targetSceneId).toBe("SC-03");

        const targetIdx = sceneStartIndexMap.get(choiceB?.targetSceneId || "");
        expect(targetIdx).toBe(3);
        expect(targetIdx !== undefined ? mockDeck.slides[targetIdx]?.dialogue.text : "").toBe(
          "Scene 3 Path B",
        );
      }
    });
  });
});
