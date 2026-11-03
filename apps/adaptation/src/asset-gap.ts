import type { AssetKind } from "@nirmata/gen";
import { plannedName } from "./asset-plan";
import type { CharacterPrep } from "./character-prep";

/**
 * A state a chapter's scenes need on screen. The adaptation lists what it needs, and only what
 * is missing becomes a new asset (ADR-0035): nothing that already expresses the state is made again.
 */
export type Need =
  | { type: "sprite"; character: string; expression?: string; state?: string }
  | { type: "clothes" | "adornment"; character: string; name: string }
  | { type: "cg" | "bg" | "object"; name: string };

export interface ExistingAsset {
  type: AssetKind;
  name: string;
}

/** What a missing asset will be called in the plan. */
export interface Missing {
  type: AssetKind;
  /** The plan input: the expression or item name; the owner is the character. */
  name: string;
  owner?: string | undefined;
  /** The full asset name the Studio lists. */
  asset: string;
}

const NEUTRAL = "neutral";

/** The expression a need asks for, with `neutral` meaning none in particular. */
const expressionOf = (expression?: string): string | undefined =>
  expression && expression !== NEUTRAL ? expression : undefined;

/**
 * The names that express a sprite state. This is stricter than how the player finds an image (it
 * falls back from `<c>_<state>_<expr>` to the bare portrait): a fallback shows a picture, but it does
 * not express the asked expression or outfit, so only an exact match, or the neutral portrait of the
 * right state, counts.
 */
export function spriteNames(character: string, expression?: string, state?: string): string[] {
  const expr = expressionOf(expression);
  if (state && expr) return [`${character}_${state}_${expr}`];
  if (state) return [`${character}_${state}`, `${character}_${state}_${NEUTRAL}`];
  if (expr) return [`${character}_${expr}`];
  return [character, `${character}_${NEUTRAL}`];
}

/** The needs that no existing asset expresses, each once, in the order asked. */
export function missingAssets(needs: Need[], existing: ExistingAsset[]): Missing[] {
  const have = new Set(existing.map((a) => `${a.type}:${a.name}`));
  const out: Missing[] = [];
  const seen = new Set<string>();
  for (const need of needs) {
    let candidates: string[];
    let missing: Missing;
    if (need.type === "sprite") {
      candidates = spriteNames(need.character, need.expression, need.state);
      const expr = expressionOf(need.expression);
      const name = need.state ? (expr ? `${need.state}_${expr}` : need.state) : (expr ?? NEUTRAL);
      missing = {
        type: "sprite",
        name,
        owner: need.character,
        asset: plannedName("sprite", { name, owner: need.character }),
      };
    } else if (need.type === "clothes" || need.type === "adornment") {
      const asset = plannedName(need.type, { name: need.name, owner: need.character });
      candidates = [asset];
      missing = { type: need.type, name: need.name, owner: need.character, asset };
    } else {
      candidates = [need.name];
      missing = { type: need.type, name: need.name, asset: need.name };
    }
    const key = `${missing.type}:${missing.asset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidates.some((c) => have.has(`${missing.type}:${c}`))) continue;
    out.push(missing);
  }
  return out;
}

/**
 * The first assets for a prepared character (the baseline): the unclad base, then each item of
 * clothes and each adornment the prep lists. Expressions are not made here; a chapter asks for the
 * ones its scenes show.
 */
export function baselineNeeds(character: string, prep: CharacterPrep): Need[] {
  return [
    { type: "clothes", character, name: "naked" },
    ...prep.outfits.map((o): Need => ({ type: o.kind, character, name: o.name })),
  ];
}
