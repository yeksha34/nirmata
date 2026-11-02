# ADR-0026: Generation runs as a followable job; status lives in a redux-saga store

- Status: Proposed
- Date: 2026-11-02
- Related: [ADR-0025](0025-comfyui-vn-asset-studio-and-reinforcement-loop.md), [F-61](../features/F-61-comfyui-vn-asset-studio.md)

## Context
`POST …/assets/generate` held the HTTP request open while it polled ComfyUI, and gave up after a fixed 600 s. Renders on slower cards finish later than that: the request failed although ComfyUI went on to complete the image. The page also showed one line of text, and a refresh lost it.

## Decision
1. **Jobs, not long requests.** `generate` returns `202` with a job at once. The server runs the render in the background and keeps the record (`GET /api/vn-jobs`, `GET /api/vn-jobs/:id`, `POST /api/vn-jobs/:id/cancel`). Records are in memory; the last 40 finished jobs are kept.
2. **No fixed time limit.** The wait follows ComfyUI itself: `/queue` (waiting with a position, or running), `/history` (finished or failed), and its websocket (`executing` per node, `progress` per sampler step, `execution_cached`). A job fails only when ComfyUI reports an error, the prompt is in neither queue nor history for 20 polls, ComfyUI is unreachable for 2 minutes, or the author cancels (queue delete plus `/interrupt`).
3. **Status per stage and per workflow node.** A job has four stages (prepare, queue, render, save) and lists the workflow's own nodes with `pending | active | done | cached`.
4. **Redux + redux-saga on the web side, for generation status only.** The existing `useReducer` store is untouched. Sagas start a job, poll it, and on `hydrate` (when the studio opens) list the server's jobs and resume following any still running. A refresh therefore shows the same status; the server is the source of truth, the store a mirror.

## Consequences
+ Slow renders finish and are shown; the browser can close or refresh mid-render.
+ Cancel exists, which an unlimited wait needs.
- Jobs are lost if the table restarts. The page then says so instead of waiting forever.
- Two state mechanisms in the web app, kept apart on purpose (generation status only).
