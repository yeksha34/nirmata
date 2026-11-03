/**
 * Asset kinds for visual-novel adaptation and the rules that link them.
 * Clothes and adornments are locked to one character; objects are locked to
 * characters and/or CGs. See ADR-0033.
 */

export const VN_ASSET_KINDS = ["sprite", "cg", "bg", "clothes", "adornment", "object"] as const;
export type VnAssetKind = (typeof VN_ASSET_KINDS)[number];

/** Kinds whose art is tied to a character (the owner). */
export const VN_OWNED_KINDS = ["clothes", "adornment"] as const;

/** The unclad base state: the one wearable-like state not locked to a character. */
export const VN_BASE_UNCLAD = "naked";

export const ADORNMENT_TYPES = ["worn", "pierced", "marking", "grown", "regalia", "worn-creature"] as const;
export type AdornmentType = (typeof ADORNMENT_TYPES)[number];
export const OBJECT_TYPES = ["held", "furniture", "tool", "mount", "fixture"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export interface ClothesSpec {
  name: string;
  owner?: string;
  slot?: string;
  coverage?: string;
  material?: string;
  prompt?: string;
}

export interface AdornmentSpec {
  name: string;
  owner?: string;
  type: AdornmentType;
  purpose?: string;
  frames?: string;
  material?: string;
  attachment?: string;
  exposure?: "covering" | "non-covering";
  scope?: "character" | "species" | "family" | "shared";
  prompt?: string;
}

export interface ObjectSpec {
  name: string;
  type: ObjectType;
  owners?: string[];
  cgs?: string[];
  interaction: string;
  whyCustom: string;
  prompt?: string;
}

export interface VnAssetLinkIssue {
  kind: VnAssetKind;
  name: string;
  message: string;
}

const isBase = (name: string) => name === VN_BASE_UNCLAD || name.endsWith(`_${VN_BASE_UNCLAD}`);

/** Applies the lock rules; returns one issue per violation (empty = valid). */
export function checkAssetLinks(input: {
  clothes?: ClothesSpec[];
  adornments?: AdornmentSpec[];
  objects?: ObjectSpec[];
}): VnAssetLinkIssue[] {
  const issues: VnAssetLinkIssue[] = [];
  for (const [kind, list] of [["clothes", input.clothes], ["adornment", input.adornments]] as const) {
    for (const a of list ?? []) {
      if (!a.owner?.trim() && !isBase(a.name)) {
        issues.push({ kind, name: a.name, message: `${kind} "${a.name}" must be locked to a character (owner)` });
      }
    }
  }
  for (const o of input.objects ?? []) {
    if (!o.owners?.length && !o.cgs?.length) {
      issues.push({ kind: "object", name: o.name, message: `object "${o.name}" must link to a character or a CG` });
    }
    if (!o.interaction?.trim()) {
      issues.push({ kind: "object", name: o.name, message: `object "${o.name}" needs an interaction (how a character uses it)` });
    }
    if (!o.whyCustom?.trim()) {
      issues.push({ kind: "object", name: o.name, message: `object "${o.name}" needs why_custom (why a generic prompt fails)` });
    }
  }
  return issues;
}
