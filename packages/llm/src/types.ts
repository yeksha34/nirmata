import type { ChatMessage } from "@nirmata/core";

export type { ChatMessage };

/**
 * Sampler settings every adapter understands. Anything backend-specific (min_p, DRY, mirostat,
 * grammar, logit_bias ...) goes in `extra` and is passed straight through to backends that accept
 * it, which is the reason this layer exists instead of a generic SDK.
 */
export interface SamplerParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stop?: string[];
  extra?: Record<string, unknown>;
}

export interface GenerateRequest {
  model: string;
  messages: ChatMessage[];
  params?: SamplerParams;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export type FinishReason = "stop" | "length" | "other";

export type StreamEvent =
  | { type: "text"; text: string }
  | {
      type: "end";
      finishReason: FinishReason;
      usage?: Usage;
      /** Settings the backend cannot honour and that were therefore dropped. */
      warnings: string[];
    };

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface TestResult {
  ok: boolean;
  /** Always plain language, safe to show the player. */
  message: string;
  models?: ModelInfo[];
}

export interface Provider {
  readonly kind: string;
  /** Human name used in messages, e.g. "KoboldCpp at localhost:5001". */
  readonly label: string;
  stream(req: GenerateRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  test(signal?: AbortSignal): Promise<TestResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
