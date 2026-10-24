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
| F-30 | Adventure host core (turn loop) | Building | `feat/F-30-adventure-host-core` | Engine, providers, host, window shifting and plot points done (207 tests, fake provider only). Server routes and play screen pending. See [features/F-30](features/F-30-adventure-host-core.md) |
| F-31 | Retry / edit / undo / continue | Building | `feat/F-30-adventure-host-core` | Done in `packages/host` (retry also recovers a failed turn); UI pending |
| F-32 | Context builder with budget | Building | `feat/F-30-adventure-host-core` | Implemented and golden-tested in `packages/core`; budget meter UI pending |
| F-33 | Persistent memory | Building | `feat/F-30-adventure-host-core` | Player pins done; long-term memory is now plot points on cards (F-42). Memory panel pending |
| F-34 | Player character, stats, inventory | Proposed | | |
| F-35 | Model/provider settings | Building | `feat/F-30-adventure-host-core` | Provider layer, presets and test-connection logic done in `packages/llm` (see ADR-0003, ADR-0006); settings UI and key storage pending |
| F-36 | Rules enforcement during play | Building | `feat/F-30-adventure-host-core` | LLM judge, automatic rewrite and flags done in `packages/host`; judge-model settings and the flag/Fix UI pending |
| F-37 | Hosting other players (LAN / link) | Proposed | | Legacy peer-sync is the seed |
| F-38 | Save, branch, export adventures | Proposed | | |
| F-39 | Content-rating gate | Building | `feat/F-30-adventure-host-core` | Gate enforced in the context builder; session-level setting UI pending |
| F-40 | Live context-window shifting into chapters | Building | `feat/F-30-adventure-host-core` | Core + host done (207 tests, fake provider). Writing chapter files is the server's job; automatic chapter breaks are a later decision. [features/F-40](features/F-40-window-shift-to-chapters.md), [ADR-0008](decisions/0008-window-shift-and-plot-points.md) |
| F-42 | Plot points on cards, with undo | Building | `feat/F-30-adventure-host-core` | Core + host done (207 tests, fake provider). Real-model review and the card/undo UI pending. [features/F-42](features/F-42-plot-points-on-cards.md) |
| F-41 | Promote adventure content to the world | Proposed | | |
| F-50 | Guided first run + simple/advanced mode | Specified | | See [ux-principles.md](ux-principles.md) |
| F-51 | Mobile-friendly PWA | Proposed | | |
| F-52 | Accessibility and keyboard | Proposed | | |
