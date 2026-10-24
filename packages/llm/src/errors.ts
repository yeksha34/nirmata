export type LlmErrorCode =
  | "unreachable"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "context_too_long"
  | "bad_request"
  | "server"
  | "aborted"
  | "bad_response";

/**
 * Every failure out of a provider is one of these. `userMessage` is written for the player
 * (what happened and what to try); `detail` keeps the raw cause for logs and the advanced view.
 */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    readonly userMessage: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(userMessage);
    this.name = "LlmError";
  }
}

export interface ErrorContext {
  label: string;
  baseUrl: string;
  model?: string | undefined;
}

const isLocal = (url: string) =>
  /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0|192\.168\.|10\.)/i.test(url);

/** Pulls the human message out of the several JSON error shapes backends use. */
export function extractMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const err = json.error;
    if (typeof err === "string") return err;
    if (
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      return (err as { message: string }).message;
    }
    if (typeof json.message === "string") return json.message;
    if (typeof json.detail === "string") return json.detail;
  } catch {
    // not JSON: fall through to the raw text
  }
  return trimmed.slice(0, 300);
}

const CONTEXT_HINT = /context|too long|too many tokens|maximum.*tokens|token limit/i;

export function fromHttp(status: number, body: string, ctx: ErrorContext): LlmError {
  const detail = extractMessage(body);
  const raw = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  switch (true) {
    case status === 401:
      return new LlmError(
        "unauthorized",
        `${ctx.label} rejected the API key. Check or re-enter it in Settings.`,
        raw,
        status,
      );
    case status === 403:
      return new LlmError(
        "forbidden",
        `${ctx.label} refused the request (permission denied). Check that your key has access to this model.`,
        raw,
        status,
      );
    case status === 404:
      return new LlmError(
        "not_found",
        ctx.model
          ? `${ctx.label} does not have a model called "${ctx.model}", or the address is wrong. Pick another model in Settings.`
          : `${ctx.label} did not recognise that address (${ctx.baseUrl}). Check the address in Settings.`,
        raw,
        status,
      );
    case status === 429:
      return new LlmError(
        "rate_limited",
        `${ctx.label} says you are sending requests too fast or are out of quota. Wait a moment and try again.`,
        raw,
        status,
      );
    case status === 400 || status === 413 || status === 422:
      if (CONTEXT_HINT.test(detail)) {
        return new LlmError(
          "context_too_long",
          "The prompt is longer than this model can read. Lower the context size in Settings, or shorten your rules.",
          raw,
          status,
        );
      }
      return new LlmError(
        "bad_request",
        `${ctx.label} rejected the request${detail ? `: ${detail}` : "."}`,
        raw,
        status,
      );
    case status >= 500:
      return new LlmError(
        "server",
        `${ctx.label} had a problem on its side (error ${status}). Try again; if it keeps happening, check its logs.`,
        raw,
        status,
      );
    default:
      return new LlmError(
        "bad_response",
        `${ctx.label} answered with an unexpected status (${status}).`,
        raw,
        status,
      );
  }
}

export function fromNetwork(err: unknown, ctx: ErrorContext): LlmError {
  if (err instanceof LlmError) return err;
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError") return new LlmError("aborted", "Stopped.", String(err));
  const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
  const detail = [cause?.code, cause?.message ?? (err as Error | null)?.message]
    .filter(Boolean)
    .join(": ");
  const hint = isLocal(ctx.baseUrl)
    ? " If you use KoboldCpp, Ollama or LM Studio, make sure it is running and the port matches."
    : " Check your internet connection and the address in Settings.";
  return new LlmError(
    "unreachable",
    `Can't reach ${ctx.label} at ${ctx.baseUrl}.${hint}`,
    detail || String(err),
  );
}

/** Errors reported inside an otherwise successful stream (HTTP 200 followed by an error event). */
export function fromStreamError(
  kind: string | undefined,
  message: string,
  ctx: ErrorContext,
): LlmError {
  const status =
    kind === "authentication_error"
      ? 401
      : kind === "permission_error"
        ? 403
        : kind === "not_found_error"
          ? 404
          : kind === "rate_limit_error"
            ? 429
            : kind === "invalid_request_error"
              ? 400
              : kind === "overloaded_error" || kind === "api_error"
                ? 500
                : 0;
  if (status) return fromHttp(status, JSON.stringify({ error: { message } }), ctx);
  return new LlmError("bad_response", `${ctx.label} reported an error: ${message}`, message);
}
