import { basename } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type Action,
  type Actor,
  NoStoryCopyError,
  projectStory,
  sourceOf,
  type VnDiagnostic,
  type VnManifest,
  type VnMode,
  type VnSlideDeck,
  type VnSummary,
  type VnTier,
  worldFromStory,
} from "@nirmata/core";
import {
  Board,
  type BoardView,
  type FlavorStyle,
  HostError,
  type HostEvent,
  type HostSettings,
  type ParticipantView,
  type Ports,
  type RoundInput,
  type RuleJudge,
  requireCan,
  SOLO_HOST,
  SourceCards,
  StorySession,
} from "@nirmata/host";
import type { Provider } from "@nirmata/llm";
import {
  applyAttentionFeedback,
  ComfyUiClient,
  type ComfyUiStatus,
  ensureTransparentSpritePng,
  type GenerationJob,
  GenerationJobs,
  injectReferences,
  injectWorkflowParams,
  type AssetKind,
  assetDir,
  assetSize,
  isLinkedKind,
} from "@nirmata/gen";
import { HttpError } from "./errors";
import type { GenerationLedger } from "./generation-ledger";
import type { GeneratedImage } from "./render-recorder";
import { type PlatformRole, seatKindOf } from "./roles";
import {
  type CardInput,
  type Library,
  newStoryId,
  type PromptSpecPatch,
  type RecentStory,
  type StoryFiles,
  type StorySummary,
  type WorldDetail,
  type WorldFiles,
  type WorldPatch,
  type WorldSummary,
  writeNewWorld,
} from "./files";
import {
  type Audience,
  type HostStoryView,
  hostStoryView,
  type SettingsView,
  type StoryView,
  storyView,
  type TableEvent,
  tableEvent,
} from "./views";

import type { VnAssetDetail, VnAssetItem } from "./files";

export interface GenerateAssetInput {
  type: AssetKind;
  name: string;
  targetPath?: string;
  positivePrompt: string;
  negativePrompt?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  feedback?: Record<string, "better" | "keep" | "worse">;
  workflowOverride?: Record<string, unknown>;
  /** Names of sprites whose images should influence this one (see reference-rules). */
  references?: string[];
  /** How strongly they count: the sampler's denoise (image-to-image) or the adapter's weight (identity). */
  referenceStrength?: number;
}

export interface TableOptions {
  /** The worlds the host can open. Which one is open is chosen on screen, not configured. */
  library: Library;
  provider: Provider;
  settings: HostSettings;
  /** The nickname of whoever runs this server. */
  hostNick: string;
  /** Proves you are the one who runs the server; printed on the host's console at startup. */
  hostKey: string;
  judge?: RuleJudge | undefined;
  ports?: Ports | undefined;
  /** Defaults to on in production only (ADR-0014). */
  requireAdultConfirmation?: boolean | undefined;
  /** Called for problems worth a line in the host's console. */
  log?: ((message: string) => void) | undefined;
  /** Keeps generations (jobs and their renders) in the database too, for an imported world. */
  recorder?: GenerationLedger | undefined;
}

/** The image size a workflow asks for (its latent image node), else the usual size for the kind. */
function workflowSize(
  workflow: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>,
  type: AssetKind,
): { width: number; height: number } {
  for (const node of Object.values(workflow)) {
    const w = Number(node.inputs?.width);
    const h = Number(node.inputs?.height);
    if (/latent/i.test(node.class_type ?? "") && w >= 64 && h >= 64) {
      return { width: Math.min(4096, w), height: Math.min(4096, h) };
    }
  }
  return assetSize(type);
}

/** Someone who has joined: the token they present, and the nickname it speaks for. */
export interface Seat {
  token: string;
  nick: string;
  host: boolean;
  /** The signed-in person this seat belongs to; absent for a nickname seat or the host key. */
  account?: string | undefined;
}

export interface You {
  nick: string;
  seat: ParticipantView["seat"];
  muted: boolean;
  host: boolean;
  /** True when the seat comes from a signed-in account. */
  account: boolean;
}

/** A signed-in person, as the table needs to know them. */
export interface Account {
  userId: string;
  /** The name they go by; made into a valid nickname if it is not one. */
  name: string;
  /** What they are on the platform; an author or admin runs the table (ADR-0029). */
  role: PlatformRole;
}

/** The world the table has open. */
export interface WorldInfo {
  name: string;
  title: string;
  tagline: string;
}

export interface TableInfo {
  /** Null until the host has chosen a world. */
  world: WorldInfo | null;
  host: string;
  requiresAdultConfirmation: boolean;
  /** True when a story is being told. */
  story: boolean;
}

export type BoardMessage = BoardView & { online: string[] };

export interface Snapshot {
  you: You;
  world: WorldInfo | null;
  board: BoardMessage;
  story: StoryView | HostStoryView | null;
  /** Host only. */
  settings?: SettingsView;
}

/** What a connection is sent, by event name. */
export interface Outgoing {
  snapshot: Snapshot;
  board: BoardMessage;
  /** The story being told, or null when there is none. */
  "story-view": StoryView | HostStoryView | null;
  /** The host opened a different world. */
  world: { world: WorldInfo | null };
  story: TableEvent;
  /** You were sent away. The connection closes after this. */
  kicked: { message: string };
}

export type Send = <K extends keyof Outgoing>(event: K, data: Outgoing[K]) => void;

interface Subscriber {
  seat: Seat;
  send: Send;
  close: () => void;
}

export type ModerationRequest =
  | { action: "kick" | "mute" | "unmute"; nick: string; style?: FlavorStyle | undefined }
  | { action: "rename"; nick: string; newNick: string; style?: FlavorStyle | undefined };

const sameKey = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const lower = (s: string) => s.toLowerCase();

/** A valid nickname (letters, digits, a few marks; up to 24) from whatever name a person goes by. */
const nickFrom = (name: string): string => {
  const clean = name
    .trim()
    .replace(/[^\p{L}\p{N}_\-[\]\\^{}|]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return clean || "Reader";
};

/** More than this at one table is a crowd, not a game; also a cheap limit on tokens held. */
const MAX_SEATS = 64;

/**
 * One table: the people who have joined, the shared board they write their turns on, and the
 * story being told to them. The server's one stateful object; routes are thin wrappers around it.
 *
 * The story session acts as the host (the table checks what each caller may do with the same
 * permission table, `can`, before it calls the session), so a player can undo or retry a turn
 * but cannot start a story, change settings or touch the source cards.
 *
 * Writing a turn on the board never waits for the story: the round is submitted in the
 * background as soon as it closes, and everything that happens is pushed to every connection.
 */
export class Table {
  private readonly board: Board;
  private open:
    | { info: WorldInfo; world: WorldFiles; stories: StoryFiles; source: SourceCards }
    | undefined;
  private playersMayRead = false;
  private readonly seats = new Map<string, Seat>();
  private readonly subs = new Set<Subscriber>();
  private readonly settings: HostSettings;
  private session: StorySession | undefined;
  private storyId: string | undefined;
  private running: Promise<void> | undefined;
  private abort: AbortController | undefined;
  /** Chapter and plot files are rewritten one after another, never at the same time. */
  private files: Promise<void> = Promise.resolve();
  private readonly comfy = new ComfyUiClient();
  private readonly genJobs = new GenerationJobs();

  /** What the host is called now: the server's setting until a signed-in host takes the seat. */
  private hostNick: string;
  /** The signed-in host, once there is one; the table has one host at a time. */
  private hostAccount: string | undefined;

  constructor(private readonly options: TableOptions) {
    this.settings = options.settings;
    this.hostNick = options.hostNick;
    options.recorder?.watch(this.genJobs);
    this.board = new Board({
      host: options.hostNick,
      ports: options.ports,
      requireAdultConfirmation: options.requireAdultConfirmation,
    });
  }

  // ---- who is here --------------------------------------------------------------------------

  async info(): Promise<TableInfo> {
    return {
      world: this.open?.info ?? null,
      host: this.hostNick,
      requiresAdultConfirmation: this.board.requiresAdultConfirmation,
      story: this.session !== undefined,
    };
  }

  // ---- the library of worlds ----------------------------------------------------------------

  /** The worlds that can be opened. Host only. */
  async worlds(seat: Seat): Promise<WorldSummary[]> {
    requireCan(this.actor(seat), "story.start");
    return this.options.library.list();
  }

  /**
   * Open a world for the table to tell stories in. Host only, and only while no reply is being
   * written. Any story in progress is put away (it is already saved) and the table waits for the
   * host to start or continue one.
   */
  async openWorld(seat: Seat, name: string): Promise<WorldInfo> {
    requireCan(this.actor(seat), "story.start");
    this.requireIdle();
    const info = await this.useWorld(name);
    this.pushWorld();
    return info;
  }

  /** On startup: if the library holds exactly one world, open it so there is nothing to choose. */
  async openOnlyWorld(): Promise<WorldInfo | undefined> {
    if (this.open) return this.open.info;
    const all = (await this.options.library.list()).filter((w) => !w.problem);
    const only = all.length === 1 ? all[0] : undefined;
    return only ? this.useWorld(only.name) : undefined;
  }

  /** Open a world with no questions asked: for startup. The host's request goes through `openWorld`. */
  async useWorld(name: string): Promise<WorldInfo> {
    const world = this.options.library.open(name);
    if (!(await world.exists())) {
      throw new HostError("nothing_to_do", `There is no world "${name}".`);
    }
    const manifest = await world.world();
    this.open = {
      info: { name, title: manifest.title, tagline: manifest.tagline },
      world,
      stories: this.options.library.stories(name),
      source: new SourceCards(world, { playersMayRead: this.playersMayRead }),
    };
    this.session = undefined;
    this.storyId = undefined;
    return this.open.info;
  }

  /** The stories played most recently in any world: where the host picks up. Host only. */
  async recent(seat: Seat, limit = 8): Promise<RecentStory[]> {
    requireCan(this.actor(seat), "story.start");
    return this.options.library.recent(limit);
  }

  /** One world's page: its details, its saved stories and its cards, without opening it. Host only. */
  async worldDetail(seat: Seat, name: string): Promise<WorldDetail> {
    requireCan(this.actor(seat), "story.start");
    return this.options.library.detail(name);
  }

  /** One chapter or draft of a world, to read, without opening the world. Host only. */
  async worldWriting(
    seat: Seat,
    name: string,
    path: string,
  ): Promise<{ path: string; title: string; text: string }> {
    requireCan(this.actor(seat), "story.start");
    return this.options.library.writing(name, path);
  }

  /** Visual novel adaptations in a world. Host only. */
  async worldVns(seat: Seat, name: string): Promise<VnSummary[]> {
    requireCan(this.actor(seat), "story.start");
    return this.options.library.vns(name);
  }

  /** One visual novel adaptation in full. Host only. */
  async worldVn(
    seat: Seat,
    name: string,
    slug: string,
  ): Promise<{ manifest: VnManifest; adaptationMd: string; slides?: VnSlideDeck }> {
    requireCan(this.actor(seat), "story.start");
    return this.options.library.vn(name, slug);
  }

  /** Save a visual novel's manifest, adaptation markdown, or slides. Host only. */
  async saveWorldVn(
    seat: Seat,
    name: string,
    slug: string,
    data: { manifest?: VnManifest; adaptationMd?: string; slides?: VnSlideDeck },
  ): Promise<void> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.saveVn(name, slug, data);
  }

  /** Scaffold a new visual novel adaptation. Host only. */
  async scaffoldWorldVn(
    seat: Seat,
    name: string,
    options: {
      slug: string;
      title: string;
      source: string;
      mode?: VnMode;
      mc?: string;
      tier?: VnTier;
    },
  ): Promise<VnSummary> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.scaffoldVn(name, options);
  }

  /** Compile a visual novel's adaptation.md into slides.json and save it. Host only. */
  async compileWorldVn(
    seat: Seat,
    name: string,
    slug: string,
  ): Promise<{ slides: VnSlideDeck; diagnostics: VnDiagnostic[] }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.compileVn(name, slug);
  }

  /** Read a static asset file (image, audio) for a visual novel adaptation. Open to all readers, players, and canvas. */
  async readWorldVnAsset(
    name: string,
    slug: string,
    subPath: string,
  ): Promise<{ data: Buffer; contentType: string } | undefined> {
    return this.options.library.readVnAsset(name, slug, subPath);
  }

  /** Check connection status of ComfyUI. */
  async comfyStatus(): Promise<ComfyUiStatus> {
    return this.comfy.checkStatus();
  }

  /** List all visual novels across worlds with asset completion status. Host only. */
  async listAllVns(seat: Seat): Promise<
    Array<
      VnSummary & {
        worldName: string;
        worldTitle: string;
        assetCounts: { sprites: number; cgs: number; backgrounds: number };
      }
    >
  > {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.listAllVns();
  }

  /** List all required assets for a visual novel adaptation. Host only. */
  async listWorldVnAssets(
    seat: Seat,
    worldName: string,
    slug: string,
  ): Promise<{ sprites: VnAssetItem[]; cgs: VnAssetItem[]; backgrounds: VnAssetItem[] }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.listVnAssets(worldName, slug);
  }

  /** Get detailed asset info, prompt parameters, and dataset history. Host only. */
  async getWorldVnAssetDetail(
    seat: Seat,
    worldName: string,
    slug: string,
    type: AssetKind,
    name: string,
  ): Promise<VnAssetDetail> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.getVnAssetDetail(worldName, slug, type, name);
  }

  /**
   * Start a ComfyUI generation and return at once with a job to follow. The render runs in the
   * background for as long as ComfyUI takes; read progress with `listGenerationJobs`. Host only.
   */
  startWorldVnAsset(
    seat: Seat,
    worldName: string,
    slug: string,
    body: GenerateAssetInput,
  ): GenerationJob {
    requireCan(this.actor(seat), "source.edit");
    const { job, signal } = this.genJobs.create({
      world: worldName,
      slug,
      type: body.type,
      name: body.name,
    });
    void this.runGeneration(job.id, signal, worldName, slug, body);
    return job;
  }

  /** The jobs in memory, and (after a restart) the recent ones the database remembers. */
  async listGenerationJobs(seat: Seat): Promise<GenerationJob[]> {
    requireCan(this.actor(seat), "source.edit");
    const live = this.genJobs.list();
    const earlier = await this.options.recorder?.recent(new Set(live.map((j) => j.id)));
    return earlier?.length ? [...live, ...earlier].sort((a, b) => b.startedAt - a.startedAt) : live;
  }

  getGenerationJob(seat: Seat, id: string): GenerationJob {
    requireCan(this.actor(seat), "source.edit");
    const job = this.genJobs.get(id);
    if (!job) throw new HttpError(404, "not_found", "No such generation.");
    return job;
  }

  async cancelGenerationJob(seat: Seat, id: string): Promise<GenerationJob> {
    const job = this.getGenerationJob(seat, id);
    if (job.promptId) await this.comfy.cancel(job.promptId);
    this.genJobs.cancel(id);
    return job;
  }

  private async runGeneration(
    jobId: string,
    signal: AbortSignal,
    worldName: string,
    slug: string,
    body: GenerateAssetInput,
  ): Promise<void> {
    const jobs = this.genJobs;
    try {
      const result = await this.generateWorldVnAsset(jobId, signal, worldName, slug, body);
      const job = jobs.get(jobId);
      if (job) for (const s of job.stages) s.state = "done";
      jobs.finish(jobId, { state: "done", result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      jobs.fail(jobId, signal.aborted ? "cancelled" : "error", message);
    }
  }

  /** Remember an asset's prompt and sampler settings, so they are there when it is selected again. Host only. */
  async saveAssetPrompt(
    seat: Seat,
    worldName: string,
    type: AssetKind,
    assetName: string,
    patch: PromptSpecPatch,
  ): Promise<void> {
    requireCan(this.actor(seat), "source.edit");
    await this.options.library.savePromptSpec(worldName, type, assetName, patch);
  }

  /** The images of the reference sprites a generation asked for; a missing one stops it. */
  private async readReferences(
    worldName: string,
    slug: string,
    body: GenerateAssetInput,
  ): Promise<Buffer[]> {
    if (isLinkedKind(body.type)) {
      // the author's own image of the asset, named by its card, guides the render
      const own = await this.options.library.linkedReference(worldName, body.type, body.name);
      return own ? [own] : [];
    }
    if (!body.references?.length || body.type === "bg") return [];
    const images: Buffer[] = [];
    for (const name of body.references.slice(0, 6)) {
      const found = await this.options.library.readVnAsset(worldName, slug, `sprites/${name}.png`);
      if (!found) {
        throw new HttpError(
          409,
          "reference_missing",
          "A reference sprite does not exist yet. Generate it first, or remove it from the references.",
        );
      }
      images.push(found.data);
    }
    return images;
  }

  private async generateWorldVnAsset(
    jobId: string,
    signal: AbortSignal,
    worldName: string,
    slug: string,
    body: GenerateAssetInput,
  ): Promise<{ assetUrl: string; positivePrompt: string; negativePrompt: string }> {
    const jobs = this.genJobs;
    let positive = body.positivePrompt;
    let negative = body.negativePrompt || "";

    if (body.feedback && Object.keys(body.feedback).length > 0) {
      const updated = applyAttentionFeedback(positive, negative, body.feedback);
      positive = updated.positivePrompt;
      negative = updated.negativePrompt;
    }

    // reference sprites are read first: a missing one stops the job before anything is archived
    const references = await this.readReferences(worldName, slug, body);

    const archivedDir = await this.options.library.archiveVnAsset(
      worldName,
      slug,
      body.type,
      body.name,
      {
        prompt: positive,
        negativePrompt: negative,
        feedback: body.feedback,
        workflow: body.workflowOverride,
      },
    );

    const template = (body.workflowOverride ||
      (await this.options.library.loadWorkflowTemplate(
        worldName,
        body.type,
        references.length > 0 ? "ref" : undefined,
      ))) as Record<string, any>;

    let injected = injectWorkflowParams(template, {
      positivePrompt: positive,
      negativePrompt: negative,
      steps: body.steps,
      cfg: body.cfg,
      sampler: body.sampler,
      scheduler: body.scheduler,
      seed: body.seed,
      filenamePrefix: `${body.type}s/${body.name}`,
    });

    if (references.length > 0) {
      const uploaded: string[] = [];
      for (const image of references) {
        const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
        uploaded.push(await this.comfy.uploadImage(`nirmata_ref_${hash}.png`, image));
      }
      const used = injectReferences(injected as any, uploaded, {
        strength: body.referenceStrength,
      });
      if (used.applied === 0) {
        throw new HttpError(
          409,
          "no_reference_slot",
          "This workflow has no place for a reference image. Use a workflow with a Reference Image node.",
        );
      }
      injected = used.workflow as typeof injected;
    }

    const links = isLinkedKind(body.type)
      ? await this.options.library
          .listVnAssets(worldName, slug)
          .then((l) => {
            const pool = { clothes: l.clothes, adornment: l.adornments, object: l.objects }[
              body.type as "clothes" | "adornment" | "object"
            ];
            const item = pool.find((a) => a.name === body.name);
            return item ? { characters: item.lockedTo ?? [], cgs: item.linkedCgs ?? [] } : undefined;
          })
          .catch(() => undefined)
      : undefined;
    await this.options.recorder?.begin({
      key: jobId,
      links,
      worldName,
      scope: slug,
      type: body.type,
      name: body.name,
      positive,
      negative,
      ...workflowSize(injected, body.type),
      steps: body.steps,
      cfg: body.cfg,
      sampler: body.sampler,
      scheduler: body.scheduler,
      seed: body.seed,
    });

    jobs.patch(jobId, {
      nodes: Object.entries(injected).map(([id, node]) => ({
        id,
        title: String(node._meta?.title ?? node.class_type),
        state: "pending" as const,
      })),
    });
    jobs.stage(jobId, "queue");

    const clientId = randomUUID();
    const promptId = await this.comfy.queuePrompt(injected as any, clientId);
    jobs.patch(jobId, { promptId, state: "queued" });
    const result = await this.comfy.waitForCompletion(promptId, {
      clientId,
      signal,
      onEvent: (event) => {
        if (event.kind === "location") {
          if (event.where === "running") {
            jobs.stage(jobId, "render");
            jobs.patch(jobId, { state: "running", queuePosition: undefined });
          } else {
            jobs.patch(jobId, { queuePosition: event.position });
          }
        } else if (event.kind === "node") {
          jobs.stage(jobId, "render");
          jobs.patch(jobId, { state: "running", queuePosition: undefined });
          jobs.nodeActive(jobId, event.node);
        } else if (event.kind === "progress") {
          jobs.patch(jobId, { progress: { value: event.value, max: event.max } });
        } else {
          jobs.nodesCached(jobId, event.nodes);
        }
      },
    });

    const firstImg = result.outputImages?.[0];
    if (!firstImg) {
      throw new HttpError(500, "generation_failed", "No output images produced by ComfyUI.");
    }

    jobs.stage(jobId, "save");
    jobs.patch(jobId, { state: "saving" });
    const rawImageBytes = await this.comfy.fetchImage(
      firstImg.filename,
      firstImg.subfolder,
      firstImg.type,
    );
    const imageBytes =
      body.type === "sprite" ? ensureTransparentSpritePng(rawImageBytes) : rawImageBytes;

    const dirName = assetDir(body.type);
    const targetPath = body.targetPath || `${dirName}/${body.name}.png`;
    await this.options.library.saveGeneratedVnAsset(worldName, slug, targetPath, imageBytes);
    await this.options.library.saveDatasetGeneratedImage(worldName, archivedDir, imageBytes);
    await this.recordGeneration({
      worldName,
      scope: slug,
      run: basename(archivedDir),
      jobKey: jobId,
      type: body.type,
      name: body.name,
      image: Buffer.from(imageBytes),
      positive,
      negative,
      steps: body.steps,
      cfg: body.cfg,
      sampler: body.sampler,
      scheduler: body.scheduler,
      seed: body.seed,
    });

    // remember what made this image (the prompt after feedback), so the next visit starts from it
    await this.options.library
      .savePromptSpec(worldName, body.type, body.name, {
        positivePrompt: positive,
        negativePrompt: negative,
        steps: body.steps,
        cfg: body.cfg,
        sampler: body.sampler,
        scheduler: body.scheduler,
      })
      .catch((e) =>
        this.options.log?.(
          `The prompt was not remembered: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    const assetUrl = `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets/${targetPath}?t=${Date.now()}`;

    return { assetUrl, positivePrompt: positive, negativePrompt: negative };
  }

  /**
   * Delete one run from the dataset gallery. Host only. For an imported world, the database copy
   * goes with it (and its stored file is removed, freeing quota) when the request is the signed-in
   * host's own; an asset's current image is refused.
   */
  async deleteDatasetRun(
    seat: Seat,
    worldName: string,
    slug: string,
    assetName: string,
    timestamp: string,
    fromDatabase = false,
  ): Promise<{ database: boolean; files: boolean }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.deleteDatasetRun(
      worldName,
      slug,
      assetName,
      timestamp,
      fromDatabase,
    );
  }

  /** The database copy of a new generation. The file is already saved, so a failure is only logged. */
  private async recordGeneration(image: GeneratedImage): Promise<void> {
    try {
      await this.options.recorder?.record(image);
    } catch (e) {
      this.options.log?.(
        `A new image was saved on disk but not in the database: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Read an image from the dataset history. Open to all viewers for files; the database copy of an
   * imported world is used only when `fromDatabase` says the request is the signed-in host's own.
   */
  readDatasetImage(
    worldName: string,
    slug: string,
    assetName: string,
    timestamp: string,
    fromDatabase = false,
  ) {
    return this.options.library.readDatasetImage(
      worldName,
      slug,
      assetName,
      timestamp,
      fromDatabase,
    );
  }

  async archiveWorldVnAsset(
    seat: Seat,
    worldName: string,
    slug: string,
    type: AssetKind,
    name: string,
  ): Promise<{ ok: boolean; timestamp: string }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.archiveOneVnAsset(worldName, slug, type, name);
  }

  async archiveAllWorldVnAssets(
    seat: Seat,
    worldName: string,
    slug: string,
  ): Promise<{ ok: boolean; archivedCount: number }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.archiveAllVnAssets(worldName, slug);
  }

  async deleteWorldVnAsset(
    seat: Seat,
    worldName: string,
    slug: string,
    type: AssetKind,
    name: string,
  ): Promise<{ ok: boolean; name: string }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.deleteOneVnAsset(worldName, slug, type, name);
  }

  async deleteAllWorldVnAssets(
    seat: Seat,
    worldName: string,
    slug: string,
  ): Promise<{ ok: boolean; deletedCount: number }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.deleteAllVnAssets(worldName, slug);
  }

  /** Make a new world. It is not opened: the host goes to its page and starts a story there. */
  async createWorld(
    seat: Seat,
    input: { title: string; tagline: string; premise: string },
  ): Promise<WorldSummary> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.create(input);
  }

  /** Change a world's title or tagline. Host only. */
  async editWorld(seat: Seat, name: string, patch: WorldPatch): Promise<WorldSummary> {
    requireCan(this.actor(seat), "source.edit");
    const found = await this.options.library.update(name, patch);
    if (this.open?.info.name === name) {
      this.open = { ...this.open, info: { name, title: found.title, tagline: found.tagline } };
      this.pushWorld();
    }
    return found;
  }

  /**
   * Add or change a card in a world's source, without opening it. Host only. A story already
   * started keeps its own copy of the cards, so this changes only stories begun afterwards.
   */
  async saveCard(
    seat: Seat,
    name: string,
    input: CardInput,
  ): Promise<{ path: string; id: string }> {
    requireCan(this.actor(seat), "source.edit");
    return this.options.library.saveCard(name, input);
  }

  /** Delete one card from a world's source. Host only. */
  async removeCard(seat: Seat, name: string, path: string): Promise<void> {
    requireCan(this.actor(seat), "source.edit");
    await this.options.library.removeCard(name, path);
  }

  /** Put a world away (its folder is renamed, not deleted). Host only; not while a reply is written. */
  async archiveWorld(seat: Seat, name: string): Promise<void> {
    requireCan(this.actor(seat), "source.edit");
    this.requireIdle();
    await this.options.library.archive(name);
    if (this.open?.info.name === name) {
      this.open = undefined;
      this.session = undefined;
      this.storyId = undefined;
      this.pushWorld();
    }
  }

  /** Open `name` unless it is already the open world, so a story can be started or continued in it. */
  private async openIfNeeded(name: string): Promise<void> {
    if (this.open?.info.name === name) return;
    await this.useWorld(name);
    this.pushWorld();
  }

  /** Begin a new story in `name`, opening that world first if needed. Host only. */
  async startStoryIn(seat: Seat, name: string, options: { arcId?: string } = {}): Promise<string> {
    requireCan(this.actor(seat), "story.start");
    this.requireIdle();
    await this.openIfNeeded(name);
    return this.startStory(seat, options);
  }

  /** Continue a saved story of `name`, opening that world first if needed. Host only. */
  async resumeStoryIn(seat: Seat, name: string, id: string): Promise<void> {
    requireCan(this.actor(seat), "story.start");
    this.requireIdle();
    await this.openIfNeeded(name);
    await this.resumeStory(seat, id);
  }

  private current() {
    if (!this.open) throw new HostError("bad_state", "Choose a world first.");
    return this.open;
  }

  /** Put the story away and go back to the library. It stays saved, ready to continue. Host only. */
  closeStory(seat: Seat): void {
    requireCan(this.actor(seat), "story.start");
    this.requireIdle();
    this.session = undefined;
    this.storyId = undefined;
    this.pushStory();
  }

  private pushWorld(): void {
    const world = this.open?.info ?? null;
    for (const sub of this.subs) sub.send("world", { world });
    this.pushStory();
  }

  /**
   * Come to the table. Everyone starts as a spectator. Whoever runs the server proves it with
   * the host key and takes the host's seat; anyone else picks a free nickname.
   */
  join(nick: string, options: { confirmedAdult?: boolean; hostKey?: string } = {}): Seat {
    let host = false;
    let name: string;
    if (options.hostKey !== undefined) {
      if (!sameKey(options.hostKey, this.options.hostKey)) {
        throw new HttpError(403, "forbidden", "That host key is not right.");
      }
      host = true;
      name = this.hostNick;
    } else {
      if (this.seats.size >= MAX_SEATS) {
        throw new HttpError(409, "table_full", "The table is full. Try again later.");
      }
      name = this.board.join(nick, {
        ...(options.confirmedAdult !== undefined ? { confirmedAdult: options.confirmedAdult } : {}),
      }).nick;
    }
    const seat: Seat = { token: randomBytes(24).toString("base64url"), nick: name, host };
    this.seats.set(seat.token, seat);
    this.pushBoard();
    return seat;
  }

  /**
   * Come to the table as a signed-in person. A person who may found worlds takes the host's seat
   * under their own name, so the table is theirs and nobody is hosted under a stand-in. Anyone
   * else comes in as a spectator under their name. Coming back returns the same seat.
   */
  joinAccount(account: Account): Seat {
    for (const seat of this.seats.values()) {
      if (seat.account === account.userId) return seat;
    }
    const base = nickFrom(account.name);
    if (seatKindOf(account.role) === "host") {
      if (this.hostAccount !== undefined && this.hostAccount !== account.userId) {
        throw new HttpError(409, "table_has_host", "This table already has a host.");
      }
      const name = this.board.setHost(base);
      for (const seat of this.seats.values()) if (seat.host) seat.nick = name;
      this.hostNick = name;
      this.hostAccount = account.userId;
      const seat: Seat = {
        token: randomBytes(24).toString("base64url"),
        nick: name,
        host: true,
        account: account.userId,
      };
      this.seats.set(seat.token, seat);
      this.pushBoard();
      return seat;
    }
    if (this.seats.size >= MAX_SEATS) {
      throw new HttpError(409, "table_full", "The table is full. Try again later.");
    }
    let name = base;
    for (let n = 2; ; n++) {
      try {
        name = this.board.join(name, { confirmedAdult: true }).nick;
        break;
      } catch (e) {
        if (n > 99 || !(e instanceof HostError) || e.code !== "bad_nickname") throw e;
        name = `${base.slice(0, 22)}${n}`;
      }
    }
    const seat: Seat = {
      token: randomBytes(24).toString("base64url"),
      nick: name,
      host: false,
      account: account.userId,
    };
    this.seats.set(seat.token, seat);
    this.pushBoard();
    return seat;
  }

  /** The signed-in account that is the table's host, once there is one. */
  hostUserId(): string | undefined {
    return this.hostAccount;
  }

  /** The seat a token speaks for. */
  seat(token: string | undefined): Seat {
    const seat = token ? this.seats.get(token) : undefined;
    if (!seat) throw new HttpError(401, "not_joined", "Join the table first.");
    return seat;
  }

  leave(seat: Seat): void {
    this.board.leave(seat.nick);
    this.dropSeats(seat.nick, "You left the table.");
    this.pushBoard();
    this.pump();
  }

  play(seat: Seat): You {
    this.board.play(seat.nick);
    this.pushBoard();
    return this.you(seat);
  }

  watch(seat: Seat): You {
    this.board.watch(seat.nick);
    this.pushBoard();
    this.pump();
    return this.you(seat);
  }

  you(seat: Seat): You {
    const person = this.person(seat);
    return {
      nick: person.nick,
      seat: person.seat,
      muted: person.muted,
      host: seat.host,
      account: seat.account !== undefined,
    };
  }

  private person(seat: Seat): ParticipantView {
    const found = this.board.view().participants.find((p) => lower(p.nick) === lower(seat.nick));
    if (!found) throw new HttpError(401, "not_joined", "You are no longer at this table.");
    return found;
  }

  private actor(seat: Seat): Actor {
    return { id: seat.nick, role: seat.host ? "host" : "player" };
  }

  /**
   * May this seat do `action`? Spectators and the hushed may only watch; everyone else is
   * checked against the one permission table.
   */
  private authorize(seat: Seat, action: Action): void {
    const person = this.person(seat);
    if (person.seat === "spectator") {
      throw new HostError("forbidden", "Opt in to play before you do that.");
    }
    if (person.muted) {
      throw new HostError(
        "forbidden",
        "Your voice is hushed for now: you can read, but not do that.",
      );
    }
    requireCan(this.actor(seat), action);
  }

  // ---- the board ----------------------------------------------------------------------------

  setDraft(seat: Seat, mode: RoundInput["mode"], text: string): void {
    this.board.setDraft(seat.nick, mode, text);
    this.pushBoard();
  }

  ready(seat: Seat): void {
    this.board.ready(seat.nick);
    this.pushBoard();
    this.pump();
  }

  unready(seat: Seat): void {
    this.board.unready(seat.nick);
    this.pushBoard();
  }

  remark(seat: Seat, text: string): void {
    this.board.remark(seat.nick, text);
    this.pushBoard();
  }

  object(seat: Seat, about: string, text: string): void {
    this.board.object(seat.nick, about, text);
    this.pushBoard();
  }

  withdraw(seat: Seat, remarkId: string): void {
    this.board.withdraw(seat.nick, remarkId);
    this.pushBoard();
  }

  /** The host closes the round now, taking every written turn whether ready or not. */
  closeRound(seat: Seat): void {
    const session = this.live();
    const lines = this.board.closeRound(this.actor(seat));
    if (!lines) {
      throw new HostError(
        "nothing_to_do",
        "There is nothing on the board to close, or the story is busy.",
      );
    }
    this.launch((signal) => session.submitRound(lines, signal));
  }

  moderate(seat: Seat, request: ModerationRequest): void {
    const actor = this.actor(seat);
    switch (request.action) {
      case "kick":
        this.board.kick(actor, request.nick, request.style);
        this.dropSeats(request.nick, "You were sent away from the table.");
        break;
      case "mute":
        this.board.mute(actor, request.nick, request.style);
        break;
      case "unmute":
        this.board.unmute(actor, request.nick, request.style);
        break;
      case "rename": {
        this.board.rename(actor, request.nick, request.newNick, request.style);
        for (const s of this.seats.values()) {
          if (lower(s.nick) === lower(request.nick)) s.nick = request.newNick.trim();
        }
        break;
      }
    }
    this.pushBoard();
    this.pump();
  }

  // ---- the story ----------------------------------------------------------------------------

  async stories(seat: Seat): Promise<StorySummary[]> {
    requireCan(this.actor(seat), "story.start");
    return this.current().stories.list();
  }

  /** Take the copy of the source cards and begin a new story. Host only. */
  async startStory(seat: Seat, options: { arcId?: string } = {}): Promise<string> {
    const actor = this.actor(seat);
    requireCan(actor, "story.start");
    this.requireIdle();
    const open = this.current();
    const copy = await open.source.snapshot(actor);
    const id = newStoryId((this.options.ports ?? { now: () => new Date().toISOString() }).now());
    const session = StorySession.create({
      world: copy.world,
      cards: copy.cards,
      actor: SOLO_HOST,
      provider: this.options.provider,
      sink: open.stories.sink(id),
      settings: this.settings,
      judge: this.options.judge,
      ports: this.options.ports,
    });
    this.adopt(id, session);
    this.launch((signal) => session.start(options, signal));
    return id;
  }

  /** Go back to a saved story. Host only. */
  async resumeStory(seat: Seat, id: string): Promise<void> {
    requireCan(this.actor(seat), "story.start");
    this.requireIdle();
    const open = this.current();
    const events = await open.stories.load(id);
    const session = StorySession.create(
      {
        actor: SOLO_HOST,
        provider: this.options.provider,
        sink: open.stories.sink(id),
        settings: this.settings,
        judge: this.options.judge,
        ports: this.options.ports,
      },
      events,
    );
    this.adopt(id, session);
    await this.afterChange();
  }

  private adopt(id: string, session: StorySession): void {
    this.session = session;
    this.storyId = id;
    this.pushStory();
  }

  /** Write a different reply (or answer a round whose reply failed). */
  retry(seat: Seat): void {
    this.authorize(seat, "story.play");
    const session = this.live();
    this.launch((signal) => session.retry(signal));
  }

  continueStory(seat: Seat): void {
    this.authorize(seat, "story.play");
    const session = this.live();
    this.launch((signal) => session.continueStory(signal));
  }

  /** Ask the model to look for plot points now. */
  extractPlot(seat: Seat): void {
    this.authorize(seat, "plot.extract");
    const session = this.live();
    this.launch((signal) => session.plot(signal));
  }

  /** Stop the reply being written. What was streamed so far is not saved. */
  stop(seat: Seat): void {
    this.authorize(seat, "story.play");
    this.abort?.abort();
  }

  async undo(seat: Seat): Promise<boolean> {
    this.authorize(seat, "story.undo");
    const done = await this.live().undo();
    await this.afterChange();
    return done;
  }

  async edit(seat: Seat, turnId: string, text: string): Promise<void> {
    this.authorize(seat, "story.edit-turn");
    await this.live().edit(turnId, text);
    await this.afterChange();
  }

  async goto(seat: Seat, target: string | null): Promise<void> {
    this.authorize(seat, "story.branch");
    await this.live().goto(target);
    await this.afterChange();
  }

  async pin(seat: Seat, fact: string, on: boolean): Promise<void> {
    this.authorize(seat, "story.pin");
    const session = this.live();
    await (on ? session.pin(fact) : session.unpin(fact));
    await this.afterChange();
  }

  async breakChapter(seat: Seat, title?: string): Promise<void> {
    this.authorize(seat, "chapter.break");
    await this.live().breakChapter(title);
    await this.afterChange();
  }

  async addPlotPoint(seat: Seat, card: string, text: string): Promise<void> {
    this.authorize(seat, "plot.add");
    await this.live().addPlotPoint(card, text);
    await this.afterChange();
  }

  async revokePlotPoint(seat: Seat, pointId: string): Promise<void> {
    this.authorize(seat, "plot.revoke");
    await this.live().revokePlotPoint(pointId);
    await this.afterChange();
  }

  async undoLastPlot(seat: Seat): Promise<boolean> {
    this.authorize(seat, "plot.revoke");
    const done = await this.live().undoLastPlot();
    await this.afterChange();
    return done;
  }

  /**
   * Save the story as it stands (or as it stood at moment `at`) as a new world: its own copy of
   * the cards with every plot point written into the card it happened to, plus its chapters.
   * Host only. The new world sits beside this one; run the server on it to tell stories there.
   */
  async saveAsWorld(
    seat: Seat,
    options: { name: string; title?: string | undefined; at?: string | undefined },
  ): Promise<{ name: string; cards: number; chapters: number }> {
    requireCan(this.actor(seat), "source.edit");
    const session = this.live();
    if (options.at !== undefined && !session.state.events.has(options.at)) {
      throw new HostError("nothing_to_do", "There is no such moment in this story.");
    }
    const was = sourceOf(session.state)?.world.title;
    try {
      const made = worldFromStory(session.state, {
        name: options.name,
        title: options.title ?? (was ? `${was} (continued)` : options.name),
        ...(options.at !== undefined ? { at: options.at } : {}),
        plot: { revokesSurviveUndo: this.settings.revokesSurviveUndo },
      });
      return await writeNewWorld(this.options.library.root, made);
    } catch (e) {
      if (e instanceof NoStoryCopyError) throw new HostError("bad_state", e.message);
      throw e;
    }
  }

  // ---- source cards and settings (host) -----------------------------------------------------

  get cards(): SourceCards {
    return this.current().source;
  }

  actorFor(seat: Seat): Actor {
    return this.actor(seat);
  }

  settingsView(): SettingsView {
    return { settings: structuredClone(this.settings), playersMayRead: this.playersMayRead };
  }

  changeSettings(
    seat: Seat,
    patch: Partial<Omit<HostSettings, "plot" | "params" | "budget">> & {
      plot?: Partial<HostSettings["plot"]>;
      params?: Partial<HostSettings["params"]>;
      budget?: Partial<HostSettings["budget"]>;
      playersMayRead?: boolean;
    },
  ): SettingsView {
    const actor = this.actor(seat);
    requireCan(actor, "settings.change");
    const { plot, params, budget, playersMayRead, ...rest } = patch;
    Object.assign(this.settings, rest);
    if (plot) Object.assign(this.settings.plot, plot);
    if (params) Object.assign(this.settings.params, params);
    if (budget) Object.assign(this.settings.budget, budget);
    if (playersMayRead !== undefined) {
      requireCan(actor, "settings.change");
      this.playersMayRead = playersMayRead;
      this.open?.source.setPlayersMayRead(actor, playersMayRead);
    }
    return this.settingsView();
  }

  // ---- what each person is sent -------------------------------------------------------------

  snapshot(seat: Seat): Snapshot {
    return {
      you: this.you(seat),
      world: this.open?.info ?? null,
      board: this.boardMessage(),
      story: this.storyFor(seat.host ? "host" : "table"),
      ...(seat.host ? { settings: this.settingsView() } : {}),
    };
  }

  /** Start sending a connection everything that happens. Returns how to stop. */
  subscribe(seat: Seat, send: Send, close: () => void): () => void {
    const sub: Subscriber = { seat, send, close };
    this.subs.add(sub);
    send("snapshot", this.snapshot(seat));
    this.pushBoard();
    return () => {
      if (this.subs.delete(sub)) this.pushBoard();
    };
  }

  /** Disconnect everyone (the server is shutting down). */
  close(): void {
    this.abort?.abort();
    for (const sub of [...this.subs]) sub.close();
    this.subs.clear();
  }

  /** Resolves when no reply is being written and the files are up to date. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
    await this.files;
  }

  private storyFor(audience: Audience): StoryView | HostStoryView | null {
    if (!this.session || !this.storyId) return null;
    return audience === "host"
      ? hostStoryView(this.storyId, this.session)
      : storyView(this.storyId, this.session);
  }

  private boardMessage(): BoardMessage {
    const online = new Set([...this.subs].map((s) => lower(s.seat.nick)));
    const view = this.board.view();
    return {
      ...view,
      online: view.participants.filter((p) => online.has(lower(p.nick))).map((p) => p.nick),
    };
  }

  private pushBoard(): void {
    if (!this.subs.size) return;
    const message = this.boardMessage();
    for (const sub of this.subs) sub.send("board", message);
  }

  private pushStory(): void {
    const views: Record<Audience, StoryView | HostStoryView | null> = {
      host: this.storyFor("host"),
      table: this.storyFor("table"),
    };
    for (const sub of this.subs) sub.send("story-view", views[sub.seat.host ? "host" : "table"]);
  }

  private fanOut(ev: HostEvent): void {
    const forHost = tableEvent(ev, "host");
    const forTable = tableEvent(ev, "table");
    for (const sub of this.subs) {
      const out = sub.seat.host ? forHost : forTable;
      if (out) sub.send("story", out);
    }
  }

  /** Close the connections of a nickname and forget its tokens. */
  private dropSeats(nick: string, message: string): void {
    for (const [token, seat] of this.seats) {
      if (lower(seat.nick) === lower(nick)) this.seats.delete(token);
    }
    for (const sub of [...this.subs]) {
      if (lower(sub.seat.nick) !== lower(nick)) continue;
      sub.send("kicked", { message });
      this.subs.delete(sub);
      sub.close();
    }
  }

  // ---- running a turn -----------------------------------------------------------------------

  private live(): StorySession {
    if (!this.session)
      throw new HostError("bad_state", "There is no story yet. The host can start one.");
    return this.session;
  }

  private requireIdle(): void {
    if (this.running || this.session?.isBusy) {
      throw new HostError("busy", "The story is busy writing. Wait for it to finish.");
    }
  }

  /** When the board's round has closed and the story is idle, hand the lines to the story. */
  private pump(): void {
    if (this.running || !this.session) return;
    const lines = this.board.takeRound();
    if (!lines) return;
    const session = this.session;
    this.launch((signal) => session.submitRound(lines, signal));
  }

  /**
   * Run a streaming operation in the background, telling everyone as it goes. Returns at once;
   * the board counts the story as busy until it ends, then looks for the next closed round.
   */
  private launch(make: (signal: AbortSignal) => AsyncGenerator<HostEvent>): void {
    this.requireIdle();
    const controller = new AbortController();
    this.abort = controller;
    this.board.setBusy(true);
    this.pushBoard();
    const run = (async () => {
      try {
        for await (const ev of make(controller.signal)) this.fanOut(ev);
      } catch (e) {
        this.options.log?.(`A turn failed: ${(e as Error).message}`);
        this.fanOut({
          type: "error",
          message: "Something went wrong with the story.",
          code: "unexpected",
          recoverable: true,
        });
      } finally {
        this.board.setBusy(false);
        this.abort = undefined;
      }
      await this.afterChange();
    })().finally(() => {
      this.running = undefined;
      this.pushBoard();
      this.pump();
    });
    this.running = run;
  }

  /** After the story changed: keep the chapter and plot files in step, and tell everyone. */
  private async afterChange(): Promise<void> {
    this.pushStory();
    await this.writeFiles();
  }

  private writeFiles(): Promise<void> {
    const session = this.session;
    const id = this.storyId;
    const stories = this.open?.stories;
    if (!session || !id || !stories) return this.files;
    const names = new Map(
      (sourceOf(session.state)?.cards ?? []).map((c) => [c.fm.id, c.fm.name] as const),
    );
    const files = projectStory(session.state, {
      cardNames: names,
      revokesSurviveUndo: this.settings.revokesSurviveUndo,
    });
    this.files = this.files
      .then(() => stories.writeProjection(id, files))
      .catch((e: Error) => {
        this.options.log?.(`Could not write the chapter files: ${e.message}`);
        this.fanOut({
          type: "warning",
          message: `The story is saved, but its chapter files could not be written: ${e.message}`,
        });
      });
    return this.files;
  }
}
