# F-71: Workflow templates in the database

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | none yet |

## Value
The adaptation agent no longer copies workflow files into a world's folder to customise them. The database holds the six asset workflows as platform defaults; a world adopts a copy or publishes its own, and a generation for that world uses it. Second of three slices ([F-70](F-70-adaptation-agent-in-the-database.md) before, VN content after; [ADR-0035](../decisions/0035-adaptation-data-in-the-database.md)).

## Acceptance criteria
- [x] Sprite, CG, background, clothes, adornment and object each have a workflow kind and a platform default that is the bundled ComfyUI graph (migration generated from `tools/comfyui/templates`; a test fails when they differ).
- [x] The nodes the bundled graphs use (`RMBG`, `TorchCompileDiffusionOpenVINO`) are on the allow-list for all six kinds.
- [x] `GET …/workflows` lists what each kind resolves to and from where (platform, world, visual novel); `GET …/workflows/:type` returns the graph.
- [x] `POST …/workflows/:type/adopt` gives the world its own copy of the default; `PUT …/workflows/:type` publishes the world's graph (one new version per call); `DELETE …/workflows/:type` goes back to the default. The agent token's scopes apply.
- [x] A graph that is not a ComfyUI graph is refused before the database; the database refuses nodes outside the allow-list, web addresses and file paths.
- [x] `loadWorkflowTemplate` uses the world's (or a visual novel's) copy from the database before the world's workflow files; the platform default stays with the bundled files, which are the same graphs.
- [ ] The migration and `db/tests/012_workflow_templates.sql` run on a real database.
- [ ] Tried with a real agent: adopt, change a step count, generate an asset, see the change in the run.
- [ ] `asset_specs.workflow_template_version_id` is filled when a generation is recorded (the job already records the version `effective_template` gives).

## Non-goals
- Visual novel pins (`pin_all_templates` runs when a visual novel is created, which comes with F-72). The endpoints accept `vnId` and resolve it already.
- Reference-image workflows: they are still derived from the plain workflow by adding a reference slot, so a customised copy keeps its customisations.
- A Studio screen for editing workflows.

## Design
- Migration `20261103000500_workflow_templates.sql` is **generated** by `tools/gen-template-migration.mjs`; edit the files, then run the tool. It adds version N+1 and moves the platform pin, so existing pins (visual novels) keep what they had. The prompt text of the bundled graphs is blanked in the database copy: `db/` carries none, and the server writes both prompts into every run.
- `apps/adaptation/src/template-store.ts`: `TemplateStore` (list, get, adopt, override, reset) over the existing `platform.*` functions, as the author the token stands for; `WorkflowSource` is what the library asks.
- Resolution for a generation: the database's world or visual novel copy, then the world's `assets/workflow/*.json`, then the bundled file. A database that fails raises; it is not hidden by the files. A world not in the database uses files only.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | `tsc -b`; full test suite | Pass |
| 2026-11-03 | Migration and pgTAP 012 | Not run yet |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Six workflow kinds and defaults, store, agent endpoints, library lookup. |
