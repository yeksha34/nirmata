import { humanize, MODE_LABEL } from "../format";
import type { Card, CardKind, ChapterView, Draft, TurnView } from "../types";

/**
 * What the reader turns the pages of: a cover and some chapters, whatever they were made from (a
 * card, a whole world, the story so far, a line someone has drafted). The builders here are
 * plain functions of data, so what ends up on a page is testable without a screen.
 */

export type Mood = "dusk" | "ember" | "forest" | "rain" | "moon" | "ink";
export const MOODS: readonly Mood[] = ["dusk", "ember", "forest", "rain", "moon", "ink"];
export const MOOD_LABEL: Record<Mood, string> = {
  dusk: "Dusk",
  ember: "Embers",
  forest: "Forest",
  rain: "Rain",
  moon: "Moonlight",
  ink: "Ink",
};

/** The look and sound that suit a card, by what kind it is. */
const KIND_MOOD: Record<CardKind, Mood> = {
  lore: "dusk",
  character: "ember",
  place: "forest",
  arc: "moon",
  rule: "ink",
  scene: "rain",
};

/** What a card is called on a cover: the words the card list already uses. */
const KIND_CARD: Record<CardKind, string> = {
  lore: "Lore entry card",
  character: "Character card",
  place: "Place card",
  arc: "Story arc card",
  rule: "Rule card",
  scene: "Scene card",
};

/** The order a world reads in: what is true of it, where, who, what happens, then the rules. */
const READING_ORDER: readonly CardKind[] = ["lore", "place", "character", "arc", "scene", "rule"];

export type Block =
  | { kind: "p"; text: string }
  | { kind: "lede"; text: string }
  /** `app` marks a heading the app wrote (a part's name), which goes through the Hindi labels. */
  | { kind: "h"; level: 3 | 4; text: string; app?: boolean }
  | { kind: "quote"; text: string; by?: string; mode?: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "rule" };

export interface Chapter {
  id: string;
  /** Empty for a chapter that has no heading. */
  title: string;
  /** The title is something the app says (a part's name or "Chapter 2"), not something written. */
  app?: boolean;
  /** A small label above the title: always something the app says. */
  kicker?: string;
  blocks: Block[];
}

export interface Book {
  id: string;
  /** What this is, in the app's words ("Lore entry card"). */
  kicker: string;
  title: string;
  lede?: string;
  tags: string[];
  mood: Mood;
  chapters: Chapter[];
}

// ---- text ------------------------------------------------------------------------------------

export type Inline = { t: "text" | "b" | "i" | "code"; s: string };

/** `**bold**`, `*italic*` and `code` inside a line; anything else is text as it was written. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const mark = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g;
  let at = 0;
  for (const m of text.matchAll(mark)) {
    const index = m.index ?? 0;
    if (index > at) out.push({ t: "text", s: text.slice(at, index) });
    if (m[1] !== undefined) out.push({ t: "b", s: m[1] });
    else if (m[2] !== undefined) out.push({ t: "i", s: m[2] });
    else out.push({ t: "code", s: m[3] ?? "" });
    at = index + m[0].length;
  }
  if (at < text.length) out.push({ t: "text", s: text.slice(at) });
  return out;
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

/** Markdown as the few kinds of block a page needs. Lines of one paragraph run together. */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;

  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    if (quote.length) blocks.push({ kind: "quote", text: quote.join(" ") });
    if (list) blocks.push({ kind: "list", ...list });
    para = [];
    quote = [];
    list = undefined;
  };

  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const quoted = QUOTE.exec(line);
    const item = ITEM.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      // the chapter's own title is the page's heading, so a heading in the text starts one lower
      blocks.push({
        kind: "h",
        level: (heading[1] as string).length <= 2 ? 3 : 4,
        text: heading[2] as string,
      });
    } else if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
    } else if (quoted) {
      if (para.length || list) flush();
      quote.push(quoted[1] as string);
    } else if (item) {
      if (para.length || quote.length) flush();
      const ordered = item[2] !== undefined;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[3] as string);
    } else {
      if (quote.length || list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

// ---- builders --------------------------------------------------------------------------------

type CardLike = { fm: Omit<Card["fm"], "id"> & { id?: string }; body: string; path?: string };

/** A card's body often begins with its own name as a heading; the page already says it. */
function withoutOwnTitle(blocks: Block[], name: string): Block[] {
  const first = blocks[0];
  return first?.kind === "h" && first.text.trim().toLowerCase() === name.trim().toLowerCase()
    ? blocks.slice(1)
    : blocks;
}

/** A card's own text as blocks: its summary, then its named parts, then the body. */
function cardBlocks(card: CardLike, withSummary: boolean): Block[] {
  const blocks: Block[] = [];
  if (withSummary && card.fm.summary?.trim())
    blocks.push({ kind: "lede", text: card.fm.summary.trim() });
  for (const [id, text] of Object.entries(card.fm.fields ?? {})) {
    if (!text.trim()) continue;
    blocks.push({ kind: "h", level: 3, text: humanize(id), app: true }, ...parseBlocks(text));
  }
  blocks.push(...withoutOwnTitle(parseBlocks(card.body), card.fm.name));
  return blocks;
}

/** One card, read as a book: the cover says what it is, and its parts are the pages after. */
export function bookFromCard(card: CardLike): Book {
  const kind = card.fm.kind;
  const named = Object.entries(card.fm.fields ?? {}).filter(([, text]) => text.trim());
  const chapters: Chapter[] = [];
  const body = withoutOwnTitle(parseBlocks(card.body), card.fm.name);
  for (const [id, text] of named)
    chapters.push({ id: `part-${id}`, title: humanize(id), app: true, blocks: parseBlocks(text) });
  if (body.length) chapters.push({ id: "body", title: "", blocks: body });
  return {
    id: card.path ?? card.fm.id ?? card.fm.name,
    kicker: KIND_CARD[kind],
    title: card.fm.name.trim(),
    ...(card.fm.summary?.trim() ? { lede: card.fm.summary.trim() } : {}),
    tags: card.fm.keywords ?? [],
    mood: KIND_MOOD[kind],
    chapters,
  };
}

/** A whole world: its cover, then every card as a chapter, in the order a reader wants them. */
export function bookFromWorld(
  world: { name: string; title: string; tagline?: string; genre?: string[]; tone?: string[] },
  cards: readonly Card[],
): Book {
  const chapters: Chapter[] = [];
  for (const kind of READING_ORDER)
    for (const card of cards.filter((c) => c.fm.kind === kind))
      chapters.push({
        id: card.path,
        title: card.fm.name,
        kicker: KIND_CARD[kind],
        blocks: cardBlocks(card, true),
      });
  return {
    id: `world:${world.name}`,
    kicker: "World",
    title: world.title,
    ...(world.tagline?.trim() ? { lede: world.tagline.trim() } : {}),
    tags: [...(world.genre ?? []), ...(world.tone ?? [])],
    mood: "moon",
    chapters,
  };
}

/** What a turn looks like on a page: the storyteller's prose, or a player's line as a quote. */
function turnBlocks(turn: TurnView): Block[] {
  if (turn.role === "host") return parseBlocks(turn.text);
  return [
    {
      kind: "quote",
      text: turn.text.replace(/\s*\n+\s*/g, " "),
      ...(turn.by ? { by: turn.by } : {}),
      ...(turn.mode ? { mode: turn.mode } : {}),
    },
  ];
}

/**
 * The story so far. Each chapter takes the turns up to the one it was cut at; whatever has been
 * written since goes on the end of the last chapter, which is the one still being written.
 */
export function bookFromStory(
  world: { title: string; tagline?: string } | null,
  id: string,
  turns: readonly TurnView[],
  chapters: readonly ChapterView[],
): Book {
  const made: Chapter[] = [];
  const cuts = chapters.filter((c) => c.through !== undefined);
  if (cuts.length === 0) {
    if (turns.length) made.push({ id: "all", title: "", blocks: turns.flatMap(turnBlocks) });
  } else {
    let from = 0;
    cuts.forEach((c, i) => {
      const last = i === cuts.length - 1;
      const at = turns.findIndex((t) => t.id === c.through);
      const to = last ? turns.length : at < 0 ? from : at + 1;
      made.push({
        id: `chapter-${c.number}`,
        title: c.title,
        app: true,
        blocks: turns.slice(from, to).flatMap(turnBlocks),
      });
      from = to;
    });
  }
  const players = [...new Set(turns.flatMap((t) => (t.role === "player" && t.by ? [t.by] : [])))];
  return {
    id: `story:${id}`,
    kicker: "Story",
    title: world?.title ?? "Story",
    ...(world?.tagline?.trim() ? { lede: world.tagline.trim() } : {}),
    tags: players,
    mood: "dusk",
    chapters: made.filter((c) => c.blocks.length > 0),
  };
}

/** A chapter or draft as the world has it: markdown, with a title taken from its first heading. */
export interface WritingText {
  path: string;
  title: string;
  text: string;
}

/** One chapter or draft: a cover with its title, then the text, a page after page. */
export function bookFromWriting(
  world: { title: string } | undefined,
  writing: WritingText,
  kind: "chapter" | "draft",
): Book {
  return {
    id: `writing:${writing.path}`,
    kicker: kind === "chapter" ? "Chapter" : "Draft",
    title: writing.title,
    ...(world?.title ? { lede: world.title } : {}),
    tags: [],
    mood: kind === "chapter" ? "dusk" : "rain",
    chapters: [
      {
        id: "text",
        title: "",
        blocks: withoutOwnTitle(parseBlocks(writing.text), writing.title),
      },
    ],
  };
}

/** A world's chapters read one after the other: the world's cover, then each chapter under its title. */
export function bookFromWritings(
  world: { name: string; title: string },
  writings: readonly WritingText[],
): Book {
  return {
    id: `chapters:${world.name}`,
    kicker: "Chapters",
    title: world.title,
    tags: [],
    mood: "dusk",
    chapters: writings.map((w) => ({
      id: w.path,
      title: w.title,
      blocks: withoutOwnTitle(parseBlocks(w.text), w.title),
    })),
  };
}

/** A turn someone is writing on the board. */
export function bookFromDraft(draft: Pick<Draft, "nick" | "mode" | "text">): Book {
  return {
    id: `draft:${draft.nick}`,
    kicker: MODE_LABEL[draft.mode],
    title: draft.nick,
    tags: [],
    mood: "dusk",
    chapters: [{ id: "draft", title: "", blocks: parseBlocks(draft.text) }],
  };
}
