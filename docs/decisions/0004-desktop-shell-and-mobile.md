# ADR-0004: Electron shell and PWA for phones

- Status: Superseded by [ADR-0006](0006-stack-revision.md)
- Date: 2026-10-25
- Related: [tech-stack](../tech-stack.md)

## Context
The baseline already has an Electron shell and a mobile app that syncs over LAN. Packaging size is a lesser concern than shipping something that works on Windows now.

## Decision
Wrap the local Hono server in Electron for desktop; serve the same UI as an installable PWA over LAN for phones. Reuse the baseline peer-sync as the seed for hosting others (F-37).

## Consequences
+ No shell rewrite. One UI codebase for desktop and phone.
- Larger installer than Tauri. Revisit at packaging time (TD-005).

## Alternatives considered
Tauri v2 (needs Rust and a Node sidecar); native mobile app (second codebase).
