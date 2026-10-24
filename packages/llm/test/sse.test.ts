import { describe, expect, it } from "vitest";
import { parseSse } from "../src";
import { collect, streamResponse } from "./helpers";

const parse = (chunks: string[]) =>
  collect(parseSse(streamResponse(chunks).body as ReadableStream<Uint8Array>));

describe("parseSse", () => {
  it("reads simple events", async () => {
    expect(await parse(["data: a\n\ndata: b\n\n"])).toEqual([{ data: "a" }, { data: "b" }]);
  });

  it("handles chunks split mid-line and mid-field", async () => {
    expect(await parse(["da", "ta: hel", "lo\n", "\nda", "ta: x\n\n"])).toEqual([
      { data: "hello" },
      { data: "x" },
    ]);
  });

  it("handles CRLF, including a CR and LF that arrive in different chunks", async () => {
    expect(await parse(["data: a\r\n\r\ndata: b\r", "\n\r\n"])).toEqual([
      { data: "a" },
      { data: "b" },
    ]);
  });

  it("joins multiple data lines and keeps the event name", async () => {
    expect(await parse(["event: message_delta\ndata: one\ndata: two\n\n"])).toEqual([
      { event: "message_delta", data: "one\ntwo" },
    ]);
  });

  it("ignores comments and events without data", async () => {
    expect(await parse([": keep-alive\n\nevent: ping\n\ndata: ok\n\n"])).toEqual([{ data: "ok" }]);
  });

  it("delivers a final event that was never terminated", async () => {
    expect(await parse(["data: tail"])).toEqual([{ data: "tail" }]);
  });

  it("passes [DONE] through as plain data for the adapter to interpret", async () => {
    expect(await parse(["data: [DONE]\n\n"])).toEqual([{ data: "[DONE]" }]);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("data: café \u{1F31F}\n\n");
    const cut = 10;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    expect(await collect(parseSse(body))).toEqual([{ data: "café \u{1F31F}" }]);
  });

  it("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode("data: x\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of parseSse(body)) break;
    expect(cancelled).toBe(true);
  });
});
