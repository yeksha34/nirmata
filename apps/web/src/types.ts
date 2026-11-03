/**
 * What the server sends, as the screens see it. This mirrors the server's wire shapes
 * (apps/server/src/table.ts and views.ts); the server's tests pin the other side.
 */
export type SeatKind = "host" | "player" | "spectator";
export type Mode = "do" | "say" | "story";

export interface You {
  nick: string;
  seat: SeatKind;
  muted: boolean;
  host: boolean;
  /** True when the seat comes from a signed-in account. */
  account?: boolean;
}

export interface WorldInfo {
  name: string;
  title: string;
  tagline: string;
}

export interface TurnView {
  id: string;
  role: "player" | "host";
  mode?: Mode;
  text: string;
  by?: string;
  round?: string;
}

export interface ChapterView {
  number: number;
  title: string;
  open: boolean;
  /** The last turn in it: where the next chapter starts. */
  through?: string;
}

export interface StoryView {
  id: string;
  started: boolean;
  busy: boolean;
  turns: TurnView[];
  chapters: ChapterView[];
}

export interface PlotPoint {
  id: string;
  card: string;
  text: string;
  eventId: string;
}

/** The host also gets these. */
export interface HostStoryView extends StoryView {
  head: string | null;
  plotPoints: PlotPoint[];
  memory: { summary: string; pinned: string[] };
}

export interface Participant {
  nick: string;
  seat: SeatKind;
  muted: boolean;
}

export interface Draft {
  nick: string;
  mode: Mode;
  text: string;
  ready: boolean;
  objections: number;
}

export interface Remark {
  id: string;
  kind: "remark" | "objection" | "notice";
  by: string;
  text: string;
  about?: string;
  answered?: boolean;
  t: string;
}

export interface BoardMessage {
  host: string;
  participants: Participant[];
  drafts: Draft[];
  remarks: Remark[];
  notices: Remark[];
  busy: boolean;
  closed: boolean;
  online: string[];
}

export interface Snapshot {
  you: You;
  world: WorldInfo | null;
  board: BoardMessage;
  story: StoryView | HostStoryView | null;
}

export interface TableInfo {
  world: WorldInfo | null;
  host: string;
  requiresAdultConfirmation: boolean;
  story: boolean;
}

export interface WorldSummary {
  name: string;
  title: string;
  tagline: string;
  stories: number;
  problem?: string;
}

export interface StorySummary {
  id: string;
  updatedAt: string;
  startedAt?: string;
  turns: number;
  players: string[];
  preview: string;
  damaged?: boolean;
}

export const CARD_KINDS = ["lore", "character", "place", "arc", "rule", "scene"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export type Perspective = "first-person" | "second-person" | "third-person";

/** One named part a card of some kind usually has, with a hint for filling it in. */
export interface FieldSpec {
  id: string;
  label: string;
  hint: string;
}

/** A starting shape for a card: a person, a place, a custom... (served by the server). */
export interface CardTemplate {
  id: string;
  kind: CardKind;
  label: string;
  description: string;
  role?: string;
  fields: FieldSpec[];
}

export interface Card {
  path: string;
  fm: {
    id: string;
    kind: CardKind;
    name: string;
    keywords?: string[];
    summary?: string;
    always?: boolean;
    role?: string;
    scope?: "chapter" | "story" | "both";
    severity?: "must" | "should";
    /** Named parts (appearance, voice ...), in the order written. */
    fields?: Record<string, string>;
  };
  body: string;
  /** The text of the card's file as it is on disk (a world's page sends it). */
  file?: string;
}

/** A card file that cannot be read: what is wrong, and its text so it can be mended. */
export interface BrokenCard {
  path: string;
  file: string;
  problems: string[];
}

/** world.json as the manager shows it. */
export interface Manifest {
  name: string;
  title: string;
  tagline: string;
  genre: string[];
  tone: string[];
  perspective: Perspective;
}

/** What the card form sends; the id, the file and any extra fields stay as they were. */
export interface CardForm {
  kind: CardKind;
  name: string;
  keywords: string[];
  summary: string;
  always: boolean;
  role?: string;
  scope?: "chapter" | "story" | "both";
  severity?: "must" | "should";
  fields: Record<string, string>;
  body: string;
}

/** A saved story with the world it belongs to: what the worlds page offers to pick up. */
export interface RecentStory extends StorySummary {
  world: string;
  worldTitle: string;
}

/** A chapter or a draft a world carries: prose in a file that is not a card. */
export interface WritingSummary {
  path: string;
  /** Its first heading, or its file's name. */
  title: string;
  /** In bytes. */
  size: number;
  updatedAt: string;
}

/** One of them in full, to read. */
export interface Writing {
  path: string;
  title: string;
  text: string;
}

/** A world's page: its details, saved stories and cards, whether or not it is the open one. */
export interface WorldDetail {
  world: WorldSummary;
  /** Where the cards came from: the database for an imported world, else the world's folder. */
  cardSource?: "database" | "files";
  manifest?: Manifest;
  stories: StorySummary[];
  cards: Card[];
  broken: BrokenCard[];
  /** Oldest first, as the file names run. */
  chapters: WritingSummary[];
  /** The most recently changed first. */
  drafts: WritingSummary[];
  /** Visual novel adaptations in the world. */
  vns?: VnSummary[];
}

export type VnMode = "mode_1" | "mode_2a" | "mode_2b" | "mode_2_open";
export type VnTier = "micro" | "short" | "mid" | "large";
export type VnSlot = "left" | "center" | "right";

export interface VnSummary {
  slug: string;
  title: string;
  source: string;
  mode: VnMode;
  mc: string;
  tier: VnTier;
  slideCount?: number;
  routes: string[];
  updatedAt: string;
  order?: number;
  nextSlug?: string;
}

export interface VnVariableDef {
  initial: number | boolean | string;
  description?: string;
}

export interface VnAssetsManifest {
  backgrounds: string[];
  characters: Record<string, string[]>;
  cgs: string[];
  music?: string[];
  sfx?: string[];
}

export interface VnManifest {
  slug: string;
  title: string;
  source: string;
  mode: VnMode;
  mc: string;
  tier: VnTier;
  routes: string[];
  variables: Record<string, VnVariableDef>;
  assets: VnAssetsManifest;
  createdAt: string;
  updatedAt: string;
  order?: number;
  nextSlug?: string;
}

export interface VnStageCharacter {
  character: string;
  state?: string;
  expression: string;
  slot: VnSlot;
}

export interface VnStageState {
  bg?: string;
  transition?: string;
  music?: string;
  sfx?: string;
  cg?: {
    name: string;
    active: boolean;
  };
  characters: VnStageCharacter[];
}

export interface VnVarOp {
  variable: string;
  op: "+" | "-" | "=";
  value: number | boolean | string;
}

export interface VnMenuChoice {
  text: string;
  targetSceneId: string;
  isCanon?: boolean;
  varChanges?: VnVarOp[];
}

export type VnSlideAction =
  | { type: "continue"; nextSlideId?: string }
  | { type: "jump"; targetSceneId: string }
  | { type: "menu"; prompt?: string; choices: VnMenuChoice[] }
  | { type: "end"; endingName?: string };

export interface VnDialogue {
  speaker?: string;
  isMonologue?: boolean;
  text: string;
}

export interface VnSlide {
  id: string;
  sceneId: string;
  route: string;
  stage: VnStageState;
  dialogue: VnDialogue;
  action: VnSlideAction;
}

export interface VnSlideDeck {
  slug: string;
  title: string;
  initialSceneId: string;
  sceneOrder: string[];
  slides: VnSlide[];
}

export interface VnDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  sceneId?: string;
  line?: number;
}

/** A live event while the story is being written. */
export type StoryEvent =
  | { type: "begun" }
  | { type: "player"; turn: TurnView }
  | { type: "text"; text: string }
  | { type: "attempt"; n: number }
  | { type: "reply"; turn: TurnView; finishReason: string }
  | { type: "stopped" }
  | { type: "error"; message: string; code: string; recoverable: boolean }
  | { type: "done" }
  | { type: "warning"; message: string }
  | { type: "rule-violation"; violations: { name: string; reason: string }[]; willRetry: boolean }
  | { type: "plotting"; turns: number }
  | { type: "plot"; points: PlotPoint[] }
  | { type: "context"; context: unknown };

export function isHostView(story: StoryView | HostStoryView | null): story is HostStoryView {
  return story !== null && "head" in story;
}

export interface ComfyUiDevice {
  name: string;
  type: string;
  vramTotal?: number;
  vramFree?: number;
}

export interface ComfyUiStatus {
  online: boolean;
  host: string;
  port: number;
  devices: ComfyUiDevice[];
}

/** Stage art (sprite, cg, bg) and character-linked art: clothes and adornments are locked to one character, objects to characters and/or CGs. */
export type AssetKind = "sprite" | "cg" | "bg" | "clothes" | "adornment" | "object";

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
  lockedTo?: string[];
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
  /** Sprites that should influence this image, and every sprite that could. */
  references?: { suggested: string[]; available: string[] };
}

export interface VnWithAssetsSummary extends VnSummary {
  worldName: string;
  worldTitle: string;
  assetCounts: {
    sprites: number;
    cgs: number;
    backgrounds: number;
  };
}

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
  /** Sprites whose images should influence this one. */
  references?: string[];
}

export type GenerationJobState = "queued" | "running" | "saving" | "done" | "error" | "cancelled";

export interface GenerationJob {
  id: string;
  world: string;
  slug: string;
  type: AssetKind;
  name: string;
  state: GenerationJobState;
  stages: Array<{ id: "prepare" | "queue" | "render" | "save"; label: string; state: "pending" | "active" | "done" | "error" }>;
  /** The workflow's own steps, as ComfyUI reports them. */
  nodes: Array<{ id: string; title: string; state: "pending" | "active" | "done" | "cached" }>;
  progress?: { value: number; max: number };
  queuePosition?: number;
  promptId?: string;
  error?: string;
  result?: { assetUrl: string; positivePrompt: string; negativePrompt: string };
  startedAt: number;
  updatedAt: number;
}
