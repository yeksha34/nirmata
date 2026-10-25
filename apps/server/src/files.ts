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
  CardFrontmatter,
  checkCards,
  formatIssues,
  type ProjectedFile,
  parseCard,
  parseLog,
  parseWorldManifest,
  replay,
  type StoryEvent,
  type StoryWorld,
  serializeCard,
  serializeEvent,
  turnsOf,
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

/** One card file: its text, and either the card it holds or what is wrong with it. */
export interface CardFile {
  path: string;
  text: string;
  card?: Card;
  problems?: string[];
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

  /** True when the folder has a world.json (it may still be unreadable). */
  async exists(): Promise<boolean> {
    return (await readIfThere(join(this.root, "world.json"))) !== undefined;
  }

  async world(): Promise<WorldManifest> {
    const text = await readIfThere(join(this.root, "world.json"));
    if (text === undefined) {
      throw new HostError("bad_state", "This world has no world.json.");
    }
    const parsed = parseWorldManifest(text);
    if (!parsed.ok) throw new HostError("bad_state", `world.json: ${parsed.errors.join("; ")}`);
    return parsed.world;
  }

  /** Every card file as it is on disk, readable or not: the manager shows the broken ones too. */
  async cardFiles(): Promise<CardFile[]> {
    const out: CardFile[] = [];
    for (const dir of CARD_DIRS) {
      for (const file of await markdownFiles(join(this.root, dir))) {
        const rel = file.slice(this.root.length + 1).replaceAll("\\", "/");
        const text = await readFile(file, "utf8");
        const parsed = parseCard(rel, text);
        out.push(
          parsed.ok
            ? { path: rel, text, card: parsed.card }
            : { path: rel, text, problems: parsed.errors },
        );
      }
    }
    return out;
  }

  /** The world's cards. A card that cannot be read stops this, naming the file (stories need all). */
  async cards(): Promise<Card[]> {
    const cards: Card[] = [];
    for (const f of await this.cardFiles()) {
      if (!f.card)
        throw new HostError("invalid_card", `${f.path}: ${(f.problems ?? []).join("; ")}`);
      cards.push(f.card);
    }
    return cards;
  }

  async save(card: Card): Promise<void> {
    await writeAtomic(this.cardFile(card.path), serializeCard(card));
  }

  /** Write a card file exactly as given (the manager's "edit as text"). */
  async saveText(path: string, text: string): Promise<void> {
    await writeAtomic(this.cardFile(path), text);
  }

  /** Delete one card file by its path. */
  async removeFile(path: string): Promise<void> {
    await rm(this.cardFile(path), { force: true });
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

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Make a new world folder: built aside, then moved into place, so a failure leaves no half-made
 * world behind. Nothing is overwritten: a name already in use is refused.
 */
async function placeNewFolder(
  parent: string,
  name: string,
  build: (temp: string) => Promise<void>,
): Promise<void> {
  if (!WORLD_NAME.test(name)) {
    throw new HostError(
      "bad_state",
      "A world's name uses lowercase letters, digits and hyphens, 2 to 40 characters.",
    );
  }
  const target = inside(parent, name);
  if (await exists(target)) {
    throw new HostError(
      "bad_state",
      `There is already a world called "${name}". Pick another name.`,
    );
  }
  const temp = `${target}.tmp-${randomBytes(3).toString("hex")}`;
  try {
    await build(temp);
    await rename(temp, target);
  } catch (e) {
    await rm(temp, { recursive: true, force: true });
    throw e;
  }
}

/** A folder name from a title: "The Lantern Coast!" becomes "the-lantern-coast". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "world";
}

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
  await placeNewFolder(parent, name, async (temp) => {
    await writeAtomic(join(temp, "world.json"), `${JSON.stringify(made.manifest, null, 2)}\n`);
    for (const card of made.cards) {
      await writeAtomic(inside(temp, cardPath(card.path)), serializeCard(card));
    }
    for (const file of made.files) await writeAtomic(inside(temp, file.path), file.content);
    await writeAtomic(join(temp, "stories", ".gitkeep"), "");
  });
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
  /** When it began. */
  startedAt?: string;
  /** Turns on the current branch. */
  turns: number;
  /** Who has written in it. */
  players: string[];
  /** The start of the latest thing the story said, to recognise it by. */
  preview: string;
  /** The log cannot be read; it needs repair before it can be continued. */
  damaged?: boolean;
}

function parseTolerant(text: string): StoryEvent[] {
  try {
    return parseLog(text);
  } catch {
    // a crash can leave one half-written last line; anything worse still throws
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    lines.pop();
    return parseLog(lines.join("\n"));
  }
}

function summarize(events: readonly StoryEvent[]): Omit<StorySummary, "id" | "updatedAt"> {
  const turns = turnsOf(replay(events));
  const lastHost = [...turns].reverse().find((t) => t.role === "host");
  const text = (lastHost?.text ?? "").replace(/\s+/g, " ").trim();
  return {
    ...(events[0] ? { startedAt: events[0].t } : {}),
    turns: turns.length,
    players: [...new Set(turns.flatMap((t) => (t.by ? [t.by] : [])))],
    preview: text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text,
  };
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

  private readonly cache = new Map<
    string,
    { key: string; summary: Omit<StorySummary, "id" | "updatedAt"> }
  >();

  /** The saved stories, newest first, each with enough to recognise it by. */
  async list(): Promise<StorySummary[]> {
    const out: StorySummary[] = [];
    for (const id of await this.ids()) {
      const file = join(this.dir, id, "events.jsonl");
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(file);
      } catch (e) {
        if (isMissing(e)) continue;
        throw e;
      }
      const key = `${info.mtimeMs}:${info.size}`;
      let cached = this.cache.get(id);
      if (cached?.key !== key) {
        let summary: Omit<StorySummary, "id" | "updatedAt">;
        try {
          summary = summarize(parseTolerant(await readFile(file, "utf8")));
        } catch {
          summary = { turns: 0, players: [], preview: "", damaged: true };
        }
        cached = { key, summary };
        this.cache.set(id, cached);
      }
      out.push({ id, updatedAt: info.mtime.toISOString(), ...cached.summary });
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /** How many stories are saved, without reading them. */
  async count(): Promise<number> {
    let n = 0;
    for (const id of await this.ids()) {
      if (
        await stat(join(this.dir, id, "events.jsonl")).then(
          () => true,
          () => false,
        )
      )
        n++;
    }
    return n;
  }

  private async ids(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((n) => STORY_ID.test(n));
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
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

export interface WorldSummary {
  name: string;
  title: string;
  tagline: string;
  /** How many stories have been saved in it. */
  stories: number;
  /** Its world.json cannot be read; the world cannot be opened until it is fixed. */
  problem?: string;
}

/** A saved story, with the world it belongs to. */
export interface RecentStory extends StorySummary {
  world: string;
  worldTitle: string;
}

/** What the manager may change in world.json; everything else in the file is kept as it was. */
export interface WorldPatch {
  title?: string | undefined;
  tagline?: string | undefined;
  genre?: string[] | undefined;
  tone?: string[] | undefined;
  perspective?: WorldManifest["perspective"] | undefined;
}

/** A card with the text of its file, for the manager to show and edit. */
export interface CardView extends Card {
  file: string;
}

/** A card file that cannot be read: shown with what is wrong, to be fixed as text or removed. */
export interface BrokenCard {
  path: string;
  file: string;
  problems: string[];
}

export interface WorldDetail {
  world: WorldSummary;
  /** world.json as read; missing when the world cannot be read. */
  manifest?: WorldManifest;
  stories: StorySummary[];
  cards: CardView[];
  broken: BrokenCard[];
}

/** What the manager's form sends for a card; the id, path and any extra fields stay as they were. */
export interface CardForm {
  kind: Card["fm"]["kind"];
  name: string;
  keywords: string[];
  summary: string;
  always: boolean;
  role?: string | undefined;
  scope?: Card["fm"]["scope"] | undefined;
  severity?: Card["fm"]["severity"] | undefined;
  /** The card's named parts, replacing the ones it had; empty ones are left out. */
  fields: Record<string, string>;
  body: string;
}

/** A card to save: the form's fields (a new card when there is no path) or the file's own text. */
export type CardInput =
  | { path?: string | undefined; form: CardForm }
  | { path: string; text: string };

/** The folder and id prefix a new card of each kind starts with. */
const KIND_HOME: Record<Card["fm"]["kind"], { dir: string; prefix: string }> = {
  lore: { dir: "lore", prefix: "lore" },
  character: { dir: "characters", prefix: "char" },
  place: { dir: "setting/places", prefix: "place" },
  arc: { dir: "plot/arcs", prefix: "arc" },
  rule: { dir: ".agents/rules", prefix: "rule" },
  scene: { dir: "plot/scenes", prefix: "scene" },
};

const LIBRARY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The folder of worlds a table can open. The host chooses one on screen; nothing is configured. */
export class Library {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  open(name: string): WorldFiles {
    if (!LIBRARY_NAME.test(name))
      throw new HostError("nothing_to_do", `There is no world "${name}".`);
    return new WorldFiles(join(this.root, name));
  }

  private readonly storyFiles = new Map<string, StoryFiles>();

  /** A world's saved stories. One `StoryFiles` per world, so its summaries stay cached. */
  stories(name: string): StoryFiles {
    let files = this.storyFiles.get(name);
    if (!files) {
      files = new StoryFiles(this.open(name).storiesDir);
      this.storyFiles.set(name, files);
    }
    return files;
  }

  /** Every folder with a world.json, by title. Folders starting with "_" or "." are skipped. */
  async list(): Promise<WorldSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
    const out: WorldSummary[] = [];
    for (const name of names.sort()) {
      if (!LIBRARY_NAME.test(name) || name.startsWith("_") || /\.tmp-[0-9a-f]+$/.test(name))
        continue;
      const found = await this.summary(name);
      if (found) out.push(found);
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** One world's summary, or nothing when the folder has no world.json. */
  private async summary(name: string): Promise<WorldSummary | undefined> {
    const world = this.open(name);
    if (!(await world.exists())) return undefined;
    const stories = await this.stories(name).count();
    try {
      const m = await world.world();
      return { name, title: m.title, tagline: m.tagline, stories };
    } catch (e) {
      return { name, title: name, tagline: "", stories, problem: (e as Error).message };
    }
  }

  /**
   * The stories played most recently, across every world, newest first: where the host picks up.
   * A damaged story or a world that cannot be read is left out (the world's own page shows them).
   */
  async recent(limit: number): Promise<RecentStory[]> {
    const out: RecentStory[] = [];
    for (const w of await this.list()) {
      if (w.problem || w.stories === 0) continue;
      for (const s of await this.stories(w.name).list()) {
        if (!s.damaged) out.push({ ...s, world: w.name, worldTitle: w.title });
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
  }

  /** Everything the host sees on a world's page: its details, saved stories and cards. */
  async detail(name: string): Promise<WorldDetail> {
    const found = await this.summary(name);
    if (!found) throw new HostError("nothing_to_do", `There is no world "${name}".`);
    if (found.problem) return { world: found, stories: [], cards: [], broken: [] };
    const files = await this.open(name).cardFiles();
    return {
      world: found,
      manifest: await this.open(name).world(),
      stories: await this.stories(name).list(),
      cards: files.flatMap((f) => (f.card ? [{ ...f.card, file: f.text }] : [])),
      broken: files.flatMap((f) =>
        f.card ? [] : [{ path: f.path, file: f.text, problems: f.problems ?? [] }],
      ),
    };
  }

  /**
   * Add a card to a world or change one, without opening the world. A new card gets a file and an
   * id from its name; an existing card keeps its file, its id and any fields the form does not
   * show. A card that would clash with another's id, or does not read, is refused in plain words
   * and nothing is written.
   */
  async saveCard(name: string, input: CardInput): Promise<{ path: string; id: string }> {
    const world = this.open(name);
    if (!(await world.exists()))
      throw new HostError("nothing_to_do", `There is no world "${name}".`);
    const files = await world.cardFiles();
    const cards = files.flatMap((f) => (f.card ? [f.card] : []));
    const refuse = (why: string) => new HostError("invalid_card", `That card is not valid: ${why}`);

    let card: Card;
    let text: string | undefined;
    if ("text" in input) {
      const path = cardPath(input.path);
      const parsed = parseCard(path, input.text);
      if (!parsed.ok) throw refuse(parsed.errors.join("; "));
      card = parsed.card;
      text = input.text;
    } else {
      const { form } = input;
      const path = input.path === undefined ? undefined : cardPath(input.path);
      const old = path === undefined ? undefined : cards.find((c) => c.path === path);
      if (path !== undefined && !old) {
        const broken = files.some((f) => f.path === path);
        throw new HostError(
          broken ? "invalid_card" : "nothing_to_do",
          broken
            ? "That card cannot be read, so it cannot be edited as a form. Edit it as text."
            : `There is no card at ${path}.`,
        );
      }
      const home = KIND_HOME[form.kind];
      const slug = slugify(form.name);
      const taken = new Set(cards.map((c) => c.fm.id));
      const used = new Set(files.map((f) => f.path));
      let n = 1;
      const nth = () => (n === 1 ? slug : `${slug}-${n}`);
      while (
        !old &&
        (taken.has(`${home.prefix}.${nth()}`) || used.has(`${home.dir}/${nth()}.md`))
      ) {
        n++;
      }
      const { role, scope, severity } = form;
      const fm = CardFrontmatter.safeParse({
        ...(old?.fm ?? {}),
        id: old?.fm.id ?? `${home.prefix}.${nth()}`,
        kind: form.kind,
        name: form.name,
        keywords: form.keywords,
        summary: form.summary,
        always: form.always,
        fields: Object.fromEntries(
          Object.entries(form.fields).filter(([, text]) => text.trim() !== ""),
        ),
        ...(role !== undefined ? { role: role.trim() || undefined } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(severity !== undefined ? { severity } : {}),
      });
      if (!fm.success) throw refuse(formatIssues(fm.error).join("; "));
      card = { path: path ?? `${home.dir}/${nth()}.md`, fm: fm.data, body: form.body };
    }

    const clash = checkCards([...cards.filter((c) => c.path !== card.path), card]);
    if (clash.length) throw refuse(clash.join("; "));
    if (text === undefined) await world.save(card);
    else await world.saveText(card.path, text);
    return { path: card.path, id: card.fm.id };
  }

  /** Delete one card's file (a git-tracked world can bring it back). Works on unreadable cards too. */
  async removeCard(name: string, path: string): Promise<void> {
    const world = this.open(name);
    const file = cardPath(path);
    if (!(await world.cardFiles()).some((f) => f.path === file)) {
      throw new HostError("nothing_to_do", `There is no card at ${file}.`);
    }
    await world.removeFile(file);
  }

  /**
   * Make a new world with a title and, if given, a premise, which becomes a card that is always in
   * the storyteller's view so the world is playable straight away. The folder name follows the
   * title and is made unique.
   */
  async create(input: { title: string; tagline: string; premise: string }): Promise<WorldSummary> {
    const base = slugify(input.title);
    let name = base;
    for (let n = 2; await exists(join(this.root, name)); n++) {
      const suffix = `-${n}`;
      name = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    }
    const manifest = {
      name,
      title: input.title,
      tagline: input.tagline,
      genre: [],
      tone: [],
      perspective: "second-person",
      systems: { dice: "none", stats: [], inventory: true },
      createdWith: "nirmata",
    };
    const premise = input.premise.trim();
    const card = serializeCard({
      path: "lore/premise.md",
      fm: CardFrontmatter.parse({
        id: "lore.premise",
        kind: "lore",
        name: "Premise",
        always: true,
      }),
      body: premise,
    });
    await placeNewFolder(this.root, name, async (temp) => {
      await writeAtomic(join(temp, "world.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      if (premise) await writeAtomic(join(temp, "lore", "premise.md"), card);
      await writeAtomic(join(temp, "stories", ".gitkeep"), "");
    });
    return { name, title: input.title, tagline: input.tagline, stories: 0 };
  }

  /** Change a world's title or tagline. Everything else in world.json is kept as it was. */
  async update(name: string, patch: WorldPatch): Promise<WorldSummary> {
    const file = join(this.open(name).root, "world.json");
    const text = await readIfThere(file);
    if (text === undefined) throw new HostError("nothing_to_do", `There is no world "${name}".`);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new HostError(
        "bad_state",
        `${name}/world.json is not valid JSON; fix it by hand first.`,
      );
    }
    const next = {
      ...raw,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
      ...(patch.genre !== undefined ? { genre: patch.genre } : {}),
      ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
      ...(patch.perspective !== undefined ? { perspective: patch.perspective } : {}),
    };
    const checked = parseWorldManifest(JSON.stringify(next));
    if (!checked.ok) throw new HostError("bad_state", `world.json: ${checked.errors.join("; ")}`);
    await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    const found = await this.summary(name);
    if (!found) throw new HostError("nothing_to_do", `There is no world "${name}".`);
    return found;
  }

  /**
   * Put a world away: its folder is renamed with a leading "_", which the library skips. Nothing
   * is deleted; renaming the folder back brings it back.
   */
  async archive(name: string): Promise<string> {
    const world = this.open(name);
    if (!(await world.exists()))
      throw new HostError("nothing_to_do", `There is no world "${name}".`);
    const archived = `_archived-${name}-${randomBytes(3).toString("hex")}`;
    try {
      await rename(world.root, join(this.root, archived));
    } catch (e) {
      throw new HostError(
        "bad_state",
        `Couldn't put "${name}" away (${(e as Error).message}). Close anything using its folder and try again.`,
      );
    }
    this.storyFiles.delete(name);
    return archived;
  }
}
