import type { VnDiagnostic, VnManifest, VnSlideDeck } from "./types";

/** Validates integrity of a compiled visual novel slide deck against itself and its manifest. */
export function validateSlideDeck(deck: VnSlideDeck, manifest?: VnManifest): VnDiagnostic[] {
  const diagnostics: VnDiagnostic[] = [];
  const knownScenes = new Set(deck.sceneOrder);

  // Map each scene to its slides
  const sceneSlides = new Map<string, typeof deck.slides>();
  for (const slide of deck.slides) {
    let list = sceneSlides.get(slide.sceneId);
    if (!list) {
      list = [];
      sceneSlides.set(slide.sceneId, list);
    }
    list.push(slide);
  }

  // Set of scenes reached via any jump or menu choice
  const reachedScenes = new Set<string>();
  if (deck.initialSceneId) {
    reachedScenes.add(deck.initialSceneId);
  }

  const declaredVariables = manifest ? new Set(Object.keys(manifest.variables)) : null;

  for (const slide of deck.slides) {
    const action = slide.action;

    if (action.type === "jump") {
      if (!knownScenes.has(action.targetSceneId)) {
        diagnostics.push({
          severity: "error",
          code: "missing_target_scene",
          message: `Slide "${slide.id}" jumps to non-existent scene "${action.targetSceneId}".`,
          sceneId: slide.sceneId,
        });
      } else {
        reachedScenes.add(action.targetSceneId);
      }
    } else if (action.type === "menu") {
      for (const choice of action.choices) {
        if (!knownScenes.has(choice.targetSceneId)) {
          diagnostics.push({
            severity: "error",
            code: "missing_target_scene",
            message: `Choice "${choice.text}" in slide "${slide.id}" branches to non-existent scene "${choice.targetSceneId}".`,
            sceneId: slide.sceneId,
          });
        } else {
          reachedScenes.add(choice.targetSceneId);
        }

        // Check declared variables
        if (declaredVariables && choice.varChanges) {
          for (const change of choice.varChanges) {
            if (!declaredVariables.has(change.variable)) {
              diagnostics.push({
                severity: "warning",
                code: "undeclared_variable",
                message: `Variable "${change.variable}" modified in choice "${choice.text}" is not declared in manifest.`,
                sceneId: slide.sceneId,
              });
            }
          }
        }
      }
    }
  }

  // Check for unreachable scenes (scenes never targeted and not initial)
  for (const sceneId of deck.sceneOrder) {
    if (!reachedScenes.has(sceneId)) {
      diagnostics.push({
        severity: "warning",
        code: "unreachable_scene",
        message: `Scene "${sceneId}" is never targeted by any menu choice or jump.`,
        sceneId,
      });
    }
  }

  return diagnostics;
}
