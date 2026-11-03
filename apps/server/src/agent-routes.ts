import {
  type AgentGrant,
  type AgentScope,
  AgentTokenError,
  type AgentTokens,
  AssetPlanError,
  baselineNeeds,
  CHARACTER_NAME,
  cardHashOf,
  type Need,
  missingAssets,
  PlanStore,
  PrepError,
  PrepStore,
  parseGraph,
  parseKind,
  parsePrep,
  prepStates,
  TemplateError,
  TemplateStore,
} from "@nirmata/adaptation";
import type { Db } from "@nirmata/db";
import { ASSET_KINDS } from "@nirmata/gen";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { HttpError } from "./errors";
import { WORLD_NAME } from "./files";
import { DbLore } from "./lore-store";
import type { Seat } from "./table";

const Make = z.object({
  label: z.string().trim().min(1).max(80),
  days: z.number().int().min(1).max(365).optional(),
});

const Name = z.string().trim().min(1).max(120);
const Plan = z.object({
  type: z.enum(ASSET_KINDS),
  name: Name,
  owner: Name.optional(),
  vnId: z.string().uuid().optional(),
});
const NeedSchema = z.union([
  z.object({
    type: z.literal("sprite"),
    character: Name,
    expression: Name.optional(),
    state: Name.optional(),
  }),
  z.object({ type: z.enum(["clothes", "adornment"]), character: Name, name: Name }),
  z.object({ type: z.enum(["cg", "bg", "object"]), name: Name }),
]);
const Gap = z.object({ needs: z.array(NeedSchema).max(500) });
const Workflow = z.object({
  graph: z.record(z.unknown()),
  note: z.string().trim().max(200).optional(),
  vnId: z.string().uuid().optional(),
});

/** A database refusal (`42501`) or a problem with the request, in the words callers get. */
async function asHttp<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (
      e instanceof AgentTokenError ||
      e instanceof PrepError ||
      e instanceof AssetPlanError ||
      e instanceof TemplateError
    ) {
      throw new HttpError(400, "bad_request", e.message);
    }
    if ((e as { code?: string }).code === "42501") {
      throw new HttpError(403, "forbidden", "Only an author of this world can do that.");
    }
    throw e;
  }
}

/** The agent's grant from `Authorization: Bearer nga_…`, or 401. */
export function agentGrantOf(tokens: AgentTokens) {
  return async (c: Context, scope: AgentScope): Promise<AgentGrant> => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const grant = token ? await tokens.resolve(token) : undefined;
    if (!grant) throw new HttpError(401, "unauthorized", "That agent token is not valid.");
    if (!grant.scopes.includes(scope)) {
      throw new HttpError(403, "forbidden", "That agent token may not do that.");
    }
    return grant;
  };
}

/**
 * Agent access (ADR-0035). An author makes, lists and revokes tokens for a world they run; the
 * adaptation agent presents one at `/api/agent/…`. The agent never reaches the database.
 */
export function registerAgentRoutes(
  app: Hono,
  db: Db,
  tokens: AgentTokens,
  seatOf: (c: Context) => Seat,
): void {
  const author = (c: Context): string => {
    const seat = seatOf(c);
    if (!seat.host || !seat.account) {
      throw new HttpError(403, "forbidden", "Sign in as an author of this world to do that.");
    }
    return seat.account;
  };
  const world = (c: Context): string => {
    const name = c.req.param("name") ?? "";
    if (!WORLD_NAME.test(name)) {
      throw new HttpError(400, "bad_request", "That is not a world name.");
    }
    return name;
  };

  app.get("/api/worlds/:name/agent-tokens", async (c) => {
    const user = author(c);
    return c.json({ tokens: await asHttp(() => tokens.list(user, world(c))) });
  });

  app.post("/api/worlds/:name/agent-tokens", async (c) => {
    const user = author(c);
    const body = Make.parse(await c.req.json().catch(() => ({})));
    const made = await asHttp(() =>
      tokens.create(user, world(c), body.label, body.days ? { days: body.days } : {}),
    );
    return c.json(made, 201);
  });

  app.delete("/api/worlds/:name/agent-tokens/:id", async (c) => {
    const user = author(c);
    world(c);
    await asHttp(() => tokens.revoke(user, c.req.param("id")));
    return c.json({ ok: true });
  });

  // ---- the agent's own routes ---------------------------------------------------------------

  const grantOf = agentGrantOf(tokens);
  const prep = new PrepStore(db);
  const plan = new PlanStore(db);
  const templates = new TemplateStore(db);

  /** The grant for this request, and the world it names, which must be the one the token is for. */
  const forWorld = async (c: Context, scope: AgentScope) => {
    const grant = await grantOf(c, scope);
    const slug = world(c);
    const id = await db.asUser(grant.userId, async (q) => {
      const row = (await q("select id from world_lore.worlds where slug = $1", [slug])).rows[0];
      return row ? String(row.id) : undefined;
    });
    if (id !== grant.worldId) {
      throw new HttpError(403, "forbidden", "That agent token is for another world.");
    }
    return { grant, slug };
  };

  /** The world's character cards, read as the author the token stands for. */
  const characters = async (grant: AgentGrant, slug: string) => {
    const files = (await new DbLore(db, () => grant.userId, 0).cardFiles(slug)) ?? [];
    return files.flatMap((f) =>
      f.card?.fm.kind === "character" ? [{ name: f.card.fm.name, text: f.text }] : [],
    );
  };

  /** Who the agent is, and where it may work. Lets it check its token before it starts. */
  app.get("/api/agent/me", async (c) => {
    const grant = await grantOf(c, "adaptation.read");
    return c.json({ worldId: grant.worldId, scopes: grant.scopes });
  });

  /** The characters, each with its card and whether its prep exists and is current. */
  app.get("/api/agent/worlds/:name/characters", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const cards = await characters(grant, slug);
    const stored = await asHttp(() => prep.list(grant.userId, slug));
    const text = new Map(cards.map((k) => [k.name, k.text]));
    return c.json({
      characters: prepStates(cards, stored).map((s) => ({ ...s, card: text.get(s.name) })),
    });
  });

  app.put("/api/agent/worlds/:name/characters/:character/prep", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const name = c.req.param("character");
    if (!CHARACTER_NAME.test(name)) {
      throw new HttpError(400, "bad_request", "That is not a character name.");
    }
    const card = (await characters(grant, slug)).find((k) => k.name === name);
    if (!card) throw new HttpError(404, "not_found", "There is no such character card.");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // a prep is made from the card as it is now unless the agent says which version it read
    const parsed = await asHttp(async () =>
      parsePrep({ ...body, cardHash: body.cardHash ?? cardHashOf(card.text) }),
    );
    await asHttp(() => prep.save(grant.userId, slug, name, parsed));
    return c.json({ ok: true, cardHash: parsed.cardHash });
  });

  app.delete("/api/agent/worlds/:name/characters/:character/prep", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    await asHttp(() => prep.remove(grant.userId, slug, c.req.param("character")));
    return c.json({ ok: true });
  });

  /** The plan of assets: what is planned or generated, in the world's shared pool and its visual novels. */
  app.get("/api/agent/worlds/:name/assets", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    return c.json({ assets: await asHttp(() => plan.list(grant.userId, slug)) });
  });

  app.post("/api/agent/worlds/:name/assets", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const body = Plan.parse(await c.req.json().catch(() => ({})));
    const made = await asHttp(() => plan.add(grant.userId, slug, body));
    return c.json(made, 201);
  });

  app.delete("/api/agent/worlds/:name/assets/:type/:assetName", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const type = c.req.param("type");
    if (!(ASSET_KINDS as readonly string[]).includes(type)) {
      throw new HttpError(400, "bad_request", "That is not a kind of asset.");
    }
    const vnId = c.req.query("vnId");
    const result = await asHttp(() =>
      plan.remove(
        grant.userId,
        slug,
        type as (typeof ASSET_KINDS)[number],
        c.req.param("assetName"),
        vnId,
      ),
    );
    return c.json({ result });
  });

  /** Of the states a chapter needs, the ones no existing asset expresses. Nothing is planned. */
  app.post("/api/agent/worlds/:name/assets/gap", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const body = Gap.parse(await c.req.json().catch(() => ({})));
    const existing = await asHttp(() => plan.existing(grant.userId, slug));
    return c.json({ missing: missingAssets(body.needs as Need[], existing) });
  });

  /** The first assets: for each prepared character, the unclad base and the items it owns. */
  app.get("/api/agent/worlds/:name/baseline", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const stored = await asHttp(() => prep.list(grant.userId, slug));
    const existing = await asHttp(() => plan.existing(grant.userId, slug));
    const needs = [...stored].flatMap(([name, p]) => baselineNeeds(name, p));
    return c.json({ missing: missingAssets(needs, existing) });
  });

  // ---- workflow templates: the world's copy of the generation workflows --------------------------

  /** What each kind of asset resolves to, and from where: the platform default, the world's copy, or a visual novel's pin. */
  app.get("/api/agent/worlds/:name/workflows", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const vnId = c.req.query("vnId");
    return c.json({ workflows: await asHttp(() => templates.list(grant.userId, slug, vnId)) });
  });

  app.get("/api/agent/worlds/:name/workflows/:type", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const type = await asHttp(async () => parseKind(c.req.param("type")));
    const found = await asHttp(() => templates.get(grant.userId, slug, type, c.req.query("vnId")));
    if (!found) throw new HttpError(404, "not_found", "There is no workflow for that kind.");
    return c.json(found);
  });

  /** The world takes its own copy of the platform default, to customise later. */
  app.post("/api/agent/worlds/:name/workflows/:type/adopt", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const type = await asHttp(async () => parseKind(c.req.param("type")));
    return c.json({ versionId: await asHttp(() => templates.adopt(grant.userId, slug, type)) });
  });

  /** Publish the world's (or a visual novel's) own workflow for a kind. */
  app.put("/api/agent/worlds/:name/workflows/:type", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const type = await asHttp(async () => parseKind(c.req.param("type")));
    const body = Workflow.parse(await c.req.json().catch(() => ({})));
    const versionId = await asHttp(async () =>
      templates.override(grant.userId, slug, type, parseGraph(body.graph), {
        note: body.note,
        vnId: body.vnId,
      }),
    );
    return c.json({ versionId }, 201);
  });

  /** Back to the platform default. */
  app.delete("/api/agent/worlds/:name/workflows/:type", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const type = await asHttp(async () => parseKind(c.req.param("type")));
    await asHttp(() => templates.reset(grant.userId, slug, type));
    return c.json({ ok: true });
  });
}
