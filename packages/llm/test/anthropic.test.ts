import { describe, expect, it } from "vitest";
import { createAnthropic, generateText, LlmError, toAnthropicMessages } from "../src";
import { collect, json, mockFetch, sse, streamResponse } from "./helpers";

const text = (t: string) =>
  sse(
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } },
    "content_block_delta",
  );

function provider(...responses: Parameters<typeof mockFetch>) {
  const m = mockFetch(...responses);
  return { ...m, p: createAnthropic({ apiKey: "sk-ant-test", fetch: m.fetch }) };
}

const messages = [
  { role: "system" as const, content: "You are the host." },
  { role: "user" as const, content: "<player_input>Hi</player_input>" },
];

describe("toAnthropicMessages", () => {
  it("pulls system messages out and keeps the conversation", () => {
    expect(toAnthropicMessages(messages)).toEqual({
      system: "You are the host.",
      messages: [{ role: "user", content: "<player_input>Hi</player_input>" }],
    });
  });

  it("merges consecutive same-role messages", () => {
    const out = toAnthropicMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ]);
    expect(out.messages).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ]);
  });

  it("prepends a user turn when the story opens with a host line", () => {
    const out = toAnthropicMessages([
      { role: "system", content: "S" },
      { role: "assistant", content: "Opening scene." },
      { role: "user", content: "I look." },
    ]);
    expect(out.messages[0]).toEqual({ role: "user", content: "(The story begins.)" });
    expect(out.messages).toHaveLength(3);
  });
});

describe("anthropic stream", () => {
  const events = [
    sse({ type: "message_start", message: { usage: { input_tokens: 90, output_tokens: 1 } } }),
    sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    sse({ type: "ping" }),
    text("The lamp "),
    text("gutters."),
    sse({ type: "content_block_stop", index: 0 }),
    sse({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 12 },
    }),
    sse({ type: "message_stop" }),
  ];

  it("assembles text, finish reason and usage", async () => {
    const { p } = provider(streamResponse(events));
    const { text: out, end } = await generateText(p, { model: "claude-x", messages });
    expect(out).toBe("The lamp gutters.");
    expect(end).toEqual({
      type: "end",
      finishReason: "stop",
      usage: { inputTokens: 90, outputTokens: 12 },
      warnings: [],
    });
  });

  it("maps max_tokens to a length finish", async () => {
    const { p } = provider(
      streamResponse([
        text("x"),
        sse({ type: "message_delta", delta: { stop_reason: "max_tokens" } }),
      ]),
    );
    expect((await generateText(p, { model: "m", messages })).end?.finishReason).toBe("length");
  });

  it("sends the key and version headers, a default max_tokens, and the system prompt separately", async () => {
    const { p, calls } = provider(streamResponse([sse({ type: "message_stop" })]));
    await collect(p.stream({ model: "claude-x", messages, params: { stop: ["END"], topK: 5 } }));
    const call = calls[0];
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call?.init.headers).toMatchObject({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
    });
    expect(call?.json()).toEqual({
      model: "claude-x",
      max_tokens: 1024,
      stream: true,
      system: "You are the host.",
      messages: [{ role: "user", content: "<player_input>Hi</player_input>" }],
      top_k: 5,
      stop_sequences: ["END"],
    });
  });

  it("drops settings Claude cannot take and says so", async () => {
    const { p, calls } = provider(streamResponse([text("ok"), sse({ type: "message_stop" })]));
    const { end } = await generateText(p, {
      model: "m",
      messages,
      params: { temperature: 0.9, topP: 0.95, maxTokens: 300, extra: { min_p: 0.05, mirostat: 2 } },
    });
    const body = calls[0]?.json() ?? {};
    expect(body).toMatchObject({ temperature: 0.9, max_tokens: 300 });
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("min_p");
    expect(end?.warnings).toHaveLength(2);
    expect(end?.warnings.join(" ")).toMatch(/min_p, mirostat/);
  });

  it("turns in-stream error events into plain-language errors", async () => {
    const { p } = provider(
      streamResponse([
        text("Hi"),
        sse({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      ]),
    );
    const err = await collect(p.stream({ model: "m", messages })).catch(
      (e: unknown) => e as LlmError,
    );
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("server");
  });

  it("explains a bad key", async () => {
    const { p } = provider(
      json(
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        401,
      ),
    );
    const err = await collect(p.stream({ model: "m", messages })).catch(
      (e: unknown) => e as LlmError,
    );
    expect((err as LlmError).code).toBe("unauthorized");
    expect((err as LlmError).userMessage).toMatch(/Anthropic rejected the API key/);
  });
});

describe("anthropic models and test()", () => {
  it("lists models with display names", async () => {
    const { p, calls } = provider(json({ data: [{ id: "claude-x", display_name: "Claude X" }] }));
    expect(await p.listModels()).toEqual([{ id: "claude-x", name: "Claude X" }]);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models");
  });

  it("test() reports a rejected key without throwing", async () => {
    const { p } = provider(json({ error: { message: "nope" } }, 401));
    const r = await p.test();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rejected the API key/);
  });
});
