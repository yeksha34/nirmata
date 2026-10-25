import { stringify } from "yaml";
import type { AdventureState } from "./events";
import { plotPointsOf } from "./plot";
import { chaptersOf } from "./window";

export interface ProjectedFile {
  /** Relative to the adventure's folder, forward slashes. */
  path: string;
  content: string;
}

export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

export function chapterPath(number: number, title: string): string {
  return `chapters/chapter-${String(number).padStart(2, "0")}-${slugify(title)}.md`;
}

function frontmatter(data: Record<string, unknown>): string {
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

/**
 * The files an adventure's current branch should have on disk: one markdown file per chapter (the
 * turns that have left the context window, verbatim), an index of them, and one file per card
 * that has plot points. A pure function of the event log, so the server can rewrite them after
 * every change (deleting any it no longer lists) and nothing is lost if they are removed.
 *
 * `cardNames` lets plot files show a card's name instead of only its id.
 */
export function projectAdventure(
  state: AdventureState,
  options: {
    at?: string | null;
    cardNames?: ReadonlyMap<string, string>;
    revokesSurviveUndo?: boolean;
  } = {},
): ProjectedFile[] {
  const at = options.at === undefined ? state.head : options.at;
  const files: ProjectedFile[] = [];

  const chapters = chaptersOf(state, at);
  for (const c of chapters) {
    files.push({
      path: chapterPath(c.number, c.title),
      content: `${frontmatter({ title: c.title, chapter: c.number, open: c.open, through: c.through })}\n# ${c.title}\n\n${c.text}\n`,
    });
  }
  if (chapters.length) {
    const list = chapters
      .map(
        (c) =>
          `${c.number}. [${c.title}](${chapterPath(c.number, c.title).replace("chapters/", "")})${c.open ? " (still being written)" : ""}`,
      )
      .join("\n");
    files.push({ path: "chapters/index.md", content: `# Chapters\n\n${list}\n` });
  }

  const byCard = new Map<string, string[]>();
  for (const p of plotPointsOf(state, at, {
    revokesSurviveUndo: options.revokesSurviveUndo === true,
  })) {
    byCard.set(p.card, [...(byCard.get(p.card) ?? []), p.text]);
  }
  for (const [card, texts] of [...byCard].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const name = options.cardNames?.get(card);
    files.push({
      path: `plot/${card}.md`,
      content: `${frontmatter({ card, ...(name ? { name } : {}) })}\n# ${name ?? card}\n\n${texts.map((t) => `- ${t}`).join("\n")}\n`,
    });
  }
  return files;
}
