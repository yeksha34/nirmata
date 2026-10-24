import { describe, expect, it } from "vitest";
import { createOpenAiCompatible, generateText, LlmError, normalizeBaseUrl } from "../src";
import { collect, connectionRefused, json, mockFetch, sse, streamResponse } from "./helpers";

const delta = (content: string) => sse({ choices: [{ delta: { content } }] });
const messages = [
  { role: "system" as const, content: "S" },
  { role: "user" as const, content: "U" },
];

function provider(
  over: Partial<Parameters<typeof createOpenAiCompatible>[0]>,
  ...responses: Parameters<typeof mockFetch>
) {
  const m = mockFetch(...responses);
  return {
    ...m,
    p: createOpenAiCompatible({
      baseUrl: "http://localhost:5001",
      label: "KoboldCpp",
      fetch: m.fetch,
      ...over,
    }),
  };
}

describe("normalizeBaseUrl", () => {
  it("adds /v1 to bare addresses and trims slashes", () => {
    expect(normalizeBaseUrl("http://localhost:5001")).toBe("http://localhost:5001/v1");
    expect(normalizeBaseUrl("http://localhost:5001/")).toBe("http://localhost:5001/v1");
    expect(normalizeBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1");
    expect(normalizeBaseUrl(" https://api.openai.com/v1 ")).toBe("https://api.openai.com/v1");
  });
});

describe("openai-compatible stream", () => {
  it("assembles streamed text, reports the finish reason, and ignores keep-alives", async () => {
    const { p } = provider(
      {},
      streamResponse([
        delta("The door "),
        ": ping\n\n",
        delta("opens."),
        sse({ choices: [{ delta: {}, finish_reason: "length" }] }),
        sse("[DONE]"),
      ]),
    );
    const { text, end } = await generateText(p, { model: "m", messages });
    expect(text).toBe("The door opens.");
    expect(end).toEqual({ type: "end", finishReason: "length", warnings: [] });
  });

  it("sends the right URL, headers and body, passing extra sampler settings through", async () => {
    const { p, calls } = provider(
      { apiKey: "sk-test", includeUsage: true },
      streamResponse([sse("[DONE]")]),
    );
    await collect(
      p.stream({
        model: "mistral-7b",
        messages,
        params: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxTokens: 200,
          stop: ["\n\n"],
          extra: { min_p: 0.05, dry_multiplier: 0.8 },
        },
      }),
    );
    const call = calls[0];
    expect(call?.url).toBe("http://localhost:5001/v1/chat/completions");
    expect(call?.init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(call?.json()).toEqual({
      model: "mistral-7b",
      messages,
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      max_tokens: 200,
      stop: ["\n\n"],
      stream_options: { include_usage: true },
      min_p: 0.05,
      dry_multiplier: 0.8,
    });
  });

  it("omits the Authorization header when no key is set and unset params when none are given", async () => {
    const { p, calls } = provider({}, streamResponse([sse("[DONE]")]));
    await collect(p.stream({ model: "m", messages }));
    expect(calls[0]?.init.headers).not.toHaveProperty("Authorization");
    expect(Object.keys(calls[0]?.json() ?? {}).sort()).toEqual(["messages", "model", "stream"]);
  });

  it("reads usage from the final chunk", async () => {
    const { p } = provider(
      {},
      streamResponse([
        delta("Hi"),
        sse({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 4 } }),
        sse("[DONE]"),
      ]),
    );
    const { end } = await generateText(p, { model: "m", messages });
    expect(end?.usage).toEqual({ inputTokens: 120, outputTokens: 4 });
  });

  it("accepts the legacy `text` field and ignores unparsable lines", async () => {
    const { p } = provider(
      {},
      streamResponse([sse({ choices: [{ text: "old" }] }), "data: {not json\n\n", sse("[DONE]")]),
    );
    expect((await generateText(p, { model: "m", messages })).text).toBe("old");
  });
});

describe("openai-compatible errors", () => {
  const run = (response: Response | Error, model = "ghost") => {
    const { p } = provider({}, response);
    return collect(p.stream({ model, messages })).then(
      () => undefined,
      (e: unknown) => e as LlmError,
    );
  };

  it("explains an unreachable local server in plain language", async () => {
    const err = await run(connectionRefused());
    expect(err).toBeInstanceOf(LlmError);
    expect(err?.code).toBe("unreachable");
    expect(err?.userMessage).toContain("Can't reach KoboldCpp at http://localhost:5001/v1");
    expect(err?.userMessage).toContain("make sure it is running");
    expect(err?.detail).toContain("ECONNREFUSED");
  });

  it("maps common HTTP failures to actionable messages", async () => {
    const e401 = await run(json({ error: { message: "bad key" } }, 401));
    expect(e401?.code).toBe("unauthorized");
    expect(e401?.userMessage).toMatch(/rejected the API key/);

    const e404 = await run(json({ error: { message: "no such model" } }, 404));
    expect(e404?.code).toBe("not_found");
    expect(e404?.userMessage).toContain('"ghost"');

    expect((await run(json({}, 429)))?.code).toBe("rate_limited");
    expect((await run(new Response("boom", { status: 502 })))?.code).toBe("server");
  });

  it("recognises an over-long prompt", async () => {
    const err = await run(
      json({ error: { message: "This model's maximum context length is 4096 tokens" } }, 400),
    );
    expect(err?.code).toBe("context_too_long");
    expect(err?.userMessage).toMatch(/Lower the context size/);
  });

  it("surfaces other 400s with the server's own words", async () => {
    const err = await run(json({ error: "temperature must be <= 2" }, 400));
    expect(err?.code).toBe("bad_request");
    expect(err?.userMessage).toContain("temperature must be <= 2");
  });

  it("turns an error chunk inside a 200 stream into an error", async () => {
    const err = await run(
      streamResponse([
        delta("Hi"),
        sse({ error: { message: "out of memory", type: "server_error" } }),
      ]),
    );
    expect(err).toBeInstanceOf(LlmError);
    expect(err?.userMessage).toContain("out of memory");
  });

  it("reports a stopped generation as aborted, not as a failure", async () => {
    const controller = new AbortController();
    const m = mockFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(delta("partial")));
          controller.signal.addEventListener("abort", () =>
            c.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return new Response(body, { status: 200 });
    });
    const p = createOpenAiCompatible({ baseUrl: "http://localhost:5001", fetch: m.fetch });
    const got: string[] = [];
    const run = (async () => {
      for await (const ev of p.stream({ model: "m", messages }, controller.signal)) {
        if (ev.type === "text") {
          got.push(ev.text);
          controller.abort();
        }
      }
    })();
    await expect(run).rejects.toMatchObject({ code: "aborted" });
    expect(got).toEqual(["partial"]);
  });
});

describe("openai-compatible models and test()", () => {
  it("lists models from either the OpenAI or the Ollama-style shape", async () => {
    expect(await provider({}, json({ data: [{ id: "a" }, { id: "b" }] })).p.listModels()).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
    expect(await provider({}, json({ models: [{ name: "llama3" }] })).p.listModels()).toEqual([
      { id: "llama3" },
    ]);
  });

  it("test() succeeds with a model count", async () => {
    const r = await provider({}, json({ data: [{ id: "a" }] })).p.test();
    expect(r).toMatchObject({ ok: true, message: "Connected to KoboldCpp. 1 model available." });
  });

  it("test() tells the player to load a model when the list is empty", async () => {
    const r = await provider({}, json({ data: [] })).p.test();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Load one first/);
  });

  it("test() fails gracefully with a plain-language message", async () => {
    const r = await provider({}, connectionRefused()).p.test();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Can't reach KoboldCpp/);
  });
});
