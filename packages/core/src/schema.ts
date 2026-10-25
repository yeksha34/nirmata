import { z } from "zod";

export const CARD_KINDS = ["lore", "character", "place", "arc", "rule", "scene"] as const;
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
    name: z.string().trim().min(1),
    keywords: Keywords,
    summary: z.string().trim().default(""),
    always: z.boolean().default(false),
    /** Rules only: where the rule applies. */
    scope: z.enum(["chapter", "adventure", "both"]).default("both"),
    /** Rules only: `must` is never dropped from context. */
    severity: z.enum(["must", "should"]).default("should"),
    role: z.string().optional(),
  })
  .passthrough();
export type CardFrontmatter = z.infer<typeof CardFrontmatter>;

export const WorldManifest = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  tagline: z.string().default(""),
  genre: z.array(z.string()).default([]),
  tone: z.array(z.string()).default([]),
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
