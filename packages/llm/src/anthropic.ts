import { type ErrorContext, fromHttp, fromNetwork, fromStreamError, LlmError } from "./errors";
import { parseSse } from "./sse";
import type {
  ChatMessage,
  FetchLike,
  FinishReason,
  GenerateRequest,
  ModelInfo,
  Provider,
  StreamEvent,
  TestResult,
  Usage,
} from "./types";
import { joinUrl } from "./util";

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  /** Shown in messages. Defaults to "Anthropic". */
  label?: string;
  version?: string;
  fetch?: FetchLike;
}

const DEFAULT_MAX_TOKENS = 1024;
const OPENING_PROMPT = "(The adventure begins.)";

export interface AnthropicMessages {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Anthropic takes the system prompt separately and requires the conversation to alternate and
 * start with the user. Merge same-role neighbours and, when the story opens with a host line,
 * prepend a neutral user turn so the opening scene is not rejected.
 */
export function toAnthropicMessages(messages: readonly ChatMessage[]): AnthropicMessages {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const merged: AnthropicMessages["messages"] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }
  if (merged[0]?.role !== "user") merged.unshift({ role: "user", content: OPENING_PROMPT });
  return { system, messages: merged };
}

const STOP: Record<string, FinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
};

interface AnthropicEvent {
  type: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

export function createAnthropic(config: AnthropicConfig): Provider {
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const label = config.label ?? "Anthropic";
  const ctx = (model?: string): ErrorContext => ({ label, baseUrl, model });
  const headers = () => ({
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": config.version ?? "2023-06-01",
  });

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    let res: Response;
    try {
      res = await doFetch(joinUrl(baseUrl, "models"), {
        headers: headers(),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      throw fromNetwork(e, ctx());
    }
    if (!res.ok) throw fromHttp(res.status, await res.text().catch(() => ""), ctx());
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id?: string; display_name?: string }>;
    };
    return (json.data ?? [])
      .filter((m) => m.id)
      .map((m) => ({ id: m.id as string, ...(m.display_name ? { name: m.display_name } : {}) }));
  }

  async function* stream(req: GenerateRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const p = req.params ?? {};
    const warnings: string[] = [];
    const extraKeys = Object.keys(p.extra ?? {});
    if (extraKeys.length) {
      warnings.push(`${label} ignores these sampler settings: ${extraKeys.join(", ")}.`);
    }
    // Newer Claude models reject temperature and top_p together; temperature wins.
    const dropTopP = p.temperature !== undefined && p.topP !== undefined;
    if (dropTopP)
      warnings.push(
        "Sent temperature only: Claude models do not accept temperature and top_p together.",
      );

    const { system, messages } = toAnthropicMessages(req.messages);
    const body = {
      model: req.model,
      max_tokens: p.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      messages,
      ...(system ? { system } : {}),
      ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
      ...(p.topP !== undefined && !dropTopP ? { top_p: p.topP } : {}),
      ...(p.topK !== undefined ? { top_k: p.topK } : {}),
      ...(p.stop?.length ? { stop_sequences: p.stop } : {}),
    };

    try {
      let res: Response;
      try {
        res = await doFetch(joinUrl(baseUrl, "messages"), {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
      } catch (e) {
        throw fromNetwork(e, ctx(req.model));
      }
      if (!res.ok) throw fromHttp(res.status, await res.text().catch(() => ""), ctx(req.model));
      if (!res.body) throw new LlmError("bad_response", `${label} sent an empty reply.`);

      let finish: FinishReason = "stop";
      const usage: Usage = {};
      for await (const msg of parseSse(res.body)) {
        let ev: AnthropicEvent;
        try {
          ev = JSON.parse(msg.data) as AnthropicEvent;
        } catch {
          continue;
        }
        switch (ev.type) {
          case "message_start":
            if (ev.message?.usage?.input_tokens !== undefined)
              usage.inputTokens = ev.message.usage.input_tokens;
            break;
          case "content_block_delta":
            if (ev.delta?.type === "text_delta" && ev.delta.text)
              yield { type: "text", text: ev.delta.text };
            break;
          case "message_delta":
            if (ev.delta?.stop_reason) finish = STOP[ev.delta.stop_reason] ?? "other";
            if (ev.usage?.output_tokens !== undefined) usage.outputTokens = ev.usage.output_tokens;
            break;
          case "error":
            throw fromStreamError(
              ev.error?.type,
              ev.error?.message ?? "unknown error",
              ctx(req.model),
            );
        }
      }
      yield {
        type: "end",
        finishReason: finish,
        ...(usage.inputTokens !== undefined || usage.outputTokens !== undefined ? { usage } : {}),
        warnings,
      };
    } catch (e) {
      throw fromNetwork(e, ctx(req.model));
    }
  }

  async function test(signal?: AbortSignal): Promise<TestResult> {
    try {
      const models = await listModels(signal);
      return {
        ok: true,
        message: `Connected to ${label}. ${models.length} models available.`,
        models,
      };
    } catch (e) {
      return { ok: false, message: fromNetwork(e, ctx()).userMessage };
    }
  }

  return { kind: "anthropic", label, stream, listModels, test };
}
