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

export interface CompactionSettings {
  enabled: boolean;
  /** Newest turns always kept verbatim in the prompt (the tail starts at a player action). */
  keepRecent: number;
  /** Fewest turns worth compacting at once. */
  minTurns: number;
  /** Compact after this many player turns since the last compaction; 0 = only by pressure. */
  everyPlayerTurns: number;
  /** Compact when the last prompt used this fraction of the available budget; 0 = never. */
  pressure: number;
  /** Model for the compaction calls; defaults to the play model. */
  model?: string | undefined;
}

export const defaultCompaction: CompactionSettings = {
  enabled: true,
  keepRecent: 4,
  minTurns: 6,
  everyPlayerTurns: 8,
  pressure: 0.7,
};

export interface HostSettings {
  model: string;
  params: SamplerParams;
  budget: { maxTokens: number; reserveReply?: number };
  /** Defaults to the world's own rating. */
  ratingCeiling?: Rating;
  scanTurns?: number;
  compaction: CompactionSettings;
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
    compaction: { ...defaultCompaction },
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
  /** Older turns are being compacted into a chapter, a summary and tracking cards. */
  | { type: "compacting"; turns: number }
  /** The compaction was saved: the new chapter and what it updated. */
  | {
      type: "compacted";
      event: AdventureEvent;
      chapter: { number: number; title: string };
      cardsUpdated: string[];
    }
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
      | "compaction_failed",
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}
