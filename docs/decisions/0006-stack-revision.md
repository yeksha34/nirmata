# ADR-0006: Stack revision: headless core, event-sourced adventures, own model adapters, no desktop shell

- Status: Proposed
- Date: 2026-10-25
- Supersedes: the stack choices in [ADR-0001](0001-tech-stack.md) (state and API layer), [ADR-0003](0003-llm-provider-abstraction.md) (use of the Vercel AI SDK) and [ADR-0004](0004-desktop-shell-and-mobile.md) (Electron shell)
- Related: [tech-stack](../tech-stack.md)

## Context
The first stack proposal was shaped by the code that was copied in (a Node server, an Electron shell, a single-provider drafting path). The owner asked for the best stack, justified, without anchoring on what exists. Re-deriving from the requirements (explainable prompts, reversible turns, diffable files, power-user sampler control, fast first run, phone and friends, no cloud) changes several choices.

## Decision
1. `packages/core` is a pure, I/O-free TypeScript engine; disk, network and clock are adapters.
2. Adventures are an append-only **event tree** (`events.jsonl`, `id` + `parentId`); retry, undo and branch are head moves; state is a reducer.
3. Delivery is a Node LTS launcher serving the UI to a browser, installable as a PWA. **No desktop shell** in the first releases.
4. API is Hono typed RPC with SSE streaming; WebSocket only for presence. This replaces the REST + TanStack Query pairing.
5. Model access uses **in-house thin adapters** with pass-through sampler parameters, not the Vercel AI SDK. Optional `node-llama-cpp` provides a zero-setup local model.
6. Editing uses CodeMirror 6 plus a Zod-generated frontmatter form, with patch-style file writes; lorebook triggers use Aho-Corasick keyword matching, with embeddings only as opt-in suggestions.
7. The SQLite index is a pure cache: a schema change drops and rebuilds it, so there are no migrations.

## Consequences
+ Prompt building is deterministic and golden-testable; retry/undo/branch share one mechanism; no second runtime for a shell.
+ First-run friction falls if bundled inference works.
- We own the adapter layer and tokenizer upkeep.
- No tray or auto-update until a shell is added later.
- Bundled local inference is unproven; it stays optional until prototyped (F-35).

## Alternatives considered
Keeping Electron, Vercel AI SDK, a mutable session file, WYSIWYG rich text, embeddings-first retrieval, Yjs for turns. See the "runner-up" column in [tech-stack](../tech-stack.md).
