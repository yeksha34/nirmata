# Nirmata tech stack (revision 2)

Decision record: [ADR-0006](decisions/0006-stack-revision.md), which supersedes the stack parts of ADR-0001, 0003 and 0004.

This page picks technology from the product's needs, not from what the copied code happens to use. Each row says what we use, why, and what lost.

## What the product demands (and so what the stack must optimise)

1. **Predictable, explainable prompts.** The context builder *is* the product; users must see why a card was included.
2. **Reversible turns.** Retry, undo and branch must be cheap and crash-safe.
3. **Diffable files.** Editing a card must not rewrite the whole file (N-02).
4. **Power-user model control.** The SillyTavern/Kobold audience chooses tools by sampler knobs.
5. **Zero-to-first-reply in minutes.** The reference tools lose newcomers at "install a backend".
6. **Play on a phone, host for friends, no cloud.** (N-01)

## Architecture shape

**Headless core, thin edges.** `packages/core` is pure TypeScript with no file, network or clock access: card schema, lorebook matching, context builder, story reducer. Everything with side effects (disk, models, HTTP) is an adapter that implements an interface the core defines.

*Why:* requirement 1 means the same inputs must give byte-identical prompts, which only pure functions can promise cheaply. It also lets the Studio, the Host, a CLI and tests all share one engine. *Runner-up:* logic inside the server routes (what the copied editor does); rejected because it cannot be tested without a running server and a model.

**Stories are an event-sourced tree.** Each turn is an immutable event `{id, parentId, kind, text, ...}` appended to `events.jsonl`. The visible story is the path from root to the current head; state is a pure reducer over that path.

*Why:* retry = new sibling event, undo = move head to parent, branch = keep both children, replay = rerun the reducer. One mechanism delivers F-31, F-33 and F-38, is crash-safe because writes only append (N-05), and makes bugs reproducible from a log. *Runner-up:* a mutable `session.json`; each of retry, undo and branch then needs its own bespoke, bug-prone code.

## Decisions

| Concern | Choice | Why | Runner-up and why it lost |
|---|---|---|---|
| Server runtime | **Node LTS** | Native add-ons we depend on (SQLite, vector extension, llama.cpp bindings, OS keychain) are first-class on Node. | Bun and Deno ship nicer single binaries but make every native add-on a risk. |
| Delivery | **One local launcher that serves the UI to the browser; installable as a PWA** | Hosting friends needs a server process anyway, and a browser tab is the cheapest UI that also reaches a phone. A desktop shell would add a second runtime for no UX gain. | Tauri (needs a Node sidecar, so two runtimes) and Electron (large installer); revisit only for tray, auto-update or file-association polish. |
| Client-server API | **Hono typed RPC** (`hc` client) with **SSE** for token streaming | Types flow from route to component with no codegen. SSE crosses proxies and tunnels, reconnects with `Last-Event-ID`, and token streaming is one-directional. | tRPC adds a layer Hono already provides; raw WebSocket for streaming is harder to resume. WebSocket is used only for multi-player presence. |
| UI framework | **React 19 + Vite** | "Easy UX" needs accessible primitives, a command palette, a graph view and a code editor; React has the deepest supply of each (Radix, cmdk, React Flow, CodeMirror bindings). It is also the stack AI coding agents write most reliably, which matters because this repo is built with them. | Svelte 5 / Solid render streaming slightly more efficiently, but the missing ecosystem costs more than the speed gains. |
| Styling and themes | **Tailwind v4 + CSS-variable design tokens + Radix primitives** | Tokens make user themes (a big SillyTavern draw) a JSON file, and light/dark/high-contrast free. | CSS-in-JS runtime libraries; slower and unnecessary. |
| Live text rendering | **Append tokens to a DOM text node by ref**, outside React reconciliation; commit to state when the reply completes | Keeps long stories smooth at high token rates. | Re-rendering the message on every token. |
| Card editor | **CodeMirror 6** for the body + a **form generated from the Zod schema** for frontmatter | Markdown stays markdown, so diffs stay small; non-technical users never see YAML. | TipTap/ProseMirror WYSIWYG reserialises Markdown and rewrites whitespace, which violates N-02. |
| File parsing and writes | **`yaml` (document API) + remark**, patching only the changed frontmatter keys or body range; `chokidar` watching | Edits preserve comments, ordering and untouched bytes. | `gray-matter` parse-then-stringify rewrites the whole header. |
| Lorebook matching | **Aho-Corasick automaton** over normalised keywords (case, accents, word boundaries), rebuilt when cards change | Linear-time scan of the last turns against hundreds of keywords; deterministic and explainable ("fired on: *marrow*"). | Embeddings as the primary trigger: opaque, so users cannot predict or debug it. |
| Semantic recall | **`sqlite-vec` + a local embedding model, opt-in, suggestions only** | Surfaces "related cards" without letting a black box silently rewrite the prompt. | Always-on vector retrieval. |
| Index and cache | **SQLite (better-sqlite3, WAL) with FTS5**; schema version bump = drop and rebuild from files | The DB is a cache of the files, so there are never migrations to write or get wrong. | An ORM with migrations; machinery for data we can regenerate. |
| Model layer | **Thin in-house adapters on `fetch` + an SSE parser** with per-backend pass-through parameters (`min_p`, DRY, mirostat, grammar, logit bias, stop strings) and a capability table | Generic SDKs normalise away exactly the sampler controls that power users come for; the interface is a couple of hundred lines and we own error messages. | Vercel AI SDK and LangChain: great for tool-calling apps, wrong abstraction for raw sampler control and churn-prone. |
| Zero-setup model | **`node-llama-cpp` "install a model for me"** (downloads a GGUF, picks GPU or CPU, runs as a managed child process); Ollama and Kobold are detected automatically | Removes the single biggest newcomer barrier. | Requiring users to install a backend first; kept as the advanced path. |
| Token budgeting | **Per-provider token counter with a conservative fallback estimate**, budget allocated by priority tiers in the core | Overflowing context silently drops lore; budgets must be right or visibly conservative. | Character-count heuristics only. |
| Hosting friends | **Server-authoritative turn queue**; loopback-only by default; LAN invite via a per-session token and QR code; internet access via the user's own Tailscale or Cloudflare Tunnel, documented but not built | No accounts, moderation or hosting cost (N-01). Only one model reply is in flight at a time, so a queue is the correct model. | Yjs/CRDTs: turns are an append-only log, not concurrently edited text. Revisit for multi-author world editing. |
| Secrets | **OS keychain** (`@napi-rs/keyring`), fallback to an ignored file with owner-only permissions | Keys never live in a world folder or repo (N-03). | `.env` files, the failure already seen in BUG-001. |
| Testing | **Vitest** with **golden-prompt snapshots** for the context builder; a **fake provider that replays recorded token streams**; **Playwright + axe** for flows and accessibility | Determinism makes the hardest component testable without a GPU or network. | Manual play-testing as the main safety net. |
| Quality gates | **TypeScript strict, Biome, pnpm workspaces** | One fast toolchain; shared types across packages. | ESLint + Prettier + many plugins. |
| Packaging | **Portable per-OS archive bundling the Node runtime and a launcher** (opens the browser, tray icon); installers later | Users never "install Node". | `npx` only; fine for developers, not for the target audience. |

## Where I am least sure

- **Bundled local inference** (`node-llama-cpp`) is the highest-value and highest-risk choice: GPU detection and model downloads fail in many ways. Mitigation: ship it as optional, keep Ollama/Kobold detection first-class, and decide after a prototype (F-35).
- **No desktop shell** gives up tray and auto-update polish. If user testing shows the browser-tab model confuses people, a Tauri shell can wrap the same launcher without changing anything above it.
- **React over a smaller framework** is an ecosystem bet, not a performance one.

## Build order this implies

1. `packages/core` (schema, matcher, context builder, reducer) with golden tests, before any UI.
2. `packages/llm` adapters + fake provider; `apps/server` routes and SSE.
3. Host play screen (F-30..F-32) on React, then Studio screens one by one, retiring `apps/studio` as each reaches parity (TD-003).
4. Local model installer, PWA, hosting friends.
