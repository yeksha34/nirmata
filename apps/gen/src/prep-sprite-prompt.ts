/** A prepared character as the sprite prompt needs it (the character prep, ADR-0035). */
export interface PrepCharacter {
  /** The key the prep is stored under: the card's name with hyphens for spaces. */
  name: string;
  /** Free text; `asset-id: <id>` names the id the character's assets use. */
  notes: string;
  basePositive: string;
  expressions: Array<{ expression: string; tags: string }>;
  outfits: Array<{ kind: string; name: string; tags: string }>;
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

/** The prepared character whose assets are owned as `owner`: by an `asset-id:` note, else by a word of its name. */
export function prepCharacterFor(owner: string, chars: PrepCharacter[]): PrepCharacter | undefined {
  const id = owner.toLowerCase();
  const tagged = chars.find((c) => /asset-id:\s*([a-z0-9-]+)/i.exec(c.notes)?.[1]?.toLowerCase() === id);
  if (tagged) return tagged;
  const named = chars.filter((c) => words(c.name).includes(id));
  return named.length === 1 ? named[0] : undefined;
}

/** The outfit a sprite state stands for: `office` is `day-office-outfit`, `uniform` is `office-slut-uniform`. */
function outfitFor(state: string, outfits: PrepCharacter["outfits"]) {
  const clothes = outfits.filter((o) => o.kind === "clothes");
  const s = state.replace(/_/g, "-");
  return (
    clothes.find((o) => o.name === s) ??
    clothes.find((o) => o.name.endsWith(`-${s}`)) ??
    clothes.find((o) => o.name.includes(`-${s}-`)) ??
    clothes.find((o) => o.name.startsWith(`${s}-`))
  );
}

/**
 * The prompt for a sprite named `<owner>[_<state>][_<expression>]`, written from the character's prep:
 * the base look, then the outfit the state stands for, then the expression's tags. `undefined` when no
 * prepared character owns the sprite, so the caller can fall back to the card-keyword prompt.
 */
export function spritePromptFromPrep(spriteName: string, chars: PrepCharacter[]): string | undefined {
  const clean = spriteName.replace(/\.(png|jpg|jpeg|webp)$/i, "");
  const at = clean.indexOf("_");
  const owner = at < 0 ? clean : clean.slice(0, at);
  const rest = at < 0 ? "" : clean.slice(at + 1);
  const who = prepCharacterFor(owner, chars);
  if (!who) return undefined;
  const byLength = [...who.expressions].sort((a, b) => b.expression.length - a.expression.length);
  const hit = byLength.find((e) => rest === e.expression || rest.endsWith(`_${e.expression}`));
  const expression = hit ?? who.expressions.find((e) => e.expression === "neutral");
  const state = hit ? rest.slice(0, rest.length - hit.expression.length).replace(/_$/, "") : rest;
  const outfit = state ? outfitFor(state, who.outfits) : undefined;
  return ["masterpiece, best quality", who.basePositive, outfit?.tags, expression?.tags]
    .filter(Boolean)
    .join(", ");
}
