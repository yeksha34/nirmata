import { LlmError } from "./errors";
import type {
  FinishReason,
  GenerateRequest,
  ModelInfo,
  Provider,
  StreamEvent,
  TestResult,
  Usage,
} from "./types";

export type FakeScript =
  | { chunks: string[]; finishReason?: FinishReason; usage?: Usage; warnings?: string[] }
  | { error: LlmError }
  /** Emit these chunks, then fail mid-stream (a dropped connection). */
  | { chunks: string[]; errorAfter: LlmError };

export interface FakeProvider extends Provider {
  /** Every request received, in order, for assertions. */
  readonly requests: GenerateRequest[];
}

/**
 * A provider that replays recorded token streams. Lets the host, server and UI tests run end to
 * end deterministically, with no GPU, network or API key. Scripts are consumed in order; the last
 * one repeats if the test makes more calls than scripts. Pass a function to script by request.
 */
export function createFakeProvider(
  scripts: FakeScript | FakeScript[] | ((req: GenerateRequest, call: number) => FakeScript),
  options: { label?: string; models?: ModelInfo[] } = {},
): FakeProvider {
  const requests: GenerateRequest[] = [];
  const models = options.models ?? [{ id: "fake-model", name: "Fake model" }];

  const pick = (req: GenerateRequest, call: number): FakeScript => {
    if (typeof scripts === "function") return scripts(req, call);
    if (!Array.isArray(scripts)) return scripts;
    const script = scripts[Math.min(call, scripts.length - 1)];
    if (!script) throw new Error("createFakeProvider needs at least one script");
    return script;
  };

  async function* stream(req: GenerateRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const call = requests.length;
    requests.push(structuredClone(req));
    const script = pick(req, call);
    const aborted = () => new LlmError("aborted", "Stopped.");

    if (signal?.aborted) throw aborted();
    if ("error" in script) throw script.error;

    for (const text of script.chunks) {
      if (signal?.aborted) throw aborted();
      yield { type: "text", text };
      // Yield to the event loop so abort signals and consumers interleave like a real stream.
      await Promise.resolve();
    }
    if ("errorAfter" in script) throw script.errorAfter;
    yield {
      type: "end",
      finishReason: script.finishReason ?? "stop",
      ...(script.usage ? { usage: script.usage } : {}),
      warnings: script.warnings ?? [],
    };
  }

  return {
    kind: "fake",
    label: options.label ?? "the fake model",
    requests,
    stream,
    listModels: async () => models,
    test: async (): Promise<TestResult> => ({
      ok: true,
      message: "Connected to the fake model.",
      models,
    }),
  };
}
