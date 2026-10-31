/**
 * Visual Novel adaptation types and slide model.
 * Per ADR-0019 and .agents/skills/story-to-vn-adaptation.
 */

export type VnMode = "mode_1" | "mode_2a" | "mode_2b" | "mode_2_open";

export type VnTier = "micro" | "short" | "mid" | "large";

export type VnSlot = "left" | "center" | "right";

export interface VnVariableDef {
  initial: number | boolean | string;
  description?: string;
}

export interface VnAssetsManifest {
  backgrounds: string[];
  characters: Record<string, string[]>; // character name -> expressions array
  cgs: string[];
  music?: string[];
  sfx?: string[];
}

export interface VnManifest {
  slug: string;
  title: string;
  source: string; // relative to world root, e.g. "chapters/01_first_contact.md"
  mode: VnMode;
  mc: string;
  tier: VnTier;
  routes: string[];
  variables: Record<string, VnVariableDef>;
  assets: VnAssetsManifest;
  createdAt: string;
  updatedAt: string;
  order?: number;
  nextSlug?: string;
}

export interface VnStageCharacter {
  character: string;
  state?: string;
  expression: string;
  slot: VnSlot;
}

export interface VnStageState {
  bg?: string;
  transition?: string;
  music?: string;
  sfx?: string;
  cg?: {
    name: string;
    active: boolean;
  };
  characters: VnStageCharacter[];
}

export interface VnVarOp {
  variable: string;
  op: "+" | "-" | "=";
  value: number | boolean | string;
}

export interface VnMenuChoice {
  text: string;
  targetSceneId: string;
  isCanon?: boolean;
  varChanges?: VnVarOp[];
}

export type VnSlideAction =
  | { type: "continue"; nextSlideId?: string }
  | { type: "jump"; targetSceneId: string }
  | { type: "menu"; prompt?: string; choices: VnMenuChoice[] }
  | { type: "end"; endingName?: string };

export interface VnDialogue {
  speaker?: string; // undefined = narration
  isMonologue?: boolean; // true for inner monologue "( MC )"
  text: string;
}

export interface VnSlide {
  id: string; // e.g. "SC-01-001"
  sceneId: string; // "SC-01"
  route: string; // "common"
  stage: VnStageState;
  dialogue: VnDialogue;
  action: VnSlideAction;
}

export interface VnSlideDeck {
  slug: string;
  title: string;
  initialSceneId: string;
  sceneOrder: string[];
  slides: VnSlide[];
}

export type VnDiagnosticSeverity = "error" | "warning" | "info";

export interface VnDiagnostic {
  severity: VnDiagnosticSeverity;
  code: string;
  message: string;
  sceneId?: string;
  line?: number;
}

export interface VnSummary {
  slug: string;
  title: string;
  source: string;
  mode: VnMode;
  mc: string;
  tier: VnTier;
  slideCount?: number;
  routes: string[];
  updatedAt: string;
  order?: number;
  nextSlug?: string;
}
