import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { rig } from "./helpers";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";
const IMPORTER = "nga_import";
const ADAPTER = "nga_adapt";

interface Card {
  kind: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  parts: Array<[string, string]>;
  secrets: string[];
}

/** A tiny database for the import routes: cards, skills and rules kept in memory. */
function fakeDb() {
  const cards = new Map<string, Card>();
  const skills = new Map<string, { title: string; description: string; body: string }>();
  const rules = new Map<string, { title: string; body: string }>();
  const writings = new Map<string, { title: string; body: string }>();
  const log: string[] = [];
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params = []) => {
        const t = text.replace(/\s+/g, " ");
        if (t.includes("resolve_agent_token")) {
          const scopes =
            params[0] === IMPORTER
              ? ["import.read", "import.write"]
              : params[0] === ADAPTER
                ? ["adaptation.read", "adaptation.write"]
                : undefined;
          return {
            rows: scopes ? [{ token_id: "t1", world_id: WORLD, user_id: AUTHOR, scopes }] : [],
          };
        }
        if (t.includes("from world_lore.worlds where slug"))
          return { rows: params[0] === "sample-world" ? [{ id: WORLD }] : [] };
        if (t.includes("from world_lore.world_lines where world_id"))
          return { rows: [{ id: "L" }] };

        // cards
        if (t.includes("length(d.body) as body_size")) {
          const only = params[2] as string | null;
          return {
            rows: [...cards]
              .filter(([, c]) => !only || c.kind === only)
              .map(([slug, c]) => ({
                kind: c.kind,
                slug,
                title: c.title,
                meta: c.meta,
                body_size: c.body.length,
                parts: c.parts.map(([k]) => k),
                part_size: c.parts.reduce((n, [, b]) => n + b.length, 0),
                secret_size: c.secrets.reduce((n, b) => n + b.length, 0),
              })),
          };
        }
        if (t.includes("select c.id as card, c.kind")) {
          const c = cards.get(String(params[2]));
          return {
            rows: c
              ? [
                  {
                    card: params[2],
                    kind: c.kind,
                    slug: params[2],
                    title: c.title,
                    body: c.body,
                    meta: c.meta,
                  },
                ]
              : [],
          };
        }
        if (t.includes("select part_key, body from world_lore.card_draft_parts"))
          return {
            rows: (cards.get(String(params[1]))?.parts ?? []).map(([k, b]) => ({
              part_key: k,
              body: b,
            })),
          };
        if (t.includes("select body from world_lore.card_draft_secrets"))
          return { rows: (cards.get(String(params[1]))?.secrets ?? []).map((b) => ({ body: b })) };
        if (t.includes("select c.id, d.meta ->> 'id' as card_id")) {
          const c = cards.get(String(params[2]));
          return { rows: c ? [{ id: params[2], card_id: c.meta.id }] : [] };
        }
        if (t.includes("insert into world_lore.cards")) {
          const slug = String(params[2]);
          if (!cards.has(slug))
            cards.set(slug, {
              kind: String(params[1]),
              title: "",
              body: "",
              meta: {},
              parts: [],
              secrets: [],
            });
          else (cards.get(slug) as Card).kind = String(params[1]);
          return { rows: [{ id: slug }] };
        }
        if (t.includes("insert into world_lore.card_drafts")) {
          const c = cards.get(String(params[1])) as Card;
          c.title = String(params[3]);
          c.body = String(params[4]);
          c.meta = JSON.parse(String(params[5]));
          return { rows: [] };
        }
        if (t.includes("delete from world_lore.card_draft_parts")) {
          (cards.get(String(params[1])) as Card).parts = [];
          return { rows: [] };
        }
        if (t.includes("delete from world_lore.card_draft_secrets")) {
          (cards.get(String(params[1])) as Card).secrets = [];
          return { rows: [] };
        }
        if (t.includes("insert into world_lore.card_draft_parts")) {
          (cards.get(String(params[1])) as Card).parts.push([String(params[4]), String(params[5])]);
          return { rows: [] };
        }
        if (t.includes("insert into world_lore.card_draft_secrets")) {
          (cards.get(String(params[1])) as Card).secrets.push(String(params[4]));
          return { rows: [] };
        }
        if (t.includes("select id from world_lore.cards where world_id")) {
          return { rows: cards.has(String(params[1])) ? [{ id: params[1] }] : [] };
        }
        if (t.includes("delete from world_lore.card_drafts")) return { rows: [] };
        if (t.includes("delete from world_lore.cards c")) {
          cards.delete(String(params[0]));
          return { rows: [] };
        }
        if (t.includes("set_line_ready")) {
          log.push("ready");
          return { rows: [] };
        }
        if (t.includes("publish_world_line")) {
          log.push(`publish:${String(params[1])}`);
          return { rows: [{ id: "V1" }] };
        }

        // skills and rules
        if (t.includes("from world_lore.world_skills where world_id = $1 order by slug"))
          return {
            rows: [...skills].map(([slug, s]) => ({
              slug,
              title: s.title,
              description: s.description,
              size: s.body.length,
            })),
          };
        if (t.includes("from world_lore.world_skills where world_id = $1 and slug")) {
          const s = skills.get(String(params[1]));
          return { rows: s ? [{ slug: params[1], ...s }] : [] };
        }
        if (t.includes("save_world_skill")) {
          skills.set(String(params[1]), {
            title: String(params[2]),
            description: String(params[3]),
            body: String(params[4]),
          });
          return { rows: [] };
        }
        if (t.includes("remove_world_skill")) {
          skills.delete(String(params[1]));
          return { rows: [] };
        }
        if (t.includes("from world_lore.author_rules where world_id = $1 order by slug"))
          return {
            rows: [...rules].map(([slug, r]) => ({ slug, title: r.title, size: r.body.length })),
          };
        if (t.includes("from world_lore.author_rules where world_id = $1 and slug")) {
          const r = rules.get(String(params[1]));
          return { rows: r ? [{ slug: params[1], ...r }] : [] };
        }
        if (t.includes("save_author_rule")) {
          rules.set(String(params[1]), { title: String(params[2]), body: String(params[3]) });
          return { rows: [] };
        }
        if (t.includes("remove_author_rule")) {
          rules.delete(String(params[1]));
          return { rows: [] };
        }

        // chapters, for the shared story routes
        if (t.includes("reader.save_writing")) {
          writings.set(String(params[1]), { title: String(params[2]), body: String(params[3]) });
          return { rows: [{ save_writing: "x" }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), cards, skills, rules, writings, log };
}

async function call(
  r: Awaited<ReturnType<typeof rig>>,
  method: string,
  path: string,
  body?: unknown,
  token = IMPORTER,
) {
  return r.app.request(`/api/agent/worlds/sample-world${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const make = async () => {
  const f = fakeDb();
  return { f, r: await rig([], { data: { db: f.db, stores: {} } }) };
};

describe("the agent's import routes", () => {
  it("saves a card of the world's own kind, and reads it back", async () => {
    const { f, r } = await make();
    const put = await call(r, "PUT", "/cards/deity.areola", {
      name: "Areola",
      summary: "A goddess of the hearth",
      keywords: ["hearth"],
      fields: { appearance: "Tall.", secrets: "She lied once.", voice: "  " },
      body: "Notes.",
    });
    expect(put.status).toBe(201);
    expect(await put.json()).toMatchObject({ id: "deity.areola", created: true });
    const stored = f.cards.get("deity-areola");
    expect(stored?.kind).toBe("deity");
    expect(stored?.meta.id).toBe("deity.areola");
    expect(stored?.parts).toEqual([["appearance", "Tall."]]); // a blank part is not kept
    expect(stored?.secrets).toEqual(["She lied once."]); // the secret goes where secrets go

    const got = (await (await call(r, "GET", "/cards/deity.areola")).json()) as {
      name: string;
      kind: string;
      fields: Record<string, string>;
    };
    expect(got).toMatchObject({ name: "Areola", kind: "deity" });
    expect(got.fields).toEqual({ appearance: "Tall.", secrets: "She lied once." });
    expect((await call(r, "PUT", "/cards/deity.areola", { name: "Areola" })).status).toBe(200);
  });

  it("lists cards, all or of one kind, without their text", async () => {
    const { r } = await make();
    await call(r, "PUT", "/cards/character.tina", { name: "Tina", fields: { age: "30" } });
    await call(r, "PUT", "/cards/clothes.red-coat", { name: "Red coat" });
    const all = (await (await call(r, "GET", "/cards")).json()) as {
      cards: Array<{ id: string; parts: string[] }>;
    };
    expect(all.cards.map((c) => c.id)).toEqual(["character.tina", "clothes.red-coat"]);
    expect(all.cards[0]?.parts).toEqual(["age"]);
    const only = (await (await call(r, "GET", "/cards?kind=clothes")).json()) as {
      cards: Array<{ id: string }>;
    };
    expect(only.cards.map((c) => c.id)).toEqual(["clothes.red-coat"]);
  });

  it("refuses an id that is not kind.name, and a kind in capitals or with a hyphen", async () => {
    const { r } = await make();
    expect((await call(r, "PUT", "/cards/tina", { name: "T" })).status).toBe(400);
    expect((await call(r, "PUT", "/cards/Deity.areola", { name: "T" })).status).toBe(400);
    expect((await call(r, "PUT", "/cards/old-god.areola", { name: "T" })).status).toBe(400);
    expect((await call(r, "PUT", "/cards/deity.areola", {})).status).toBe(400); // a card needs a name
  });

  it("removes a card, and says when there is none", async () => {
    const { f, r } = await make();
    await call(r, "PUT", "/cards/lore.fog", { name: "Fog" });
    expect((await call(r, "DELETE", "/cards/lore.fog")).status).toBe(200);
    expect(f.cards.has("lore-fog")).toBe(false);
    expect((await call(r, "DELETE", "/cards/lore.fog")).status).toBe(404);
    expect((await call(r, "GET", "/cards/lore.fog")).status).toBe(404);
  });

  it("publishes the world", async () => {
    const { f, r } = await make();
    const done = await call(r, "POST", "/publish", { note: "first import" });
    expect(await done.json()).toEqual({ versionId: "V1" });
    expect(f.log).toEqual(["ready", "publish:first import"]);
  });

  it("keeps the world's skills and the author's rules", async () => {
    const { f, r } = await make();
    const skill = await call(r, "PUT", "/skills/dark-fantasy", {
      title: "Dark fantasy",
      description: "how to write it",
      body: "# Guide\n\nlong text",
    });
    expect(skill.status).toBe(200);
    expect(f.skills.get("dark-fantasy")?.title).toBe("Dark fantasy");
    const list = (await (await call(r, "GET", "/skills")).json()) as {
      skills: Array<{ slug: string }>;
    };
    expect(list.skills.map((s) => s.slug)).toEqual(["dark-fantasy"]);
    expect(
      ((await (await call(r, "GET", "/skills/dark-fantasy")).json()) as { body: string }).body,
    ).toContain("long text");
    expect((await call(r, "GET", "/skills/none")).status).toBe(404);
    expect((await call(r, "PUT", "/skills/Bad Name", { title: "x", body: "x" })).status).toBe(400);

    expect(
      (await call(r, "PUT", "/rules/world-02-culture", { title: "Culture", body: "rule text" }))
        .status,
    ).toBe(200);
    expect(f.rules.get("world-02-culture")?.body).toBe("rule text");
    expect(
      (await call(r, "PUT", "/rules/world-02-culture", { title: "Culture", body: " " })).status,
    ).toBe(400);
    expect((await call(r, "DELETE", "/rules/world-02-culture")).status).toBe(200);
    expect(f.rules.size).toBe(0);
  });

  it("lets an import-only token save a chapter, since the story is shared", async () => {
    const { f, r } = await make();
    const put = await call(r, "PUT", "/writing", {
      path: "chapters/ch5/scene/p1.md",
      text: "# P1\n\nbeat",
    });
    expect(put.status).toBe(200);
    expect(f.writings.get("chapters/ch5/scene/p1.md")?.title).toBe("P1");
  });

  it("keeps imports and adaptations apart: each token does only its own kind of work", async () => {
    const { r } = await make();
    // an adaptation token cannot write cards, skills or rules, or publish
    expect((await call(r, "PUT", "/cards/lore.fog", { name: "Fog" }, ADAPTER)).status).toBe(403);
    expect((await call(r, "GET", "/cards", undefined, ADAPTER)).status).toBe(403);
    expect((await call(r, "POST", "/publish", {}, ADAPTER)).status).toBe(403);
    expect((await call(r, "PUT", "/skills/x", { title: "x", body: "x" }, ADAPTER)).status).toBe(
      403,
    );
    // an import token cannot touch the asset plan
    expect((await call(r, "GET", "/assets", undefined, IMPORTER)).status).toBe(403);
  });

  it("needs a valid token", async () => {
    const { r } = await make();
    expect((await call(r, "GET", "/cards", undefined, "")).status).toBe(401);
    expect((await call(r, "GET", "/cards", undefined, "nga_wrong")).status).toBe(401);
  });
});
