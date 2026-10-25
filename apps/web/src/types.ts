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
  body: string;
}

/** A saved story with the world it belongs to: what the worlds page offers to pick up. */
export interface RecentStory extends StorySummary {
  world: string;
  worldTitle: string;
}

/** A world's page: its details, saved stories and cards, whether or not it is the open one. */
export interface WorldDetail {
  world: WorldSummary;
  manifest?: Manifest;
  stories: StorySummary[];
  cards: Card[];
  broken: BrokenCard[];
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
