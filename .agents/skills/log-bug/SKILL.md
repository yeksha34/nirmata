---
name: log-bug
description: Log, triage, fix-track and close a bug or tech-debt item in docs/bugs.md. Use when something is broken, when a verification step fails, when a security issue is found, or when asked to "log a bug", "add tech debt", or "close BUG-xxx".
---

# log-bug

`docs/bugs.md` is the single register. Bugs are `BUG-nnn`; known debt that is not a defect is `TD-nnn`.

## Log
1. Take the next free number. Add a row to **Open bugs** with: severity, date found (absolute date), area, one-line summary, and a **repro or evidence** another person can follow.
2. Severity: **S1** data loss, security, or cannot start. **S2** feature unusable. **S3** workaround exists. **S4** cosmetic.
3. **Secrets or security findings:** never paste the secret into the doc. Name the file and the action (revoke/rotate), nothing more.
4. If the bug belongs to a feature, link it from that feature record's verification log.

## Fix and close
1. Status `Fixing` while a branch exists. When fixed, record the commit hash.
2. **Verify by re-running the repro.** Only then move the row to **Closed** with the fix summary.
3. If the root cause is a wrong design decision, write an ADR (`record-decision`) that supersedes the old one.

Never delete a row; closed bugs are history.
