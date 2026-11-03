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

/** A generic starting prompt for a linked kind; the world's card text and prompts.json refine it. */
export function synthesizeLinkedPrompt(kind: LinkedKind, name: string, owner?: string): string {
  const words = name.replace(/_/g, " ");
  const base =
    kind === "clothes"
      ? `masterpiece, best quality, garment design sheet, ${words}`
      : kind === "adornment"
        ? `masterpiece, best quality, ornament design sheet, ${words}`
        : `masterpiece, best quality, prop design, ${words}`;
  return `${base}${owner ? `, for ${owner.replace(/_/g, " ")}` : ""}, isolated item, no person, white background`;
}
