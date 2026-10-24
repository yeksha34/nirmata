export interface SseMessage {
  event?: string;
  data: string;
}

/**
 * Minimal, forgiving Server-Sent Events reader for `fetch` response bodies.
 * Handles chunks split anywhere (mid-line, between CR and LF), CRLF/LF/CR endings, comments,
 * multi-line `data:` fields, and a final unterminated event. Releases the reader on early exit.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];

  const flush = (): SseMessage | undefined => {
    if (!data.length) {
      event = undefined;
      return undefined;
    }
    const msg: SseMessage = { data: data.join("\n"), ...(event !== undefined ? { event } : {}) };
    event = undefined;
    data = [];
    return msg;
  };

  const handleLine = (line: string): SseMessage | undefined => {
    if (line === "") return flush();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    return undefined;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch !== "\n" && ch !== "\r") continue;
        // A trailing CR may be the first half of CRLF: wait for the next chunk.
        if (ch === "\r" && i === buffer.length - 1) break;
        const msg = handleLine(buffer.slice(start, i));
        if (ch === "\r" && buffer[i + 1] === "\n") i++;
        start = i + 1;
        if (msg) yield msg;
      }
      buffer = buffer.slice(start);
    }
    buffer += decoder.decode();
    if (buffer) {
      const msg = handleLine(buffer.replace(/\r$/, ""));
      if (msg) yield msg;
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}
