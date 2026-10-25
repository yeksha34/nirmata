# ADR-0011: Joining a story works like IRC: no accounts

- Status: Accepted 2026-10-25
- Related: [ADR-0009](0009-story-copies-and-source-permissions.md), [F-37](../requirements.md)

## Context
Roles (host, player) needed a meaning in real use. The owner: *there is no complicated user management; anyone that joins the story's server can opt to play; think of it as IRC chat.*

## Decision
1. **The host is whoever runs the story's server.** Roles are not stored in accounts.
2. **Anyone who can reach the server may join** with a nickname. No sign-up, password, profile or user list to manage. The nickname is the `Actor.id`.
3. **A joiner starts as a spectator** (sees the public story: turns, chapters, plot points) **and can opt to play**, which makes them a `player`. Spectators have no session methods.
4. **Host-only actions stay host-only** (ADR-0009 table); the host's machine is the authority.

## Consequences
+ Nothing to build or maintain for identity; joining is instant.
- No authentication: anyone can use any free nickname, and a host cannot tell people apart across sessions. Acceptable on a trusted network or with a shared link; moderation tools (kick, mute, rename) are a later question.
- Several players can send input at once while the session handles one reply at a time. The server will have to queue them; **the turn order rule (free-for-all when idle, strict round-robin, host approval) is undecided** ([open-questions](../open-questions.md)).
- Public access to the server is the host's responsibility (their own tunnel or network), as in ADR-0006.

## Alternatives considered
- **Accounts and roles per user.** Explicitly rejected as too complicated.
