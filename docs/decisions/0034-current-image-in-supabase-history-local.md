# ADR-0034: Supabase keeps the current image; the history and the run record stay local

- Status: Accepted
- Date: 2026-11-03
- Related: [ADR-0026](0026-generation-jobs-and-status-store.md), [ADR-0028](0028-asset-files-served-by-backend-from-any-store.md), [ADR-0030](0030-imported-worlds-read-lore-from-the-database.md), [ADR-0031](0031-reference-images-in-generation.md)

## Context
Two gaps were found after generation was recorded in the database (F-65, F-66):

1. **The record of a run was thin.** A spec held the prompts and some sampler columns, and the recorder filled any missing value with a default (seed 0, 20 steps, cfg 7, euler). The reference images, their strength, the checkpoint, the LoRAs and the exact workflow were kept nowhere. A dataset built from these rows could not be trusted for training, and some of its settings were made up.
2. **Every image stayed in Supabase.** Each generation was uploaded and kept, so the free storage quota filled with history that the game never serves.

## Decision
- **The run is one unit.** When a generation starts, its folder in the world's dataset gets a `run.json` (what was asked, what the workflow applied, the status), the exact `workflow.json` that was sent, and a copy of every reference image used. When it ends, the status becomes `succeeded` (with the output's size and hash), `failed` or `cancelled`. A failed run keeps its inputs.
- **Settings are read from what was sent.** After the references and parameters are injected, `readRunSettings` reads the seed, steps, cfg, sampler, scheduler, denoise, checkpoint, LoRAs and adapter weight from the final workflow, not from the request. A value the workflow does not set is left out. The same record is stored in the spec (`asset_specs.run_settings`, plus the existing sampler columns).
- **Unknown stays unknown.** The sampler columns of a spec are nullable. An image imported from before settings were kept has null there, not a default, so training can leave those rows out. The columns still reject a value that is out of range.
- **Supabase serves, the local store keeps history.** After a new image is uploaded and recorded as the asset's current render, each older render of the asset still in Supabase is copied to the local store (`NIRMATA_ASSET_DIR`), checked against the hash in the database, recorded as `local` (`assets.set_render_store`), and only then removed from Supabase. Any step that fails leaves that image in Supabase, to be tried again on the next generation. Without a local store, or an image with no recorded hash, nothing moves.

## Consequences
+ A render and everything that made it can be reproduced, compared or used for training, and the folder and the database agree.
+ Supabase holds about one image per asset, so the quota lasts.
+ No data is lost by a failed copy: the new file is up before anything moves, and the old one is removed last.
- History exists on the author's machine (and whatever backs it up, such as OneDrive) and no longer in Supabase. The hash in the database shows a missing or damaged file but cannot restore it. A "keep in the cloud" choice for chosen runs is not built.
- A server on another machine has the current images and all rows but not the history files.
- Runs recorded before this change, and imported runs, keep null settings and an empty `run_settings`. Runs imported from the dataset folder are not scanned for `run.json` yet.
- Editing an existing migration instead of adding one needs the database to be reset (the project was still fresh, so this was accepted).

## Alternatives considered
Keeping every image in Supabase and paying for storage (simple, but the quota is the limit); moving history to local before the new upload (a failed upload would lose the old image); storing only the settings in the database and not the workflow (cannot reproduce a run whose workflow changed since).
