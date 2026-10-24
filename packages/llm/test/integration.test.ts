import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnthropic, createOpenAiCompatible, generateText, LlmError } from "../src";

/** Real sockets, real `fetch`: proves streaming and error shapes against actual node networking. */
let server: Server;
let base: string;
const seen: Array<{ url: string; auth: string | undefined; body: unknown }> = [];

const messages = [{ role: "user" as const, content: "hi" }];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  seen.push({ url: req.url ?? "", auth: req.headers.authorization, body });

  if (req.headers.authorization === "Bearer wrong") {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Incorrect API key" } }));
    return;
  }
  if (req.url === "/v1/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Deliberately cut events mid-line across separate socket writes.
    const frames = [
      'data: {"choices":[{"delta":{"con',
      'tent":"The tide "}}]}\n\ndata: {"choices":[{"delta":{"content":"turns."}}]}\n',
      '\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ];
    for (const f of frames) {
      res.write(f);
      await pause(10);
    }
    res.end();
    return;
  }
  if (req.url === "/v1/messages") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\r\n\r\n',
    );
    await pause(10);
    res.end('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\r\n\r\n');
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
}

beforeAll(async () => {
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe("real network", () => {
  it("streams an OpenAI-compatible reply split across socket writes", async () => {
    const p = createOpenAiCompatible({ baseUrl: base, apiKey: "good" });
    const { text, end } = await generateText(p, { model: "m", messages });
    expect(text).toBe("The tide turns.");
    expect(end?.finishReason).toBe("stop");
    const call = seen.find((s) => s.url === "/v1/chat/completions");
    expect(call?.auth).toBe("Bearer good");
    expect(call?.body).toMatchObject({ model: "m", stream: true });
  });

  it("streams an Anthropic-style reply over real CRLF framing", async () => {
    const p = createAnthropic({ apiKey: "k", baseUrl: `${base}/v1` });
    const { text } = await generateText(p, { model: "claude-x", messages });
    expect(text).toBe("Hello");
  });

  it("maps a real 401 and a real 404", async () => {
    const bad = createOpenAiCompatible({ baseUrl: base, apiKey: "wrong", label: "TestServer" });
    await expect(generateText(bad, { model: "m", messages })).rejects.toMatchObject({
      code: "unauthorized",
    });
    const gone = createOpenAiCompatible({ baseUrl: `${base}/nope`, label: "TestServer" });
    await expect(generateText(gone, { model: "ghost", messages })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("reports a closed port as unreachable, in plain language", async () => {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));

    const p = createOpenAiCompatible({ baseUrl: `http://127.0.0.1:${port}`, label: "KoboldCpp" });
    const err = await generateText(p, { model: "m", messages }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("unreachable");
    expect((err as LlmError).userMessage).toContain(
      `Can't reach KoboldCpp at http://127.0.0.1:${port}/v1`,
    );
    const test = await p.test();
    expect(test.ok).toBe(false);
  });

  it("stops promptly when the caller aborts mid-stream", async () => {
    const slow = createServer(async (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      await pause(2000);
      res.end();
    });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const port = (slow.address() as AddressInfo).port;
    const p = createOpenAiCompatible({ baseUrl: `http://127.0.0.1:${port}` });
    const controller = new AbortController();
    const started = Date.now();
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const ev of p.stream({ model: "m", messages }, controller.signal)) {
          if (ev.type === "text") {
            got.push(ev.text);
            controller.abort();
          }
        }
      })(),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(got).toEqual(["first"]);
    expect(Date.now() - started).toBeLessThan(1500);
    slow.closeAllConnections();
    await new Promise((r) => slow.close(r));
  });
});
