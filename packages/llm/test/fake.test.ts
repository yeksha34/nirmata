import { describe, expect, it } from "vitest";
import { createFakeProvider, generateText, LlmError, PRESETS, resolveParams } from "../src";
import { collect } from "./helpers";

const req = { model: "fake-model", messages: [{ role: "user" as const, content: "hi" }] };

describe("createFakeProvider", () => {
  it("replays chunks in order and records the request", async () => {
    const p = createFakeProvider({ chunks: ["Hel", "lo"], usage: { outputTokens: 2 } });
    const { text, end } = await generateText(p, req);
    expect(text).toBe("Hello");
    expect(end).toEqual({
      type: "end",
      finishReason: "stop",
      usage: { outputTokens: 2 },
      warnings: [],
    });
    expect(p.requests).toEqual([req]);
  });

  it("walks through scripts and repeats the last one", async () => {
    const p = createFakeProvider([{ chunks: ["one"] }, { chunks: ["two"] }]);
    const texts = [];
    for (let i = 0; i < 3; i++) texts.push((await generateText(p, req)).text);
    expect(texts).toEqual(["one", "two", "two"]);
  });

  it("can script by request", async () => {
    const p = createFakeProvider((r) => ({ chunks: [`echo:${r.messages[0]?.content}`] }));
    expect((await generateText(p, req)).text).toBe("echo:hi");
  });

  it("can fail immediately or mid-stream", async () => {
    const boom = new LlmError("server", "down");
    await expect(collect(createFakeProvider({ error: boom }).stream(req))).rejects.toBe(boom);

    const seen: string[] = [];
    const p = createFakeProvider({ chunks: ["a", "b"], errorAfter: boom });
    await expect(
      (async () => {
        for await (const ev of p.stream(req)) if (ev.type === "text") seen.push(ev.text);
      })(),
    ).rejects.toBe(boom);
    expect(seen).toEqual(["a", "b"]);
  });

  it("stops when aborted", async () => {
    const c = new AbortController();
    const p = createFakeProvider({ chunks: ["a", "b", "c"] });
    const seen: string[] = [];
    const run = (async () => {
      for await (const ev of p.stream(req, c.signal)) {
        if (ev.type === "text") {
          seen.push(ev.text);
          c.abort();
        }
      }
    })();
    await expect(run).rejects.toMatchObject({ code: "aborted" });
    expect(seen).toEqual(["a"]);
  });

  it("test() and listModels() always succeed", async () => {
    const p = createFakeProvider({ chunks: [] });
    expect((await p.test()).ok).toBe(true);
    expect(await p.listModels()).toEqual([{ id: "fake-model", name: "Fake model" }]);
  });
});

describe("presets", () => {
  it("resolves a preset with overrides and merges extra settings", () => {
    expect(resolveParams("strict")).toEqual(PRESETS.strict);
    const creative = resolveParams("creative", {
      temperature: 1.3,
      extra: { dry_multiplier: 0.8 },
    });
    expect(creative).toMatchObject({
      temperature: 1.3,
      topP: 0.98,
      extra: { min_p: 0.05, dry_multiplier: 0.8 },
    });
  });
});
