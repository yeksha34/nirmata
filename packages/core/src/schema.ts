import { z } from "zod";

export const RATINGS = ["everyone", "teen", "mature"] as const;
export const Rating = z.enum(RATINGS);
export type Rating = z.infer<typeof Rating>;

/** Higher number = more mature. Used by the content-rating gate (F-39). */
export function ratingRank(rating: Rating): number {
  return RATINGS.indexOf(rating);
}

/**
 * `scene` and `state` are what play produces: a scene card records what happened somewhere, a
 * state card tracks the live condition of an entity. Authored `scene` cards (one-line beats in a
 * world's `scenes/` folder) are not for prompts; adventure ones (`origin: adventure`) are.
 */
export const CARD_KINDS = ["lore", "character", "place", "arc", "rule", "scene", "state"] as const;
export const CardKind = z.enum(CARD_KINDS);
export type CardKind = z.infer<typeof CardKind>;

const Keywords = z
  .union([
    z.array(z.string().trim().min(1)),
    z.string().transform((s) =>
      s
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ])
  .default([]);

const CardId = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*\.[a-z0-9][a-z0-9-]*$/,
    'id must look like "kind.slug" (lowercase letters, digits, hyphens)',
  );

/**
 * Frontmatter every world card carries. Unknown keys pass through untouched so
 * authors (and later features) can add their own fields without breaking parsing.
 */
export const CardFrontmatter = z
  .object({
    id: CardId,
    kind: CardKind,
    /** `adventure` marks cards written by play (compaction), never authored by hand. */
    origin: z.enum(["authored", "adventure"]).default("authored"),
    name: z.string().trim().min(1),
    keywords: Keywords,
    summary: z.string().trim().default(""),
    always: z.boolean().default(false),
    rating: Rating.default("everyone"),
    /** Rules only: where the rule applies. */
    scope: z.enum(["chapter", "adventure", "both"]).default("both"),
    /** Rules only: `must` is never dropped from context. */
    severity: z.enum(["must", "should"]).default("should"),
    role: z.string().optional(),
  })
  .passthrough();
export type CardFrontmatter = z.infer<typeof CardFrontmatter>;

/**
 * A tracking card as carried inside a `compact` event. Later updates to the same id replace
 * earlier ones, so a state card always holds its latest full content.
 */
export const CardUpdate = z.object({
  id: CardId,
  kind: z.enum(["scene", "state"]),
  name: z.string().trim().min(1),
  keywords: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().trim().default(""),
  body: z.string().default(""),
  always: z.boolean().default(false),
  /** What a state card tracks: character, place, item, quest, relationship, other. */
  entity: z.string().optional(),
});
export type CardUpdate = z.output<typeof CardUpdate>;

export const WorldManifest = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  tagline: z.string().default(""),
  genre: z.array(z.string()).default([]),
  tone: z.array(z.string()).default([]),
  contentRating: Rating.default("everyone"),
  perspective: z.enum(["first-person", "second-person", "third-person"]).default("second-person"),
  systems: z
    .object({
      dice: z.string().default("none"),
      stats: z.array(z.string()).default([]),
      inventory: z.boolean().default(true),
    })
    .default({}),
  createdWith: z.string().optional(),
});
export type WorldManifest = z.infer<typeof WorldManifest>;

export const PLAYER_MODES = ["do", "say", "story"] as const;
export const PlayerMode = z.enum(PLAYER_MODES);
export type PlayerMode = z.infer<typeof PlayerMode>;

/** One visible exchange line, oldest first in arrays of these. */
export interface Turn {
  id: string;
  role: "player" | "host";
  /** Player turns only; missing is treated as "do". */
  mode?: PlayerMode | undefined;
  text: string;
}

/** What the host remembers beyond the verbatim recent turns. */
export interface Memory {
  summary: string;
  pinned: string[];
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
