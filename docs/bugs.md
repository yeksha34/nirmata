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
| TD-007 | Terminology | Code still says "story" where Nirmata says "world" (`story_paths.py`, `.active_story.json`, `listStories`). | Rename when the Studio is rebuilt; do not rename in the baseline copy (risk without tests). |

## Closed

| ID | Closed | Summary | Fix |
|---|---|---|---|
| TD-009 | 2026-10-25 | Code said `Adventure*` while users say story. | Renamed to `Story*` everywhere: identifiers, `stories/` folders, `story.*` action names, the `story` rule scope, docs and the skill. |
