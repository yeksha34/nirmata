# F-66: Reference images in generation

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `v0.3.0-supabase-database` |

## Value
Expressions keep the character and CGs show the right people.

## Acceptance criteria
- [x] The derived sprite and CG workflows, with two references, are valid against the node definitions of the owner's ComfyUI (2026-11-03).
- [x] A missing reference sprite stops the job before anything is archived; a workflow without a slot says so (server tests).
- [ ] Generating an expression sprite from its base sprite keeps the character (look at the result).
- [ ] Generating a CG with two characters' sprites carries their likeness without copying their pose.

## Non-goals
- A strength control in the Studio.
- References from the database store (they are read from the visual novel's sprite files).

## Design
[ADR-0031](../decisions/0031-reference-images-in-generation.md); `apps/gen/src/reference-images.ts`, `apps/server/src/reference-rules.ts`, `tools/comfyui/README.md`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | Derived workflows checked against `/object_info` of the running ComfyUI; server tests with a fake ComfyUI | Valid; real generation pending |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written for release v0.3.0-supabase-database; state Review. |
