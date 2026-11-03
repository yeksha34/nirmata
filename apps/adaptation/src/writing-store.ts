import type { Db } from "@nirmata/db";

/** A refusal the caller can read: a path that is not a chapter or draft, or a text that is too large. */
export class WritingError extends Error {}

/** One chapter or draft, without its text. */
export interface WritingInfo {
  /** Inside the world, with forward slashes: `chapters/…` or `drafts/…`. */
  path: string;
  title: string;
  /** Bytes. */
  size: number;
  updatedAt: string;
}

export interface WritingText {
  path: string;
  title: string;
  text: string;
}

/** What the library asks for an imported world's chapters and drafts (ADR-0035). */
export interface WritingSource {
  /** The world's chapters and drafts without their text, or undefined when the world is not in the database. */
  list(worldSlug: string): Promise<WritingInfo[] | undefined>;
  /** One in full, or undefined when there is none (or the world is not in the database). */
  get(worldSlug: string, path: string): Promise<WritingText | undefined>;
}

const MAX_BYTES = 4_194_304;

/** A path the database accepts: markdown under `chapters/` or `drafts/`, with no `..` and no backslash. */
export function parseWritingPath(input: unknown): string {
  const path = typeof input === "string" ? input.replaceAll("\\", "/") : "";
  if (
    !/^(chapters|drafts)\/[^/].*\.md$/.test(path) ||
    path.length > 300 ||
    /(^|\/)\.\.(\/|$)/.test(path) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
    /[\x01-\x1f]/.test(path)
  ) {
    throw new WritingError("A chapter or draft is a markdown file under chapters/ or drafts/.");
  }
  return path;
}

/** The first heading of a text, else its file's name. */
export function writingTitle(text: string, path: string): string {
  const heading = /^#{1,2}[ \t]+(.+?)[ \t]*$/m.exec(text.slice(0, 2000));
  if (heading?.[1]) return heading[1].slice(0, 300);
  const base = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  const name = base.replace(/[_-]+/g, " ").trim() || "Untitled";
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 300);
}

/**
 * Chapters and drafts, kept in the database (ADR-0035, ADR-0036). Read and written as the author the
 * caller stands for; nobody else reads them.
 */
export class WritingStore {
  constructor(private readonly db: Db) {}

  async list(userId: string, worldSlug: string): Promise<WritingInfo[] | undefined> {
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]
        ?.id;
      if (!world) return undefined;
      const rows = (
        await q(
          `select path, title, octet_length(body) as size, updated_at
             from reader.writings where world_id = $1 order by path`,
          [world],
        )
      ).rows;
      return rows.map((r) => ({
        path: String(r.path),
        title: String(r.title),
        size: Number(r.size),
        updatedAt: new Date(r.updated_at as string).toISOString(),
      }));
    });
  }

  async get(userId: string, worldSlug: string, path: string): Promise<WritingText | undefined> {
    return this.db.asUser(userId, async (q) => {
      const row = (
        await q(
          `select x.path, x.title, x.body from reader.writings x
             join world_lore.worlds w on w.id = x.world_id
            where w.slug = $1 and x.path = $2`,
          [worldSlug, path],
        )
      ).rows[0];
      return row ? { path: String(row.path), title: String(row.title), text: String(row.body) } : undefined;
    });
  }

  /** Save a chapter or draft, making it if it is new. False when the world is not in the database. */
  async save(userId: string, worldSlug: string, path: string, text: string): Promise<boolean> {
    const clean = parseWritingPath(path);
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new WritingError("That text is too large.");
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]
        ?.id;
      if (!world) return false;
      await q("select reader.save_writing($1, $2, $3, $4)", [
        world,
        clean,
        writingTitle(text, clean),
        text,
      ]);
      return true;
    });
  }

  async remove(userId: string, worldSlug: string, path: string): Promise<boolean> {
    const clean = parseWritingPath(path);
    return this.db.asUser(userId, async (q) => {
      const world = (await q("select id from world_lore.worlds where slug = $1", [worldSlug])).rows[0]
        ?.id;
      if (!world) return false;
      await q("select reader.remove_writing($1, $2)", [world, clean]);
      return true;
    });
  }

  source(userOf: () => string | undefined): WritingSource {
    return {
      list: async (world) => {
        const user = userOf();
        return user ? this.list(user, world) : undefined;
      },
      get: async (world, path) => {
        const user = userOf();
        return user ? this.get(user, world, path) : undefined;
      },
    };
  }
}
