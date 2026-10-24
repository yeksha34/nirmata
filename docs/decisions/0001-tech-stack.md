# ADR-0001: TypeScript, React + Vite, Hono, pnpm monorepo

- Status: Proposed
- Date: 2026-10-25
- Related: [tech-stack](../tech-stack.md)

## Context
The copied Studio is ~5.6k lines of untyped, framework-free JS in four files. The product now needs two surfaces (Studio and Host) sharing one engine, a nicer UI, and tests. The user asked for the best stack.

## Decision
- TypeScript across `apps/*` and `packages/*` in a pnpm workspace.
- UI: React 19, Vite, Tailwind, Radix/shadcn, TanStack Query, Zustand, CodeMirror, React Flow.
- Server: Node 22 + Hono with SSE streaming; Zod for all schemas.
- Tests: Vitest and Playwright. Lint/format: Biome.
- The legacy Studio keeps running from `apps/studio` until each screen has a React replacement.

## Consequences
+ Shared types between UI, server and engine; accessible primitives for the "easy UX" goal.
+ Incremental migration; nothing is thrown away until replaced.
- Build tooling arrives (Node, pnpm), where the baseline had none.
- Two UIs coexist for a while.

## Alternatives considered
SvelteKit, Next.js, FastAPI, staying vanilla JS: see [tech-stack](../tech-stack.md#alternatives-considered).
