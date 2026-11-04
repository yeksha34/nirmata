import { createHash } from "node:crypto";
import { ASSET_NAME } from "./asset-plan";

/**
 * What asset generation needs to know about a character, written once from the character card
 * (ADR-0035): a base look, the expressions the character shows, and the outfits and adornments
 * they own. Tags are free text the prompt builder joins; the names become asset names.
 */
export interface CharacterPrep {
  basePositive: string;
  baseNegative: string;
  notes: string;
  /** A hash of the card text the prep was made from; a different hash later means out of date. */
  cardHash: string | null;
  expressions: Array<{ expression: string; tags: string }>;
  outfits: Array<{ kind: "clothes" | "adornment"; name: string; tags: string }>;
}

export class PrepError extends Error {}

/** A character name as a card gives it: no spaces or slashes inside asset names. */
export const CHARACTER_NAME = /^[^\s/\\]{1,64}$/;

/** The key a prep is stored under: the card's name with each run of whitespace made a hyphen. */
export const prepKey = (cardName: string): string => cardName.trim().replace(/\s+/g, "-");

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

export type CharacterMatch<T> =
  | { ok: true; card: T }
  | { ok: false; reason: "none" | "ambiguous"; candidates: string[] };

/**
 * Finds the card an agent means by a name or part of one. An exact name wins. Otherwise every word
 * given must be a whole word of the card's name or id ("Evelyn" finds "Evelyn Hart"). When several
 * cards fit, the one with the shortest name wins if it is alone ("Evelyn Hart" over "Evelyn Hart
 * (skin)"); otherwise the match is ambiguous and the candidates are returned.
 */
export function resolveCharacter<T extends { name: string; id?: string }>(
  cards: T[],
  query: string,
): CharacterMatch<T> {
  const exact = cards.find((c) => c.name === query);
  if (exact) return { ok: true, card: exact };
  const asked = words(query);
  if (asked.length === 0) return { ok: false, reason: "none", candidates: [] };
  const fits = cards.filter((c) => {
    const have = new Set([...words(c.name), ...words(c.id ?? "")]);
    return asked.every((w) => have.has(w));
  });
  if (fits.length === 0) return { ok: false, reason: "none", candidates: [] };
  const shortest = Math.min(...fits.map((c) => words(c.name).length));
  const best = fits.filter((c) => words(c.name).length === shortest);
  const only = best[0];
  if (best.length === 1 && only) return { ok: true, card: only };
  return { ok: false, reason: "ambiguous", candidates: fits.map((c) => c.name) };
}

const text = (v: unknown, field: string, max: number): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new PrepError(`${field} must be text.`);
  if (v.length > max) throw new PrepError(`${field} is too long (${max} characters at most).`);
  return v.trim();
};

/** Checks what an agent sent and returns the prep as it will be stored. Throws `PrepError`. */
export function parsePrep(input: unknown): CharacterPrep {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PrepError("The prep must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const list = (v: unknown, field: string): unknown[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 60) {
      throw new PrepError(`${field} must be a list of up to 60.`);
    }
    return v;
  };
  const seen = new Set<string>();
  const expressions = list(raw.expressions, "expressions").map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const expression = text(o.expression, "An expression name", 60);
    if (!ASSET_NAME.test(expression)) {
      throw new PrepError(`Invalid expression name "${expression}".`);
    }
    if (seen.has(`e:${expression}`)) throw new PrepError(`"${expression}" is listed twice.`);
    seen.add(`e:${expression}`);
    return { expression, tags: text(o.tags, "Tags", 2000) };
  });
  const outfits = list(raw.outfits, "outfits").map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const kind: "clothes" | "adornment" | undefined =
      o.kind === "clothes" || o.kind === "adornment" ? o.kind : undefined;
    if (!kind) {
      throw new PrepError("An outfit is clothes or an adornment.");
    }
    const name = text(o.name, "An outfit name", 60);
    if (!ASSET_NAME.test(name)) throw new PrepError(`Invalid outfit name "${name}".`);
    if (seen.has(`${kind}:${name}`)) throw new PrepError(`"${name}" is listed twice.`);
    seen.add(`${kind}:${name}`);
    return { kind, name, tags: text(o.tags, "Tags", 2000) };
  });
  const cardHash =
    raw.cardHash === undefined || raw.cardHash === null ? null : text(raw.cardHash, "cardHash", 128);
  return {
    basePositive: text(raw.basePositive, "The base look", 4000),
    baseNegative: text(raw.baseNegative, "The base negative", 2000),
    notes: text(raw.notes, "Notes", 4000),
    cardHash,
    expressions,
    outfits,
  };
}

/** The hash a prep records for a card, so a later edit of the card can be noticed. */
export function cardHashOf(cardText: string): string {
  return createHash("sha256").update(cardText).digest("hex").slice(0, 32);
}

export interface PrepState {
  /** The character as the card names it. */
  name: string;
  cardHash: string;
  prep: CharacterPrep | undefined;
  /** `none`: not prepared; `stale`: the card changed since; `current`. */
  state: "none" | "stale" | "current";
}

/** The characters of a world, each with whether its prep exists and is still current. */
export function prepStates(
  cards: Array<{ name: string; text: string }>,
  stored: Map<string, CharacterPrep>,
): PrepState[] {
  return cards.map((c) => {
    const cardHash = cardHashOf(c.text);
    const prep = stored.get(prepKey(c.name));
    const state = !prep ? "none" : prep.cardHash === cardHash ? "current" : "stale";
    return { name: c.name, cardHash, prep, state };
  });
}
