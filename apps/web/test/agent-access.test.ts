import { describe, expect, it } from "vitest";
import { laneKinds, standing } from "../src/screens/agent-access";
import type { AgentToken } from "../src/types";

const token = (over: Partial<AgentToken>): AgentToken => ({
  id: "t1",
  label: "adaptation",
  scopes: ["adaptation.read", "adaptation.write"],
  kinds: null,
  expiresAt: "2026-12-01T00:00:00Z",
  revokedAt: null,
  lastUsedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("an agent token's standing", () => {
  const now = Date.parse("2026-11-15T00:00:00Z");

  it("is active until it ends", () => {
    expect(standing(token({}), now)).toBe("active");
  });

  it("is expired once its end has passed", () => {
    expect(standing(token({ expiresAt: "2026-11-10T00:00:00Z" }), now)).toBe("expired");
  });

  it("is revoked when it was revoked, even before its end", () => {
    expect(standing(token({ revokedAt: "2026-11-02T00:00:00Z" }), now)).toBe("revoked");
  });
});

describe("the lane an agent token works in", () => {
  it("is any kind for everything, and the kinds of the worker for a lane", () => {
    expect(laneKinds("all", "")).toBeUndefined();
    expect(laneKinds("characters", "")).toEqual(["character"]);
    expect(laneKinds("accessories", "")).toEqual(["clothes", "adornment", "object"]);
    expect(laneKinds("settings", "")).toEqual(["place"]);
  });

  it("takes typed kinds for the other lane, keeping only names that can be kinds", () => {
    expect(laneKinds("custom", "Playground, deity  deity, not-a-kind, 9x")).toEqual([
      "playground",
      "deity",
    ]);
    expect(laneKinds("custom", "  ")).toBeUndefined();
  });
});
