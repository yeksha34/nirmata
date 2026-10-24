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
| F-30 | Adventure host core (turn loop) | Specified | | See [features/F-30-adventure-host-core.md](features/F-30-adventure-host-core.md) |
| F-31 | Retry / edit / undo / continue | Proposed | | |
| F-32 | Context builder with budget | Proposed | | Shares engine with F-03 |
| F-33 | Persistent memory and summaries | Proposed | | |
| F-34 | Player character, stats, inventory | Proposed | | |
| F-35 | Model/provider settings | Specified | | See ADR-0003, ADR-0006 |
| F-36 | Rules enforcement during play | Proposed | | Uses F-05 |
| F-37 | Hosting other players (LAN / link) | Proposed | | Legacy peer-sync is the seed |
| F-38 | Save, branch, export adventures | Proposed | | |
| F-39 | Content-rating gate | Specified | | `contentRating` field exists in `world.json` |
| F-50 | Guided first run + simple/advanced mode | Specified | | See [ux-principles.md](ux-principles.md) |
| F-51 | Mobile-friendly PWA | Proposed | | |
| F-52 | Accessibility and keyboard | Proposed | | |
