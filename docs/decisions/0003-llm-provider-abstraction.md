# ADR-0003: Provider adapter layer over OpenAI-compatible API and Anthropic

- Status: Proposed; stack parts superseded by [ADR-0006](0006-stack-revision.md)
- Date: 2026-10-25
- Related: [tech-stack](../tech-stack.md)

## Context
References (SillyTavern, KoboldAI) win on letting users bring any backend; the baseline editor is wired to Mistral agents and a manual Claude queue. Requirement N-06 forbids vendor lock-in.

## Decision
`packages/llm` exposes one interface: `stream({ messages, model, params, signal }) -> AsyncIterable<token>` plus `listModels()` and `test()`.
Adapters: `openai-compatible` (base URL + optional key: KoboldCpp, Ollama, LM Studio, OpenRouter, OpenAI), `anthropic`, and `mistral` (ported from the baseline). Presets map friendly names to sampler params. Keys are read from the OS keychain or an ignored local file, never from the world folder.

## Consequences
+ Any local or hosted model works; the host and rules checker use the same interface.
+ Connection errors can be translated to plain language in one place (UX principle 8).
- Sampler differences between backends need a small capability table.

## Alternatives considered
Hard-coding one vendor SDK; using LangChain (heavier than the problem needs).
