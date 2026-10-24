import { type ErrorContext, fromHttp, fromNetwork, fromStreamError, LlmError } from "./errors";
import { parseSse } from "./sse";
import type {
  FetchLike,
  FinishReason,
  GenerateRequest,
  ModelInfo,
  Provider,
  StreamEvent,
  TestResult,
  Usage,
} from "./types";
import { joinUrl, normalizeBaseUrl } from "./util";

export interface OpenAiCompatibleConfig {
  /** `http://localhost:5001` is enough; `/v1` is added when the address has no path. */
  baseUrl: string;
  apiKey?: string;
  /** Shown in messages, e.g. "KoboldCpp". Defaults to the host name. */
  label?: string;
  headers?: Record<string, string>;
  /** Ask for token usage in the final chunk. Off by default: some local servers reject the option. */
  includeUsage?: boolean;
  fetch?: FetchLike;
}

const FINISH: Record<string, FinishReason> = { stop: "stop", length: "length" };

interface Chunk {
  error?: { message?: string; type?: string } | string;
  choices?: Array<{
    delta?: { content?: string | null };
    text?: string | null;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Talks to anything that speaks the OpenAI chat-completions dialect: KoboldCpp, Ollama,
 * LM Studio, OpenRouter, OpenAI itself. Sampler settings outside the standard set are passed
 * through untouched via `params.extra`.
 */
export function createOpenAiCompatible(config: OpenAiCompatibleConfig): Provider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const label = config.label ?? (safeHost(baseUrl) || "the model server");
  const ctx = (model?: string): ErrorContext => ({ label, baseUrl, model });

  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...config.headers,
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
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const rows = json.data ?? json.models ?? [];
    return rows
      .map((m) => ({ id: m.id ?? (m as { name?: string }).name ?? "" }))
      .filter((m) => m.id);
  }

  async function* stream(req: GenerateRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const p = req.params ?? {};
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
      ...(p.topP !== undefined ? { top_p: p.topP } : {}),
      ...(p.topK !== undefined ? { top_k: p.topK } : {}),
      ...(p.maxTokens !== undefined ? { max_tokens: p.maxTokens } : {}),
      ...(p.stop?.length ? { stop: p.stop } : {}),
      ...(config.includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...p.extra,
    };

    try {
      let res: Response;
      try {
        res = await doFetch(joinUrl(baseUrl, "chat/completions"), {
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
      let usage: Usage | undefined;
      for await (const msg of parseSse(res.body)) {
        if (msg.data === "[DONE]") break;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(msg.data) as Chunk;
        } catch {
          continue; // keep-alives and partial junk from some servers
        }
        if (chunk.error) {
          const message =
            typeof chunk.error === "string"
              ? chunk.error
              : (chunk.error.message ?? "unknown error");
          throw fromStreamError(
            typeof chunk.error === "string" ? undefined : chunk.error.type,
            message,
            ctx(req.model),
          );
        }
        const choice = chunk.choices?.[0];
        const text = choice?.delta?.content ?? choice?.text;
        if (text) yield { type: "text", text };
        if (choice?.finish_reason) finish = FINISH[choice.finish_reason] ?? "other";
        if (chunk.usage) {
          usage = {
            ...(chunk.usage.prompt_tokens !== undefined
              ? { inputTokens: chunk.usage.prompt_tokens }
              : {}),
            ...(chunk.usage.completion_tokens !== undefined
              ? { outputTokens: chunk.usage.completion_tokens }
              : {}),
          };
        }
      }
      yield { type: "end", finishReason: finish, ...(usage ? { usage } : {}), warnings: [] };
    } catch (e) {
      throw fromNetwork(e, ctx(req.model));
    }
  }

  async function test(signal?: AbortSignal): Promise<TestResult> {
    try {
      const models = await listModels(signal);
      return {
        ok: true,
        message: models.length
          ? `Connected to ${label}. ${models.length} model${models.length === 1 ? "" : "s"} available.`
          : `Connected to ${label}, but it reports no models. Load one first.`,
        models,
      };
    } catch (e) {
      return { ok: false, message: fromNetwork(e, ctx()).userMessage };
    }
  }

  return { kind: "openai-compatible", label, stream, listModels, test };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
