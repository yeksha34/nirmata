import { describe, expect, it } from "vitest";
import {
  getDefaultNegativePrompt,
  parseSpriteName,
  synthesizeBackgroundDanbooruPrompt,
  synthesizeCgDanbooruPrompt,
  synthesizeSpriteDanbooruPrompt,
} from "../src/danbooru-prompt";

describe("danbooru-prompt synthesis architecture (content-neutral)", () => {
  describe("parseSpriteName", () => {
    it("extracts character name and expression from standard sprite naming", () => {
      expect(parseSpriteName("heroine_neutral")).toEqual({ charName: "heroine", expr: "neutral" });
      expect(parseSpriteName("heroine_flustered")).toEqual({ charName: "heroine", expr: "flustered" });
      expect(parseSpriteName("heroine_submissive.png")).toEqual({ charName: "heroine", expr: "submissive" });
      expect(parseSpriteName("supervisor_commanding")).toEqual({ charName: "supervisor", expr: "commanding" });
      expect(parseSpriteName("mentor_demanding")).toEqual({ charName: "mentor", expr: "demanding" });
    });

    it("falls back to neutral expression if expression is not separated by underscore", () => {
      expect(parseSpriteName("heroine")).toEqual({ charName: "heroine", expr: "neutral" });
      expect(parseSpriteName("Lead Investigator")).toEqual({ charName: "Lead Investigator", expr: "neutral" });
    });
  });

  describe("synthesizeSpriteDanbooruPrompt", () => {
    it("synthesizes rich Danbooru tags dynamically from character cards", () => {
      const mockHeroineCard = {
        path: "characters/heroine.md",
        card: {
          fm: { id: "char.heroine", kind: "character", name: "Elena" },
          body: "",
        },
        text: `
          <card id="char.heroine" name="Elena">
            <appearance>A 22-year-old girl with dark brown hair, bob cut, straight bangs, brown eyes, and fair skin.</appearance>
            <body-description>Slender build, small breasts, navel, collarbone.</body-description>
            <wardrobe>Sheer crop top, see-through shirt, charcoal micro miniskirt, black thighhighs, and high heels.</wardrobe>
          </card>
        `,
      };

      const prompt = synthesizeSpriteDanbooruPrompt("Elena_neutral", [mockHeroineCard]);

      // Character & Subject
      expect(prompt).toContain("1girl, solo");

      // Appearance & Identity
      expect(prompt).toContain("22yo");
      expect(prompt).toContain("dark brown hair");
      expect(prompt).toContain("bob cut");
      expect(prompt).toContain("straight bangs");
      expect(prompt).toContain("fair skin");

      // Physical characteristics & body description
      expect(prompt).toContain("slender");
      expect(prompt).toContain("small breasts");
      expect(prompt).toContain("navel");

      // Wardrobe / Clothing
      expect(prompt).toContain("crop top");
      expect(prompt).toContain("micro miniskirt");
      expect(prompt).toContain("thighhighs");
      expect(prompt).toContain("high heels");

      // Uncensored rating
      expect(prompt).toContain("uncensored");

      // Composition / Cutout
      expect(prompt).toContain("white background");
      expect(prompt).toContain("character cutout");
    });

    it("synthesizes expression-specific tags for flustered and submissive states", () => {
      const flusteredPrompt = synthesizeSpriteDanbooruPrompt("heroine_flustered");
      expect(flusteredPrompt).toContain("blushing");
      expect(flusteredPrompt).toContain("embarrassed");
      expect(flusteredPrompt).toContain("shy");

      const submissivePrompt = synthesizeSpriteDanbooruPrompt("heroine_submissive");
      expect(submissivePrompt).toContain("teary eyes");
      expect(submissivePrompt).toContain("looking down");
      expect(submissivePrompt).toContain("submissive");
      expect(submissivePrompt).toContain("knees slightly bent");
    });

    it("synthesizes rich Danbooru tags dynamically for male characters from cards", () => {
      const mockManagerCard = {
        path: "characters/manager.md",
        card: {
          fm: { id: "char.manager", kind: "character", name: "Supervisor" },
          body: "",
        },
        text: `
          <card id="char.manager" name="Supervisor">
            <appearance>A 50-year-old man, broad shoulders, heavy jowl, thinning sandy hair.</appearance>
            <wardrobe>Business suit, navy blazer, necktie, white collared shirt.</wardrobe>
          </card>
        `,
      };

      const prompt = synthesizeSpriteDanbooruPrompt("Supervisor_demanding", [mockManagerCard]);
      expect(prompt).toContain("1man, solo");
      expect(prompt).toContain("50yo");
      expect(prompt).toContain("broad shoulders");
      expect(prompt).toContain("heavy jowl");
      expect(prompt).toContain("sandy hair");
      expect(prompt).toContain("business suit");
      expect(prompt).toContain("necktie");
      expect(prompt).toContain("uncensored");
    });

    it("synthesizes special stylized and non-human anatomical tags dynamically from creature cards", () => {
      const mockCreatureCard = {
        path: "characters/creature.md",
        card: {
          fm: { id: "char.creature", kind: "character", name: "Creature" },
          body: "",
        },
        text: `
          <card id="char.creature" name="Creature">
            <kind>fantasy girl</kind>
            <features>fox ears, sharp fangs, wings, horns, tail</features>
            <anatomy>digitigrade legs</anatomy>
          </card>
        `,
      };

      const prompt = synthesizeSpriteDanbooruPrompt("Creature_neutral", [mockCreatureCard]);
      expect(prompt).toContain("fox ears");
      expect(prompt).toContain("sharp canine fangs");
      expect(prompt).toContain("wings");
      expect(prompt).toContain("horns");
      expect(prompt).toContain("tail");
      expect(prompt).toContain("digitigrade legs");
      expect(prompt).toContain("uncensored");
    });
  });

  describe("synthesizeCgDanbooruPrompt", () => {
    it("synthesizes 16:9 cinematic narrative CG tags with dynamic context and uncensored rating", () => {
      const copyPrompt = synthesizeCgDanbooruPrompt("cg_office_alcove");
      expect(copyPrompt).toContain("cinematic event CG");
      expect(copyPrompt).toContain("16:9 widescreen");
      expect(copyPrompt).toContain("office interior");
      expect(copyPrompt).toContain("uncensored");

      const windowPrompt = synthesizeCgDanbooruPrompt("cg_window_balcony");
      expect(windowPrompt).toContain("large window");
      expect(windowPrompt).toContain("city view");
      expect(windowPrompt).toContain("uncensored");
    });
  });

  describe("synthesizeBackgroundDanbooruPrompt", () => {
    it("synthesizes clean unpopulated environment tags with no humans exclusion", () => {
      const bgPrompt = synthesizeBackgroundDanbooruPrompt("office_procurement_aisle");
      expect(bgPrompt).toContain("no humans");
      expect(bgPrompt).toContain("16:9 widescreen");
      expect(bgPrompt).toContain("visual novel background");
      expect(bgPrompt).toContain("office interior");

      const meetingBg = synthesizeBackgroundDanbooruPrompt("meeting_room");
      expect(meetingBg).toContain("no humans");
      expect(meetingBg).toContain("meeting room");
      expect(meetingBg).toContain("conference table");
    });
  });

  describe("getDefaultNegativePrompt", () => {
    it("returns appropriate negative prompt for sprite, cg, and bg", () => {
      const spriteNeg = getDefaultNegativePrompt("sprite");
      expect(spriteNeg).toContain("bad anatomy");
      expect(spriteNeg).toContain("censored");
      expect(spriteNeg).toContain("2girls");

      const cgNeg = getDefaultNegativePrompt("cg");
      expect(cgNeg).toContain("bad anatomy");
      expect(cgNeg).toContain("censored");

      const bgNeg = getDefaultNegativePrompt("bg");
      expect(bgNeg).toContain("1girl, 1boy, human, person");
    });
  });
});
