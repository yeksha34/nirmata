import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { Client, HOST_KEY, rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";

function db(grant = true): Db {
  const pool: Pool = {
    connect: async () => ({
      query: async (text) => {
        if (text.includes("from world_lore.worlds")) return { rows: [{ id: WORLD }] };
        if (text.includes("identity.create_agent_token"))
          return { rows: [{ made: { id: "t1", token: "nga_secret" } }] };
        if (text.includes("from identity.agent_tokens")) return { rows: [] };
        if (text.includes("identity.resolve_agent_token"))
          return {
            rows: grant
              ? [{ token_id: "t1", world_id: WORLD, user_id: AUTHOR, scopes: ["adaptation.read"] }]
              : [],
          };
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return new Db(pool);
}

const call = (
  r: Awaited<ReturnType<typeof rig>>,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) =>
  r.app.request(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("agent access", () => {
  it("lets a signed-in author make, list and revoke a token", async () => {
    const r = await rig([], { data: { db: db(), stores: {} } });
    const seat = r.table.joinAccount({ userId: AUTHOR, name: "Dana", role: "author" });
    const auth = { authorization: `Bearer ${seat.token}` };
    const made = await call(r, "POST", "/api/worlds/example-world/agent-tokens", auth, {
      label: "agent",
    });
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({ id: "t1", token: "nga_secret" });
    expect((await call(r, "GET", "/api/worlds/example-world/agent-tokens", auth)).status).toBe(200);
    expect(
      (await call(r, "DELETE", "/api/worlds/example-world/agent-tokens/t1", auth)).status,
    ).toBe(200);
  });

  it("refuses the host key, which is not a person", async () => {
    const r = await rig([], { data: { db: db(), stores: {} } });
    const host = new Client(r.app);
    expect((await host.join("ignored", { hostKey: HOST_KEY })).status).toBe(201);
    const res = await call(
      r,
      "POST",
      "/api/worlds/example-world/agent-tokens",
      { authorization: `Bearer ${host.token}` },
      { label: "agent" },
    );
    expect(res.status).toBe(403);
  });

  it("knows an agent by its token and by nothing else", async () => {
    const r = await rig([], { data: { db: db(), stores: {} } });
    const ok = await call(r, "GET", "/api/agent/me", { authorization: "Bearer nga_secret" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ worldId: WORLD, scopes: ["adaptation.read"] });
    expect((await call(r, "GET", "/api/agent/me", {})).status).toBe(401);
    expect(
      (await call(r, "GET", "/api/agent/me", { authorization: "Bearer hunter2" })).status,
    ).toBe(401);
    const gone = await rig([], { data: { db: db(false), stores: {} } });
    expect(
      (await call(gone, "GET", "/api/agent/me", { authorization: "Bearer nga_secret" })).status,
    ).toBe(401);
  });

  it("is absent without a database", async () => {
    const r = await rig([]);
    expect(
      (await call(r, "GET", "/api/agent/me", { authorization: "Bearer nga_secret" })).status,
    ).toBe(404);
  });
});
