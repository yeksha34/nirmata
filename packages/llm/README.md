# @nirmata/llm

One streaming interface over every model backend ([ADR-0003](../../docs/decisions/0003-llm-provider-abstraction.md), [ADR-0006](../../docs/decisions/0006-stack-revision.md)). No SDKs: plain `fetch` plus a small SSE reader, so sampler settings reach the backend untouched.

| Export | What it is |
|---|---|
| `createOpenAiCompatible({ baseUrl, apiKey? })` | KoboldCpp, Ollama, LM Studio, OpenRouter, OpenAI. `http://localhost:5001` works; `/v1` is added. `params.extra` (min_p, DRY, mirostat, grammar, logit_bias ...) is sent as-is |
| `createAnthropic({ apiKey })` | Claude. Splits out the system prompt, fixes turn alternation, drops settings Claude cannot take and reports them in `warnings` |
| `createFakeProvider(script)` | Replays recorded streams and records requests. Used by host, server and UI tests so nothing needs a GPU or key |
| `PRESETS`, `resolveParams` | `balanced` / `creative` / `strict` starting points, with per-field overrides |
| `LlmError` | Every failure. `code` for logic, `userMessage` for the player ("Can't reach KoboldCpp at ... make sure it is running"), `detail` for logs |
| `parseSse`, `generateText`, `normalizeBaseUrl` | Building blocks |

```ts
const model = createOpenAiCompatible({ baseUrl: "http://localhost:5001", label: "KoboldCpp" });
for await (const ev of model.stream({ model: "any", messages, params: resolveParams("balanced") })) {
  if (ev.type === "text") process.stdout.write(ev.text);
}
```

Cancel with an `AbortSignal`; a stopped generation throws `LlmError` with code `aborted`, which callers treat as "stopped", not "failed".

API keys are never read here: callers pass them in (the server reads them from the OS keychain, ADR-0006).

## Not here yet
- Real tokenizers (the core budget uses a conservative estimate), Ollama native model management, bundled local inference (`node-llama-cpp`), retries.
