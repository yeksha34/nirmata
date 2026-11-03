import { z } from "zod";
import type {
  VnAssetsManifest,
  VnDialogue,
  VnManifest,
  VnMenuChoice,
  VnMode,
  VnSlide,
  VnSlideAction,
  VnSlideDeck,
  VnSlot,
  VnStageCharacter,
  VnStageState,
  VnTier,
  VnVariableDef,
  VnVarOp,
} from "./types";

export const VnModeSchema = z.enum([
  "mode_1",
  "mode_2a",
  "mode_2b",
  "mode_2_open",
]) satisfies z.ZodType<VnMode>;

export const VnTierSchema = z.enum(["micro", "short", "mid", "large"]) satisfies z.ZodType<VnTier>;

export const VnSlotSchema = z.enum(["left", "center", "right"]) satisfies z.ZodType<VnSlot>;

export const VnVariableDefSchema = z.object({
  initial: z.union([z.number(), z.boolean(), z.string()]),
  description: z.string().optional(),
}) satisfies z.ZodType<VnVariableDef>;

export const VnAssetsManifestSchema = z.object({
  backgrounds: z.array(z.string()),
  characters: z.record(z.string(), z.array(z.string())),
  cgs: z.array(z.string()),
  clothes: z.record(z.string(), z.array(z.string())).optional(),
  adornments: z.record(z.string(), z.array(z.string())).optional(),
  objects: z
    .array(z.object({ name: z.string().min(1), owners: z.array(z.string()).optional(), cgs: z.array(z.string()).optional() }))
    .optional(),
  music: z.array(z.string()).optional(),
  sfx: z.array(z.string()).optional(),
}) satisfies z.ZodType<VnAssetsManifest>;

export const VnManifestSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  source: z.string().min(1),
  mode: VnModeSchema,
  mc: z.string().min(1),
  tier: VnTierSchema,
  routes: z.array(z.string()),
  variables: z.record(z.string(), VnVariableDefSchema),
  assets: VnAssetsManifestSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  order: z.number().int().optional(),
  nextSlug: z.string().optional(),
}) satisfies z.ZodType<VnManifest>;

export const VnStageCharacterSchema = z.object({
  character: z.string().min(1),
  expression: z.string().min(1),
  slot: VnSlotSchema,
}) satisfies z.ZodType<VnStageCharacter>;

export const VnStageStateSchema = z.object({
  bg: z.string().optional(),
  transition: z.string().optional(),
  music: z.string().optional(),
  sfx: z.string().optional(),
  cg: z
    .object({
      name: z.string(),
      active: z.boolean(),
    })
    .optional(),
  characters: z.array(VnStageCharacterSchema),
}) satisfies z.ZodType<VnStageState>;

export const VnVarOpSchema = z.object({
  variable: z.string().min(1),
  op: z.enum(["+", "-", "="]),
  value: z.union([z.number(), z.boolean(), z.string()]),
}) satisfies z.ZodType<VnVarOp>;

export const VnMenuChoiceSchema = z.object({
  text: z.string().min(1),
  targetSceneId: z.string().min(1),
  isCanon: z.boolean().optional(),
  varChanges: z.array(VnVarOpSchema).optional(),
}) satisfies z.ZodType<VnMenuChoice>;

export const VnSlideActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("continue"),
    nextSlideId: z.string().optional(),
  }),
  z.object({
    type: z.literal("jump"),
    targetSceneId: z.string().min(1),
  }),
  z.object({
    type: z.literal("menu"),
    prompt: z.string().optional(),
    choices: z.array(VnMenuChoiceSchema),
  }),
  z.object({
    type: z.literal("end"),
    endingName: z.string().optional(),
  }),
]) satisfies z.ZodType<VnSlideAction>;

export const VnDialogueSchema = z.object({
  speaker: z.string().optional(),
  isMonologue: z.boolean().optional(),
  text: z.string(),
}) satisfies z.ZodType<VnDialogue>;

export const VnSlideSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  route: z.string(),
  stage: VnStageStateSchema,
  dialogue: VnDialogueSchema,
  action: VnSlideActionSchema,
}) satisfies z.ZodType<VnSlide>;

export const VnSlideDeckSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  initialSceneId: z.string().min(1),
  sceneOrder: z.array(z.string()),
  slides: z.array(VnSlideSchema),
}) satisfies z.ZodType<VnSlideDeck>;
