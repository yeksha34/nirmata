import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";
const TOKEN = "nga_secret";

const DEFAULT = { "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "a" } } };

/** A tiny database for the workflow routes: the platform default for every kind, and the world's own copies. */
function fakeDb(refuse?: string) {
  const world = new Map<string, Record<string, unknown>>();
  const drafts: unknown[][] = [];
  const calls: string[] = [];
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
        if (t.includes("platform.effective_template")) {
          const own = world.get(String(params[2]));
          return {
            rows: [
              {
                template_version_id: own ? "v-own" : "v-platform",
                resolved_scope: own ? "world" : "platform",
                body: own ?? DEFAULT,
                param_map: {},
                schema_version: 1,
                checksum: own ? "own" : "plat",
              },
            ],
          };
        }
        if (t.includes("from platform.templates where kind_key")) return { rows: [] };
        if (t.includes("create_template_override")) return { rows: [{ id: "tpl1" }] };
        if (t.includes("update platform.template_drafts")) {
          drafts.push(params);
          return { rows: [] };
        }
        if (t.includes("set_template_ready")) return { rows: [] };
        if (t.includes("platform.publish_template")) {
          if (refuse) throw Object.assign(new Error(refuse), { code: "22023" });
          world.set("workflow_sprite", JSON.parse(String(drafts.at(-1)?.[0])));
          return { rows: [{ id: "v-own" }] };
        }
        if (t.includes("upgrade_world_template")) {
          calls.push(`adopt ${String(params[1])}`);
          return { rows: [{ id: "v-platform" }] };
        }
        if (t.includes("reset_world_template")) {
          world.delete(String(params[1]));
          calls.push(`reset ${String(params[1])}`);
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), calls };
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

describe("the agent's workflow routes", () => {
  it("lists a workflow for every kind of asset, with where it came from", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    const res = await call(r, "GET", "/workflows");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workflows: Array<{ type: string; scope: string }> };
    expect(body.workflows.map((w) => w.type)).toEqual([
      "sprite",
      "cg",
      "bg",
      "clothes",
      "adornment",
      "object",
    ]);
    expect(body.workflows.every((w) => w.scope === "platform")).toBe(true);
  });

  it("reads one graph, and refuses a kind that does not exist", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    const body = (await (await call(r, "GET", "/workflows/sprite")).json()) as {
      graph: unknown;
    };
    expect(body.graph).toEqual(DEFAULT);
    expect((await call(r, "GET", "/workflows/weapon")).status).toBe(400);
  });

  it("publishes the world's own copy, which then resolves for the world, and resets it", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    const graph = { "1": { class_type: "KSampler", inputs: { steps: 30 } } };
    const put = await call(r, "PUT", "/workflows/sprite", { graph, note: "more steps" });
    expect(put.status).toBe(201);
    const got = (await (await call(r, "GET", "/workflows/sprite")).json()) as {
      scope: string;
      graph: unknown;
    };
    expect(got).toMatchObject({ scope: "world", graph });
    expect((await call(r, "DELETE", "/workflows/workflow_sprite")).status).toBe(400);
    expect((await call(r, "DELETE", "/workflows/sprite")).status).toBe(200);
    expect(f.calls).toContain("reset workflow_sprite");
  });

  it("adopts the platform default for a world", async () => {
    const f = fakeDb();
    const r = await rig([], { data: { db: f.db, stores: {} } });
    expect((await call(r, "POST", "/workflows/bg/adopt")).status).toBe(200);
    expect(f.calls).toContain("adopt workflow_bg");
  });

  it("refuses what is not a workflow, and what the database refuses", async () => {
    const r = await rig([], {
      data: { db: fakeDb("node 1 has a disallowed class_type").db, stores: {} },
    });
    expect((await call(r, "PUT", "/workflows/sprite", { graph: {} })).status).toBe(400);
    expect(
      (await call(r, "PUT", "/workflows/sprite", { graph: { "1": { inputs: {} } } })).status,
    ).toBe(400);
    const refused = await call(r, "PUT", "/workflows/sprite", {
      graph: { "1": { class_type: "Evil", inputs: {} } },
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("disallowed");
  });

  it("needs a valid token", async () => {
    const r = await rig([], { data: { db: fakeDb().db, stores: {} } });
    expect((await call(r, "GET", "/workflows", undefined, {})).status).toBe(401);
  });
});
