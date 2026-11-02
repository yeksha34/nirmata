# ADR-0028: Asset files are served by the backend from any store

- Status: Proposed
- Date: 2026-11-02
- Related: [ADR-0025](0025-comfyui-vn-asset-studio-and-reinforcement-loop.md), [ADR-0026](0026-generation-jobs-and-status-store.md), [ADR-0027](0027-database-is-lore-source-of-truth.md)

## Context
Assets live as local files under `worlds/<world>/assets/dataset/` today. The database has private `vn-assets` and `exports` buckets and `assets.renders.storage_path`, which implied a Supabase object. The free Supabase plan is small (about 1 GB storage, limited monthly egress), so not every generated file can be uploaded. ComfyUI reads only local files, so linked reference images must be fetched to disk before a job runs.

## Decision
- Every render has a row, whatever its store. `storage_path` (`<world-uuid>/…`) is the one stable name.
- `assets.renders.store` says where the bytes are: `supabase`, `local` or `none` (deleted, row kept). `bytes`, `sha256` and `content_type` are recorded once.
- Clients ask the backend for `GET /assets/renders/:id/file`. The backend checks access and streams from the store, or redirects to a short-lived signed URL. Clients never see the store.
- Moving a file between stores, or deleting its bytes, is `assets.set_render_store` (server or host only), audited, and emits `render.store_changed`. The current render of an asset cannot go to `none`.
- Import registers every kept render. Only chosen (approved) files are uploaded, to stay inside the quota. `assets.v_store_usage` feeds the quota warning.
- Before a job, the worker downloads referenced assets into a content-hash cache (size and age limited) and uploads them to ComfyUI's input; the files are temporary.

## Consequences
+ The same path and API work for local and uploaded files; quota decisions do not change callers.
+ Archive and delete become store changes, not data loss.
- A hosted backend cannot serve `local` files that sit on another machine; assets a hosted setup needs must be in `supabase`.
- The importer, quota warning, delete/archive jobs and the backend endpoint are separate work.

## Alternatives considered
Upload everything (exceeds the free plan); keep paths only in files (no access control, no usage view); expose Storage URLs to clients (leaks the store and needs public or per-user signing).
