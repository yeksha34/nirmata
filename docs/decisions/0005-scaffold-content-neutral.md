# ADR-0005: Scaffold copies structure and tooling, not private story content

- Status: Accepted
- Date: 2026-10-25
- Related: [tech-stack](../tech-stack.md)

## Context
The brief says the stories repo is "an example of world-building scaffolding per story content". The repo contains private long-form fiction and rule text; the new project is meant to be a general tool with a shareable repo.

## Decision
Copy the folder layering, skills and tooling. Do **not** copy story cards, chapters, drafts, rule text or derived datasets; ship a small, content-safe example world instead. Never copy secrets (`.env`).

## Consequences
+ Repo is safe to share; example world is a clean first-run experience.
- The Studio can no longer be pointed at the old content by default; set `WORLDS_DIR` or `STORIES_ROOT` to do so.

## Alternatives considered
Copying everything (leaks private work and a live API key); symlinking the old repo (couples lifecycles).
