import type {
  AdventureEvent,
  AdventureState,
  BuiltContext,
  Card,
  PlayerMode,
  Rating,
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

export interface HostSettings {
  model: string;
  params: SamplerParams;
  budget: { maxTokens: number; reserveReply?: number };
  /** Defaults to the world's own rating. */
  ratingCeiling?: Rating;
  scanTurns?: number;
  /** Refresh the memory summary after this many player turns; 0 turns it off. */
  summaryEvery: number;
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
    summaryEvery: 10,
    ruleCheck: "must",
    maxRegenerations: 1,
  };
}

export type HostEvent =
  /** The exact prompt inputs for this attempt: feeds the "why is this card here" drawer. */
  | { type: "context"; context: BuiltContext }
  /** The player's input was saved. */
  | { type: "player"; event: AdventureEvent }
  /** A live token chunk of the reply being written. */
  | { type: "text"; text: string }
  /** A complete reply was saved. Flagged replies carry `violations`. */
  | { type: "reply"; event: AdventureEvent; finishReason: string; violations: Violation[] }
  | { type: "rule-violation"; violations: Violation[]; willRetry: boolean }
  /** A rewrite is starting: clear the text streamed so far. */
  | { type: "attempt"; n: number }
  /** The memory summary was refreshed. */
  | { type: "memory"; event: AdventureEvent }
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
      | "judge_failed",
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}
