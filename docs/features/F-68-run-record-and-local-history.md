# F-68: Run record and local history

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | none yet |

## Value
Every generated image keeps what made it, so the dataset can be trusted for reproducing runs and training a model, and Supabase storage is spent only on what the game serves.

## Acceptance criteria
- [x] A run folder holds `run.json`, the exact `workflow.json`, the reference images and the output; a failed run keeps its inputs (server tests).
- [x] Settings are read from the workflow that was sent; a value it does not set stays unknown (gen tests).
- [x] A spec stores the run settings; unknown sampler values are null, not defaults (database test 009, recorder tests).
- [x] A new current image is uploaded first; older Supabase images then move to the local store after a hash check, and stay put when any step fails (recorder tests).
- [ ] The database is reset and `009_run_settings.sql` passes on the project.
- [ ] A real generation leaves a run folder and a spec that match, and the previous image is local afterwards.
- [ ] `NIRMATA_ASSET_DIR` is set on the author's machine (without it nothing moves).

## Non-goals
- A "keep in the cloud" choice for chosen runs.
- Reading `run.json` back when a dataset folder is imported.
- Showing the run settings in the dataset gallery.

## Design
[ADR-0034](../decisions/0034-current-image-in-supabase-history-local.md); `apps/gen/src/run-settings.ts`, `apps/server/src/render-recorder.ts`, `apps/server/src/table.ts`, `db/assets/migrations/20261102001000_assets.sql`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | Full test suite (759); typecheck | Pass; not run against the database or a live ComfyUI |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written after the dataset was found to hold no reference, strength or workflow, and made-up sampler defaults. |
