import type { BuiltContext, PlotPoint, Turn } from "@nirmata/core";
import type { HostEvent, HostSettings, StorySession, Violation } from "@nirmata/host";

/**
 * What each kind of person at the table is shown (ADR-0009, ADR-0011).
 *
 * The host sees everything about the story. Everyone else, players and spectators alike, sees
 * only the story as it is told: turns, chapter titles and who wrote what. Never the copy of the
 * cards the story plays on, never anything in them (Secrets are host-only), never the prompt,
 * and never what a rule check or plot extraction found. Nothing here is derived by filtering
 * text: the table views are built from the fields listed below and nothing else, so a field
 * added to an event later stays private until it is added here on purpose.
 */
export type Audience = "host" | "table";

export interface TurnView {
  id: string;
  role: "player" | "host";
  mode?: string;
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

export interface HostStoryView extends StoryView {
  head: string | null;
  plotPoints: PlotPoint[];
  memory: { summary: string; pinned: string[] };
}

export function turnView(t: Turn): TurnView {
  return {
    id: t.id,
    role: t.role,
    ...(t.mode ? { mode: t.mode } : {}),
    text: t.text,
    ...(t.by ? { by: t.by } : {}),
    ...(t.round ? { round: t.round } : {}),
  };
}

export function storyView(id: string, session: StorySession): StoryView {
  return {
    id,
    started: session.state.log.length > 0,
    busy: session.isBusy,
    turns: session.turns.map(turnView),
    chapters: session.chapters.map((c) => ({ number: c.number, title: c.title, open: c.open })),
  };
}

export function hostStoryView(id: string, session: StorySession): HostStoryView {
  return {
    ...storyView(id, session),
    head: session.state.head,
    plotPoints: session.plotPoints,
    memory: session.memory,
  };
}

/** A live event as it travels to the browsers. */
export type TableEvent =
  | { type: "begun" }
  | { type: "player"; turn: TurnView }
  | { type: "text"; text: string }
  | { type: "attempt"; n: number }
  | { type: "reply"; turn: TurnView; finishReason: string; violations?: Violation[] }
  | { type: "stopped" }
  | { type: "error"; message: string; code: string; recoverable: boolean }
  | { type: "done" }
  // host only below
  | { type: "context"; context: BuiltContext }
  | { type: "rule-violation"; violations: Violation[]; willRetry: boolean }
  | { type: "plotting"; turns: number }
  | { type: "plot"; points: PlotPoint[] }
  | { type: "warning"; message: string };

/** Errors whose text may mention the machine; the table is told something plainer. */
const PLAIN_ERRORS = new Set(["unexpected", "persist"]);

/** The event as `audience` may see it, or nothing if it is not for them. */
export function tableEvent(ev: HostEvent, audience: Audience): TableEvent | undefined {
  const host = audience === "host";
  switch (ev.type) {
    case "begun":
      return { type: "begun" };
    case "player":
      return { type: "player", turn: turnView({ id: ev.event.id, role: "player", ...turnOf(ev) }) };
    case "text":
      return { type: "text", text: ev.text };
    case "attempt":
      return { type: "attempt", n: ev.n };
    case "reply":
      return {
        type: "reply",
        turn: turnView({ id: ev.event.id, role: "host", text: ev.event.text }),
        finishReason: ev.finishReason,
        ...(host ? { violations: ev.violations } : {}),
      };
    case "stopped":
      return { type: "stopped" };
    case "error":
      return {
        type: "error",
        message:
          !host && PLAIN_ERRORS.has(ev.code)
            ? "Something went wrong with the story. The host can try again."
            : ev.message,
        code: ev.code,
        recoverable: ev.recoverable,
      };
    case "done":
      return { type: "done" };
    case "context":
      return host ? { type: "context", context: ev.context } : undefined;
    case "rule-violation":
      return host
        ? { type: "rule-violation", violations: ev.violations, willRetry: ev.willRetry }
        : undefined;
    case "plotting":
      return host ? { type: "plotting", turns: ev.turns } : undefined;
    case "plot":
      return host ? { type: "plot", points: ev.points } : undefined;
    case "warning":
      return host ? { type: "warning", message: ev.message } : undefined;
  }
}

function turnOf(ev: Extract<HostEvent, { type: "player" }>): Omit<Turn, "id" | "role"> {
  const e = ev.event;
  return { mode: e.mode, text: e.text, by: e.by, round: e.round };
}

export interface SettingsView {
  settings: HostSettings;
  playersMayRead: boolean;
}
