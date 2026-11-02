# ADR-0029: Four roles: admin, author, moderator, player

- Status: Proposed
- Date: 2026-11-03
- Related: [ADR-0009](0009-permissions.md), [ADR-0027](0027-database-is-lore-source-of-truth.md)

## Context
"Host" meant two things: the per-world database role that edits lore, assets and visual novels, and the seat that runs a game. The last change seated any account that may found worlds as the one table's host. A public product needs named roles, and the database already separates a platform flag from world membership.

## Decision
Four roles. **Host is not a role**: it is the label the screens use for an author who is running a game (and the game-seat label in code, `host` in actor and event kinds, which stays).

| Permission | Admin | Author | Moderator | Player |
|---|---|---|---|---|
| Everything, in every world, plus platform tasks | Y | - | - | - |
| Create a world | Y | Y | - | - |
| Edit lore and cards, read host-only secrets | Y | Y (own worlds) | - | - |
| Manage assets (generate, import, archive, delete) | Y | Y (own) | - | - |
| Adapt a story into a visual novel, edit VN content | Y | Y (own) | - | - |
| Host a world chat adventure (start, settings, plot, branch, chapter) | Y | Y (own) | - | - |
| Host a visual novel | Y | Y (own) | - | - |
| Invite moderators and players to a world | Y | Y (own) | - | - |
| Moderate a world (kick, mute, hush, close a round) | Y | Y (own) | Y | - |
| Play in a world, play a visual novel | Y | Y | Y | Y |
| Invite an author; see platform storage quota and usage | Y | - | - | - |

"Own" means worlds the person is an author of.

- Database: the world role `host` is renamed `author` (migration 022). `membership.is_host` becomes `is_author`, `is_host_of` `is_author_of`, `platform.is_any_host` `is_any_author`, `identity.create_host_invitation` `create_author_invitation`. `identity.profiles.can_found_worlds` keeps its name and means "is an author" on the platform; `identity.profiles.is_admin` is new and makes the person pass every world role check. `identity.set_admin` is for the owner's tools only, not the backend.
- Server: `apps/server/src/roles.ts` is the one place that turns an account into `admin`, `author` or `player` and decides the game seat it takes. A signed-in author or admin takes the host seat of the table.
- The in-memory game rules (`packages/core/src/permissions.ts`) keep their two seat roles, `host` and `player`: they are the game labels.

## Consequences
+ One word per thing: roles for who you are, "host" for what you are doing at the table.
+ Going public later needs only open sign-up creating players, admin tooling for authors, and swapping the single-table shortcut in `seatKindOf` for a world-membership check.
- Moderators are honoured by the database but not yet by the in-memory table (`board.moderate` is host-only).
- The seat shortcut ties the whole table to the first author who signs in, until worlds are rows.

## Alternatives considered
Keep `host` as the role and add `author` beside it (two overlapping roles for the same person); a separate `host` role without lore rights (the owner chose to merge them).
