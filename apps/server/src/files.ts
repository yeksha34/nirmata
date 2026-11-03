import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, resolve, sep } from "node:path";
import {
  type Card,
  CardFrontmatter,
  checkCards,
  compileVn,
  createStarterAdaptationMd,
  createStarterManifest,
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
  type VnDiagnostic,
  type VnManifest,
  VnManifestSchema,
  type VnMode,
  type VnSlideDeck,
  type VnSummary,
  type VnTier,
  type WorldManifest,
} from "@nirmata/core";
import { type EventSink, HostError, type SourceBackend } from "@nirmata/host";
import {
  addReferenceSlot,
  getDefaultNegativePrompt,
  synthesizeBackgroundDanbooruPrompt,
  synthesizeCgDanbooruPrompt,
  synthesizeSpriteDanbooruPrompt,
  type Workflow,
  type AssetKind,
  assetDir,
  isLinkedKind,
  LINKED_KINDS,
  type LinkedKind,
  composeLinkedPrompt,
  type LinkedDetails,
  parseLinkedCard,
  templateName,
} from "@nirmata/gen";
import {
  AssetPlanError,
  addToPlan,
  type PlannedAsset,
  removeFromPlan,
  type VnSource,
  type WorkflowSource,
} from "@nirmata/adaptation";
import { HttpError } from "./errors";
import { CARD_DIRS, type CardFile, markdownFiles, readCardFiles, slugFor } from "@nirmata/importer";
import {
  parseReferenceSettings,
  type ReferenceSettings,
  type Suggested,
  suggestReferences,
} from "./reference-rules";

export interface VnAssetItem {
  id: string;
  type: AssetKind;
  name: string;
  targetPath: string;
  exists: boolean;
  url?: string;
  defaultPrompt?: string;
  isShared?: boolean;
  vnSlug?: string;
  /** Clothes, adornments and objects: the characters this asset is locked to (from the manifest). */
  lockedTo?: string[];
  /** Objects: the CGs this asset is linked to. */
  linkedCgs?: string[];
}

export interface VnAssetLists {
  sprites: VnAssetItem[];
  cgs: VnAssetItem[];
  backgrounds: VnAssetItem[];
  clothes: VnAssetItem[];
  adornments: VnAssetItem[];
  objects: VnAssetItem[];
}

export interface VnAssetDatasetEntry {
  timestamp: string;
  imageFilename: string;
  imageUrl?: string;
  prompt: string;
  negativePrompt?: string;
  feedback?: Record<string, "better" | "keep" | "worse">;
}

export interface VnAssetPromptSpec {
  name: string;
  type: AssetKind;
  positivePrompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  referenceImage?: string;
  status?: string;
}

/** What the Studio saves about an asset's prompt: the text and the sampler settings, never the seed. */
export interface PromptSpecPatch {
  positivePrompt: string;
  negativePrompt?: string | undefined;
  steps?: number | undefined;
  cfg?: number | undefined;
  sampler?: string | undefined;
  scheduler?: string | undefined;
}

export interface VnAssetDetail {
  id: string;
  type: AssetKind;
  name: string;
  targetPath: string;
  exists: boolean;
  url?: string;
  positivePrompt: string;
  negativePrompt: string;
  templateClass: string;
  datasetHistory: VnAssetDatasetEntry[];
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
  /** Sprites that should influence this image, and every sprite that could (see reference-rules). */
  references?: Suggested;
}

/** The last save to each prompts file, so a later save waits for it. */
const promptWrites = new Map<string, Promise<void>>();

const NO_REFERENCE_SLOT =
  "This workflow has no place for a reference image. Use a workflow with a Reference Image node.";

/** Where a world keeps prose that is not a card: finished chapters, and work in progress. */
const WRITING_DIRS = ["chapters", "drafts"] as const;

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

/** Validates and normalizes an adaptation slug (e.g. "ch01-first-contact"). */
/** One folder name of a stored file's path, as the importer and the recorder write it. */
export const STORED_PART = /^[A-Za-z0-9._-]{1,120}$/;

export function sanitizeSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s || s === "." || s === "..") {
    throw new HostError("invalid_card", `Invalid visual novel slug "${raw}".`);
  }
  return s;
}

/** A file's first heading, or its name made readable: "playground_coldbrook.md" is "Playground coldbrook". */
function titleFrom(text: string, rel: string): string {
  const heading = /^#{1,2}[ \t]+(.+?)[ \t]*$/m.exec(text.slice(0, 2000));
  if (heading?.[1]) return heading[1];
  const name = basename(rel, ".md").replace(/[_-]+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The title of a file, reading only its beginning. */
async function titleOf(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return titleFrom(buffer.subarray(0, bytesRead).toString("utf8"), file.replaceAll("\\", "/"));
  } finally {
    await handle.close();
  }
}

/** One card file: its text, and either the card it holds or what is wrong with it. */
export type { CardFile };

/** Dataset images of an imported world, from the database and its stores (see `DbImages`). */
export interface DatasetImages {
  read(
    worldName: string,
    scope: string,
    assetName: string,
    run: string,
  ): Promise<{ data: Buffer; contentType: string } | "gone" | undefined>;
  /**
   * Take a run's file out of its store and mark the render `none`. Answers whether the run was in
   * the database. Refuses (409) the current render of an asset: an asset keeps its file.
   */
  remove(
    worldName: string,
    scope: string,
    assetName: string,
    run: string,
  ): Promise<"removed" | "absent">;
}

/** Where a world's cards are read from. */
export type CardSource = "database" | "files";

/**
 * A world's cards when they live in the database instead of the folder. Each call answers
 * `undefined`/`false` for a world that is not in the database, and the world's files are used.
 */
export interface LoreCards {
  cardFiles(slug: string): Promise<CardFile[] | undefined>;
  save(slug: string, card: Card): Promise<boolean>;
  removeFile(slug: string, path: string): Promise<boolean>;
}

/** The parts of a saved visual novel, as the database store takes them. */
function toParts(data: { manifest?: VnManifest; adaptationMd?: string; slides?: VnSlideDeck }) {
  return {
    manifest: data.manifest,
    adaptationMd: data.adaptationMd,
    slides: data.slides,
  };
}

/** One world on disk: `world.json` and its card folders. The source cards (ADR-0009). */
export class WorldFiles implements SourceBackend {
  readonly root: string;

  constructor(
    root: string,
    private readonly lore?: LoreCards,
    private readonly workflows?: WorkflowSource,
    private readonly vnContent?: VnSource,
  ) {
    this.root = resolve(root);
  }

  /** The world's name in the database, when cards may live there. */
  private async loreSlug(anyStore = false): Promise<string | undefined> {
    if (!this.lore && !anyStore) return undefined;
    try {
      return slugFor((await this.world()).name);
    } catch {
      return undefined;
    }
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
    return (await this.cardFilesFrom()).files;
  }

  /** The cards, and where they came from: the database for an imported world, else the folder. */
  async cardFilesFrom(): Promise<{ files: CardFile[]; source: CardSource }> {
    const slug = await this.loreSlug();
    const inDb = slug ? await this.lore?.cardFiles(slug) : undefined;
    if (inDb) return { files: inDb, source: "database" };
    return { files: await this.cardFilesOnDisk(), source: "files" };
  }

  private cardFilesOnDisk(): Promise<CardFile[]> {
    return readCardFiles(this.root);
  }

  /**
   * The chapters and drafts in the world: markdown under `chapters/` and `drafts/` that is not a
   * card (`skip` holds the cards' paths; the scene cards live in `chapters/scenes/`).
   */
  async writings(
    skip: ReadonlySet<string>,
  ): Promise<{ chapters: WritingSummary[]; drafts: WritingSummary[] }> {
    const found: Record<(typeof WRITING_DIRS)[number], WritingSummary[]> = {
      chapters: [],
      drafts: [],
    };
    for (const dir of WRITING_DIRS) {
      for (const file of await markdownFiles(join(this.root, dir))) {
        const rel = file.slice(this.root.length + 1).replaceAll("\\", "/");
        if (skip.has(rel) || basename(rel) === "index.md") continue;
        // the scenes beside the chapters are one-line beats, not chapters
        if (rel.startsWith("chapters/scenes/")) continue;
        const info = await stat(file);
        found[dir].push({
          path: rel,
          title: await titleOf(file),
          size: info.size,
          updatedAt: info.mtime.toISOString(),
        });
      }
    }
    // "chapter_1" comes before "chapter_1_part_2", and "chapter_2" before "chapter_10"
    const stem = (w: WritingSummary) => w.path.replace(/\.md$/, "");
    const byName = (a: WritingSummary, b: WritingSummary) =>
      stem(a).localeCompare(stem(b), undefined, { numeric: true });
    return {
      chapters: found.chapters.sort(byName),
      drafts: found.drafts.sort((a, b) =>
        a.updatedAt === b.updatedAt ? byName(a, b) : a.updatedAt < b.updatedAt ? 1 : -1,
      ),
    };
  }

  /** The text of one chapter or draft. Only those folders, and only markdown, can be asked for. */
  async writing(path: string): Promise<{ path: string; title: string; text: string }> {
    const rel = posix.normalize(path.replaceAll("\\", "/"));
    const dir = rel.split("/")[0] ?? "";
    if (!(WRITING_DIRS as readonly string[]).includes(dir) || !rel.endsWith(".md")) {
      throw new HostError("nothing_to_do", `There is no chapter or draft at ${rel}.`);
    }
    const full = inside(this.root, rel);
    const text = await readIfThere(full);
    if (text === undefined)
      throw new HostError("nothing_to_do", `There is no chapter or draft at ${rel}.`);
    return { path: rel, title: titleFrom(text, rel), text };
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
    const slug = await this.loreSlug();
    if (slug && (await this.lore?.save(slug, card))) return;
    await writeAtomic(this.cardFile(card.path), serializeCard(card));
  }

  /** Write a card file exactly as given (the manager's "edit as text"). */
  async saveText(path: string, text: string): Promise<void> {
    const slug = await this.loreSlug();
    if (slug) {
      const parsed = parseCard(path, text);
      if (parsed.ok && (await this.lore?.save(slug, parsed.card))) return;
    }
    await writeAtomic(this.cardFile(path), text);
  }

  /** Delete one card file by its path. */
  async removeFile(path: string): Promise<void> {
    const slug = await this.loreSlug();
    if (slug && (await this.lore?.removeFile(slug, cardPath(path)))) return;
    await rm(this.cardFile(path), { force: true });
  }

  async remove(cardId: string): Promise<void> {
    const found = (await this.cards()).find((c) => c.fm.id === cardId);
    if (found) await this.removeFile(found.path);
  }

  get vnsDir(): string {
    return join(this.root, "vns");
  }

  /** The world's name in the database when its visual novels may live there. */
  private async vnWorld(): Promise<string | undefined> {
    return this.vnContent ? this.loreSlug(true) : undefined;
  }

  private summaryOf(manifest: VnManifest, slideCount: number | undefined): VnSummary {
    return {
      slug: manifest.slug,
      title: manifest.title,
      source: manifest.source,
      mode: manifest.mode,
      mc: manifest.mc,
      tier: manifest.tier,
      slideCount,
      routes: manifest.routes,
      updatedAt: manifest.updatedAt,
      order: manifest.order,
      nextSlug: manifest.nextSlug,
    };
  }

  /** Sorted by `order`, then by name; each one points at the next unless it says otherwise. */
  private ordered(summaries: VnSummary[]): VnSummary[] {
    summaries.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return a.slug.localeCompare(b.slug, undefined, { numeric: true, sensitivity: "base" });
    });
    for (let i = 0; i < summaries.length; i++) {
      const cur = summaries[i];
      const nxt = summaries[i + 1];
      if (cur && !cur.nextSlug && nxt) {
        cur.nextSlug = nxt.slug;
      }
    }
    return summaries;
  }

  async vns(): Promise<VnSummary[]> {
    const world = await this.vnWorld();
    const stored = world ? await this.vnContent?.list(world) : undefined;
    if (stored) {
      const summaries: VnSummary[] = [];
      for (const rec of stored) {
        const parsed = VnManifestSchema.safeParse(rec.manifest);
        if (parsed.success) summaries.push(this.summaryOf(parsed.data, rec.slideCount));
      }
      return this.ordered(summaries);
    }
    let slugs: string[];
    try {
      slugs = await readdir(this.vnsDir);
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
    const summaries: VnSummary[] = [];
    for (const slug of slugs.sort()) {
      if (slug.startsWith("_")) continue;
      const manifestPath = join(this.vnsDir, slug, "manifest.json");
      const text = await readIfThere(manifestPath);
      if (!text) continue;
      try {
        const raw = JSON.parse(text);
        const parsed = VnManifestSchema.safeParse(raw);
        if (parsed.success) {
          let slideCount: number | undefined;
          const slidesText = await readIfThere(join(this.vnsDir, slug, "slides.json"));
          if (slidesText) {
            try {
              const slidesJson = JSON.parse(slidesText);
              if (Array.isArray(slidesJson.slides)) {
                slideCount = slidesJson.slides.length;
              }
            } catch {}
          }
          summaries.push(this.summaryOf(parsed.data, slideCount));
        }
      } catch {}
    }
    return this.ordered(summaries);
  }

  /** One visual novel from the database (undefined for a world that is not there) or the folder. */
  private async readVn(
    safeSlug: string,
    slug: string,
  ): Promise<{ manifest: VnManifest; adaptationMd: string; slides?: VnSlideDeck | undefined }> {
    const world = await this.vnWorld();
    if (world && this.vnContent) {
      const rec = await this.vnContent.get(world, safeSlug);
      if (rec) {
        return {
          manifest: VnManifestSchema.parse(rec.manifest),
          adaptationMd: rec.adaptationMd,
          slides: rec.slides as VnSlideDeck | undefined,
        };
      }
      if ((await this.vnContent.list(world)) !== undefined) {
        throw new HostError("nothing_to_do", `There is no visual novel adaptation "${slug}".`);
      }
    }
    const dir = inside(this.root, `vns/${safeSlug}`);
    const manifestText = await readIfThere(join(dir, "manifest.json"));
    if (!manifestText) {
      throw new HostError("nothing_to_do", `There is no visual novel adaptation "${slug}".`);
    }
    const manifest = VnManifestSchema.parse(JSON.parse(manifestText));
    const adaptationMd = (await readIfThere(join(dir, "adaptation.md"))) || "";
    let slides: VnSlideDeck | undefined;
    const slidesText = await readIfThere(join(dir, "slides.json"));
    if (slidesText) {
      try {
        slides = JSON.parse(slidesText);
      } catch {}
    }
    return { manifest, adaptationMd, slides };
  }

  /** One visual novel's manifest as written, without working out its order or what comes next. */
  private async vnManifest(safeSlug: string): Promise<VnManifest> {
    return (await this.readVn(safeSlug, safeSlug)).manifest;
  }

  async vn(
    slug: string,
  ): Promise<{ manifest: VnManifest; adaptationMd: string; slides?: VnSlideDeck }> {
    const safeSlug = sanitizeSlug(slug);
    const { manifest, adaptationMd, slides } = await this.readVn(safeSlug, slug);
    if (!manifest.nextSlug || manifest.order === undefined) {
      const all = await this.vns();
      const current = all.find((v) => v.slug === safeSlug);
      if (current) {
        if (!manifest.nextSlug && current.nextSlug) {
          manifest.nextSlug = current.nextSlug;
        }
        if (manifest.order === undefined && current.order !== undefined) {
          manifest.order = current.order;
        }
      }
    }
    return { manifest, adaptationMd, ...(slides ? { slides } : {}) };
  }

  async saveVn(
    slug: string,
    data: { manifest?: VnManifest; adaptationMd?: string; slides?: VnSlideDeck },
  ): Promise<void> {
    const safeSlug = sanitizeSlug(slug);
    const world = await this.vnWorld();
    if (world && (await this.vnContent?.save(world, safeSlug, toParts(data)))) return;
    const dir = inside(this.root, `vns/${safeSlug}`);
    await mkdir(dir, { recursive: true });
    if (data.manifest) {
      await writeAtomic(join(dir, "manifest.json"), JSON.stringify(data.manifest, null, 2));
    }
    if (data.adaptationMd !== undefined) {
      await writeAtomic(join(dir, "adaptation.md"), data.adaptationMd);
    }
    if (data.slides) {
      await writeAtomic(join(dir, "slides.json"), JSON.stringify(data.slides, null, 2));
    }
  }

  async scaffoldVn(options: {
    slug: string;
    title: string;
    source: string;
    mode?: VnMode;
    mc?: string;
    tier?: VnTier;
    order?: number;
    nextSlug?: string;
  }): Promise<VnSummary> {
    const safeSlug = sanitizeSlug(options.slug);
    const dir = inside(this.root, `vns/${safeSlug}`);
    const world = await this.vnWorld();
    const stored = world ? await this.vnContent?.list(world) : undefined;
    const exists = stored
      ? stored.some((v) => v.slug === safeSlug)
      : Boolean(await readIfThere(join(dir, "manifest.json")));
    if (exists) {
      throw new HostError("bad_state", `Visual novel adaptation "${safeSlug}" already exists.`);
    }
    const manifest = createStarterManifest({ ...options, slug: safeSlug });
    const adaptationMd = createStarterAdaptationMd({ ...options, slug: safeSlug });
    const { deck } = compileVn(adaptationMd, { manifest });

    if (world && stored) {
      await this.vnContent?.save(world, safeSlug, { manifest, adaptationMd, slides: deck });
      return this.summaryOf(manifest, deck.slides.length);
    }
    await mkdir(join(this.vnsDir, "_shared", "assets"), { recursive: true });
    await writeAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeAtomic(join(dir, "adaptation.md"), adaptationMd);
    await writeAtomic(join(dir, "slides.json"), JSON.stringify(deck, null, 2));

    return {
      slug: manifest.slug,
      title: manifest.title,
      source: manifest.source,
      mode: manifest.mode,
      mc: manifest.mc,
      tier: manifest.tier,
      slideCount: deck.slides.length,
      routes: manifest.routes,
      updatedAt: manifest.updatedAt,
      order: manifest.order,
      nextSlug: manifest.nextSlug,
    };
  }

  async compileVn(slug: string): Promise<{ slides: VnSlideDeck; diagnostics: VnDiagnostic[] }> {
    const safeSlug = sanitizeSlug(slug);
    const dir = inside(this.root, `vns/${safeSlug}`);
    const { manifest, adaptationMd } = await this.readVn(safeSlug, slug);
    const result = compileVn(adaptationMd, { manifest });

    manifest.updatedAt = new Date().toISOString();
    const world = await this.vnWorld();
    if (world && (await this.vnContent?.save(world, safeSlug, { manifest, slides: result.deck }))) {
      return { slides: result.deck, diagnostics: result.diagnostics };
    }
    await writeAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeAtomic(join(dir, "slides.json"), JSON.stringify(result.deck, null, 2));

    return { slides: result.deck, diagnostics: result.diagnostics };
  }

  async readVnAsset(
    slug: string,
    subPath: string,
  ): Promise<{ data: Buffer; contentType: string } | undefined> {
    const safeSlug = sanitizeSlug(slug);
    const cleanSub = subPath.replace(/^[/\\]+/, "").replace(/\0/g, "");
    if (!cleanSub) return undefined;

    // Search priority:
    // 1. Shared VN asset pool: vns/_shared/assets/<subPath>
    // 2. Legacy scene-specific asset fallback: vns/<slug>/assets/<subPath>
    const candidates = [
      inside(this.root, `vns/_shared/assets/${cleanSub}`),
      inside(this.root, `vns/${safeSlug}/assets/${cleanSub}`),
    ];

    // 3. Hierarchical sprite state & expression fallback:
    // Supports <character>_<state>_<expression>.<ext>, <character>_<state>.<ext>, and <character>_<expression>.<ext>
    const spriteMatch = cleanSub.match(/^sprites\/([^/]+)\.(png|jpg|jpeg|webp)$/i);
    if (spriteMatch?.[1] && spriteMatch[2]) {
      const stem = spriteMatch[1];
      const ext = spriteMatch[2];
      const parts = stem.split("_");

      if (parts.length >= 3) {
        const charName = parts[0];
        const state = parts[1];
        const expr = parts.slice(2).join("_");
        candidates.push(
          inside(this.root, `vns/_shared/assets/sprites/${charName}_${state}.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}_${state}.${ext}`),
          inside(this.root, `vns/_shared/assets/sprites/${charName}_${state}_neutral.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}_${state}_neutral.${ext}`),
          inside(this.root, `vns/_shared/assets/sprites/${charName}_${expr}.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}_${expr}.${ext}`),
          inside(this.root, `vns/_shared/assets/sprites/${charName}.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}.${ext}`),
          inside(this.root, `vns/_shared/assets/sprites/${charName}_neutral.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}_neutral.${ext}`),
        );
      } else if (parts.length === 2) {
        const charName = parts[0];
        const modifier = parts[1];
        candidates.push(
          inside(this.root, `vns/_shared/assets/sprites/${charName}_${modifier}_neutral.${ext}`),
          inside(
            this.root,
            `vns/${safeSlug}/assets/sprites/${charName}_${modifier}_neutral.${ext}`,
          ),
          inside(this.root, `vns/_shared/assets/sprites/${charName}.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}.${ext}`),
          inside(this.root, `vns/_shared/assets/sprites/${charName}_neutral.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}_neutral.${ext}`),
        );
      } else if (parts.length === 1) {
        const charName = parts[0];
        candidates.push(
          inside(this.root, `vns/_shared/assets/sprites/${charName}_neutral.${ext}`),
          inside(this.root, `vns/${safeSlug}/assets/sprites/${charName}_neutral.${ext}`),
        );
      }
    }

    // Deduplicate candidate paths while preserving order
    const uniqueCandidates = Array.from(new Set(candidates));

    for (const full of uniqueCandidates) {
      try {
        const data = await readFile(full);
        const ext = full.split(".").pop()?.toLowerCase();
        const contentType =
          ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "webp"
                ? "image/webp"
                : ext === "svg"
                  ? "image/svg+xml"
                  : ext === "mp3"
                    ? "audio/mpeg"
                    : ext === "ogg"
                      ? "audio/ogg"
                      : ext === "wav"
                        ? "audio/wav"
                        : "application/octet-stream";
        return { data, contentType };
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    }
    return undefined;
  }

  async loadPromptSpecs(): Promise<Record<string, VnAssetPromptSpec>> {
    const candidates = [
      inside(this.root, "vns/_shared/assets/prompts.json"),
      inside(this.root, "assets/workflow/prompts.json"),
    ];
    for (const cand of candidates) {
      try {
        const text = await readIfThere(cand);
        if (text) {
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            const map: Record<string, VnAssetPromptSpec> = {};
            for (const item of data) {
              if (item.name) map[item.name] = item;
            }
            return map;
          }
          if (typeof data === "object" && data !== null) {
            return data as Record<string, VnAssetPromptSpec>;
          }
        }
      } catch {}
    }
    return {};
  }

  /**
   * The assets of a visual novel. `prompts: false` skips the default prompts (which read every
   * card and the prompt specs), for callers that only count or list them.
   */
  /**
   * Remembers an asset's prompt and sampler settings in the file `loadPromptSpecs` reads (the shared
   * visual novel one if it exists, else the world's `assets/workflow/prompts.json`), keeping the file's
   * shape (a map or a list) and every other field of the entry, the seed included. Saves to one file
   * wait for each other.
   */
  async savePromptSpec(name: string, type: AssetKind, patch: PromptSpecPatch): Promise<void> {
    const shared = inside(this.root, "vns/_shared/assets/prompts.json");
    const own = inside(this.root, "assets/workflow/prompts.json");
    const file = (await readIfThere(shared)) ? shared : own;
    const previous = promptWrites.get(file) ?? Promise.resolve();
    const done = previous.then(async () => {
      let data: unknown = {};
      const text = await readIfThere(file);
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new HostError(
            "bad_state",
            "The prompts file cannot be read, so nothing was saved.",
          );
        }
      }
      const fields: Record<string, unknown> = { name, type, positivePrompt: patch.positivePrompt };
      for (const key of ["negativePrompt", "steps", "cfg", "sampler", "scheduler"] as const) {
        if (patch[key] !== undefined) fields[key] = patch[key];
      }
      if (Array.isArray(data)) {
        const at = data.findIndex((e) => e && typeof e === "object" && e.name === name);
        if (at >= 0) data[at] = { ...data[at], ...fields };
        else data.push(fields);
      } else {
        const map = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
        map[name] = { ...((map[name] as object | undefined) ?? {}), ...fields };
        data = map;
      }
      await mkdir(dirname(file), { recursive: true });
      await writeAtomic(
        file,
        `${JSON.stringify(data, null, 2)}
`,
      );
    });
    promptWrites.set(
      file,
      done.catch(() => undefined),
    );
    await done;
  }

  /** What the world's card for a clothes, adornment or object asset says (empty when it has none). */
  async linkedDetails(kind: LinkedKind, name: string): Promise<LinkedDetails> {
    const text = await readIfThere(inside(this.root, `${assetDir(kind)}/${sanitizeSlug(name)}.md`));
    return text ? parseLinkedCard(text) : {};
  }

  /** The author's own image of such an asset (the card's `reference` part), if the card names one that exists. */
  async linkedReference(kind: LinkedKind, name: string): Promise<Buffer | undefined> {
    const rel = (await this.linkedDetails(kind, name)).reference;
    if (!rel) return undefined;
    try {
      return await readFile(inside(this.root, rel.replaceAll("\\", "/")));
    } catch {
      return undefined;
    }
  }

  async listVnAssets(slug: string, options: { prompts?: boolean } = {}): Promise<VnAssetLists> {
    const withPrompts = options.prompts !== false;
    const safeSlug = sanitizeSlug(slug);

    if (safeSlug === "_all" || safeSlug === "all") {
      const shared = await this.listVnAssets("_shared", options);
      const allSprites: VnAssetItem[] = [
        ...shared.sprites.map((s) => ({ ...s, isShared: true, vnSlug: "_shared" })),
      ];
      const allCgs: VnAssetItem[] = [
        ...shared.cgs.map((c) => ({ ...c, isShared: true, vnSlug: "_shared" })),
      ];
      const allBgs: VnAssetItem[] = [
        ...shared.backgrounds.map((b) => ({ ...b, isShared: true, vnSlug: "_shared" })),
      ];

      const vns = await this.vns();
      for (const v of vns) {
        if (v.slug === "_shared") continue;
        const vAssets = await this.listVnAssets(v.slug, options);
        for (const s of vAssets.sprites) {
          if (!allSprites.some((existing) => existing.name === s.name)) {
            allSprites.push({ ...s, vnSlug: v.slug });
          }
        }
        for (const c of vAssets.cgs) {
          if (!allCgs.some((existing) => existing.name === c.name)) {
            allCgs.push({ ...c, vnSlug: v.slug });
          }
        }
        for (const b of vAssets.backgrounds) {
          if (!allBgs.some((existing) => existing.name === b.name)) {
            allBgs.push({ ...b, vnSlug: v.slug });
          }
        }
      }
      const linked = {
        clothes: [...shared.clothes],
        adornments: [...shared.adornments],
        objects: [...shared.objects],
      };
      for (const v of vns) {
        if (v.slug === "_shared") continue;
        const vAssets = await this.listVnAssets(v.slug, options);
        for (const key of ["clothes", "adornments", "objects"] as const) {
          for (const item of vAssets[key]) {
            if (!linked[key].some((existing) => existing.name === item.name)) {
              linked[key].push({ ...item, vnSlug: v.slug });
            }
          }
        }
      }
      return { sprites: allSprites, cgs: allCgs, backgrounds: allBgs, ...linked };
    }

    const sprites: VnAssetItem[] = [];
    const cgs: VnAssetItem[] = [];
    const backgrounds: VnAssetItem[] = [];
    const promptSpecs = withPrompts ? await this.loadPromptSpecs() : {};
    const cardFiles = withPrompts ? await this.cardFiles().catch(() => []) : [];
    const sprite = (n: string) =>
      withPrompts ? synthesizeSpriteDanbooruPrompt(n, cardFiles) : undefined;
    const cg = (n: string) => (withPrompts ? synthesizeCgDanbooruPrompt(n, cardFiles) : undefined);
    const bg = (n: string) =>
      withPrompts ? synthesizeBackgroundDanbooruPrompt(n, cardFiles) : undefined;

    const checkAsset = async (subPath: string): Promise<{ exists: boolean; fullPath?: string }> => {
      const candidates = [
        inside(this.root, `vns/_shared/assets/${subPath}`),
        inside(this.root, `vns/${safeSlug}/assets/${subPath}`),
      ];
      for (const cand of candidates) {
        try {
          await stat(cand);
          return { exists: true, fullPath: cand };
        } catch {}
      }
      return { exists: false };
    };

    const scanDir = async (dirName: "sprites" | "cgs" | "backgrounds", type: AssetKind) => {
      const dirs: Array<{ path: string; isShared: boolean }> = [
        { path: inside(this.root, `vns/_shared/assets/${dirName}`), isShared: true },
      ];
      if (safeSlug !== "_shared") {
        dirs.push({
          path: inside(this.root, `vns/${safeSlug}/assets/${dirName}`),
          isShared: false,
        });
      }
      const seen = new Set<string>();
      for (const { path: d, isShared } of dirs) {
        try {
          const files = await readdir(d);
          for (const f of files) {
            if (f.match(/\.(png|jpg|jpeg|webp)$/i)) {
              const stem = f.replace(/\.[^.]+$/, "");
              if (!seen.has(stem)) {
                seen.add(stem);
                const targetPath = `${dirName}/${f}`;
                const item: VnAssetItem = {
                  id: `${type}:${stem}`,
                  type,
                  name: stem,
                  targetPath,
                  exists: true,
                  url: `/api/worlds/${encodeURIComponent(basename(this.root))}/vns/${encodeURIComponent(slug)}/assets/${targetPath}`,
                  isShared,
                  vnSlug: isShared ? "_shared" : safeSlug,
                };
                if (type === "sprite") sprites.push(item);
                else if (type === "cg") cgs.push(item);
                else backgrounds.push(item);
              }
            }
          }
        } catch {}
      }
    };

    await scanDir("sprites", "sprite");
    await scanDir("cgs", "cg");
    await scanDir("backgrounds", "bg");

    // clothes, adornments and objects: reference art kept beside the stage art, named <owner>_<name>
    const linked: Record<LinkedKind, VnAssetItem[]> = { clothes: [], adornment: [], object: [] };
    for (const kind of LINKED_KINDS) {
      const dirName = assetDir(kind);
      const seen = new Set<string>();
      for (const { path: d, isShared } of [
        { path: inside(this.root, `vns/_shared/assets/${dirName}`), isShared: true },
        ...(safeSlug === "_shared"
          ? []
          : [{ path: inside(this.root, `vns/${safeSlug}/assets/${dirName}`), isShared: false }]),
      ]) {
        try {
          for (const f of await readdir(d)) {
            if (!/\.(png|jpg|jpeg|webp)$/i.test(f)) continue;
            const stem = f.replace(/\.[^.]+$/, "");
            if (seen.has(stem)) continue;
            seen.add(stem);
            const targetPath = `${dirName}/${f}`;
            linked[kind].push({
              id: `${kind}:${stem}`,
              type: kind,
              name: stem,
              targetPath,
              exists: true,
              url: `/api/worlds/${encodeURIComponent(basename(this.root))}/vns/${encodeURIComponent(slug)}/assets/${targetPath}`,
              isShared,
              vnSlug: isShared ? "_shared" : safeSlug,
            });
          }
        } catch {}
      }
    }
    try {
      const m = (await this.vnManifest(safeSlug)).assets;
      const planned: Array<{ kind: LinkedKind; name: string; owner?: string }> = [];
      const links = new Map<string, { owners: string[]; cgs: string[] }>();
      for (const [owner, names] of Object.entries(m?.clothes ?? {})) {
        for (const n of names) {
          planned.push({ kind: "clothes", name: `${owner}_${n}`, owner });
          links.set(`clothes:${owner}_${n}`, { owners: [owner], cgs: [] });
        }
      }
      for (const [owner, names] of Object.entries(m?.adornments ?? {})) {
        for (const n of names) {
          planned.push({ kind: "adornment", name: `${owner}_${n}`, owner });
          links.set(`adornment:${owner}_${n}`, { owners: [owner], cgs: [] });
        }
      }
      for (const o of m?.objects ?? []) {
        planned.push({ kind: "object", name: o.name, owner: o.owners?.[0] });
        links.set(`object:${o.name}`, { owners: o.owners ?? [], cgs: o.cgs ?? [] });
      }
      for (const { kind, name, owner } of planned) {
        if (linked[kind].some((a) => a.name === name)) continue;
        const targetPath = `${assetDir(kind)}/${name}.png`;
        const check = await checkAsset(targetPath);
        linked[kind].push({
          id: `${kind}:${name}`,
          type: kind,
          name,
          targetPath,
          exists: check.exists,
          url: check.exists
            ? `/api/worlds/${encodeURIComponent(basename(this.root))}/vns/${encodeURIComponent(slug)}/assets/${targetPath}`
            : undefined,
        });
      }
      for (const kind of LINKED_KINDS) {
        for (const item of linked[kind]) {
          const link = links.get(`${kind}:${item.name}`);
          if (link) {
            item.lockedTo = link.owners;
            if (link.cgs.length > 0) item.linkedCgs = link.cgs;
          }
        }
      }
    } catch {}
    if (withPrompts) {
      for (const kind of LINKED_KINDS) {
        for (const item of linked[kind]) {
          const details = await this.linkedDetails(kind, item.name);
          item.defaultPrompt ??= composeLinkedPrompt(kind, item.name, details);
        }
      }
    }

    try {
      const manifestAssets = (await this.vnManifest(safeSlug)).assets;
      if (manifestAssets?.characters) {
        for (const [charName, expressions] of Object.entries(manifestAssets.characters)) {
          const exprList =
            Array.isArray(expressions) && expressions.length > 0 ? expressions : ["neutral"];
          for (const expr of exprList) {
            const spriteName = `${charName}_${expr}`;
            if (!sprites.some((s) => s.name === spriteName || s.name === charName)) {
              const targetPath = `sprites/${spriteName}.png`;
              const check = await checkAsset(targetPath);
              sprites.push({
                id: `sprite:${spriteName}`,
                type: "sprite",
                name: spriteName,
                targetPath,
                exists: check.exists,
                url: check.exists
                  ? `/api/worlds/${encodeURIComponent(basename(this.root))}/vns/${encodeURIComponent(slug)}/assets/${targetPath}`
                  : undefined,
                defaultPrompt: sprite(spriteName),
              });
            }
          }
        }
      }
      if (Array.isArray(manifestAssets?.cgs)) {
        for (const cgName of manifestAssets.cgs) {
          if (!cgs.some((c) => c.name === cgName)) {
            const targetPath = `cgs/${cgName}.png`;
            const check = await checkAsset(targetPath);
            cgs.push({
              id: `cg:${cgName}`,
              type: "cg",
              name: cgName,
              targetPath,
              exists: check.exists,
              url: check.exists
                ? `/api/worlds/${encodeURIComponent(basename(this.root))}/vns/${encodeURIComponent(slug)}/assets/${targetPath}`
                : undefined,
              defaultPrompt: cg(cgName),
            });
          }
        }
      }
      if (Array.isArray(manifestAssets?.backgrounds)) {
        for (const bgName of manifestAssets.backgrounds) {
          if (!backgrounds.some((b) => b.name === bgName)) {
            const targetPath = `backgrounds/${bgName}.png`;
            const check = await checkAsset(targetPath);
            backgrounds.push({
              id: `bg:${bgName}`,
              type: "bg",
              name: bgName,
              targetPath,
              exists: check.exists,
              url: check.exists
                ? `/api/worlds/${encodeURIComponent(basename(this.root))}/vns/${encodeURIComponent(slug)}/assets/${targetPath}`
                : undefined,
              defaultPrompt: bg(bgName),
            });
          }
        }
      }
    } catch {}

    // Populate any disk-scanned items that did not have default prompts
    for (const s of sprites) {
      if (!s.defaultPrompt) {
        s.defaultPrompt = sprite(s.name);
      }
    }
    for (const c of cgs) {
      if (!c.defaultPrompt) {
        c.defaultPrompt = cg(c.name);
      }
    }
    for (const b of backgrounds) {
      if (!b.defaultPrompt) {
        b.defaultPrompt = bg(b.name);
      }
    }

    if (sprites.length === 0) {
      sprites.push({
        id: "sprite:main_character_neutral",
        type: "sprite",
        name: "main_character_neutral",
        targetPath: "sprites/main_character_neutral.png",
        exists: false,
        defaultPrompt: sprite("main_character_neutral"),
      });
    }
    if (cgs.length === 0) {
      cgs.push({
        id: "cg:scene_01_climax",
        type: "cg",
        name: "scene_01_climax",
        targetPath: "cgs/scene_01_climax.png",
        exists: false,
        defaultPrompt: cg("scene_01_climax"),
      });
    }
    if (backgrounds.length === 0) {
      backgrounds.push({
        id: "bg:main_setting_day",
        type: "bg",
        name: "main_setting_day",
        targetPath: "backgrounds/main_setting_day.png",
        exists: false,
        defaultPrompt: bg("main_setting_day"),
      });
    }

    for (const item of [
      ...sprites,
      ...cgs,
      ...backgrounds,
      ...linked.clothes,
      ...linked.adornment,
      ...linked.object,
    ]) {
      if (promptSpecs[item.name]?.positivePrompt) {
        item.defaultPrompt = promptSpecs[item.name]!.positivePrompt;
      }
    }

    return {
      sprites,
      cgs,
      backgrounds,
      clothes: linked.clothes,
      adornments: linked.adornment,
      objects: linked.object,
    };
  }

  async getVnAssetDetail(slug: string, type: AssetKind, name: string): Promise<VnAssetDetail> {
    // the list without prompts: only this asset needs one, and building every asset's reads the cards each time
    const list = await this.listVnAssets(slug, { prompts: false });
    const pool = {
      sprite: list.sprites,
      cg: list.cgs,
      bg: list.backgrounds,
      clothes: list.clothes,
      adornment: list.adornments,
      object: list.objects,
    }[type];
    const cards = await this.cardFiles().catch(() => []);
    const details = isLinkedKind(type) ? await this.linkedDetails(type, name) : {};
    const synth = (n: string) =>
      isLinkedKind(type)
        ? composeLinkedPrompt(type, n, details)
        : type === "sprite"
          ? synthesizeSpriteDanbooruPrompt(n, cards)
          : type === "cg"
            ? synthesizeCgDanbooruPrompt(n, cards)
            : synthesizeBackgroundDanbooruPrompt(n, cards);
    const found = pool.find((a) => a.name === name);
    const item = found
      ? { ...found, defaultPrompt: found.defaultPrompt ?? synth(name) }
      : {
          id: `${type}:${name}`,
          type,
          name,
          targetPath: `${assetDir(type)}/${name}.png`,
          exists: false,
          defaultPrompt: synth(name),
        };

    let positivePrompt = item.defaultPrompt || "";
    let negativePrompt = getDefaultNegativePrompt(type);
    try {
      const tpl = (await this.loadWorkflowTemplate(type)) as Record<string, any>;
      for (const node of Object.values(tpl)) {
        if (node.class_type === "CLIPTextEncode") {
          const title = (node._meta?.title || "").toLowerCase();
          if (title.includes("negative") || title.includes("anti")) {
            if (!negativePrompt) negativePrompt = node.inputs?.text || "";
          } else if (title.includes("positive") || title.includes("prompt")) {
            if (!positivePrompt) positivePrompt = node.inputs?.text || "";
          }
        }
      }
    } catch {}

    const promptSpecs = await this.loadPromptSpecs();
    const spec = promptSpecs[name];
    if (spec) {
      if (spec.positivePrompt) positivePrompt = spec.positivePrompt;
      if (spec.negativePrompt) negativePrompt = spec.negativePrompt;
    }

    const datasetSlugs = [sanitizeSlug(slug)];
    if (slug !== "_shared") datasetSlugs.push("_shared");
    if (slug === "_all" || slug === "all") {
      try {
        const vns = await this.vns();
        for (const v of vns) datasetSlugs.push(sanitizeSlug(v.slug));
      } catch {}
    }

    const uniqueDatasetSlugs = Array.from(new Set(datasetSlugs));
    const datasetHistory: VnAssetDatasetEntry[] = [];
    const seenTs = new Set<string>();

    for (const dSlug of uniqueDatasetSlugs) {
      const datasetDir = inside(this.root, `assets/dataset/${dSlug}/${sanitizeSlug(name)}`);
      let timestamps: string[] = [];
      try {
        timestamps = await readdir(datasetDir);
      } catch {}
      const fresh = timestamps.filter((ts) => !seenTs.has(ts));
      for (const ts of fresh) seenTs.add(ts);
      // each run is two small files; read them side by side (the folder may be on a slow disk)
      const runs = await Promise.all(
        fresh.map(async (ts): Promise<VnAssetDatasetEntry | undefined> => {
          try {
            const [promptText, feedbackText] = await Promise.all([
              readIfThere(inside(datasetDir, `${ts}/prompt.json`)),
              readIfThere(inside(datasetDir, `${ts}/feedback.json`)),
            ]);
            const promptData = JSON.parse(promptText || "{}");
            const feedbackData = JSON.parse(feedbackText || "{}");
            return {
              timestamp: ts,
              imageFilename: `assets/dataset/${dSlug}/${sanitizeSlug(name)}/${ts}/generated_image.png`,
              imageUrl: `/api/worlds/${encodeURIComponent(basename(this.root))}/dataset/${encodeURIComponent(dSlug)}/${encodeURIComponent(name)}/${encodeURIComponent(ts)}/image`,
              prompt: promptData.positive || "",
              negativePrompt: promptData.negative || "",
              feedback: feedbackData,
            };
          } catch {
            return undefined;
          }
        }),
      );
      for (const run of runs) if (run) datasetHistory.push(run);
    }
    datasetHistory.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const references = suggestReferences({
      type,
      name,
      positivePrompt,
      sprites: list.sprites.filter((a) => a.exists).map((a) => a.name),
      settings: await this.referenceSettings(),
    });

    return {
      id: item.id,
      type,
      name,
      targetPath: item.targetPath,
      exists: item.exists,
      url: item.url,
      positivePrompt,
      negativePrompt,
      templateClass: type,
      references,
      datasetHistory,
      steps: spec?.steps,
      cfg: spec?.cfg,
      sampler: spec?.sampler,
      scheduler: spec?.scheduler,
      seed: spec?.seed,
      aspectRatio: spec?.aspectRatio,
      width: spec?.width,
      height: spec?.height,
    };
  }

  async archiveVnAsset(
    slug: string,
    type: AssetKind,
    name: string,
    data: {
      prompt: string;
      negativePrompt?: string;
      feedback?: Record<string, "better" | "keep" | "worse">;
      workflow?: unknown;
    },
  ): Promise<string> {
    const safeSlug = sanitizeSlug(slug);
    const safeName = sanitizeSlug(name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetDir = inside(this.root, `assets/dataset/${safeSlug}/${safeName}/${timestamp}`);
    await mkdir(targetDir, { recursive: true });

    await writeAtomic(
      join(targetDir, "prompt.json"),
      JSON.stringify({ positive: data.prompt, negative: data.negativePrompt || "" }, null, 2),
    );
    await writeAtomic(
      join(targetDir, "feedback.json"),
      JSON.stringify(data.feedback || {}, null, 2),
    );
    if (data.workflow) {
      await writeAtomic(join(targetDir, "workflow.json"), JSON.stringify(data.workflow, null, 2));
    }

    const dirName = assetDir(type);
    const exts = ["png", "jpg", "jpeg", "webp"];
    const candidates: string[] = [];
    for (const ext of exts) {
      candidates.push(inside(this.root, `vns/${safeSlug}/assets/${dirName}/${safeName}.${ext}`));
      candidates.push(inside(this.root, `vns/_shared/assets/${dirName}/${safeName}.${ext}`));
    }
    for (const cand of candidates) {
      try {
        const imgBytes = await readFile(cand);
        await writeFile(join(targetDir, "previous_image.png"), imgBytes);
        break;
      } catch {}
    }

    return targetDir;
  }

  async archiveOneVnAsset(
    slug: string,
    type: AssetKind,
    name: string,
  ): Promise<{ ok: boolean; timestamp: string; targetDir: string }> {
    const detail = await this.getVnAssetDetail(slug, type, name);
    const targetDir = await this.archiveVnAsset(slug, type, name, {
      prompt: detail.positivePrompt,
      negativePrompt: detail.negativePrompt,
    });
    const timestamp = basename(targetDir);
    return { ok: true, timestamp, targetDir };
  }

  async archiveAllVnAssets(slug: string): Promise<{ ok: boolean; archivedCount: number }> {
    const assets = await this.listVnAssets(slug);
    const all = [...assets.sprites, ...assets.cgs, ...assets.backgrounds];
    let archivedCount = 0;
    for (const item of all) {
      if (item.exists) {
        await this.archiveOneVnAsset(slug, item.type, item.name);
        archivedCount++;
      }
    }
    return { ok: true, archivedCount };
  }

  async deleteOneVnAsset(
    slug: string,
    type: AssetKind,
    name: string,
  ): Promise<{ ok: boolean; name: string }> {
    const safeSlug = sanitizeSlug(slug);
    const safeName = sanitizeSlug(name);
    const dirName = assetDir(type);
    const exts = ["png", "jpg", "jpeg", "webp"];
    const candidates: string[] = [];
    for (const ext of exts) {
      candidates.push(inside(this.root, `vns/${safeSlug}/assets/${dirName}/${safeName}.${ext}`));
      if (safeSlug !== "_shared") {
        candidates.push(inside(this.root, `vns/_shared/assets/${dirName}/${safeName}.${ext}`));
      }
    }
    for (const cand of candidates) {
      try {
        await stat(cand);
        await rm(cand, { force: true });
      } catch {}
    }
    return { ok: true, name };
  }

  /** Plan a new asset in a visual novel. Its image is made later, in the Studio. */
  async addVnAsset(
    slug: string,
    type: AssetKind,
    input: PlannedAsset,
  ): Promise<{ ok: boolean; name: string }> {
    const safeSlug = sanitizeSlug(slug);
    if (safeSlug === "_all" || safeSlug === "all" || safeSlug === "_shared")
      throw new HostError("bad_state", "Pick one visual novel to plan the asset in.");
    const manifest = await this.vnManifest(safeSlug);
    try {
      const { assets, name } = addToPlan(manifest.assets, type, input);
      await this.saveVn(safeSlug, {
        manifest: { ...manifest, assets, updatedAt: new Date().toISOString() },
      });
      return { ok: true, name };
    } catch (e) {
      if (e instanceof AssetPlanError) throw new HostError("bad_state", e.message);
      throw e;
    }
  }

  /**
   * Take an asset out of a visual novel's plan and delete its image there. Its runs in the dataset
   * stay: they are what a model is trained on. An asset of the shared pool has no plan, only images.
   */
  async removeVnAsset(
    slug: string,
    type: AssetKind,
    name: string,
  ): Promise<{ ok: boolean; name: string }> {
    const safeSlug = sanitizeSlug(slug);
    if (safeSlug === "_all" || safeSlug === "all")
      throw new HostError("bad_state", "Pick one visual novel to remove the asset from.");
    if (safeSlug !== "_shared") {
      const manifest = await this.vnManifest(safeSlug);
      const { assets, removed } = removeFromPlan(manifest.assets, type, name);
      if (removed)
        await this.saveVn(safeSlug, {
          manifest: { ...manifest, assets, updatedAt: new Date().toISOString() },
        });
    }
    // the name is a file name as the Studio listed it (an owner may be capitalised), so it is checked, not rewritten
    if (!STORED_PART.test(name) || name.includes(".."))
      throw new HostError("invalid_card", `Invalid asset name "${name}".`);
    const dirName = assetDir(type);
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      await rm(inside(this.root, `vns/${safeSlug}/assets/${dirName}/${name}.${ext}`), {
        force: true,
      });
    }
    return { ok: true, name };
  }

  async deleteAllVnAssets(slug: string): Promise<{ ok: boolean; deletedCount: number }> {
    const safeSlug = sanitizeSlug(slug);
    const subDirs = ["sprites", "cgs", "backgrounds"];
    let deletedCount = 0;
    const targetDirs: string[] = [];
    if (safeSlug === "_all") {
      targetDirs.push(inside(this.root, "vns/_shared/assets"));
      const vns = await this.vns();
      for (const v of vns) {
        targetDirs.push(inside(this.root, `vns/${sanitizeSlug(v.slug)}/assets`));
      }
    } else {
      targetDirs.push(inside(this.root, `vns/${safeSlug}/assets`));
    }

    for (const base of targetDirs) {
      for (const sub of subDirs) {
        const dir = join(base, sub);
        try {
          const files = await readdir(dir);
          for (const f of files) {
            if (f.match(/\.(png|jpg|jpeg|webp)$/i)) {
              await rm(join(dir, f), { force: true });
              deletedCount++;
            }
          }
        } catch {}
      }
    }
    return { ok: true, deletedCount };
  }

  async saveGeneratedVnAsset(slug: string, subPath: string, buffer: Buffer): Promise<string> {
    const safeSlug = sanitizeSlug(slug);
    const cleanSub = subPath.replace(/^[/\\]+/, "").replace(/\0/g, "");
    if (!cleanSub) {
      throw new HttpError(400, "invalid_path", "Asset path cannot be empty");
    }
    const dest = inside(this.root, `vns/${safeSlug}/assets/${cleanSub}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buffer);
    return dest;
  }

  /** Which expression is a character's base sprite, from the world's own folder (it is private). */
  async referenceSettings(): Promise<ReferenceSettings> {
    return parseReferenceSettings(
      await readIfThere(inside(this.root, "assets/workflow/references.json")),
    );
  }

  /** The first of these files that holds a workflow. */
  private async readTemplate(candidates: string[]): Promise<Record<string, unknown> | undefined> {
    for (const cand of candidates) {
      const content = await readIfThere(cand);
      if (content) {
        try {
          return JSON.parse(content);
        } catch {}
      }
    }
    return undefined;
  }

  /**
   * A world's own workflow wins over the bundled one. The `ref` variant takes reference images: the
   * world's own `<type>_ref.json` if it has one, else the world's (or the bundled) plain workflow with a
   * reference slot added, so a customised workflow keeps its customisations.
   */
  async loadWorkflowTemplate(type: AssetKind, variant?: "ref"): Promise<Record<string, unknown>> {
    if (variant) {
      if (type === "bg") {
        throw new HttpError(409, "no_reference_slot", NO_REFERENCE_SLOT);
      }
      const own = await this.readTemplate([
        inside(this.root, `assets/workflow/${type}_ref.json`),
        inside(this.root, `assets/workflow/${type}_ref.api.json`),
      ]);
      if (own) return own;
      const derived = addReferenceSlot(
        (await this.loadWorkflowTemplate(type)) as Workflow,
        isLinkedKind(type) ? "cg" : type,
      );
      if (!derived) throw new HttpError(409, "no_reference_slot", NO_REFERENCE_SLOT);
      return derived;
    }
    // the world's own workflow in the database (its copy or a visual novel's) wins over every file
    const slug = this.workflows ? await this.loreSlug(true) : undefined;
    const own = slug ? await this.workflows?.find(slug, type) : undefined;
    if (own && own.scope !== "platform") return own.graph;
    const bundled = templateName(type);
    const found = await this.readTemplate([
      inside(this.root, `assets/workflow/${type}.json`),
      inside(this.root, `assets/workflow/${type}.api.json`),
      resolve(process.cwd(), `tools/comfyui/templates/${bundled}.template.api.json`),
    ]);
    if (found) return found;
    throw new HttpError(404, "template_not_found", `Template for ${type} was not found.`);
  }

  async readDatasetImage(
    slug: string,
    assetName: string,
    timestamp: string,
  ): Promise<{ data: Buffer; contentType: string } | undefined> {
    const safeSlug = sanitizeSlug(slug);
    const safeName = sanitizeSlug(assetName);
    const safeTs = sanitizeSlug(timestamp);

    const candidates = [
      inside(this.root, `assets/dataset/${safeSlug}/${safeName}/${safeTs}/generated_image.png`),
      inside(this.root, `assets/dataset/${safeSlug}/${safeName}/${safeTs}/previous_image.png`),
      inside(this.root, `assets/dataset/${safeSlug}/${safeName}/${safeTs}/image.png`),
      inside(this.root, `assets/dataset/_shared/${safeName}/${safeTs}/generated_image.png`),
      inside(this.root, `assets/dataset/_shared/${safeName}/${safeTs}/previous_image.png`),
    ];

    for (const cand of candidates) {
      try {
        const data = await readFile(cand);
        return { data, contentType: "image/png" };
      } catch {}
    }
    return undefined;
  }

  async saveDatasetGeneratedImage(targetDir: string, buffer: Buffer): Promise<void> {
    try {
      await writeFile(join(targetDir, "generated_image.png"), buffer);
    } catch {}
  }

  /**
   * The run's record, kept beside its image so the pair stays one unit: `run.json` (what was asked,
   * what the workflow applied, how it ended), `workflow.json` (the exact graph sent) and the
   * reference images used. Written when the run starts and again when it ends. A failure to write is
   * the caller's to log: a generation never fails because its record could not be kept.
   */
  async saveRunRecord(
    targetDir: string,
    run: {
      record: Record<string, unknown>;
      workflow?: unknown;
      references?: Array<{ name: string; data: Buffer }>;
    },
  ): Promise<void> {
    const base = resolve(this.root);
    const dir = inside(base, resolve(targetDir).slice(base.length + 1));
    await writeAtomic(join(dir, "run.json"), JSON.stringify(run.record, null, 2));
    if (run.workflow !== undefined) {
      await writeAtomic(join(dir, "workflow.json"), JSON.stringify(run.workflow, null, 2));
    }
    for (const [i, ref] of (run.references ?? []).entries()) {
      const file = join(dir, "references", `${i + 1}-${sanitizeSlug(ref.name)}.png`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, ref.data);
    }
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

/** A chapter or a draft a world carries: prose in a file that is not a card. */
export interface WritingSummary {
  /** Inside the world's folder, with forward slashes. */
  path: string;
  /** Its first heading, or its file's name. */
  title: string;
  /** In bytes. */
  size: number;
  updatedAt: string;
}

export interface WorldDetail {
  world: WorldSummary;
  /** Where the cards came from: the database for an imported world (ADR-0030), else the folder. */
  cardSource: CardSource;
  /** world.json as read; missing when the world cannot be read. */
  manifest?: WorldManifest;
  stories: StorySummary[];
  cards: CardView[];
  broken: BrokenCard[];
  /** Chapters, oldest first, as the file names run. */
  chapters: WritingSummary[];
  /** Work in progress, the most recently changed first. */
  drafts: WritingSummary[];
  /** Visual novel adaptations in the world. */
  vns: VnSummary[];
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

  constructor(
    root: string,
    private readonly options: {
      lore?: LoreCards | undefined;
      images?: DatasetImages | undefined;
      /** Workflows an imported world keeps in the database (ADR-0035). */
      workflows?: WorkflowSource | undefined;
      /** Visual novels an imported world keeps in the database (ADR-0035). */
      vnContent?: VnSource | undefined;
    } = {},
  ) {
    this.root = resolve(root);
  }

  open(name: string): WorldFiles {
    if (!LIBRARY_NAME.test(name))
      throw new HostError("nothing_to_do", `There is no world "${name}".`);
    return new WorldFiles(
      join(this.root, name),
      this.options.lore,
      this.options.workflows,
      this.options.vnContent,
    );
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
    if (found.problem)
      return {
        world: found,
        cardSource: "files",
        stories: [],
        cards: [],
        broken: [],
        chapters: [],
        drafts: [],
        vns: [],
      };
    const { files, source } = await this.open(name).cardFilesFrom();
    const writings = await this.open(name).writings(new Set(files.map((f) => f.path)));
    const vns = await this.open(name).vns();
    return {
      world: found,
      cardSource: source,
      manifest: await this.open(name).world(),
      stories: await this.stories(name).list(),
      cards: files.flatMap((f) => (f.card ? [{ ...f.card, file: f.text }] : [])),
      broken: files.flatMap((f) =>
        f.card ? [] : [{ path: f.path, file: f.text, problems: f.problems ?? [] }],
      ),
      ...writings,
      vns,
    };
  }

  /** Visual novel adaptations in a world. */
  async vns(name: string): Promise<VnSummary[]> {
    return this.open(name).vns();
  }

  /** One visual novel adaptation in full. */
  async vn(
    name: string,
    slug: string,
  ): Promise<{ manifest: VnManifest; adaptationMd: string; slides?: VnSlideDeck }> {
    return this.open(name).vn(slug);
  }

  /** Save manifest, adaptation markdown, or slides for a visual novel adaptation. */
  async saveVn(
    name: string,
    slug: string,
    data: { manifest?: VnManifest; adaptationMd?: string; slides?: VnSlideDeck },
  ): Promise<void> {
    return this.open(name).saveVn(slug, data);
  }

  /** Scaffold a new visual novel adaptation from a chapter or draft. */
  async scaffoldVn(
    name: string,
    options: {
      slug: string;
      title: string;
      source: string;
      mode?: VnMode;
      mc?: string;
      tier?: VnTier;
      order?: number;
      nextSlug?: string;
    },
  ): Promise<VnSummary> {
    return this.open(name).scaffoldVn(options);
  }

  /** Compile a visual novel's adaptation.md into slides.json and save it. */
  async compileVn(
    name: string,
    slug: string,
  ): Promise<{ slides: VnSlideDeck; diagnostics: VnDiagnostic[] }> {
    return this.open(name).compileVn(slug);
  }

  /** Read an asset file belonging to an adapted visual novel. */
  async readVnAsset(
    name: string,
    slug: string,
    subPath: string,
  ): Promise<{ data: Buffer; contentType: string } | undefined> {
    return this.open(name).readVnAsset(slug, subPath);
  }

  async listAllVns(): Promise<
    Array<
      VnSummary & {
        worldName: string;
        worldTitle: string;
        assetCounts: { sprites: number; cgs: number; backgrounds: number };
      }
    >
  > {
    const worlds = await this.list();
    const result: Array<
      VnSummary & {
        worldName: string;
        worldTitle: string;
        assetCounts: { sprites: number; cgs: number; backgrounds: number };
      }
    > = [];

    for (const w of worlds) {
      try {
        const vns = await this.vns(w.name);
        for (const vn of vns) {
          const assets = await this.open(w.name).listVnAssets(vn.slug, { prompts: false });
          result.push({
            ...vn,
            worldName: w.name,
            worldTitle: w.title,
            assetCounts: {
              sprites: assets.sprites.length,
              cgs: assets.cgs.length,
              backgrounds: assets.backgrounds.length,
            },
          });
        }
      } catch {}
    }

    return result;
  }

  async linkedReference(
    name: string,
    kind: LinkedKind,
    asset: string,
  ): Promise<Buffer | undefined> {
    return this.open(name).linkedReference(kind, asset);
  }

  async listVnAssets(name: string, slug: string): Promise<VnAssetLists> {
    return this.open(name).listVnAssets(slug);
  }

  async getVnAssetDetail(
    name: string,
    slug: string,
    type: AssetKind,
    nameKey: string,
  ): Promise<VnAssetDetail> {
    return this.open(name).getVnAssetDetail(slug, type, nameKey);
  }

  async archiveVnAsset(
    name: string,
    slug: string,
    type: AssetKind,
    nameKey: string,
    data: {
      prompt: string;
      negativePrompt?: string;
      feedback?: Record<string, "better" | "keep" | "worse">;
      workflow?: unknown;
    },
  ): Promise<string> {
    return this.open(name).archiveVnAsset(slug, type, nameKey, data);
  }

  async archiveOneVnAsset(
    name: string,
    slug: string,
    type: AssetKind,
    nameKey: string,
  ): Promise<{ ok: boolean; timestamp: string; targetDir: string }> {
    return this.open(name).archiveOneVnAsset(slug, type, nameKey);
  }

  async archiveAllVnAssets(
    name: string,
    slug: string,
  ): Promise<{ ok: boolean; archivedCount: number }> {
    return this.open(name).archiveAllVnAssets(slug);
  }

  async deleteOneVnAsset(
    name: string,
    slug: string,
    type: AssetKind,
    nameKey: string,
  ): Promise<{ ok: boolean; name: string }> {
    return this.open(name).deleteOneVnAsset(slug, type, nameKey);
  }

  async addVnAsset(
    name: string,
    slug: string,
    type: AssetKind,
    input: PlannedAsset,
  ): Promise<{ ok: boolean; name: string }> {
    return this.open(name).addVnAsset(slug, type, input);
  }

  async removeVnAsset(
    name: string,
    slug: string,
    type: AssetKind,
    nameKey: string,
  ): Promise<{ ok: boolean; name: string }> {
    return this.open(name).removeVnAsset(slug, type, nameKey);
  }

  async deleteAllVnAssets(
    name: string,
    slug: string,
  ): Promise<{ ok: boolean; deletedCount: number }> {
    return this.open(name).deleteAllVnAssets(slug);
  }

  async saveGeneratedVnAsset(
    name: string,
    slug: string,
    subPath: string,
    buffer: Buffer,
  ): Promise<string> {
    return this.open(name).saveGeneratedVnAsset(slug, subPath, buffer);
  }

  async readDatasetImage(
    name: string,
    slug: string,
    assetName: string,
    timestamp: string,
    /** True only when the request is the signed-in host's own: the database copy is private. */
    fromDatabase = false,
  ): Promise<{ data: Buffer; contentType: string } | undefined> {
    const images = fromDatabase ? this.options.images : undefined;
    // the run folder is named by its time ("…T10-00-00-000Z"): keep its case, only check it is safe
    if (images && [slug, assetName, timestamp].every((part) => STORED_PART.test(part))) {
      const found = await images.read(name, slug, assetName, timestamp);
      if (found === "gone") return undefined;
      if (found) return found;
    }
    return this.open(name).readDatasetImage(slug, assetName, timestamp);
  }

  /**
   * Delete one run of the dataset: its database copy (when `fromDatabase` and it is there) and its
   * folder on disk. The database goes first, because it may refuse; then nothing is deleted.
   * Returns what was deleted so the caller can say so.
   */
  async deleteDatasetRun(
    name: string,
    slug: string,
    assetName: string,
    timestamp: string,
    fromDatabase = false,
  ): Promise<{ database: boolean; files: boolean }> {
    if (![slug, assetName, timestamp].every((part) => STORED_PART.test(part))) {
      throw new HostError("nothing_to_do", "There is no such run.");
    }
    const images = fromDatabase ? this.options.images : undefined;
    const database = images
      ? (await images.remove(name, slug, assetName, timestamp)) === "removed"
      : false;
    const world = this.open(name);
    const dir = inside(
      world.root,
      `assets/dataset/${sanitizeSlug(slug)}/${sanitizeSlug(assetName)}/${timestamp}`,
    );
    let files = false;
    try {
      await stat(dir);
      await rm(dir, { recursive: true, force: true });
      files = true;
    } catch {}
    return { database, files };
  }

  async saveDatasetGeneratedImage(name: string, targetDir: string, buffer: Buffer): Promise<void> {
    return this.open(name).saveDatasetGeneratedImage(targetDir, buffer);
  }

  async saveRunRecord(
    name: string,
    targetDir: string,
    run: Parameters<WorldFiles["saveRunRecord"]>[1],
  ): Promise<void> {
    return this.open(name).saveRunRecord(targetDir, run);
  }

  async loadWorkflowTemplate(
    name: string,
    type: AssetKind,
    variant?: "ref",
  ): Promise<Record<string, unknown>> {
    return this.open(name).loadWorkflowTemplate(type, variant);
  }

  async savePromptSpec(
    name: string,
    type: AssetKind,
    assetName: string,
    patch: PromptSpecPatch,
  ): Promise<void> {
    return this.open(name).savePromptSpec(assetName, type, patch);
  }

  /** One chapter or draft of a world, in full, for reading. */
  async writing(
    name: string,
    path: string,
  ): Promise<{ path: string; title: string; text: string }> {
    return this.open(name).writing(path);
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
