import type { AssetKind } from "@nirmata/gen";
import type { VnAssetsManifest } from "@nirmata/core";

/**
 * A visual novel's plan of assets lives in its manifest. These add an asset to the plan and take
 * one out; the images are made in the Studio and are not touched here.
 *
 * A sprite is a character with one more expression, named `<character>_<expression>`. Clothes and
 * adornments belong to one character and are named `<owner>_<name>`. A cg, a background and an
 * object have a name of their own.
 */

/** A name that is safe as a file name, as the Studio writes them. */
export const ASSET_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface PlannedAsset {
  /** The cg, background or object name; the expression of a sprite; the item of clothes or an adornment. */
  name: string;
  /** The character a sprite, an item of clothes or an adornment belongs to; optional for an object. */
  owner?: string | undefined;
}

export class AssetPlanError extends Error {}

const clean = (assets: VnAssetsManifest): VnAssetsManifest => ({
  ...assets,
  characters: { ...assets.characters },
  backgrounds: [...assets.backgrounds],
  cgs: [...assets.cgs],
});

/** The full asset name the Studio lists for this input. */
export function plannedName(type: AssetKind, input: PlannedAsset): string {
  return type === "sprite" || type === "clothes" || type === "adornment"
    ? `${input.owner}_${input.name}`
    : input.name;
}

/** The plan with this asset added. Throws when the input is not usable or the asset is already planned. */
export function addToPlan(
  assets: VnAssetsManifest,
  type: AssetKind,
  input: PlannedAsset,
): { assets: VnAssetsManifest; name: string } {
  if (!ASSET_NAME.test(input.name))
    throw new AssetPlanError(
      "A name uses lower-case letters, digits, - and _, and starts with a letter or digit.",
    );
  const needsOwner = type === "sprite" || type === "clothes" || type === "adornment";
  if (needsOwner && !input.owner?.trim())
    throw new AssetPlanError("Say which character it is for.");
  if (input.owner !== undefined && !/^[^\s/\\]{1,64}$/.test(input.owner))
    throw new AssetPlanError("A character name has no spaces or slashes.");
  const name = plannedName(type, input);
  if (listed(assets, type).includes(name))
    throw new AssetPlanError(`"${name}" is already planned.`);
  const next = clean(assets);
  const owner = input.owner ?? "";
  switch (type) {
    case "sprite":
      next.characters[owner] = [...(next.characters[owner] ?? []), input.name];
      break;
    case "cg":
      next.cgs.push(name);
      break;
    case "bg":
      next.backgrounds.push(name);
      break;
    case "clothes":
      next.clothes = { ...next.clothes, [owner]: [...(next.clothes?.[owner] ?? []), input.name] };
      break;
    case "adornment":
      next.adornments = {
        ...next.adornments,
        [owner]: [...(next.adornments?.[owner] ?? []), input.name],
      };
      break;
    case "object":
      next.objects = [...(next.objects ?? []), { name, ...(owner ? { owners: [owner] } : {}) }];
      break;
  }
  return { assets: next, name };
}

/** The plan without this asset (the same plan when it was never in it). */
export function removeFromPlan(
  assets: VnAssetsManifest,
  type: AssetKind,
  name: string,
): { assets: VnAssetsManifest; removed: boolean } {
  const next = clean(assets);
  let removed = false;
  const fromGroups = (groups: Record<string, string[]>): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [owner, items] of Object.entries(groups)) {
      const kept = items.filter((i) => `${owner}_${i}` !== name);
      if (kept.length !== items.length) removed = true;
      if (kept.length > 0) out[owner] = kept;
    }
    return out;
  };
  switch (type) {
    case "sprite":
      next.characters = fromGroups(next.characters);
      break;
    case "cg":
      next.cgs = next.cgs.filter((c) => c !== name);
      removed = next.cgs.length !== assets.cgs.length;
      break;
    case "bg":
      next.backgrounds = next.backgrounds.filter((b) => b !== name);
      removed = next.backgrounds.length !== assets.backgrounds.length;
      break;
    case "clothes":
      if (next.clothes) next.clothes = fromGroups(next.clothes);
      break;
    case "adornment":
      if (next.adornments) next.adornments = fromGroups(next.adornments);
      break;
    case "object":
      if (next.objects) {
        next.objects = next.objects.filter((o) => o.name !== name);
        removed = next.objects.length !== (assets.objects ?? []).length;
      }
      break;
  }
  return { assets: next, removed };
}

function listed(assets: VnAssetsManifest, type: AssetKind): string[] {
  const flat = (groups: Record<string, string[]> | undefined) =>
    Object.entries(groups ?? {}).flatMap(([owner, items]) => items.map((i) => `${owner}_${i}`));
  switch (type) {
    case "sprite":
      return flat(assets.characters);
    case "cg":
      return assets.cgs;
    case "bg":
      return assets.backgrounds;
    case "clothes":
      return flat(assets.clothes);
    case "adornment":
      return flat(assets.adornments);
    case "object":
      return (assets.objects ?? []).map((o) => o.name);
  }
}
