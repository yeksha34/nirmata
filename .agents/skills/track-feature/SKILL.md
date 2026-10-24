---
name: track-feature
description: Move a Nirmata feature through its lifecycle and keep requirements.md, docs/lifecycle.md and docs/features/ in sync. Use whenever starting, changing, reviewing, verifying or releasing a feature (F-xx), or when asked "what state is feature X in", "start work on F-30", "mark this verified", or "update the status board".
---

# track-feature

Three places describe a feature, and they must agree:

1. `docs/requirements.md` - the requirement and its acceptance summary.
2. `docs/lifecycle.md` - the **status board** row (state, branch/tag, notes). Authoritative for state.
3. `docs/features/F-xx-short-name.md` - the working record (acceptance checklist, design, verification log, history).

## Steps

1. **Find the feature.** Read its row in `docs/lifecycle.md`. If no ID exists, add a row to `requirements.md` with the next free ID in its band (A: F-01..29, B: F-30..49, C/UX: F-50+) and state **Proposed**.
2. **Pick the transition** (states: Proposed, Specified, Designed, Building, Review, Verified, Released, Blocked, Dropped). Check the entry criteria for the target state in `docs/lifecycle.md`. Do not skip a state; if criteria are not met, say which are missing instead of advancing.
3. **Write the evidence** the target state requires into the feature record: acceptance bullets (Specified), ADR/sketch link (Designed), branch name (Building), commit list (Review), dated verification notes naming what was actually run (Verified), tag (Released).
4. **Update the status board row** and add a line to the record's History table with today's date.
5. **If a bug was found**, log it with the `log-bug` skill and link it from the record. A feature cannot be Verified with an open S1/S2 bug.
6. **If a hard-to-reverse choice was made**, write an ADR with `record-decision`.

## Rules

- Create a record from `docs/features/_template.md` when a feature reaches **Specified**, not before.
- Branch names: `feat/F-xx-short-name`. Never commit straight to `main`.
- "Verified" means the app or a test was run and the result is written down. Building without errors is not verification.
- Keep edits small: touch only the three places above plus linked bugs/ADRs.
