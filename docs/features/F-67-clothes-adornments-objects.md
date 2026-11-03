# F-67: Clothes, adornments and objects as VN asset kinds

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | |
| Branch | `feat/supabase-database` |
| Target tag | |

## Value
Authors adapting a story get character-locked clothes and adornments and interaction-only objects, with generic templates, database support and a Studio UI, in any world.

## Acceptance criteria
- [x] Core kind model, lock rules and manifest fields, tested
- [x] Card templates and `world-lint assets`
- [x] Migration with `asset_links`, `set_links`, issues view; pgTAP 008 written
- [x] Generic ComfyUI templates and driver support
- [x] Server and gen list, prompt, generate paths for the new kinds
- [x] Studio sections, filter, lock badges
- [ ] pgTAP 008 run against a database
- [ ] Studio checked in a browser against real data
- [ ] Server writes `asset_links` when the DB recorder creates these assets

## Non-goals
Layered sprite compositing; reference slots on the new kinds.

## Design
[ADR-0033](../decisions/0033-clothes-adornments-objects-asset-kinds.md).

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | vitest core, gen, server, web; `tsc -b apps/server`, `tsc -p apps/web`; world-lint check | pass |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Built |
