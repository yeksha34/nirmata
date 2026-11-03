import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { Client, HOST_KEY, rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";

/** A database that hands out a numbered token for each one asked for, and remembers how. */
function fake() {
  const made: Array<{ label: unknown; scopes: unknown; kinds: unknown }> = [];
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params = []) => {
        if (text.includes("from world_lore.worlds")) return { rows: [{ id: "W" }] };
        if (text.includes("identity.create_agent_token")) {
          made.push({ label: params[1], scopes: params[2], kinds: params[4] });
          return { rows: [{ made: { id: `t${made.length}`, token: `nga_${made.length}` } }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), made };
}

const post = (r: Awaited<ReturnType<typeof rig>>, token: string, body: unknown) =>
  r.app.request("/api/worlds/import", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("importing a world", () => {
  it("makes the world and a token for each worker in one step", async () => {
    const f = fake();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const seat = r.table.joinAccount({ userId: AUTHOR, name: "Dana", role: "author" });
    const res = await post(r, seat.token, {
      title: "Imported Tale",
      settingsKinds: ["place", "playground"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      world: { name: string; title: string };
      tokens: Record<string, string>;
    };
    expect(body.world).toMatchObject({ name: "imported-tale", title: "Imported Tale" });
    expect(Object.keys(body.tokens)).toEqual(["full", "characters", "accessories", "settings"]);
    expect(Object.values(body.tokens).every((t) => t.startsWith("nga_"))).toBe(true);
    // the first token is unrestricted; the others work only on their kinds, and only import
    expect(f.made.map((m) => m.kinds)).toEqual([
      null,
      ["character"],
      ["clothes", "adornment", "object"],
      ["place", "playground"],
    ]);
    expect(f.made[0]?.scopes).toEqual([
      "adaptation.read",
      "adaptation.write",
      "import.read",
      "import.write",
    ]);
    expect(f.made[1]?.scopes).toEqual(["import.read", "import.write"]);
  });

  it("takes place for the settings when none are named", async () => {
    const f = fake();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const seat = r.table.joinAccount({ userId: AUTHOR, name: "Dana", role: "author" });
    await post(r, seat.token, { title: "Another Tale" });
    expect(f.made[3]?.kinds).toEqual(["place"]);
  });

  it("needs a title, and a signed-in author (the host key is not a person)", async () => {
    const f = fake();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const seat = r.table.joinAccount({ userId: AUTHOR, name: "Dana", role: "author" });
    expect((await post(r, seat.token, { title: "  " })).status).toBe(400);
    const host = new Client(r.app);
    await host.join("ignored", { hostKey: HOST_KEY });
    expect((await post(r, host.token ?? "", { title: "Nope" })).status).toBe(403);
    expect(f.made).toEqual([]); // nothing was made
  });
});
