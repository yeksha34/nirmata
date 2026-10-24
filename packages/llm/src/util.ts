import type { GenerateRequest, Provider, StreamEvent } from "./types";

/** Reads a whole stream into one string plus its closing event. Handy for summaries and tests. */
export async function generateText(
  provider: Provider,
  req: GenerateRequest,
  signal?: AbortSignal,
): Promise<{ text: string; end: Extract<StreamEvent, { type: "end" }> | undefined }> {
  let text = "";
  let end: Extract<StreamEvent, { type: "end" }> | undefined;
  for await (const ev of provider.stream(req, signal)) {
    if (ev.type === "text") text += ev.text;
    else end = ev;
  }
  return { text, end };
}

/**
 * Local servers publish the chat API under `/v1`; people paste just `http://localhost:5001`.
 * Add `/v1` when the address has no path, and drop trailing slashes either way.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path === "" ? "/v1" : path}`;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
