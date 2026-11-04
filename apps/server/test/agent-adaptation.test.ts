import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";
const TOKEN = "nga_secret";

/** A tiny database for the agent's routes: one world, one character card, and the tables it fills. */
function fakeDb(scopes: string[] = ["adaptation.read", "adaptation.write"]) {
  const preps = new Map<string, unknown[]>();
  const assets: Array<{ id: string; kind: string; name: string; vn: string | null }> = [];
  const links: unknown[][] = [];
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params = []) => {
        const t = text.replace(/\s+/g, " ");
        if (t.includes("resolve_agent_token"))
          return {
            rows:
              params[0] === TOKEN
                ? [{ token_id: "t1", world_id: WORLD, user_id: AUTHOR, scopes }]
                : [],
          };
        if (t.includes("from world_lore.worlds where slug"))
          return { rows: params[0] === "sample-world" ? [{ id: WORLD }] : [] };
        if (t.includes("from world_lore.world_lines")) return { rows: [{ id: "l1" }] };
        if (t.includes("from world_lore.cards c"))
          return {
            rows: [
              {
                id: "c1",
                kind: "character",
                slug: "mara",
                title: "Mara",
                body: "Mara is tall.",
                meta: { path: "characters/mara.md" },
              },
            ],
          };
        if (t.includes("card_draft_parts") || t.includes("card_draft_secrets")) return { rows: [] };
        if (t.includes("save_character_prep")) {
          preps.set(String(params[1]), params);
          return { rows: [] };
        }
        if (t.includes("from assets.character_prep"))
          return {
            rows: [...preps.values()].map((p) => ({
              character_name: p[1],
              base_positive: p[2],
              base_negative: p[3],
              notes: p[4],
              card_hash: p[5],
            })),
          };
        if (t.includes("from assets.character_expressions"))
          return {
            rows: [...preps.values()].flatMap((p) =>
              (JSON.parse(String(p[6])) as Array<{ expression: string; tags: string }>).map(
                (e) => ({
                  character_name: p[1],
                  expression: e.expression,
                  tags: e.tags,
                }),
              ),
            ),
          };
        if (t.includes("from assets.character_outfits"))
          return {
            rows: [...preps.values()].flatMap((p) =>
              (JSON.parse(String(p[7])) as Array<{ kind: string; name: string; tags: string }>).map(
                (o) => ({ character_name: p[1], kind_key: o.kind, name: o.name, tags: o.tags }),
              ),
            ),
          };
        if (t.includes("assets.create_asset")) {
          if (assets.some((a) => a.kind === params[2] && a.name === params[3]))
            throw Object.assign(new Error("duplicate"), { code: "23505" });
          const id = `a${assets.length + 1}`;
          assets.push({ id, kind: String(params[2]), name: String(params[3]), vn: null });
          return { rows: [{ id }] };
        }
        if (t.includes("assets.set_links")) {
          links.push(params);
          return { rows: [] };
        }
        if (t.includes("from assets.v_asset_list where world_id = $1 and status_key")) {
          return {
            rows: assets.map((a) => ({
              asset_id: a.id,
              vn_id: a.vn,
              kind_key: a.kind,
              name: a.name,
              status_key: "planned",
            })),
          };
        }
        if (t.includes("from assets.v_asset_list"))
          return {
            rows: assets
              .filter((a) => a.kind === params[1] && a.name === params[2])
              .map((a) => ({ asset_id: a.id })),
          };
        if (t.includes("assets.unplan_asset")) {
          const i = assets.findIndex((a) => a.id === params[0]);
          if (i >= 0) assets.splice(i, 1);
          return { rows: [{ result: "deleted" }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), preps, assets, links };
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

describe("the adaptation agent's routes", () => {
  it("lists the characters from their cards, each not yet prepared", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const res = await call(r, "GET", "/characters");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { characters: Array<Record<string, unknown>> };
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]).toMatchObject({ name: "Mara", state: "none" });
    expect(String(body.characters[0]?.card)).toContain("Mara is tall.");
  });

  it("saves a prep, then shows the character as current, and refuses a bad one", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const put = await call(r, "PUT", "/characters/Mara/prep", {
      basePositive: "tall",
      expressions: [{ expression: "calm", tags: "soft" }],
    });
    expect(put.status).toBe(200);
    expect(f.preps.get("Mara")?.[2]).toBe("tall");
    const list = (await (await call(r, "GET", "/characters")).json()) as {
      characters: Array<{ state: string }>;
    };
    expect(list.characters[0]?.state).toBe("current");
    expect(
      (await call(r, "PUT", "/characters/Mara/prep", { expressions: [{ expression: "No Good" }] }))
        .status,
    ).toBe(400);
    expect((await call(r, "PUT", "/characters/Nobody/prep", {})).status).toBe(404);
  });

  it("plans the baseline, then reports it done; a chapter adds only what is missing", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    await call(r, "PUT", "/characters/Mara/prep", {
      outfits: [{ kind: "clothes", name: "robe" }],
    });
    const base = (await (await call(r, "GET", "/baseline")).json()) as {
      missing: Array<{ asset: string; type: string; name: string; owner?: string }>;
    };
    expect(base.missing.map((m) => m.asset)).toEqual(["Mara_naked", "Mara_robe"]);
    for (const m of base.missing) {
      const res = await call(r, "POST", "/assets", { type: m.type, name: m.name, owner: m.owner });
      expect(res.status).toBe(201);
    }
    expect(f.links).toHaveLength(2);
    const again = (await (await call(r, "GET", "/baseline")).json()) as { missing: unknown[] };
    expect(again.missing).toEqual([]);

    const gap = (await (
      await call(r, "POST", "/assets/gap", {
        needs: [
          { type: "clothes", character: "Mara", name: "robe" },
          { type: "bg", name: "quay" },
        ],
      })
    ).json()) as { missing: Array<{ asset: string }> };
    expect(gap.missing.map((m) => m.asset)).toEqual(["quay"]);
  });

  it("refuses a repeat, a sprite with no character and a bad kind", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    expect((await call(r, "POST", "/assets", { type: "bg", name: "quay" })).status).toBe(201);
    expect((await call(r, "POST", "/assets", { type: "bg", name: "quay" })).status).toBe(400);
    expect((await call(r, "POST", "/assets", { type: "sprite", name: "calm" })).status).toBe(400);
    expect((await call(r, "POST", "/assets", { type: "weapon", name: "x" })).status).toBe(400);
    expect((await call(r, "DELETE", "/assets/bg/quay")).status).toBe(200);
    expect((await call(r, "DELETE", "/assets/bg/quay")).status).toBe(400);
  });

  it("needs a token, the right scope and the token's own world", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    expect((await call(r, "GET", "/characters", undefined, {})).status).toBe(401);
    const readOnly = await rig([], { data: { db: fakeDb(["adaptation.read"]).db, stores: {} } });
    expect((await call(readOnly, "GET", "/characters")).status).toBe(200);
    expect((await call(readOnly, "POST", "/assets", { type: "bg", name: "quay" })).status).toBe(
      403,
    );
    const other = await r.app.request("/api/agent/worlds/other-world/characters", {
      headers: bearer,
    });
    expect(other.status).toBe(403);
  });
});
