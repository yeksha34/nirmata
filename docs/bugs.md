# Bugs and tech debt

Severity: **S1** data loss / security / cannot start. **S2** feature unusable. **S3** workaround exists.
**S4** cosmetic. `TD-` rows are known debt rather than defects. Newest first inside each table.

## Open bugs

| ID | Sev | Found | Area | Summary | Repro / evidence | Status |
|---|---|---|---|---|---|---|
| BUG-001 | S1 | 2026-10-25 | Security, source repo | `story-editor-pc/tools/.env` is **tracked in git** and holds an `ANTHROPIC_API_KEY`. | `git -C ../story-editor-pc ls-files tools/.env` lists it. The file was deliberately **not copied** into Nirmata. | Ignored: owner decision 2026-10-25; not tracked or reminded about further. |
| BUG-002 | S3 | 2026-10-25 | Studio | Copied from a working tree with uncommitted edits (`app.js`, `index.html`, `server.mjs` were modified in the source). Behaviour may differ from source commit `33a47ae`. | See [provenance.md](provenance.md) | Open, verify on first run |

## Tech debt

| ID | Area | Summary | Plan |
|---|---|---|---|
| TD-001 | rules-check-manual | `lib.mjs` hard-codes rule-file-name regexes from the private source corpus (`UNIVERSAL_RULE_RE`, `CENSORSHIP_WORKAROUND_RULE_RE`). Meaningless for other worlds. | Replace with frontmatter fields (`scope`, `severity`, `universal`) read from each rule card. Part of F-05/F-36. The checker runs after generation on host text only and never on player input ([ADR-0012](decisions/0012-player-input-is-not-fact.md)). |
| TD-002 | Studio server | `STORIES_ROOT_FOR_RULES = resolve(ROOT, '..', '..')` and `rule_groups.json` paths assume a `stories/<name>/` layout; Nirmata uses `worlds/<name>/`. Rule grouping files were not copied (derived data). | Regenerate groups with the copied `services/rules-gatekeeper/data/collapse_rules.py` after pointing it at `worlds/`. |
| TD-003 | Studio | `server.mjs` (2.4k lines) and `app.js` (2k lines) are monolithic, framework-free, and carry story-specific wording. | Superseded by the React/Hono rebuild, [ADR-0001](decisions/0001-tech-stack.md). Keep running as baseline until each feature reaches parity. Confirmed 2026-10-25: retire it screen by screen. |
| TD-004 | Studio (partly addressed: `packages/llm` now exists) | Prose drafting is wired to one provider (Mistral agents API) and a manual "Claude worker" queue. | Provider abstraction, [ADR-0003](decisions/0003-llm-provider-abstraction.md). |
| TD-005 | Studio | `electron/` shell expects `npm install` for ~460 MB of dependencies and is not installed here. [ADR-0006](decisions/0006-stack-revision.md) drops the desktop shell from the first releases. | Delete when the React UI replaces the Studio. |
| TD-006 | tools/*.py | Python utilities still mention the old `stories-repo` / Mentor names in comments and help text; `rewrite_chapter_mistral.py` is single-provider. | Rename on touch; fold into `packages/llm` where they remain useful. |
| TD-008 | Server (future) | A story's `begin` event, and so its `events.jsonl`, contains every source card **including host-only Secrets**. The server must never send the log or card copies to players; spectators and players get turns, chapters and plot points. Reading the source cards is a host setting (`playersMayRead`, off by default; allowed = full cards, Secrets included). | Carry into F-37 and the server design; see ADR-0009, ADR-0011. |
| TD-010 | Server, roles | A signed-in author or admin takes the one table's host seat from the account (`apps/server/src/roles.ts`), not from membership of the open world; and the in-memory table honours only `host` and `player`, so a world's moderator cannot moderate in the app although the database allows it. | Once worlds are rows, replace `seatKindOf` with a `membership.is_author` check on the open world and add `moderator` to `packages/core/src/permissions.ts`; see [ADR-0029](decisions/0029-roles-admin-author-moderator-player.md). |
| TD-007 | Terminology | Code still says "story" where Nirmata says "world" (`story_paths.py`, `.active_story.json`, `listStories`). | Rename when the Studio is rebuilt; do not rename in the baseline copy (risk without tests). |

## Closed

| ID | Closed | Summary | Fix |
|---|---|---|---|
| BUG-007 | 2026-10-30 | Draft and chapter `.writing-row` cards overflowed horizontally out of the navigation column into the editor pane when titles were long. | Added `min-width: 0`, `flex: 1 1 auto`, and `max-width: 100%` constraints across `.writings`, `.writing-rows`, `li`, `.writing-row`, `.writing-row-head`, and `strong`, styled `.vn-badge` with `flex-shrink: 0`, and added tooltip titles on truncated headers. |
| BUG-006 | 2026-10-30 | Visual novel static asset serving route `/api/worlds/:name/vns/:slug/assets/*` required an authenticated seat token (`seatOf(c)`), causing browser canvas image/audio requests and direct URL views to fail with 401 `{"error":{"code":"not_joined","message":"Join the table first."}}`. | Moved the asset route under the unauthenticated public endpoints in `apps/server/src/app.ts` and removed the seat requirement from `table.readWorldVnAsset`, verified by automated test in `library.test.ts` ([ADR-0022](decisions/0022-vn-dynamic-asset-loading-and-artstyle-fallback.md)). |
| BUG-005 | 2026-10-30 | Visual Novel presenter in VnCanvas did not load dynamic image assets (backgrounds, character sprites, CGs) from the server endpoint, remaining on procedural graphics fallbacks; character sprites did not adhere to world canon sculptural art style. | Implemented dynamic asset serving route `GET /api/worlds/:name/vns/:slug/assets/*` in server with MIME streaming, wired dynamic Phaser 3 texture loading in `VnCanvas.tsx` with hierarchical fallbacks (`.png` -> `.jpg`, expression -> base sprite -> procedural Classical Hindu Temple Sculpture figure), and regenerated canon apsara sprite (`heroine_neutral.jpg`) ([ADR-0022](decisions/0022-vn-dynamic-asset-loading-and-artstyle-fallback.md)). |
| BUG-004 | 2026-10-30 | Writings list action buttons stacked over each other in grid cell (`.writing-row .tip`), burying `Play VN` and `Read` buttons; clicking card row had no effect. | Rebuilt Writings UI into two-pane model: middle column clickable card selector (`WritingsList`) and right-hand panel (`WritingDetail`) with primary actions, VN status, and live text preview ([ADR-0021](decisions/0021-workspace-writings-detail-panel.md)). |
| BUG-003 | 2026-10-30 | Server startup fails with `"No model is set up"` when running `npm start` / `pnpm start` without explicit env vars, and defaults to random unguessable host key. | Added native Node `process.loadEnvFile()` in `apps/server/src/main.ts` scanning project candidate roots on boot ([ADR-0020](decisions/0020-server-dotenv-auto-loading.md)). |
| TD-009 | 2026-10-25 | Code said `Adventure*` while users say story. | Renamed to `Story*` everywhere: identifiers, `stories/` folders, `story.*` action names, the `story` rule scope, docs and the skill. |
