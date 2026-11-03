# F-63: Invitation-only sign-in and four roles

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | `v0.3.0-supabase-database` |

## Value
Only invited people get accounts, nobody needs a host key, and what a person may do follows from a named role.

## Acceptance criteria
- [x] `node tools/invite-author.mjs <email>` prints a one-time link; opening it shows the address, takes a password and the adult confirmation, and creates the account (owner, 2026-11-03).
- [x] Roles admin, author, moderator, player exist in the database; an administrator passes every role check; `identity.set_admin` is not callable by the backend (pgTAP 007).
- [ ] Signing in at `/login`, signing out, and coming back keep the same seat (browser check not done).
- [ ] A signed-in author takes the host seat under their own name; anyone else watches; a second author is refused (unit tests only).
- [ ] The old host-key login still works beside it, and a restart signs everyone out (documented, not exercised).

## Non-goals
- Single sign-on (a later scope).
- Moderators acting in the in-memory table: the database allows it, the table does not yet (TD-010).
- Gating every route by the signed-in person.

## Design
[ADR-0032](../decisions/0032-sign-in-through-the-server.md), [ADR-0029](../decisions/0029-roles-admin-author-moderator-player.md); `apps/auth`, `apps/server/src/auth-routes.ts`, `apps/server/src/roles.ts`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | Owner opened an invitation link and set a password; unit and route tests (736 passing) | Account created; browser login and seat checks still to do |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written for release v0.3.0-supabase-database; state Review. |
