import { createStarterAdaptationMd, createStarterManifest } from "@nirmata/core";
import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";
const TOKEN = "nga_secret";

const manifest = createStarterManifest({
  slug: "chapter-1",
  title: "Chapter 1",
  source: "chapters/1.md",
});
const adaptationMd = createStarterAdaptationMd({
  slug: "chapter-1",
  title: "Chapter 1",
  source: "chapters/1.md",
});

/** A tiny database for the visual novel routes: one world, and the visual novels saved into it. */
function fakeDb(options: { unpublished?: boolean } = {}) {
  const vns = new Map<string, { manifest: unknown; md: string; slides: unknown; tier: unknown }>();
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
        if (t.includes("from world_lore.worlds where slug"))
          return { rows: params[0] === "sample-world" ? [{ id: WORLD }] : [] };
        if (t.includes("vn_content.save_vn")) {
          if (options.unpublished)
            throw Object.assign(new Error("publish the world before adapting it"), {
              code: "23514",
            });
          const had = vns.get(String(params[1]));
          vns.set(String(params[1]), {
            manifest: params[4] ? JSON.parse(String(params[4])) : had?.manifest,
            md: params[5] === null ? (had?.md ?? "") : String(params[5]),
            slides: params[6] ? JSON.parse(String(params[6])) : had?.slides,
            tier: params[3] ?? had?.tier,
          });
          return { rows: [{ save_vn: "v1" }] };
        }
        if (t.includes("join world_lore.worlds w")) {
          const v = vns.get(String(params[1]));
          return {
            rows: v
              ? [{ slug: params[1], manifest: v.manifest, adaptation_md: v.md, slides: v.slides }]
              : [],
          };
        }
        if (t.includes("from vn_content.vns v join vn_content.vn_drafts d")) {
          return {
            rows: [...vns].map(([slug, v]) => ({
              slug,
              manifest: v.manifest,
              slide_count: v.slides ? 3 : null,
            })),
          };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), vns };
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

describe("the agent's visual novel routes", () => {
  it("saves a visual novel, lists it and reads it back", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const put = await call(r, "PUT", "/vns/chapter-1", { manifest, adaptationMd });
    expect(put.status).toBe(200);
    expect(f.vns.get("chapter-1")?.tier).toBe("short");

    const list = (await (await call(r, "GET", "/vns")).json()) as { vns: Array<{ slug: string }> };
    expect(list.vns.map((v) => v.slug)).toEqual(["chapter-1"]);
    const one = (await (await call(r, "GET", "/vns/chapter-1")).json()) as {
      adaptationMd: string;
    };
    expect(one.adaptationMd).toBe(adaptationMd);
    expect((await call(r, "GET", "/vns/nope")).status).toBe(404);
  });

  it("compiles the saved script into slides and reports what the compiler said", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    await call(r, "PUT", "/vns/chapter-1", { manifest, adaptationMd });
    const res = await call(r, "POST", "/vns/chapter-1/compile");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slideCount: number; diagnostics: unknown[] };
    expect(body.slideCount).toBeGreaterThan(0);
    expect(Array.isArray(body.diagnostics)).toBe(true);
    expect(f.vns.get("chapter-1")?.slides).toBeTruthy();
  });

  it("refuses a bad name, a manifest for another visual novel and an empty save", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    expect((await call(r, "PUT", "/vns/Bad_Name", { adaptationMd: "x" })).status).toBe(400);
    expect((await call(r, "PUT", "/vns/chapter-2", { manifest })).status).toBe(400);
    expect((await call(r, "PUT", "/vns/chapter-1", {})).status).toBe(400);
    expect((await call(r, "PUT", "/vns/chapter-1", { manifest: { slug: "x" } })).status).toBe(400);
  });

  it("says so when the world is not published yet", async () => {
    const r = await rig([], { data: { db: fakeDb({ unpublished: true }).db, stores: {} } });
    const res = await call(r, "PUT", "/vns/chapter-1", { manifest, adaptationMd });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("publish the world");
  });

  it("needs a valid token", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    expect((await call(r, "GET", "/vns", undefined, {})).status).toBe(401);
  });
});
