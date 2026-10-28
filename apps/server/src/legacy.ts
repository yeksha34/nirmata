import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import {
  type Card,
  type CardFrontmatter,
  type CardKind,
  checkCards,
  isFieldId,
  parseCard,
  serializeCard,
  type WorldManifest,
} from "@nirmata/core";
import { isNoise } from "./watch-core";

/**
 * Brings a story written the older way into a world Nirmata can host: a folder of markdown files
 * where a card is a `## Name` heading over `- **Label:** text` bullets. Every such file becomes a
 * card (docs/decisions/0017, 0018): the bullets become named parts, the rest stays as markdown,
 * and the keywords that bring a card into play are worked out from its name. Files that are not
 * cards (chapters, drafts, working notes) are copied across as they are.
 */

export interface Override {
  id?: string;
  name?: string;
  kind?: CardKind;
  role?: string;
  /** Replaces the keywords worked out from the name. */
  keywords?: string[];
  /** Added to them. */
  addKeywords?: string[];
  summary?: string;
  always?: boolean;
  scope?: CardFrontmatter["scope"];
  severity?: CardFrontmatter["severity"];
  /** A rule's yes/no question for the judge. */
  check?: string;
}

export interface Recipe {
  world: Pick<WorldManifest, "name" | "title"> & Partial<WorldManifest>;
  /** By the file's path in the source story. */
  overrides?: Record<string, Override>;
  /** Working documents that are not cards: kept, as they are, in `notes/`. */
  notes?: string[];
  /**
   * Two files that follow each character through the story (`arcs`: what changed in them;
   * `state`: where things stand). Each character gets one arc card holding both.
   */
  progress?: { arcs: string; state: string };
  /** Words that are also ordinary words in the story ("labia"): never a keyword on their own. */
  avoid?: string[];
}

export interface ImportReport {
  cards: number;
  byKind: Record<string, number>;
  copied: number;
  warnings: string[];
}

// ---- reading one file --------------------------------------------------------------------------

const HONORIFICS = new Set(["lady", "lord", "mr", "mrs", "ms", "dr", "sir", "dame"]);

const lf = (text: string): string => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

/** `Voice & Registers` -> `voice-and-registers`: a part's name, as Nirmata writes it. */
export function slug(text: string, max = 60): string {
  const s = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf("-");
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/-+$/, "");
}

/** Labels the story writes one way and Nirmata's templates another, for the same thing. */
const PART_ALIASES: Record<string, string> = {
  "kind-of-place": "kind",
  "the-ground": "layout",
  owner: "keeper",
};

const RESERVED_SUFFIX = "-notes";

export interface Parsed {
  title: string;
  front: Record<string, string>;
  /** The lines under the title, before anything else. */
  lines: string[];
}

export function parseLegacy(text: string): Parsed {
  let t = lf(text);
  const front: Record<string, string> = {};
  const fm = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
  if (fm) {
    for (const line of (fm[1] as string).split("\n")) {
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (m) front[m[1] as string] = (m[2] as string).trim();
    }
    t = t.slice(fm[0].length);
  }
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /^#{1,2}\s+\S/.test(l));
  if (at < 0) return { title: "", front, lines };
  const title = (lines[at] as string).replace(/^#{1,2}\s+/, "").trim();
  return { title, front, lines: lines.slice(at + 1) };
}

export interface Item {
  label: string;
  text: string;
}

/** What a character or place file holds: its labelled bullets, and everything else as markdown. */
export function readParts(lines: string[]): { items: Item[]; body: string } {
  const items: Item[] = [];
  const chunks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (/^#{1,6}\s/.test(line)) break;
    if (/^[-*] /.test(line)) {
      const block = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i] as string;
        if (next.trim() === "" || /^[ \t]/.test(next)) {
          block.push(next);
          i++;
        } else break;
      }
      while (block.length && (block[block.length - 1] as string).trim() === "") block.pop();
      const m = /^- \*\*(.+?):\*\*[ \t]*(.*)$/.exec(block[0] as string);
      if (!m) {
        chunks.push(block.join("\n"));
        continue;
      }
      const rest = block.slice(1);
      const indents = rest.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
      const cut = indents.length ? Math.min(...indents) : 0;
      const text = [
        m[2] as string,
        ...rest.map((l) => l.slice(Math.min(cut, l.length - l.trimStart().length))),
      ]
        .join("\n")
        .trim();
      items.push({ label: (m[1] as string).trim(), text });
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    // a paragraph
    const para = [line];
    i++;
    while (
      i < lines.length &&
      (lines[i] as string).trim() !== "" &&
      !/^(#{1,6}\s|[-*] )/.test(lines[i] as string)
    ) {
      para.push(lines[i] as string);
      i++;
    }
    chunks.push(para.join("\n"));
  }
  const rest = lines.slice(i).join("\n").trim();
  if (rest) chunks.push(rest);
  return { items, body: chunks.join("\n\n").trim() };
}

/** A part's id for a label: the template's own when it means the same, else the label made lowercase. */
export function partId(
  label: string,
  taken: ReadonlySet<string>,
  warn: (m: string) => void,
): string {
  let id = PART_ALIASES[slug(label)] ?? slug(label, 40);
  if (!/^[a-z]/.test(id)) id = `x-${id}`;
  if (!isFieldId(id)) {
    warn(`the label "${label}" is a reserved tag name; written as "${id}${RESERVED_SUFFIX}"`);
    id += RESERVED_SUFFIX;
  }
  let unique = id;
  for (let n = 2; taken.has(unique); n++) unique = `${id.slice(0, 36)}-${n}`;
  if (unique !== id) warn(`two parts are both called "${label}"; the second is "${unique}"`);
  return unique;
}

const plain = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The first sentence of some markdown, as plain text, cut short when it runs on. */
export function firstSentence(text: string, max = 200): string {
  const p = plain(text);
  const end = /[.!?](?:\s|$)/.exec(p);
  const sentence = end ? p.slice(0, end.index + 1) : p;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max).replace(/[,;:]$/, "")}…`;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What a lore file says first, as a summary: its first paragraph, or else its first bullet. */
function leadOf(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || /^(#|\||>|---)/.test(line)) continue;
    const m = /^[-*] (?:\*\*(.+?):\*\*\s*)?(.*)$/.exec(line);
    if (m) {
      const text = (m[2] as string) || (m[1] as string);
      if (text) return capital(firstSentence(text));
      continue;
    }
    return capital(firstSentence(line));
  }
  return "";
}

// ---- cards -------------------------------------------------------------------------------------

export interface Draft {
  /** The card's file, in the new world. */
  path: string;
  kind: CardKind;
  name: string;
  /** The name keywords come from, when the card's own name carries a suffix like "(arc)". */
  keyName: string;
  role?: string;
  parts: Record<string, string>;
  body: string;
  summary: string;
  extra: Partial<CardFrontmatter>;
  /** The file it came from; a card made from part of a file adds `#heading`. */
  source: string;
  keywords?: string[];
  id?: string;
}

const KIND_OF_DIR: Array<[string, CardKind]> = [
  ["characters/", "character"],
  ["setting/", "place"],
  ["lore/", "lore"],
  ["plot/", "arc"],
  [".agents/rules/", "rule"],
];

const PREFIX: Record<CardKind, string> = {
  lore: "lore",
  character: "char",
  place: "place",
  arc: "arc",
  rule: "rule",
  scene: "scene",
};

const kindOfPath = (rel: string): CardKind | undefined =>
  KIND_OF_DIR.find(([dir]) => rel.startsWith(dir))?.[1];

export function cardFromFile(
  rel: string,
  text: string,
  override: Override,
  warn: (m: string) => void,
): Draft | undefined {
  const kind = override.kind ?? kindOfPath(rel);
  if (!kind) return undefined;
  const parsed = parseLegacy(text);
  const title = parsed.title || basename(rel, ".md").replace(/[_-]+/g, " ");
  if (!parsed.title) warn(`${rel}: no heading; the file name is used as the name`);

  let name = override.name ?? title;
  let role = override.role;
  const protagonist = /\s*\(protagonist\)\s*$/i.exec(name);
  if (protagonist) {
    name = name.slice(0, protagonist.index).trim();
    role ??= "protagonist";
  }
  if (kind === "character") role ??= "npc";

  const draft: Draft = {
    path: rel,
    kind,
    name,
    keyName: name,
    ...(role ? { role } : {}),
    parts: {},
    body: "",
    summary: "",
    extra: {},
    source: rel,
  };
  if (parsed.front.trigger === "always_on") {
    if (kind === "rule") draft.extra.severity = "must";
    else draft.extra.always = true;
  }

  if (kind === "character" || kind === "place") {
    const { items, body } = readParts(parsed.lines);
    const taken = new Set<string>();
    for (const it of items) {
      if (!it.text) continue;
      const id = partId(it.label, taken, (m) => warn(`${rel}: ${m}`));
      taken.add(id);
      draft.parts[id] = it.text;
    }
    draft.body = body;
    const kindPart = draft.parts.kind;
    const standing = draft.parts.standing ?? draft.parts.position;
    draft.summary = [kindPart, standing]
      .filter((x): x is string => Boolean(x))
      .map((x) => capital(firstSentence(x, 110)))
      .join(" ");
    if (!draft.summary) draft.summary = leadOf(body);
  } else if (kind === "rule") {
    const body = parsed.lines.join("\n").trim();
    draft.parts.rule = body;
    if (override.check) draft.parts.check = override.check;
    draft.summary = leadOf(body);
  } else {
    draft.body = parsed.lines.join("\n").trim();
    draft.summary = leadOf(draft.body);
  }

  if (override.summary !== undefined) draft.summary = override.summary;
  if (override.always !== undefined) draft.extra.always = override.always;
  if (override.scope) draft.extra.scope = override.scope;
  if (override.severity) draft.extra.severity = override.severity;
  return draft;
}

// ---- the two files that follow each character --------------------------------------------------

interface Section {
  group: string;
  heading: string;
  lines: string[];
}

function sectionsOf(text: string, level: number): Section[] {
  const mark = "#".repeat(level);
  const out: Section[] = [];
  let group = "";
  let cur: Section | undefined;
  for (const line of lf(text).split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m && (m[1] as string).length < level) {
      group = (m[2] as string).trim();
      cur = undefined;
      continue;
    }
    if (m && m[1] === mark) {
      cur = { group, heading: (m[2] as string).trim(), lines: [] };
      out.push(cur);
      continue;
    }
    cur?.lines.push(line);
  }
  return out;
}

const words = (s: string): string[] =>
  plain(s)
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w && !HONORIFICS.has(w) && w !== "the");

/** The arc cards: one per character that has an arc or a place in the state file. */
export function progressCards(
  arcsText: string,
  stateText: string,
  source: { arcs: string; state: string },
  warn: (m: string) => void,
): Draft[] {
  const drafts: Draft[] = [];
  const byHeading: Draft[] = [];
  for (const s of sectionsOf(arcsText, 3)) {
    const body = s.lines.join("\n").trim();
    if (!body) continue;
    const d: Draft = {
      path: "",
      kind: "arc",
      name: `${s.heading} (arc)`,
      keyName: s.heading,
      parts: {},
      body,
      summary: leadOf(body),
      extra: {},
      source: `${source.arcs}#${s.heading}`,
    };
    byHeading.push(d);
    drafts.push(d);
  }

  const entries = new Map<string, { label: string; texts: string[] }>();
  const groups: Section[] = sectionsOf(stateText, 2);
  for (const g of groups) {
    const { items, body } = readParts(g.lines);
    for (const it of items) {
      const key = slug(it.label);
      const e = entries.get(key) ?? { label: it.label, texts: [] };
      e.texts.push(it.text);
      entries.set(key, e);
    }
    if (!items.length && body) {
      const d: Draft = {
        path: "",
        kind: "arc",
        name: g.heading,
        keyName: g.heading,
        parts: {},
        body,
        summary: leadOf(body),
        extra: {},
        source: `${source.state}#${g.heading}`,
      };
      drafts.push(d);
    }
  }
  for (const { label, texts } of entries.values()) {
    const want = words(label);
    const hits = byHeading.filter((d) => {
      const have = words(d.keyName);
      return want.length > 0 && want.every((w) => have.includes(w));
    });
    const text = texts.join("\n\n");
    if (hits.length === 1) {
      (hits[0] as Draft).parts.progress = text;
      continue;
    }
    if (hits.length > 1) warn(`state of "${label}" fits several arcs; written as its own card`);
    drafts.push({
      path: "",
      kind: "arc",
      name: `${plain(label)} (where things stand)`,
      keyName: plain(label).replace(/\s*\([^)]*\)\s*$/, ""),
      parts: { progress: text },
      body: "",
      summary: capital(firstSentence(text)),
      extra: {},
      source: `${source.state}#${label}`,
    });
  }
  return drafts;
}

// ---- keywords ----------------------------------------------------------------------------------

/** What a card is called, and what it might be shortened to. */
export function nameForms(keyName: string, skin: boolean): { full: string[]; short: string[] } {
  const base = plain(keyName)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const tokens = base.split(/\s+/);
  const lead = (tokens[0] as string).toLowerCase();
  const bare = HONORIFICS.has(lead) && tokens.length > 1 ? tokens.slice(1).join(" ") : base;
  const first = bare.split(/\s+/)[0] as string;
  const person = bare.split(/\s+/).length > 1 && /^\p{L}{4,}$/u.test(first) && lead !== "the";
  if (skin) {
    return { full: [`${bare}'s skin`], short: [bare, ...(person ? [`${first}'s skin`] : [])] };
  }
  const full = [base];
  if (bare !== base) full.push(bare);
  if (lead === "the" && tokens.length > 1) full.push(tokens.slice(1).join(" "));
  return { full, short: person ? [first] : [] };
}

export function assignKeywords(
  drafts: Draft[],
  overrides: Record<string, Override>,
  avoid: readonly string[] = [],
): string[] {
  const warnings: string[] = [];
  const shunned = new Set(avoid.map((w) => w.toLowerCase()));
  const keywords = new Map<Draft, string[]>();
  const claims = new Map<string, Set<Draft>>();
  const claim = (d: Draft, k: string) => {
    const key = `${d.kind}:${k.toLowerCase()}`;
    const set = claims.get(key) ?? new Set<Draft>();
    set.add(d);
    claims.set(key, set);
  };
  const forms = new Map<Draft, { full: string[]; short: string[] }>();
  for (const d of drafts) {
    const f = nameForms(d.keyName, /\(skin\)\s*$/i.test(d.name));
    forms.set(d, f);
    // a card whose keywords were written by hand does not take part in the sharing of short names
    if (overrides[d.source]?.keywords) continue;
    for (const k of [...f.full, ...f.short]) claim(d, k);
  }
  for (const d of drafts) {
    const o = overrides[d.source] ?? {};
    const f = forms.get(d) as { full: string[]; short: string[] };
    const keep = (k: string) => (claims.get(`${d.kind}:${k.toLowerCase()}`)?.size ?? 0) === 1;
    // a lore card's one-word shortenings ("touch", "casting") would fire on every page
    const short = d.kind === "lore" || d.kind === "rule" ? [] : f.short.filter(keep);
    const named = [...f.full, ...short].filter((k) => !shunned.has(k.toLowerCase()));
    const list = o.keywords ?? (d.kind === "rule" ? [] : named);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of [...list, ...(o.addKeywords ?? [])]) {
      const v = k.replace(/,/g, "").trim();
      if (v && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        out.push(v);
      }
    }
    keywords.set(d, out);
  }
  for (const [d, k] of keywords) {
    d.keywords = k;
    if (!k.length && d.kind !== "rule") warnings.push(`${d.path || d.name}: no keywords`);
  }
  return warnings;
}

// ---- writing it all ----------------------------------------------------------------------------

type Keyed = Draft;

function cardOf(d: Keyed): Card {
  const fm = {
    id: d.id as string,
    kind: d.kind,
    name: d.name,
    keywords: d.keywords ?? [],
    summary: d.summary,
    always: false,
    scope: "both",
    severity: "should",
    ...(d.role ? { role: d.role } : {}),
    ...d.extra,
    fields: d.parts,
  } as CardFrontmatter;
  return { path: d.path, fm, body: d.body ? `${d.body}\n` : "" };
}

export async function* walk(dir: string, rel = ""): AsyncGenerator<string> {
  for (const name of (await readdir(dir)).sort()) {
    if ([".git", "__pycache__", "node_modules"].includes(name)) continue;
    const path = posix.join(rel, name);
    // an editor's scratch file or a sync client's temporary one is not part of the story
    if (isNoise(name)) continue;
    if ((await stat(join(dir, name))).isDirectory()) yield* walk(join(dir, name), path);
    else yield path;
  }
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

/** Reads the old story in `src` and writes a Nirmata world to `dest` (which must not exist yet). */
export async function importStory(
  src: string,
  dest: string,
  recipe: Recipe,
): Promise<ImportReport> {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const overrides = recipe.overrides ?? {};
  const notes = new Set(recipe.notes ?? []);
  const progress = recipe.progress;
  const progressFiles = new Set(progress ? [progress.arcs, progress.state] : []);

  try {
    await stat(join(dest, "world.json"));
    throw new Error(`${dest} already holds a world; choose a new folder`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const drafts: Keyed[] = [];
  let copied = 0;
  const texts = new Map<string, string>();

  for await (const rel of walk(src)) {
    const from = join(src, rel);
    if (notes.has(rel)) {
      await mkdir(join(dest, "notes"), { recursive: true });
      await copyFile(from, join(dest, "notes", basename(rel)));
      copied++;
      continue;
    }
    if (progressFiles.has(rel)) {
      texts.set(rel, await readFile(from, "utf8"));
      continue;
    }
    if (rel.endsWith(".md") && kindOfPath(rel) && !basename(rel).startsWith("_")) {
      const draft = cardFromFile(rel, await readFile(from, "utf8"), overrides[rel] ?? {}, warn);
      if (draft) {
        drafts.push(draft);
        continue;
      }
    }
    await mkdir(dirname(join(dest, rel)), { recursive: true });
    await copyFile(from, join(dest, rel));
    copied++;
  }

  if (progress) {
    const arcs = texts.get(progress.arcs);
    const state = texts.get(progress.state);
    if (arcs === undefined || state === undefined) {
      warn("the progress files named in the recipe were not found");
    } else {
      for (const d of progressCards(arcs, state, progress, warn)) {
        d.path = `plot/arcs/${slug(d.keyName)}${d.name.endsWith("(where things stand)") ? "-state" : ""}.md`;
        drafts.push(d);
      }
    }
  }

  // a link to a working document now reaches it in notes/
  const moved = new Map(
    [...notes].map((n) => [n, posix.join("notes", posix.basename(n))] as const),
  );
  const relink = (text: string, was: string, now: string): string =>
    text.replace(
      /\]\((?!https?:|#|mailto:)([^)\s#]+)(#[^)\s]*)?\)/g,
      (_all, target: string, hash = "") => {
        const path = posix.normalize(posix.join(posix.dirname(was), target));
        const there = moved.get(path) ?? path;
        return `](${posix.relative(posix.dirname(now), there)}${hash})`;
      },
    );
  for (const d of drafts) {
    const was = d.source.split("#")[0] as string;
    d.body = relink(d.body, was, d.path);
    for (const k of Object.keys(d.parts)) d.parts[k] = relink(d.parts[k] as string, was, d.path);
  }

  // ids: kind prefix and the file's name
  const used = new Set<string>();
  for (const d of drafts) {
    const o = overrides[d.source] ?? {};
    const stem = basename(d.path, ".md").replace(/^world_\d+_/, "");
    let id = o.id ?? `${PREFIX[d.kind]}.${slug(stem)}`;
    for (let n = 2; used.has(id); n++) id = `${o.id ?? `${PREFIX[d.kind]}.${slug(stem)}`}-${n}`;
    used.add(id);
    d.id = id;
  }

  warnings.push(...assignKeywords(drafts, overrides, recipe.avoid));

  const byKind: Record<string, number> = {};
  const written: Card[] = [];
  for (const d of drafts) {
    const card = cardOf(d);
    const text = serializeCard(card);
    const back = parseCard(d.path, text);
    if (!back.ok) {
      warn(`${d.path}: written, but cannot be read back: ${back.errors.join("; ")}`);
    } else {
      const same = JSON.stringify(back.card.fm.fields) === JSON.stringify(card.fm.fields);
      if (!same || back.card.body.trim() !== card.body.trim()) {
        warn(`${d.path}: changed on the way through the card format`);
      }
      written.push(back.card);
    }
    await put(join(dest, d.path), text);
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  }
  warnings.push(...checkCards(written));

  // links between cards should still reach a file
  const here = new Set<string>();
  for await (const rel of walk(dest)) here.add(rel);
  for (const card of written) {
    const texts = [card.body, ...Object.values(card.fm.fields)];
    for (const t of texts) {
      for (const m of t.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
        const target = posix.normalize(
          posix.join(posix.dirname(card.path), (m[1] as string).split("#")[0] as string),
        );
        if (!here.has(target)) warn(`${card.path}: links to ${m[1]}, which is not in the world`);
      }
    }
  }

  const manifest = {
    ...recipe.world,
    genre: recipe.world.genre ?? [],
    tone: recipe.world.tone ?? [],
    perspective: recipe.world.perspective ?? "third-person",
    systems: recipe.world.systems ?? { dice: "none", stats: [], inventory: false },
    createdWith: "nirmata 0.1 (imported)",
  };
  await put(join(dest, "world.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return { cards: drafts.length, byKind, copied, warnings };
}
