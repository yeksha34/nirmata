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

/**
 * Pure: takes the file's text, returns a validated card or a list of human-readable problems.
 * A card is written as XML around markdown (`<card …>`, ADR-0017); the older YAML-frontmatter
 * form is still read, so worlds written before that keep loading.
 */
export function parseCard(path: string, text: string): ParseCardResult {
  const trimmed = text
    .replace(/^﻿/, "")
    .replace(/^(?:\s*<!--[\s\S]*?-->)+/, "")
    .trimStart();
  if (trimmed.startsWith("<card")) return parseXmlCard(path, trimmed);

  const parts = splitFrontmatter(text);
  if (!parts) {
    return {
      ok: false,
      path,
      errors: ["not a card: the file should start with <card …> (or an older --- block)"],
    };
  }

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

// ---- the XML + markdown form ---------------------------------------------------------------------
//
//   <card id="char.marrow" kind="character" name="Marrow" role="npc">
//     <keywords>marrow, keeper</keywords>
//     <summary>Gruff keeper of the north light.</summary>
//
//   # Marrow
//   - **Wants:** the fourth light put out.
//   </card>
//
// Fields are attributes; keywords and summary are small child tags; everything after them is
// markdown, left exactly as written (it is not XML, so `<` and `&` in it need no escaping).

/** Fields that are always text, whatever they look like (a name may be "1984"). */
const TEXT_FIELDS = new Set(["id", "kind", "name", "role", "scope", "severity"]);

const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] as string);
const encode = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const encodeAttr = (s: string): string => encode(s).replace(/"/g, "&quot;").replace(/>/g, "&gt;");

/** Attributes carry only text; a value that looks like a number or true/false is read as one. */
function typed(key: string, value: string): unknown {
  if (TEXT_FIELDS.has(key)) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

/** Reads `name="value"` pairs up to `>` or `/>`. Returns where the tag ended, or a problem. */
function readTag(
  text: string,
  from: number,
): { attrs: Record<string, string>; end: number; selfClosed: boolean } | string {
  const attrs: Record<string, string> = {};
  let i = from;
  for (;;) {
    while (/\s/.test(text[i] ?? "")) i++;
    if (text.startsWith("/>", i)) return { attrs, end: i + 2, selfClosed: true };
    if (text[i] === ">") return { attrs, end: i + 1, selfClosed: false };
    ATTRIBUTE.lastIndex = i;
    const m = ATTRIBUTE.exec(text);
    if (!m) {
      const near = text.slice(i, i + 24).split("\n")[0];
      return `could not read the card's opening tag near "${near}" (write each field as name="value")`;
    }
    const key = m[1] as string;
    if (key in attrs) return `the field "${key}" is written twice in the opening tag`;
    attrs[key] = decode(m[2] ?? m[3] ?? "");
    i = ATTRIBUTE.lastIndex;
  }
}

function parseXmlCard(path: string, text: string): ParseCardResult {
  const fail = (...errors: string[]): ParseCardResult => ({ ok: false, path, errors });

  const open = readTag(text, "<card".length);
  if (typeof open === "string") return fail(open);

  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(open.attrs)) raw[key] = typed(key, value);

  let body = "";
  if (!open.selfClosed) {
    const close = text.lastIndexOf("</card>");
    if (close < open.end || text.slice(close + "</card>".length).trim() !== "") {
      return fail("the card has no closing </card> at the end of the file");
    }
    let rest = text.slice(open.end, close);

    // the small child tags come first; the first thing that is not one starts the markdown
    for (;;) {
      const lead = /^\s*<(keywords|summary|data)\b/.exec(rest);
      if (!lead) break;
      const tag = lead[1] as string;
      const afterName = lead[0].length;
      const opened = readTag(rest, afterName);
      if (typeof opened === "string") return fail(`<${tag}>: ${opened}`);
      const closeAt = opened.selfClosed ? opened.end : rest.indexOf(`</${tag}>`, opened.end);
      if (closeAt < 0) return fail(`<${tag}> is never closed (write </${tag}>)`);
      const inner = opened.selfClosed ? "" : decode(rest.slice(opened.end, closeAt)).trim();
      if (tag === "data") {
        const key = opened.attrs.key;
        if (!key) return fail('<data> needs a key, as in <data key="mood">…</data>');
        try {
          raw[key] = JSON.parse(inner);
        } catch {
          return fail(`<data key="${key}"> does not hold valid JSON`);
        }
      } else {
        raw[tag] = inner;
      }
      rest = rest.slice(opened.selfClosed ? opened.end : closeAt + `</${tag}>`.length);
    }
    body = rest.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
    if (body) body += "\n";
  }

  const result = CardFrontmatter.safeParse(raw);
  if (!result.success) return fail(...formatIssues(result.error));
  return { ok: true, card: { path, fm: result.data, body } };
}

const FIELD_ORDER = ["id", "kind", "name", "role", "always", "scope", "severity"] as const;
const DEFAULTS: Record<string, unknown> = { always: false, scope: "both", severity: "should" };
const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** The card as a file: `parseCard(path, serializeCard(card))` gives the card back. */
export function serializeCard(card: Card): string {
  const { keywords, summary, ...fields } = card.fm as Record<string, unknown>;
  const known = FIELD_ORDER.filter((k) => fields[k] !== undefined && fields[k] !== DEFAULTS[k]);
  const extra = Object.keys(fields)
    .filter((k) => !(FIELD_ORDER as readonly string[]).includes(k) && fields[k] !== undefined)
    .sort();
  const attributes = [...known, ...extra.filter((k) => isScalar(fields[k]))]
    .map((k) => ` ${k}="${encodeAttr(String(fields[k]))}"`)
    .join("");

  const children: string[] = [];
  if (Array.isArray(keywords) && keywords.length) {
    children.push(`  <keywords>${encode(keywords.join(", "))}</keywords>`);
  }
  if (typeof summary === "string" && summary.trim()) {
    children.push(`  <summary>${encode(summary.trim())}</summary>`);
  }
  for (const k of extra.filter((k) => !isScalar(fields[k]))) {
    children.push(`  <data key="${encodeAttr(k)}">${encode(JSON.stringify(fields[k]))}</data>`);
  }

  const text = card.body.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
  const body = text ? `\n${text}\n` : "";
  const head = children.length ? `\n${children.join("\n")}\n` : "";
  return `<card${attributes}>${head}${body}</card>\n`;
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
