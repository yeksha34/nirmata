/**
 * The asset kinds a visual novel can generate (mirrors VN_ASSET_KINDS in @nirmata/core, which this
 * package does not depend on). Clothes and adornments are locked to one character; objects link to
 * characters and/or CGs (ADR-0033).
 */
export const ASSET_KINDS = ["sprite", "cg", "bg", "clothes", "adornment", "object"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Kinds that are character-linked reference art rather than stage art. */
export const LINKED_KINDS = ["clothes", "adornment", "object"] as const;
export type LinkedKind = (typeof LINKED_KINDS)[number];

export const isAssetKind = (v: unknown): v is AssetKind => (ASSET_KINDS as readonly unknown[]).includes(v);
export const isLinkedKind = (k: AssetKind): k is LinkedKind => (LINKED_KINDS as readonly string[]).includes(k);

const DIRS: Record<AssetKind, string> = {
  sprite: "sprites",
  cg: "cgs",
  bg: "backgrounds",
  clothes: "clothes",
  adornment: "adornments",
  object: "objects",
};
/** The folder under a visual novel's `assets/` that holds a kind. */
export const assetDir = (kind: AssetKind): string => DIRS[kind];

/** The workflow template a kind uses (`bg` is bundled as `background`). */
export const templateName = (kind: AssetKind): string => (kind === "bg" ? "background" : kind);

/** Canvas for a kind: sprites are portrait, stage art is 16:9, linked reference art is square. */
export function assetSize(kind: AssetKind): { width: number; height: number } {
  if (kind === "sprite") return { width: 512, height: 768 };
  if (isLinkedKind(kind)) return { width: 768, height: 768 };
  return { width: 1024, height: 576 };
}

/** What a world's card says about a clothes, adornment or object asset (the card's parts, as written). */
export interface LinkedDetails {
  type?: string;
  summary?: string;
  appearance?: string;
  material?: string;
  frames?: string;
  attachment?: string;
  coverage?: string;
  exposure?: string;
  interaction?: string;
  prompt?: string;
  /** A world-relative path to an image the author made of this asset, used as a reference. */
  reference?: string;
  /** The card's owner attribute (clothes, adornment) or owners attribute (object), as written. */
  owners?: string[];
  /** An object card's linked CG names. */
  cgs?: string[];
}

const PARTS = [
  "summary",
  "appearance",
  "material",
  "frames",
  "attachment",
  "coverage",
  "exposure",
  "interaction",
  "prompt",
  "reference",
] as const;

/** Reads the parts of a clothes, adornment or object card. Unknown parts are ignored. */
export function parseLinkedCard(text: string): LinkedDetails {
  const out: LinkedDetails = {};
  const head = /<card\b[^>]*>/.exec(text)?.[0] ?? "";
  const type = /\btype="([^"]*)"/.exec(head)?.[1];
  if (type) out.type = type;
  const list = (attr: string) =>
    (new RegExp(`\\b${attr}="([^"]*)"`).exec(head)?.[1] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const owners = [...list("owner"), ...list("owners")];
  if (owners.length > 0) out.owners = owners;
  const cgs = list("cgs");
  if (cgs.length > 0) out.cgs = cgs;
  for (const part of PARTS) {
    const m = new RegExp(`<${part}>([\\s\\S]*?)</${part}>`).exec(text);
    const value = m?.[1]?.replace(/\s+/g, " ").trim();
    if (value) out[part] = value;
  }
  return out;
}

const LEAD: Record<LinkedKind, string> = {
  clothes: "masterpiece, best quality, garment design sheet, single outfit laid flat, front view",
  adornment: "masterpiece, best quality, ornament design sheet, single accessory, front view",
  object: "masterpiece, best quality, prop design sheet, single object, three-quarter view",
};
const TAIL = "isolated item, no person, no body, plain white background";

/**
 * The prompt for a linked asset. It is only what the image model needs to draw the item: the card's own
 * prompt first (the author's words), then what it looks like, what it is made of, where it sits on the
 * body and how it is attached. No character names and no story (who owns it, how it is used): the model
 * cannot use them, and they would only be drawn as text or confuse the image.
 */
export function composeLinkedPrompt(kind: LinkedKind, name: string, d: LinkedDetails = {}): string {
  const bits: Array<string | undefined> = [
    LEAD[kind],
    d.prompt,
    d.prompt ? undefined : d.appearance,
    d.material && `made of ${d.material}`,
    d.frames && `worn on ${d.frames}`,
    d.attachment && d.attachment !== "magic" ? `attached by ${d.attachment}` : undefined,
    d.coverage && `coverage: ${d.coverage}`,
    d.prompt || d.appearance ? undefined : itemWords(kind, name),
  ];
  return `${bits.filter(Boolean).join(", ")}, ${TAIL}`;
}

/** What a card name says about the item. An owned item is named `<Owner>_<item>`; the owner is dropped. */
function itemWords(kind: LinkedKind, name: string): string {
  const item = kind !== "object" && name.includes("_") ? name.slice(name.indexOf("_") + 1) : name;
  return item.replace(/_/g, " ");
}

/** A starting prompt when the world has no card: the name only. Prefer composeLinkedPrompt with a card. */
export function synthesizeLinkedPrompt(kind: LinkedKind, name: string): string {
  return composeLinkedPrompt(kind, name, {});
}
