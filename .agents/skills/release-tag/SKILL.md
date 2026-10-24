---
name: release-tag
description: Cut a tagged release branch for Realmwright, with the docs and status board consistent. Use when asked to "tag a release", "cut v0.x", "prepare the tagged branch", or "release the scaffold".
---

# release-tag

Naming: branch `release/vX.Y.Z` (or the scaffold branch for `-scaffold` tags), annotated tag `vX.Y.Z[-label]`.

1. `git status` is clean on the branch; run `node .agents/skills/world-lint/driver.mjs check`. It must exit 0.
2. In `docs/lifecycle.md` set the **Branch / tag** column for every feature shipping in this tag; features must be at least **Verified** to be marked Released.
3. Ensure `docs/bugs.md` has no open S1/S2 bug for shipped features, or lists them as known issues in the tag message.
4. Commit docs updates: `Release vX.Y.Z: <summary>`.
5. `git tag -a vX.Y.Z -m "<what is in it, what is known broken>"`.
6. Do **not** push the tag or branch unless the user asked; pushing publishes it.
