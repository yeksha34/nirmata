import { Db, type Pool } from "@nirmata/db";
import type { AssetStore } from "@nirmata/storage";
import { describe, expect, it } from "vitest";
import { Client, HOST_KEY, rig } from "./helpers";

const RENDER = "11111111-1111-4111-8111-111111111111";
const PATH = "22222222-2222-4222-8222-222222222222/hero/one.png";

function dbReturning(rows: Record<string, unknown>[]): Db {
  const pool: Pool = {
    connect: async () => ({
      query: async (text) => ({
        rows: text.includes("render_file")
          ? rows
          : text.includes("current_user")
            ? [{ user: "app_rw" }]
            : [],
      }),
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return new Db(pool);
}

function memoryStore(files: Record<string, number[]>): AssetStore {
  return {
    get: async (p) =>
      files[p] ? { data: new Uint8Array(files[p]), contentType: undefined } : undefined,
    put: async () => undefined,
    remove: async () => undefined,
  };
}

const row = (store: string) => [{ storage_path: PATH, store, content_type: "image/png", bytes: 3 }];

async function hostOf(r: Awaited<ReturnType<typeof rig>>) {
  const c = new Client(r.app);
  expect((await c.join("ignored", { hostKey: HOST_KEY })).status).toBe(201);
  return c;
}

describe("asset routes", () => {
  it("are absent when no database is configured", async () => {
    const r = await rig([]);
    const res = await new Client(r.app).get(`/api/assets/renders/${RENDER}/file`);
    expect(res.status).toBe(404);
  });

  it("serve a file from the store the row names", async () => {
    const r = await rig([], {
      data: {
        db: dbReturning(row("local")),
        stores: { local: memoryStore({ [PATH]: [1, 2, 3] }) },
      },
    });
    const res = await r.app.request(`/api/assets/renders/${RENDER}/file`, {
      headers: { authorization: `Bearer ${(await hostOf(r)).token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("answer the failures plainly", async () => {
    const cases: Array<[string, Record<string, unknown>[], Record<string, number[]>, number]> = [
      ["unknown id", [], {}, 404],
      ["bytes deleted", row("none"), {}, 404],
      ["store not set up", row("supabase"), {}, 503],
      ["file missing from its store", row("local"), {}, 404],
    ];
    for (const [name, rows, files, status] of cases) {
      const r = await rig([], {
        data: { db: dbReturning(rows), stores: { local: memoryStore(files) } },
      });
      const host = await hostOf(r);
      expect((await host.get(`/api/assets/renders/${RENDER}/file`)).status, name).toBe(status);
    }
  });

  it("are for the host only", async () => {
    const r = await rig([], {
      data: { db: dbReturning(row("local")), stores: { local: memoryStore({ [PATH]: [1] }) } },
    });
    expect((await new Client(r.app).get(`/api/assets/renders/${RENDER}/file`)).status).toBe(401);
    const player = new Client(r.app);
    await player.join("Ann");
    expect((await player.get(`/api/assets/renders/${RENDER}/file`)).status).toBe(403);
    expect((await player.get("/api/health/db")).status).toBe(403);
  });

  it("report the database when the host asks", async () => {
    const r = await rig([], { data: { db: dbReturning([]), stores: {} } });
    const res = await (await hostOf(r)).get("/api/health/db");
    expect(res.body).toEqual({ ok: true, user: "app_rw" });
  });
});
