# F-65: Generation jobs and renders in the database

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `v0.3.0-supabase-database` |

## Value
Generation history and the dataset survive restarts and count against a visible quota.

## Acceptance criteria
- [ ] A generation of an imported world creates its job, follows stages and nodes, links the render and finishes (live run).
- [ ] After a restart the queue lists recent jobs and open ones are closed as failed.
- [ ] A full quota sends the image to the local store; no store keeps only the file.

## Non-goals
- Archive and delete of a visual novel's current image (they stay file-only and do not touch the dataset).
- Recording reference images in the spec.

## Design
`apps/server/src/generation-ledger.ts`, `render-recorder.ts`, `apps/gen/src/record-render.ts`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | Unit tests with fake databases (736 passing) | Pass; live run pending |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written for release v0.3.0-supabase-database; state Review. |
