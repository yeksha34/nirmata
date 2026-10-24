import type { FetchLike } from "../src";

const encoder = new TextEncoder();

/** A streaming Response whose body arrives as the given text chunks, exactly as split. */
export function streamResponse(chunks: string[], init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

export const sse = (data: unknown, event?: string): string =>
  `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

export interface Call {
  url: string;
  init: RequestInit;
  json: () => Record<string, unknown>;
}

/** Records calls and answers with the queued responses (or the last one repeatedly). */
export function mockFetch(...responses: Array<Response | (() => Response) | Error>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    calls.push({
      url,
      init,
      json: () => JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
    });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    if (!next) throw new Error("mockFetch has no response queued");
    // A Response body can be read once; clone so a repeated entry keeps working.
    return next.clone();
  };
  return { fetch, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

/** What node's fetch throws when nothing is listening on the port. */
export function connectionRefused(): TypeError {
  const err = new TypeError("fetch failed");
  (err as TypeError & { cause: unknown }).cause = {
    code: "ECONNREFUSED",
    message: "connect ECONNREFUSED 127.0.0.1:5001",
  };
  return err;
}
