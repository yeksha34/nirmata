import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { AgentTokenError, AgentTokens } from "../src/agent-tokens";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";

/** A tiny database: knows one world and answers the token functions the way the real ones do. */
function fake(opts: { world?: boolean; grant?: boolean } = {}) {
  const seen: Array<{ text: string; params: unknown[] }> = [];
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params = []) => {
        seen.push({ text: text.replace(/\s+/g, " ").trim(), params });
        if (text.includes("from world_lore.worlds"))
          return { rows: opts.world === false ? [] : [{ id: WORLD }] };
        if (text.includes("identity.create_agent_token"))
          return { rows: [{ made: { id: "t1", token: "nga_secret" } }] };
        if (text.includes("from identity.agent_tokens"))
          return {
            rows: [
              {
                id: "t1",
                label: "agent",
                scopes: ["adaptation.read"],
                expires_at: "2026-12-01",
                revoked_at: null,
                last_used_at: null,
                created_at: "2026-11-01",
              },
            ],
          };
        if (text.includes("identity.resolve_agent_token"))
          return {
            rows:
              opts.grant === false
                ? []
                : [{ token_id: "t1", world_id: WORLD, user_id: AUTHOR, scopes: ["adaptation.read"] }],
          };
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { tokens: new AgentTokens(new Db(pool)), seen };
}

describe("agent tokens", () => {
  it("makes a token for a world and passes the label, scopes and lifetime", async () => {
    const f = fake();
    const made = await f.tokens.create(AUTHOR, "sample-world", "agent", { days: 7 });
    expect(made).toEqual({ id: "t1", token: "nga_secret" });
    const call = f.seen.find((s) => s.text.includes("create_agent_token"));
    expect(call?.params).toEqual([WORLD, "agent", ["adaptation.read", "adaptation.write"], 7]);
  });

  it("refuses a world that is not in the database", async () => {
    await expect(fake({ world: false }).tokens.create(AUTHOR, "nope", "x")).rejects.toBeInstanceOf(
      AgentTokenError,
    );
  });

  it("lists tokens without ever carrying a token or its hash", async () => {
    const rows = await fake().tokens.list(AUTHOR, "sample-world");
    expect(rows).toEqual([
      {
        id: "t1",
        label: "agent",
        scopes: ["adaptation.read"],
        expiresAt: "2026-12-01",
        revokedAt: null,
        lastUsedAt: null,
        createdAt: "2026-11-01",
      },
    ]);
  });

  it("resolves a live token to its author, world and scopes", async () => {
    expect(await fake().tokens.resolve("nga_secret")).toEqual({
      tokenId: "t1",
      worldId: WORLD,
      userId: AUTHOR,
      scopes: ["adaptation.read"],
    });
  });

  it("does not ask the database about something that is not an agent token", async () => {
    const f = fake();
    expect(await f.tokens.resolve("hunter2")).toBeUndefined();
    expect(await f.tokens.resolve(`nga_${"x".repeat(300)}`)).toBeUndefined();
    expect(f.seen).toHaveLength(0);
  });

  it("answers nothing for a revoked, expired or unknown token", async () => {
    expect(await fake({ grant: false }).tokens.resolve("nga_gone")).toBeUndefined();
  });
});
