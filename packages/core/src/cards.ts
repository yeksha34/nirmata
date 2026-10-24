import { parse as parseYaml } from "yaml";
import { CardFrontmatter, formatIssues, WorldManifest } from "./schema";

export interface Card {
  /** World-relative path, used only for messages and stable ordering. */
  path: string;
  fm: CardFrontmatter;
  body: string;
}

export type ParseCardResult =
  | { ok: true; card: Card }
  | { ok: false; path: string; errors: string[] };

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

export function splitFrontmatter(text: string): { yaml: string; body: string } | null {
  const m = FRONTMATTER.exec(text);
  if (!m) return null;
  return { yaml: m[1] ?? "", body: m[2] ?? "" };
}

/** Pure: takes the file's text, returns a validated card or a list of human-readable problems. */
export function parseCard(path: string, text: string): ParseCardResult {
  const parts = splitFrontmatter(text);
  if (!parts) return { ok: false, path, errors: ["missing frontmatter block (--- ... ---)"] };

  let raw: unknown;
  try {
    raw = parseYaml(parts.yaml);
  } catch (e) {
    return { ok: false, path, errors: [`frontmatter is not valid YAML: ${(e as Error).message}`] };
  }

  const result = CardFrontmatter.safeParse(raw ?? {});
  if (!result.success) return { ok: false, path, errors: formatIssues(result.error) };
  return { ok: true, card: { path, fm: result.data, body: parts.body } };
}

export function parseWorldManifest(
  text: string,
): { ok: true; world: WorldManifest } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`world.json is not valid JSON: ${(e as Error).message}`] };
  }
  const result = WorldManifest.safeParse(raw);
  if (!result.success) return { ok: false, errors: formatIssues(result.error) };
  return { ok: true, world: result.data };
}

/** Problems that only show up across cards (currently: duplicate ids). */
export function checkCards(cards: readonly Card[]): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  for (const card of cards) {
    const first = seen.get(card.fm.id);
    if (first !== undefined) {
      errors.push(`duplicate id "${card.fm.id}" in ${card.path} (first used in ${first})`);
    } else {
      seen.set(card.fm.id, card.path);
    }
  }
  return errors;
}

/**
 * Cards cross-link with relative markdown links for the editor and linter; in a prompt those
 * paths are pure noise, so `[The Fog](../lore/the_fog.md)` becomes `The Fog`.
 */
export function plainLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((?!https?:)[^)\s]+\)/g, "$1");
}

/** Card bodies start with a "# Title" that repeats the name; the prompt does not need it twice. */
export function stripTitle(body: string): string {
  return body.replace(/^\s*#\s+.*(?:\r?\n|$)/, "").trim();
}
