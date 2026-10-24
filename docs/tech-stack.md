# Recommended tech stack

Decision record: [ADR-0001](decisions/0001-tech-stack.md). This page is the explanation.

## What we are building

A local-first app: a **Studio** for authoring worlds (lots of forms, markdown, graphs, file I/O) and a
**Host** for playing them (streaming text, long-lived sessions, model calls). It must run on a Windows PC
today, be reachable from a phone on the same network, and not lock anyone to one model vendor.

## Recommendation

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language and one set of types (card schema, event log, API) shared by UI, server and engine. The existing code is already JavaScript, so the team keeps its skills and can port logic incrementally. |
| Workspace | **pnpm workspaces** monorepo | `apps/*` and `packages/*` with shared schemas; fast installs. |
| UI | **React 19 + Vite + Tailwind CSS + Radix UI (shadcn/ui)** | Largest ecosystem of accessible primitives, which is what "easy UX" needs (dialogs, command palette, tabs, tooltips all keyboard-correct). Vite gives instant dev reload. |
| UI state | **TanStack Query** (server state) + **Zustand** (local UI state) | Small, boring, testable. |
| Editor widgets | **CodeMirror 6** (markdown/YAML) or **TipTap** (rich text), **React Flow** (link and relationship graph) | Mature, embeddable, no framework lock-in. |
| Server | **Node 22 + Hono** | Tiny web-standard (fetch/Request/Response) framework; first-class **SSE streaming** for tokens; runs the same on Node, Bun, or inside Electron. |
| Validation | **Zod** schemas in `packages/core` | Single source for frontmatter, API payloads and event-log lines. |
| Source of truth | **Markdown + YAML frontmatter files in git** | Keeps everything in the existing corpus format, diffable, portable, hand-editable. |
| Index and sessions | **SQLite** (better-sqlite3) with FTS5; optional `sqlite-vec` later | Rebuildable search index and fast adventure queries without making a database the master copy. See [ADR-0002](decisions/0002-storage-files-plus-sqlite-index.md). |
| Model access | **Provider adapter layer** (`packages/llm`) over the **OpenAI-compatible chat API** + native **Anthropic**; Vercel **AI SDK** used inside adapters where it saves code | One interface covers KoboldCpp, Ollama, LM Studio, OpenRouter, OpenAI and Anthropic, so the SillyTavern/Kobold crowd is first-class. See [ADR-0003](decisions/0003-llm-provider-abstraction.md). |
| Desktop shell | **Electron** (already in the codebase) wrapping the local server; **PWA** for phone | Zero rewrite of shell work already done. Tauri v2 is lighter, but needs a Rust toolchain and a sidecar for Node; revisit if bundle size matters. See [ADR-0004](decisions/0004-desktop-shell-and-mobile.md). |
| Rules judge | Keep **Python** `services/rules-gatekeeper` as an optional offline training project; at runtime call its exported model through Ollama/OpenAI-compatible HTTP | Training stays in the ecosystem built for it; the app only needs an HTTP endpoint. |
| Tests | **Vitest** (unit), **Playwright** (end to end) | Standard pairing with Vite. The context builder must be deterministic and unit-tested. |
| Lint and format | **Biome** | One fast tool instead of ESLint + Prettier. |

## Alternatives considered

| Option | Verdict |
|---|---|
| **SvelteKit** | Pleasant and small, but a smaller pool of accessible component kits; no strong reason to leave React. |
| **Next.js** | Server rendering and routing add nothing for a local single-user app; heavier to embed in Electron. |
| **Python (FastAPI) backend** | Good for ML, but would split the codebase into two languages for the main app. Used only for the training sidecar. |
| **Keep vanilla JS (status quo)** | Fine for a prototype; the two big files (2k+ lines each) have no types or tests and are the main obstacle to "easy UX". Kept as baseline until replaced feature by feature (TD-003). |
| **Database as source of truth (Postgres/SQLite only)** | Loses git diffs, hand-editing and the existing corpus. Rejected. |
| **Tauri** | Deferred, see above. |
| **Cloud-hosted SaaS** | Contradicts local-first (N-01) and adds accounts, cost and moderation burden. Out of scope. |

## Migration path from the copied code

1. v0.1 (this tag): baseline Studio runs unchanged from `apps/studio`; docs and skills in place.
2. v0.2: `packages/core` (card schema, lorebook, context builder) is extracted from `app.js`/`server.mjs` logic; `packages/llm` adapters; first `apps/server` routes; Host core (F-30).
3. v0.3: React UI replaces Studio screens one at a time (world library, card editor, then play view). Each screen reaches parity, then the baseline screen is deleted.
4. v0.4+: memory, rules during play, hosting others, PWA.
