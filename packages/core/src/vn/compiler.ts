import type { ParsedStageDirective } from "./parser";
import { parseScript } from "./parser";
import type {
  VnDiagnostic,
  VnDialogue,
  VnManifest,
  VnSlide,
  VnSlideAction,
  VnSlideDeck,
  VnSlot,
  VnStageCharacter,
  VnStageState,
} from "./types";
import { validateSlideDeck } from "./validate";

export interface CompileVnOptions {
  manifest?: VnManifest;
  defaultRoute?: string;
}

export interface CompileVnResult {
  deck: VnSlideDeck;
  diagnostics: VnDiagnostic[];
}

/** Assigns a slot for a character if not provided. */
function assignSlot(
  charName: string,
  requestedSlot: VnSlot | undefined,
  existingChars: VnStageCharacter[],
): VnSlot {
  if (requestedSlot) return requestedSlot;
  const existing = existingChars.find((c) => c.character.toLowerCase() === charName.toLowerCase());
  if (existing) return existing.slot;

  const usedSlots = new Set(existingChars.map((c) => c.slot));
  if (!usedSlots.has("center")) return "center";
  if (!usedSlots.has("right")) return "right";
  if (!usedSlots.has("left")) return "left";
  return "center";
}

/** Compiles a visual novel script or full adaptation markdown into a typed slide deck. */
export function compileVn(markdown: string, options: CompileVnOptions = {}): CompileVnResult {
  const { scenes, diagnostics: parseDiagnostics } = parseScript(markdown);
  const diagnostics: VnDiagnostic[] = [...parseDiagnostics];

  const sceneOrder: string[] = scenes.map((s) => s.header.sceneId);
  const initialSceneId = sceneOrder[0] || "SC-01";

  const slides: VnSlide[] = [];

  // Running stage state across the entire script
  let currentBg: string | undefined;
  let currentMusic: string | undefined;
  let currentCg: { name: string; active: boolean } | undefined;
  let charactersOnStage: VnStageCharacter[] = [];

  // Pending stage directives to apply on the next interactive slide
  let pendingTransition: string | undefined;
  let pendingSfx: string | undefined;

  const applyDirectives = (directives: ParsedStageDirective[]) => {
    for (const d of directives) {
      if (d.type === "bg") {
        currentBg = d.name;
      } else if (d.type === "music") {
        currentMusic = d.stop ? undefined : d.name;
      } else if (d.type === "sfx") {
        pendingSfx = d.name;
      } else if (d.type === "cg") {
        currentCg = { name: d.name, active: true };
      } else if (d.type === "hide_cg") {
        currentCg = undefined;
      } else if (d.type === "transition") {
        pendingTransition = d.name;
      } else if (d.type === "show") {
        const slot = assignSlot(d.character, d.slot, charactersOnStage);
        const idx = charactersOnStage.findIndex(
          (c) => c.character.toLowerCase() === d.character.toLowerCase(),
        );
        const existingState = idx >= 0 ? charactersOnStage[idx]?.state : undefined;
        const state = d.state ?? existingState;
        const updated: VnStageCharacter = {
          character: d.character,
          ...(state ? { state } : {}),
          expression: d.expression,
          slot,
        };
        if (idx >= 0) {
          charactersOnStage[idx] = updated;
        } else {
          charactersOnStage.push(updated);
        }
      } else if (d.type === "hide") {
        charactersOnStage = charactersOnStage.filter(
          (c) => c.character.toLowerCase() !== d.character.toLowerCase(),
        );
      }
    }
  };

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex];
    if (!scene) continue;

    const sceneSlides: VnSlide[] = [];
    let slideSeq = 1;

    for (const line of scene.lines) {
      applyDirectives(line.directives);

      const hasDialogue = Boolean(line.dialogue && line.dialogue.text.length > 0);
      const hasMenu = Boolean(line.menu && line.menu.choices.length > 0);
      const isTerminal = Boolean(line.jump || line.end);

      // If line only had directives and neither dialogue nor menu:
      // If it is terminal and there's already a slide in this scene, attach the jump/end to it.
      if (!hasDialogue && !hasMenu) {
        if (isTerminal && sceneSlides.length > 0) {
          const prev = sceneSlides[sceneSlides.length - 1];
          if (prev) {
            if (line.jump) {
              prev.action = { type: "jump", targetSceneId: line.jump };
            } else if (line.end) {
              prev.action = { type: "end", endingName: line.end.endingName };
            }
          }
          continue;
        }
        if (!isTerminal) {
          continue;
        }
      }

      const slideId = `${scene.header.sceneId}-${String(slideSeq++).padStart(3, "0")}`;

      const stageSnapshot: VnStageState = {
        bg: currentBg,
        music: currentMusic,
        cg: currentCg ? { ...currentCg } : undefined,
        transition: pendingTransition,
        sfx: pendingSfx,
        characters: charactersOnStage.map((c) => ({ ...c })),
      };

      // Reset single-beat cues
      pendingTransition = undefined;
      pendingSfx = undefined;

      let dialogue: VnDialogue;
      if (hasDialogue && line.dialogue) {
        dialogue = { ...line.dialogue };
      } else if (hasMenu && line.menu?.prompt) {
        dialogue = { text: line.menu.prompt };
      } else {
        dialogue = { text: "" };
      }

      let action: VnSlideAction;
      if (hasMenu && line.menu) {
        action = {
          type: "menu",
          prompt: line.menu.prompt,
          choices: line.menu.choices,
        };
      } else if (line.jump) {
        action = {
          type: "jump",
          targetSceneId: line.jump,
        };
      } else if (line.end) {
        action = {
          type: "end",
          endingName: line.end.endingName,
        };
      } else {
        action = {
          type: "continue",
        };
      }

      const slide: VnSlide = {
        id: slideId,
        sceneId: scene.header.sceneId,
        route: scene.header.route,
        stage: stageSnapshot,
        dialogue,
        action,
      };

      sceneSlides.push(slide);
    }

    // If scene had no slides at all, create a placeholder slide
    if (sceneSlides.length === 0) {
      const slideId = `${scene.header.sceneId}-001`;
      const fallbackSlide: VnSlide = {
        id: slideId,
        sceneId: scene.header.sceneId,
        route: scene.header.route,
        stage: {
          bg: currentBg,
          music: currentMusic,
          cg: currentCg ? { ...currentCg } : undefined,
          transition: pendingTransition,
          sfx: pendingSfx,
          characters: charactersOnStage.map((c) => ({ ...c })),
        },
        dialogue: { text: `[${scene.header.title}]` },
        action: { type: "continue" },
      };
      pendingTransition = undefined;
      pendingSfx = undefined;
      sceneSlides.push(fallbackSlide);

      diagnostics.push({
        severity: "info",
        code: "empty_scene",
        message: `Scene "${scene.header.sceneId}" had no dialogue lines; generated placeholder slide.`,
        sceneId: scene.header.sceneId,
      });
    }

    // Link slides within the scene
    for (let i = 0; i < sceneSlides.length - 1; i++) {
      const current = sceneSlides[i];
      const next = sceneSlides[i + 1];
      if (current && next && current.action.type === "continue") {
        current.action = {
          type: "continue",
          nextSlideId: next.id,
        };
      }
    }

    // Resolve the final slide of this scene
    const lastSlide = sceneSlides[sceneSlides.length - 1];
    if (lastSlide && lastSlide.action.type === "continue") {
      const nextScene = scenes[sceneIndex + 1];
      if (nextScene) {
        lastSlide.action = {
          type: "jump",
          targetSceneId: nextScene.header.sceneId,
        };
      } else {
        lastSlide.action = {
          type: "end",
        };
      }
    }

    slides.push(...sceneSlides);
  }

  const deck: VnSlideDeck = {
    slug: options.manifest?.slug || "untitled",
    title: options.manifest?.title || (scenes[0]?.header.title ?? "Visual Novel"),
    initialSceneId,
    sceneOrder,
    slides,
  };

  const validationIssues = validateSlideDeck(deck, options.manifest);
  diagnostics.push(...validationIssues);

  return { deck, diagnostics };
}
