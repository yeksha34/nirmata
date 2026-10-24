import { stringify } from "yaml";
import { type AdventureState, chaptersOf, liveCardsOf } from "./events";

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
 * The files an adventure's current branch should have on disk: one markdown file per chapter, an
 * index of them, and one card file per tracking card. A pure function of the event log, so the
 * server can rewrite them after every change (and delete any it no longer lists) and nothing is
 * lost if they are removed. Cards use the same format as the world's, so the editor and linter
 * read them unchanged.
 */
export function projectAdventure(
  state: AdventureState,
  at: string | null = state.head,
): ProjectedFile[] {
  const files: ProjectedFile[] = [];

  const chapters = chaptersOf(state, at);
  for (const c of chapters) {
    files.push({
      path: chapterPath(c.number, c.title),
      content: `${frontmatter({ title: c.title, chapter: c.number, covers: c.covers, event: c.eventId })}\n# ${c.title}\n\n${c.text.trim()}\n`,
    });
  }
  if (chapters.length) {
    const list = chapters
      .map(
        (c) =>
          `${c.number}. [${c.title}](${chapterPath(c.number, c.title).replace("chapters/", "")})`,
      )
      .join("\n");
    files.push({ path: "chapters/index.md", content: `# Chapters\n\n${list}\n` });
  }

  for (const card of liveCardsOf(state, at).sort((a, b) => (a.fm.id < b.fm.id ? -1 : 1))) {
    const fm = card.fm;
    files.push({
      path: `cards/${fm.id}.md`,
      content: `${frontmatter({
        id: fm.id,
        kind: fm.kind,
        origin: fm.origin,
        name: fm.name,
        keywords: fm.keywords,
        summary: fm.summary,
        always: fm.always,
        ...(typeof fm.entity === "string" ? { entity: fm.entity } : {}),
      })}\n# ${fm.name}\n\n${card.body.trim()}\n`,
    });
  }
  return files;
}
