/**
 * Who a signed-in person is on the platform (ADR-0029). Three levels come from the account:
 * - `admin`: can do everything, in every world.
 * - `author`: may found worlds; manages their own worlds, assets and visual novels, and hosts games.
 * - `player`: everyone else. What they may do in a world comes from that world's membership
 *   (moderator or player), not from here.
 * "Host" is not a role: it is what the screens call an author who is running a game.
 */
export type PlatformRole = "admin" | "author" | "player";

export interface RoleFacts {
  isAdmin: boolean;
  /** `identity.profiles.can_found_worlds`: set when an author invitation is accepted. */
  canFoundWorlds: boolean;
}

export function platformRoleOf({ isAdmin, canFoundWorlds }: RoleFacts): PlatformRole {
  if (isAdmin) return "admin";
  return canFoundWorlds ? "author" : "player";
}

/**
 * The seat a signed-in person takes at the one table: an author (or admin) runs it, so they take
 * the game's host seat; anyone else watches. This is the single-table shortcut. Once worlds are rows
 * it becomes a check of the open world's membership (`membership.is_author`), and only here.
 */
export function seatKindOf(role: PlatformRole): "host" | "spectator" {
  return role === "player" ? "spectator" : "host";
}
