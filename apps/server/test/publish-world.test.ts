import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { Client, HOST_KEY, rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";

/** A database that publishes, or refuses because there is nothing to publish. */
function fake(empty = false) {
  const log: string[] = [];
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params = []) => {
        const t = text.replace(/\s+/g, " ");
        if (t.includes("from world_lore.worlds")) return { rows: [{ id: "W" }] };
        if (t.includes("from world_lore.world_lines")) return { rows: [{ id: "L" }] };
        if (t.includes("set_line_ready")) {
          log.push("ready");
          return { rows: [] };
        }
        if (t.includes("publish_world_line")) {
          if (empty) throw Object.assign(new Error("nothing to publish"), { code: "23514" });
          log.push(`publish:${String(params[1])}`);
          return { rows: [{ id: "V1" }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), log };
}

const publish = (r: Awaited<ReturnType<typeof rig>>, token: string, body: unknown = {}) =>
  r.app.request("/api/worlds/sample-world/publish", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe("publishing a world from its page", () => {
  it("marks the draft ready and publishes it as the next version", async () => {
    const f = fake();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const seat = r.table.joinAccount({ userId: AUTHOR, name: "Dana", role: "author" });
    const res = await publish(r, seat.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ versionId: "V1" });
    expect(f.log).toEqual(["ready", "publish:published by the author"]);
  });

  it("says plainly when there is nothing to publish", async () => {
    const f = fake(true);
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const seat = r.table.joinAccount({ userId: AUTHOR, name: "Dana", role: "author" });
    const res = await publish(r, seat.token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /no cards to publish/,
    );
  });

  it("needs a signed-in author (the host key is not a person)", async () => {
    const f = fake();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const host = new Client(r.app);
    await host.join("ignored", { hostKey: HOST_KEY });
    expect((await publish(r, host.token ?? "")).status).toBe(403);
    expect(f.log).toEqual([]);
  });
});
