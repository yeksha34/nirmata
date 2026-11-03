import { describe, expect, it } from "vitest";
import { platformRoleOf, seatKindOf } from "../src/roles";

describe("platform roles", () => {
  it("names the role from the account", () => {
    expect(platformRoleOf({ isAdmin: false, canFoundWorlds: false })).toBe("player");
    expect(platformRoleOf({ isAdmin: false, canFoundWorlds: true })).toBe("author");
    expect(platformRoleOf({ isAdmin: true, canFoundWorlds: false })).toBe("admin");
    expect(platformRoleOf({ isAdmin: true, canFoundWorlds: true })).toBe("admin");
  });

  it("seats an author or admin as the game's host and a player as a spectator", () => {
    expect(seatKindOf("admin")).toBe("host");
    expect(seatKindOf("author")).toBe("host");
    expect(seatKindOf("player")).toBe("spectator");
  });
});
