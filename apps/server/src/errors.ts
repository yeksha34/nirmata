import { formatIssues, PermissionError } from "@nirmata/core";
import { HostError } from "@nirmata/host";
import { ZodError } from "zod";

/** A problem with the request itself, not with the story. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface ErrorBody {
  error: { code: string; message: string };
}

const STATUS: Record<HostError["code"], 400 | 403 | 409 | 500> = {
  busy: 409,
  persist: 500,
  empty_reply: 409,
  nothing_to_do: 400,
  bad_state: 409,
  judge_failed: 500,
  plot_failed: 500,
  forbidden: 403,
  invalid_card: 400,
  age_unconfirmed: 400,
  bad_nickname: 400,
  board: 400,
};

/**
 * What a caller is told about a failure. Every message is plain language; nothing internal
 * (stack traces, file paths, provider responses) leaves the server.
 */
export function describeError(e: unknown): {
  status: 400 | 401 | 403 | 404 | 409 | 500;
  body: ErrorBody;
} {
  if (e instanceof HttpError) return { status: e.status, body: fail(e.code, e.message) };
  if (e instanceof HostError) return { status: STATUS[e.code], body: fail(e.code, e.message) };
  if (e instanceof PermissionError) return { status: 403, body: fail("forbidden", e.message) };
  if (e instanceof ZodError) {
    return {
      status: 400,
      body: fail("invalid_request", `That request is not right: ${formatIssues(e).join("; ")}`),
    };
  }
  return {
    status: 500,
    body: fail("unexpected", "Something went wrong on the server. Try again."),
  };
}

function fail(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}
