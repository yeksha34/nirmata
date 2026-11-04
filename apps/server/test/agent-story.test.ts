import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";
const TOKEN = "nga_secret";

/** A tiny database for the story routes: one world with a manifest, and the chapters saved into it. */
function fakeDb() {
  const rows = new Map<string, { title: string; body: string }>([
    ["chapters/chapter_1.md", { title: "One", body: "# One\n\ntext" }],
    ["chapters/scenes/s1.md", { title: "S", body: "beat" }],
    ["drafts/d1.md", { title: "D", body: "draft" }],
  ]);
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params = []) => {
        const t = text.replace(/\s+/g, " ");
        if (t.includes("resolve_agent_token"))
          return {
            rows:
              params[0] === TOKEN
                ? [
                    {
                      token_id: "t1",
                      world_id: WORLD,
                      user_id: AUTHOR,
                      scopes: ["adaptation.read", "adaptation.write"],
                    },
                  ]
                : [],
          };
        if (t.includes("select manifest from world_lore.worlds"))
          return { rows: [{ manifest: { name: "Sample World", title: "Sample" } }] };
        if (t.includes("from world_lore.worlds where slug"))
          return { rows: params[0] === "sample-world" ? [{ id: WORLD }] : [] };
        if (t.includes("from reader.writings where world_id")) {
          return {
            rows: [...rows].map(([path, r]) => ({
              path,
              title: r.title,
              size: r.body.length,
              updated_at: "2026-01-01T00:00:00Z",
            })),
          };
        }
        if (t.includes("from reader.writings x")) {
          const r = rows.get(String(params[1]));
          return { rows: r ? [{ path: params[1], title: r.title, body: r.body }] : [] };
        }
        if (t.includes("reader.save_writing")) {
          rows.set(String(params[1]), { title: String(params[2]), body: String(params[3]) });
          return { rows: [{ save_writing: "x" }] };
        }
        if (t.includes("reader.remove_writing")) {
          rows.delete(String(params[1]));
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), rows };
}

const bearer = { authorization: `Bearer ${TOKEN}` };
async function call(
  r: Awaited<ReturnType<typeof rig>>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = bearer,
) {
  return r.app.request(`/api/agent/worlds/sample-world${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("the agent's story routes", () => {
  it("describes the world: its manifest and how much story it has", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    const body = (await (await call(r, "GET", "")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "sample-world",
      manifest: { title: "Sample" },
      chapters: 1,
      scenes: 1,
      drafts: 1,
    });
  });

  it("lists the chapters and drafts, and reads one in full", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    const list = (await (await call(r, "GET", "/writings")).json()) as {
      writings: Array<{ path: string }>;
    };
    expect(list.writings.map((w) => w.path)).toContain("drafts/d1.md");
    const one = (await (await call(r, "GET", "/writing?path=chapters/chapter_1.md")).json()) as {
      text: string;
    };
    expect(one.text).toBe("# One\n\ntext");
    expect((await call(r, "GET", "/writing?path=chapters/nope.md")).status).toBe(404);
  });

  it("saves and removes a draft, and refuses a path outside chapters and drafts", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const put = await call(r, "PUT", "/writing", {
      path: "drafts/new.md",
      text: "# A new draft\n\nwords",
    });
    expect(put.status).toBe(200);
    expect(f.rows.get("drafts/new.md")?.title).toBe("A new draft");
    expect((await call(r, "DELETE", "/writing?path=drafts/new.md")).status).toBe(200);
    expect(f.rows.has("drafts/new.md")).toBe(false);

    expect((await call(r, "PUT", "/writing", { path: "lore/a.md", text: "x" })).status).toBe(400);
    expect((await call(r, "GET", "/writing?path=../world.json")).status).toBe(400);
  });

  it("needs a valid token", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    expect((await call(r, "GET", "/writings", undefined, {})).status).toBe(401);
  });
});
