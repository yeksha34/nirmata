import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  type Card,
  type ProjectedFile,
  parseCard,
  parseLog,
  parseWorldManifest,
  type StoryEvent,
  type StoryWorld,
  serializeCard,
  serializeEvent,
  type WorldManifest,
} from "@nirmata/core";
import { type EventSink, HostError, type SourceBackend } from "@nirmata/host";

/** Where a world keeps its cards. Same layout the editor and the linter use. */
const CARD_DIRS = ["lore", "characters", "setting", "plot", ".agents/rules"] as const;

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (isMissing(e)) return undefined;
    throw e;
  }
}

/** `rel` inside `root`, or an error: nothing a caller sends may reach outside the world's folder. */
export function inside(root: string, rel: string): string {
  const base = resolve(root);
  const full = resolve(base, rel);
  if (rel.includes("\0") || (full !== base && !full.startsWith(base + sep))) {
    throw new HostError("invalid_card", "That path is outside the world's folder.");
  }
  return full;
}

async function markdownFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
  const out: string[] = [];
  for (const name of names.sort()) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await markdownFiles(full)));
    else if (name.endsWith(".md") && !name.startsWith("_")) out.push(full);
  }
  return out;
}

/** One world on disk: `world.json` and its card folders. The source cards (ADR-0009). */
export class WorldFiles implements SourceBackend {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  get storiesDir(): string {
    return join(this.root, "stories");
  }

  async world(): Promise<WorldManifest> {
    const text = await readIfThere(join(this.root, "world.json"));
    if (text === undefined) {
      throw new HostError("bad_state", `There is no world.json in ${this.root}.`);
    }
    const parsed = parseWorldManifest(text);
    if (!parsed.ok) throw new HostError("bad_state", `world.json: ${parsed.errors.join("; ")}`);
    return parsed.world;
  }

  async cards(): Promise<Card[]> {
    const cards: Card[] = [];
    for (const dir of CARD_DIRS) {
      for (const file of await markdownFiles(join(this.root, dir))) {
        const rel = file.slice(this.root.length + 1).replaceAll("\\", "/");
        const parsed = parseCard(rel, await readFile(file, "utf8"));
        if (!parsed.ok) {
          throw new HostError("invalid_card", `${rel}: ${parsed.errors.join("; ")}`);
        }
        cards.push(parsed.card);
      }
    }
    return cards;
  }

  async save(card: Card): Promise<void> {
    await writeAtomic(this.cardFile(card.path), serializeCard(card));
  }

  async remove(cardId: string): Promise<void> {
    const found = (await this.cards()).find((c) => c.fm.id === cardId);
    if (found) await rm(this.cardFile(found.path), { force: true });
  }

  /** The folder that holds this world and its siblings. */
  get parent(): string {
    return dirname(this.root);
  }

  private cardFile(path: string): string {
    return inside(this.root, cardPath(path));
  }
}

/** A card's world-relative path: markdown, in one of the card folders, never starting with "_". */
export function cardPath(path: string): string {
  const rel = path.replaceAll("\\", "/");
  const ok =
    rel.endsWith(".md") &&
    !basename(rel).startsWith("_") &&
    CARD_DIRS.some((d) => rel.startsWith(`${d}/`));
  if (!ok) {
    throw new HostError(
      "invalid_card",
      `A card's path must be a .md file inside ${CARD_DIRS.join(", ")} (got "${path}").`,
    );
  }
  return rel;
}

/** Names a world folder may have: lowercase letters, digits and hyphens. */
export const WORLD_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;

/**
 * Write a world made from a story as a new folder next to the others. Nothing is overwritten: a
 * name already in use is refused. The folder is built aside and moved into place, so a failure
 * leaves no half-made world behind.
 */
export async function writeNewWorld(
  parent: string,
  made: StoryWorld,
): Promise<{ name: string; cards: number; chapters: number }> {
  const name = made.manifest.name;
  if (!WORLD_NAME.test(name)) {
    throw new HostError(
      "bad_state",
      "A world's name uses lowercase letters, digits and hyphens, 2 to 40 characters.",
    );
  }
  const target = inside(parent, name);
  if (
    await stat(target).then(
      () => true,
      () => false,
    )
  ) {
    throw new HostError(
      "bad_state",
      `There is already a world called "${name}". Pick another name.`,
    );
  }
  const temp = `${target}.tmp-${randomBytes(3).toString("hex")}`;
  try {
    await writeAtomic(
      join(temp, "world.json"),
      `${JSON.stringify(made.manifest, null, 2)}
`,
    );
    for (const card of made.cards) {
      await writeAtomic(inside(temp, cardPath(card.path)), serializeCard(card));
    }
    for (const file of made.files) await writeAtomic(inside(temp, file.path), file.content);
    await writeAtomic(join(temp, "stories", ".gitkeep"), "");
    await rename(temp, target);
  } catch (e) {
    await rm(temp, { recursive: true, force: true });
    throw e;
  }
  return {
    name,
    cards: made.cards.length,
    chapters: made.files.filter((f) => f.path !== "chapters/index.md").length,
  };
}

export interface StorySummary {
  id: string;
  /** When its log was last written. */
  updatedAt: string;
}

/** A story's id: sortable by when it began, with a little randomness so two never collide. */
export function newStoryId(now: string): string {
  const stamp = now.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-").replace("Z", "");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

const STORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Every story is a folder: `events.jsonl` is the truth, and `chapters/` and `plot/` are files
 * rewritten from it after every change (`projectStory`), so they can be read, versioned or
 * deleted without losing anything.
 */
export class StoryFiles {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  folder(id: string): string {
    if (!STORY_ID.test(id)) throw new HostError("bad_state", `"${id}" is not a story id.`);
    return join(this.dir, id);
  }

  async list(): Promise<StorySummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
    const out: StorySummary[] = [];
    for (const id of names.filter((n) => STORY_ID.test(n))) {
      try {
        const info = await stat(join(this.dir, id, "events.jsonl"));
        out.push({ id, updatedAt: info.mtime.toISOString() });
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /** Appends one line per event. The session saves each event before using it. */
  sink(id: string): EventSink {
    const file = join(this.folder(id), "events.jsonl");
    return {
      async append(event: StoryEvent) {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${serializeEvent(event)}\n`, "utf8");
      },
    };
  }

  /**
   * The saved events. A crash can leave the last line half-written; that one line is set aside
   * in `events.jsonl.dropped` and the log is made whole again, so the next append starts on a
   * clean line. A bad line anywhere else is not guessed at: the error names it.
   */
  async load(id: string): Promise<StoryEvent[]> {
    const file = join(this.folder(id), "events.jsonl");
    const text = await readIfThere(file);
    if (text === undefined) throw new HostError("nothing_to_do", `There is no story "${id}".`);
    try {
      const events = parseLog(text);
      if (text.length && !text.endsWith("\n")) await appendFile(file, "\n", "utf8");
      return events;
    } catch (first) {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const last = lines.pop();
      let events: StoryEvent[];
      try {
        events = parseLog(lines.join("\n"));
      } catch {
        throw new HostError(
          "bad_state",
          `The saved story "${id}" is damaged: ${(first as Error).message}`,
        );
      }
      await writeAtomic(`${file}.dropped`, `${last ?? ""}\n`);
      await writeAtomic(file, events.map((e) => `${serializeEvent(e)}\n`).join(""));
      return events;
    }
  }

  /** Make `chapters/` and `plot/` match the projection: write what changed, delete what is gone. */
  async writeProjection(id: string, files: readonly ProjectedFile[]): Promise<void> {
    const root = this.folder(id);
    const wanted = new Set(files.map((f) => f.path));
    for (const f of files) {
      const full = inside(root, f.path);
      if ((await readIfThere(full)) !== f.content) await writeAtomic(full, f.content);
    }
    for (const dir of ["chapters", "plot"]) {
      let names: string[];
      try {
        names = await readdir(join(root, dir));
      } catch (e) {
        if (isMissing(e)) continue;
        throw e;
      }
      for (const name of names) {
        if (name.endsWith(".md") && !wanted.has(`${dir}/${name}`)) {
          await rm(join(root, dir, name), { force: true });
        }
      }
    }
  }
}
