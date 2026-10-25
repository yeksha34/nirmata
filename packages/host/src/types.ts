import type {
  AdventureEvent,
  AdventureState,
  BuiltContext,
  Card,
  PlayerMode,
  PlotPoint,
} from "@nirmata/core";
import type { SamplerParams } from "@nirmata/llm";

/** Where events are persisted. The server writes `events.jsonl`; tests keep an array. */
export interface EventSink {
  append(event: AdventureEvent): Promise<void>;
}

/** The only sources of ids and time, so a session is replayable and testable. */
export interface Ports {
  newId(): string;
  now(): string;
}

export interface Violation {
  ruleId: string;
  name: string;
  reason: string;
}

export interface RuleJudgeInput {
  text: string;
  rules: readonly Card[];
  signal?: AbortSignal | undefined;
}

/** Decides which rules a reply breaks. May throw; the session then keeps the reply and warns. */
export type RuleJudge = (input: RuleJudgeInput) => Promise<Violation[]>;

export interface PlotSettings {
  enabled: boolean;
  /** Look for plot points after this many player turns since the last look; 0 = only on request. */
  everyPlayerTurns: number;
  /** Most points saved from one look. */
  maxPoints: number;
  /** Most turns read in one look. */
  maxTurns: number;
  /** Model for the extraction call; defaults to the play model. */
  model?: string | undefined;
}

export const defaultPlot: PlotSettings = {
  enabled: true,
  everyPlayerTurns: 3,
  maxPoints: 6,
  maxTurns: 12,
};

export interface HostSettings {
  model: string;
  params: SamplerParams;
  budget: { maxTokens: number; reserveReply?: number };
  /**
   * Revoked plot points stay revoked on every branch, so undoing a turn does not bring back a
   * point that was taken back later. Off by default: undo is plain time travel.
   */
  revokesSurviveUndo: boolean;
  scanTurns?: number;
  plot: PlotSettings;
  /** Which rules the judge checks each reply against. */
  ruleCheck: "off" | "must" | "all";
  /** How many times to rewrite a reply that breaks a rule before accepting it flagged. */
  maxRegenerations: number;
}

export function defaultSettings(model: string, maxTokens = 4096): HostSettings {
  return {
    model,
    params: { temperature: 0.8, topP: 0.95, maxTokens: 350 },
    budget: { maxTokens },
    plot: { ...defaultPlot },
    ruleCheck: "must",
    revokesSurviveUndo: false,
    maxRegenerations: 1,
  };
}

export type HostEvent =
  /** The exact prompt inputs for this attempt: feeds the "why is this card here" drawer. */
  | { type: "context"; context: BuiltContext }
  /** The adventure took its copy of the source cards. Always the first event of a new one. */
  | { type: "begun"; event: AdventureEvent; cards: number }
  /** The player's input was saved. */
  | { type: "player"; event: AdventureEvent }
  /** A live token chunk of the reply being written. */
  | { type: "text"; text: string }
  /** A complete reply was saved. Flagged replies carry `violations`. */
  | { type: "reply"; event: AdventureEvent; finishReason: string; violations: Violation[] }
  | { type: "rule-violation"; violations: Violation[]; willRetry: boolean }
  /** A rewrite is starting: clear the text streamed so far. */
  | { type: "attempt"; n: number }
  /** The recent turns are being read for plot points. */
  | { type: "plotting"; turns: number }
  /** Plot points were saved (possibly none); `points` carry the ids used to revoke them. */
  | { type: "plot"; event: AdventureEvent; points: PlotPoint[] }
  /** Something worth showing that did not stop the turn. */
  | { type: "warning"; message: string }
  /** The caller stopped generation; `partial` was not saved. */
  | { type: "stopped"; partial: string }
  | { type: "error"; message: string; code: string; recoverable: boolean; cause?: unknown }
  /** Always the last event of a turn. */
  | { type: "done"; state: AdventureState };

export interface TurnInput {
  mode: PlayerMode;
  text: string;
}

export class HostError extends Error {
  constructor(
    readonly code:
      | "busy"
      | "persist"
      | "empty_reply"
      | "nothing_to_do"
      | "bad_state"
      | "judge_failed"
      | "plot_failed"
      | "forbidden"
      | "invalid_card",
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}
