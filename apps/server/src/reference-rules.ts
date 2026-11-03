import { type AssetKind, isLinkedKind } from "@nirmata/gen";
/**
 * Which images should influence a new one (the owner's rules):
 * - a character's base sprite influences the character's other sprites (image-to-image);
 * - a character's sprites influence a CG that shows the character (an identity reference).
 * A sprite is named `<character>_<expression>`; the base sprite's expression is a per-world setting.
 */

export interface ReferenceSettings {
  /** The expression of a character's base sprite, e.g. `neutral`. */
  baseSprite: string;
  /** The expression of the sprite that stands in for the character in a CG; the base sprite's by default. */
  cgSprite: string;
}

export const DEFAULT_REFERENCE_SETTINGS: ReferenceSettings = {
  baseSprite: "neutral",
  cgSprite: "neutral",
};

const EXPRESSION = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Reads `assets/workflow/references.json`; anything missing or not valid falls back to the defaults. */
export function parseReferenceSettings(text: string | undefined): ReferenceSettings {
  if (!text) return DEFAULT_REFERENCE_SETTINGS;
  try {
    const raw = JSON.parse(text) as { baseSprite?: unknown; cgSprite?: unknown };
    const base =
      typeof raw.baseSprite === "string" && EXPRESSION.test(raw.baseSprite.toLowerCase())
        ? raw.baseSprite.toLowerCase()
        : DEFAULT_REFERENCE_SETTINGS.baseSprite;
    const cg =
      typeof raw.cgSprite === "string" && EXPRESSION.test(raw.cgSprite.toLowerCase())
        ? raw.cgSprite.toLowerCase()
        : base;
    return { baseSprite: base, cgSprite: cg };
  } catch {
    return DEFAULT_REFERENCE_SETTINGS;
  }
}

/** `tina_happy` is character `tina`; `main_character_neutral` is `main_character`. */
export function characterOf(spriteName: string): string {
  const at = spriteName.lastIndexOf("_");
  return at > 0 ? spriteName.slice(0, at) : spriteName;
}

export interface SuggestInput {
  type: AssetKind;
  name: string;
  positivePrompt: string;
  /** The visual novel's sprites that exist as images. */
  sprites: readonly string[];
  settings: ReferenceSettings;
}

export interface Suggested {
  /** What to use unless the author changes it. */
  suggested: string[];
  /** Every sprite that could be used. */
  available: string[];
}

const MAX_CG_REFERENCES = 4;

/** Whether `character` is named in the text, as a whole word (underscores, hyphens and commas break words). */
function mentions(text: string, character: string): boolean {
  const words = ` ${text.toLowerCase().replace(/[_\-,()]+/g, " ")} `;
  const want = character.toLowerCase().replace(/[_-]+/g, " ");
  return words.includes(` ${want} `);
}

export function suggestReferences(input: SuggestInput): Suggested {
  const { type, name, sprites, settings } = input;
  const available = sprites.filter((s) => s !== name);
  if (type === "bg" || isLinkedKind(type)) return { suggested: [], available: [] };

  if (type === "sprite") {
    const character = characterOf(name);
    const base = `${character}_${settings.baseSprite}`;
    const suggested = name !== base && sprites.includes(base) ? [base] : [];
    return { suggested, available };
  }

  // a CG: the characters it shows are the ones named in its name or its prompt
  const text = `${name} ${input.positivePrompt}`;
  const characters = [...new Set(sprites.map(characterOf))].filter((c) => mentions(text, c));
  const suggested: string[] = [];
  for (const character of characters) {
    const pick = [`${character}_${settings.cgSprite}`, `${character}_${settings.baseSprite}`].find(
      (s) => sprites.includes(s),
    );
    if (pick) suggested.push(pick);
  }
  return { suggested: suggested.slice(0, MAX_CG_REFERENCES), available };
}
