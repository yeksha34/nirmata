import { z } from "zod";

export const CARD_KINDS = ["lore", "character", "place", "arc", "rule", "scene"] as const;
export const CardKind = z.enum(CARD_KINDS);
export type CardKind = z.infer<typeof CardKind>;

/**
 * A world may define kinds of its own (a deity, a playground, a garment). Its name is lowercase
 * letters and digits, so a card id `kind.name` stays unambiguous. The kinds above have templates and
 * a place in the editor; a custom kind is only a name the world gives to a set of cards.
 */
export const CUSTOM_KIND = /^[a-z][a-z0-9]{0,39}$/;
export const AnyCardKind = z.union([
  CardKind,
  z.string().regex(CUSTOM_KIND, "a kind is lowercase letters and digits, starting with a letter"),
]);

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

/** Tags a card may not use as a field: its own structure, and the HTML a markdown body may start with. */
const RESERVED_TAGS = new Set(
  (
    "card keywords summary data a abbr b blockquote br center cite code del details div em figure " +
    "font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li mark nav ol p pre q s section small " +
    "span strong sub sup table tbody td tfoot th thead tr u ul video audio source article aside"
  ).split(" "),
);

/** A field is a lowercase tag name inside the card: `appearance`, `life-outside-the-story`. */
export const isFieldId = (id: string): boolean =>
  /^[a-z][a-z0-9-]{0,39}$/.test(id) && !RESERVED_TAGS.has(id);

/**
 * Frontmatter every world card carries. Unknown keys pass through untouched so
 * authors (and later features) can add their own fields without breaking parsing.
 */
export const CardFrontmatter = z
  .object({
    id: CardId,
    kind: AnyCardKind,
    name: z.string().trim().min(1),
    keywords: Keywords,
    summary: z.string().trim().default(""),
    always: z.boolean().default(false),
    /** Rules only: where the rule applies. */
    scope: z.enum(["chapter", "story", "both"]).default("both"),
    /** Rules only: `must` is never dropped from context. */
    severity: z.enum(["must", "should"]).default("should"),
    role: z.string().optional(),
    /** The card's named parts (appearance, voice, wants ...), in the order written; text is markdown. */
    fields: z
      .record(
        z.string().refine(isFieldId, "a field name is lowercase letters, digits and hyphens"),
        z.string(),
      )
      .default({}),
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
  /** Player turns only: the nickname of who wrote it, when several people play. */
  by?: string | undefined;
  /** Player turns only: lines written together on the shared board share a round. */
  round?: string | undefined;
}

/** What one player wrote for a turn. */
export interface PlayerInput {
  mode: PlayerMode;
  text: string;
  by?: string | undefined;
}

/** What the host remembers beyond the verbatim recent turns. */
export interface Memory {
  summary: string;
  pinned: string[];
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
