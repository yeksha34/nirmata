# Feature lifecycle

Every deliverable feature (F-xx in [requirements.md](requirements.md)) moves through the same states.
A feature is in exactly one state; the state is recorded in the status board below **and** in the
feature's record under [features/](features/).

```
Proposed -> Specified -> Designed -> Building -> Review -> Verified -> Released
                 \__________________________________/
                            Blocked / Dropped (from any state, with a reason)
```

| State | Entry criteria | Evidence to record |
|---|---|---|
| **Proposed** | Idea has an ID, one-line value statement, and priority (M/S/C/W) | Row in requirements.md |
| **Specified** | Acceptance criteria written as checkable bullets; scope and non-goals stated | Feature record created from [`features/_template.md`](features/_template.md) |
| **Designed** | UX sketch/flow and any data-shape change agreed; ADR written if a hard-to-reverse choice was made | Link to ADR / sketch in the record |
| **Building** | Work started on a branch named `feat/F-xx-short-name` | Branch name, started date |
| **Review** | Code complete; self-review done (`/code-review`); docs updated | PR / commit list |
| **Verified** | Every acceptance bullet checked by running the app (or a test); bugs found are logged | Verification notes with date, what was run |
| **Released** | Merged to `main` and included in a tag (`vX.Y.Z`) | Tag name in the status board |

## Definition of done

1. All acceptance bullets verified, not just "builds".
2. `node .agents/skills/world-lint/driver.mjs check` passes on `worlds/example-world`.
3. No open **S1/S2** bug (see severity in [bugs.md](bugs.md)) against the feature.
4. requirements.md row, feature record and this status board agree.
5. Any decision someone could reasonably reverse has an ADR.

## Bug lifecycle

`Open -> Triaged (severity + owner) -> Fixing -> Fixed (commit linked) -> Verified (re-run the repro) -> Closed`.
A bug is only Closed once its repro no longer reproduces. Bugs that are really "we chose the wrong
design" become an ADR that supersedes the old one.

## Decision lifecycle

`Proposed -> Accepted -> (Superseded by ADR-xxxx | Deprecated)`. ADRs are never rewritten; a changed
mind is a new ADR that links back.

## Status board

Updated 2026-10-25. "Baseline" = exists in the code copied from the three source repos and works there,
but has not been re-verified inside Nirmata.

| ID | Feature | State | Branch / tag | Notes |
|---|---|---|---|---|
| F-01 | World library and creation wizard | Specified | | Template + example world exist; wizard UI not built |
| F-02 | Card editor (lore/character/place/rule) | Baseline | `v0.1.1-scaffold` | Legacy vanilla-JS Studio in `apps/studio` |
| F-03 | Keyword-triggered lorebook + token budget | Baseline | `v0.1.1-scaffold` | Legacy "context panel"; to be rebuilt in `packages/core` |
| F-04 | Link graph and lint | Verified | `v0.1.1-scaffold` | `world-lint` skill runs clean on example world |
| F-05 | World rules authoring and checking | Baseline | | Needs path fixes, see TD-002 |
| F-06 | Import / export (zip, ST lorebook, epub) | Baseline | | Python tools copied; ST import not built |
| F-07 | Version-control drawer | Baseline | | Git diff viewer in legacy Studio |
| F-08 | AI-assisted card generation | Proposed | | |
| F-09 | Contradiction / consistency check | Baseline | | Legacy ops queue |
| F-30 | Story host core (turn loop) | Building | `feat/F-30-story-host-core` | Engine, providers, host, window shifting and plot points done (310 tests, fake provider only). Server built (F-47); play screen pending. See [features/F-30](features/F-30-story-host-core.md) |
| F-31 | Retry / edit / undo / continue | Building | `feat/F-30-story-host-core` | Done in `packages/host` (retry also recovers a failed turn); UI pending |
| F-32 | Context builder with budget | Building | `feat/F-30-story-host-core` | Implemented and golden-tested in `packages/core`; budget meter UI pending |
| F-33 | Persistent memory | Building | `feat/F-30-story-host-core` | Player pins done; long-term memory is now plot points on cards (F-42). Memory panel pending |
| F-34 | Player character, stats, inventory | Proposed | | |
| F-35 | Model/provider settings | Building | `feat/F-30-story-host-core` | Provider layer, presets and test-connection logic done in `packages/llm` (see ADR-0003, ADR-0006); settings UI and key storage pending |
| F-36 | Rules enforcement during play | Building | `feat/F-30-story-host-core` | LLM judge, automatic rewrite and flags done in `packages/host`; judge-model settings and the flag/Fix UI pending |
| F-37 | Join a story IRC-style | Building | `feat/F-30-story-host-core` | Done in the server: nickname, spectator then opt in to play, host key for the host ([ADR-0011](decisions/0011-irc-style-joining.md), [F-47](features/F-47-table-server.md)). Join screen pending |
| F-38 | Save, branch, export stories | Proposed | | |
| F-39 | Adults only (no rating tiers) | Building | `feat/F-30-story-host-core` | Rating tiers removed; one fixed prompt line added ([ADR-0010](decisions/0010-adults-only.md)). Whether to confirm age on joining is open |
| F-40 | Live context-window shifting into chapters | Building | `feat/F-30-story-host-core` | Core + host done (310 tests, fake provider). The server rewrites the chapter and plot files after every change (F-47); automatic chapter breaks are a later decision. [features/F-40](features/F-40-window-shift-to-chapters.md), [ADR-0008](decisions/0008-window-shift-and-plot-points.md) |
| F-42 | Plot points on cards, with undo | Building | `feat/F-30-story-host-core` | Core + host done (310 tests, fake provider). Real-model review and the card/undo UI pending. [features/F-42](features/F-42-plot-points-on-cards.md) |
| F-43 | Story copies of the source cards | Building | `feat/F-30-story-host-core` | Done in core + host (310 tests, fake provider, in-memory source). The server has the real source backend and secret-safe views (F-47); only the screens are pending. [features/F-43](features/F-43-story-copies-and-source-permissions.md), [ADR-0009](decisions/0009-story-copies-and-source-permissions.md) |
| F-44 | Source-card permissions (host edits, players cannot) | Building | `feat/F-30-story-host-core` | `SourceCards` guard and role table done; accounts and the real backend belong to the server. Same record as F-43 |
| F-45 | Player input is never fact | Building | `feat/F-30-story-host-core` | Prompt + judge pipeline done and tested with the fake provider; real-model check pending. [features/F-45](features/F-45-player-input-is-not-fact.md) |
| F-46 | Shared board, age confirmation, moderation | Building | `feat/F-30-story-host-core` | Board, rounds, env-gated age check and in-fiction moderation done in core + host (310 tests, fake provider). Live transport is done in the server (F-47); screens pending. [features/F-46](features/F-46-shared-board-and-table-rules.md) |
| F-47 | The table server | Review | `feat/F-30-story-host-core` | `apps/server`: join, live board and story, saved stories, per-role views; 41 tests and one real run in demo mode. Not yet tried with a live model or a second device. [features/F-47](features/F-47-table-server.md), [ADR-0016](decisions/0016-table-server.md) |
| F-41 | Promote story content to the world | Proposed | | |
| F-50 | Guided first run + simple/advanced mode | Specified | | See [ux-principles.md](ux-principles.md) |
| F-51 | Mobile-friendly PWA | Proposed | | |
| F-52 | Accessibility and keyboard | Proposed | | |
