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

export interface Card {
  path: string;
  fm: { id: string; kind: string; name: string; summary?: string; always?: boolean };
  body: string;
}

/** A saved story with the world it belongs to: what the portal offers to pick up. */
export interface RecentStory extends StorySummary {
  world: string;
  worldTitle: string;
}

/** A world's page: its details, saved stories and cards, whether or not it is the open one. */
export interface WorldDetail {
  world: WorldSummary;
  stories: StorySummary[];
  cards: Card[];
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
