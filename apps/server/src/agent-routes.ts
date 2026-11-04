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
  VnError,
  VnStore,
  WorldStore,
  WritingError,
  WritingStore,
  parseWritingPath,
} from "@nirmata/adaptation";
import { compileVn, VnManifestSchema, VnSlideDeckSchema } from "@nirmata/core";
import type { Db } from "@nirmata/db";
import { ASSET_KINDS } from "@nirmata/gen";
import { CardError, CardStore, GuideError, GuideStore } from "@nirmata/importer";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { HttpError } from "./errors";
import { WORLD_NAME } from "./files";
import { DbLore } from "./lore-store";
import type { Seat } from "./table";

const Make = z.object({
  label: z.string().trim().min(1).max(80),
  days: z.number().int().min(1).max(365).optional(),
  /** A lane: the kinds of card the token may write. Leave out for any kind. */
  kinds: z.array(z.string().trim().min(1).max(40)).min(1).max(40).optional(),
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
const WritingBody = z.object({ path: z.string().min(1).max(400), text: z.string().max(4_194_304) });
const VN_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VnParts = z
  .object({
    manifest: VnManifestSchema.optional(),
    adaptationMd: z.string().max(4_000_000).optional(),
    slides: VnSlideDeckSchema.optional(),
  })
  .refine((v) => v.manifest || v.adaptationMd !== undefined || v.slides, {
    message: "Send a manifest, adaptationMd or slides.",
  });
const CARD_ID = /^([a-z][a-z0-9]{0,39})\.([a-z0-9][a-z0-9-]{0,60})$/;
const GUIDE_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const CardBody = z.object({
  name: z.string().trim().min(1).max(200),
  summary: z.string().max(2000).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  always: z.boolean().optional(),
  role: z.string().max(80).optional(),
  scope: z.enum(["chapter", "story", "both"]).optional(),
  severity: z.enum(["must", "should"]).optional(),
  fields: z.record(z.string().max(200_000)).optional(),
  body: z.string().max(400_000).optional(),
});
const SkillBody = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).optional(),
  body: z.string().min(1).max(1_000_000),
});
const RuleBody = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(250_000),
});
const PublishBody = z.object({ note: z.string().trim().max(200).optional() });
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
      e instanceof TemplateError ||
      e instanceof VnError ||
      e instanceof WritingError ||
      e instanceof CardError ||
      e instanceof GuideError
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
  return async (c: Context, scope: AgentScope | readonly AgentScope[]): Promise<AgentGrant> => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const grant = token ? await tokens.resolve(token) : undefined;
    if (!grant) throw new HttpError(401, "unauthorized", "That agent token is not valid.");
    const wanted = typeof scope === "string" ? [scope] : scope;
    if (!wanted.some((w) => grant.scopes.includes(w))) {
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
      tokens.create(user, world(c), body.label, {
        ...(body.days ? { days: body.days } : {}),
        ...(body.kinds ? { kinds: body.kinds } : {}),
      }),
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
  const vns = new VnStore(db);
  const writings = new WritingStore(db);
  const worlds = new WorldStore(db);
  const cards = new CardStore(db);
  const guides = new GuideStore(db);

  // The author publishes the draft cards as the world's next version, from the world's page. A
  // visual novel is pinned to the latest published version, so one must exist before it is made.
  app.post("/api/worlds/:name/publish", async (c) => {
    const user = author(c);
    const slug = world(c);
    const body = PublishBody.parse(await c.req.json().catch(() => ({})));
    try {
      const version = await asHttp(() =>
        cards.publish(user, slug, body.note || "published by the author"),
      );
      return c.json({ versionId: version ?? null });
    } catch (e) {
      if ((e as { code?: string }).code === "23514") {
        throw new HttpError(409, "nothing_to_publish", "There are no cards to publish yet.");
      }
      throw e;
    }
  });

  /** The story is read and written by an adaptation and by an import alike. */
  const READ = ["adaptation.read", "import.read"] as const;
  const WRITE = ["adaptation.write", "import.write"] as const;

  /** The grant for this request, and the world it names, which must be the one the token is for. */
  const forWorld = async (c: Context, scope: AgentScope | readonly AgentScope[]) => {
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

  /** A lane token writes cards of its own kinds only. */
  const mayWrite = (grant: AgentGrant, kind: string): void => {
    if (grant.kinds && !grant.kinds.includes(kind)) {
      throw new HttpError(403, "forbidden", "That agent token may not write cards of that kind.");
    }
  };
  /** Skills, rules, publishing and the story are not cards: a lane token leaves them alone. */
  const mayWriteMore = (grant: AgentGrant): void => {
    if (grant.kinds) {
      throw new HttpError(403, "forbidden", "That agent token may write cards of its kinds only.");
    }
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

  // ---- visual novels: the manifest, the script and the compiled slides ------------------------------

  const vnSlug = (c: Context): string => {
    const slug = c.req.param("slug") ?? "";
    if (!VN_SLUG.test(slug))
      throw new HttpError(400, "bad_request", "That is not a visual novel name.");
    return slug;
  };

  /** The world's visual novels, without their text. */
  app.get("/api/agent/worlds/:name/vns", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const list = (await asHttp(() => vns.list(grant.userId, slug))) ?? [];
    return c.json({
      vns: list.map((v) => ({ slug: v.slug, manifest: v.manifest, slideCount: v.slideCount })),
    });
  });

  app.get("/api/agent/worlds/:name/vns/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.read");
    const found = await asHttp(() => vns.get(grant.userId, slug, vnSlug(c)));
    if (!found) throw new HttpError(404, "not_found", "There is no such visual novel.");
    return c.json(found);
  });

  /** Save any of the manifest, the script (adaptation.md) and the slides. A new visual novel is made. */
  app.put("/api/agent/worlds/:name/vns/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const body = VnParts.parse(await c.req.json().catch(() => ({})));
    const name = vnSlug(c);
    if (body.manifest && body.manifest.slug !== name) {
      throw new HttpError(400, "bad_request", "The manifest names another visual novel.");
    }
    await asHttp(() => vns.save(grant.userId, slug, name, body));
    return c.json({ ok: true });
  });

  /** Compile the saved script into slides, save them, and say what was wrong with it. */
  app.post("/api/agent/worlds/:name/vns/:slug/compile", async (c) => {
    const { grant, slug } = await forWorld(c, "adaptation.write");
    const name = vnSlug(c);
    const found = await asHttp(() => vns.get(grant.userId, slug, name));
    if (!found) throw new HttpError(404, "not_found", "There is no such visual novel.");
    const manifest = VnManifestSchema.parse(found.manifest);
    const result = compileVn(found.adaptationMd, { manifest });
    manifest.updatedAt = new Date().toISOString();
    await asHttp(() => vns.save(grant.userId, slug, name, { manifest, slides: result.deck }));
    return c.json({ slideCount: result.deck.slides.length, diagnostics: result.diagnostics });
  });

  // ---- the story itself: world.json, chapters and drafts -----------------------------------------

  /** What world.json held, and how much story text the world has. */
  app.get("/api/agent/worlds/:name", async (c) => {
    const { grant, slug } = await forWorld(c, READ);
    const manifest = await asHttp(() => worlds.manifest(grant.userId, slug));
    const list = (await asHttp(() => writings.list(grant.userId, slug))) ?? [];
    return c.json({
      name: slug,
      manifest: manifest ?? null,
      chapters: list.filter(
        (w) => w.path.startsWith("chapters/") && !w.path.startsWith("chapters/scenes/"),
      ).length,
      scenes: list.filter((w) => w.path.startsWith("chapters/scenes/")).length,
      drafts: list.filter((w) => w.path.startsWith("drafts/")).length,
    });
  });

  /** The chapters and drafts, without their text. */
  app.get("/api/agent/worlds/:name/writings", async (c) => {
    const { grant, slug } = await forWorld(c, READ);
    return c.json({ writings: (await asHttp(() => writings.list(grant.userId, slug))) ?? [] });
  });

  /** One chapter or draft in full. The path is a query because it has slashes in it. */
  app.get("/api/agent/worlds/:name/writing", async (c) => {
    const { grant, slug } = await forWorld(c, READ);
    const path = await asHttp(async () => parseWritingPath(c.req.query("path")));
    const found = await asHttp(() => writings.get(grant.userId, slug, path));
    if (!found) throw new HttpError(404, "not_found", "There is no such chapter or draft.");
    return c.json(found);
  });

  app.put("/api/agent/worlds/:name/writing", async (c) => {
    const { grant, slug } = await forWorld(c, WRITE);
    mayWriteMore(grant);
    const body = WritingBody.parse(await c.req.json().catch(() => ({})));
    await asHttp(() => writings.save(grant.userId, slug, body.path, body.text));
    return c.json({ ok: true });
  });

  app.delete("/api/agent/worlds/:name/writing", async (c) => {
    const { grant, slug } = await forWorld(c, WRITE);
    mayWriteMore(grant);
    const path = await asHttp(async () => parseWritingPath(c.req.query("path")));
    await asHttp(() => writings.remove(grant.userId, slug, path));
    return c.json({ ok: true });
  });
  // ---- importing: cards, the world's skills and the author's rules ----------------------------------
  // An importing agent works one file at a time: it reads a piece of the source, writes the cards it
  // holds, and goes on. Nothing here reads a folder; the agent holds the source and sends the text.

  const cardId = (c: Context): { kind: string; slug: string } => {
    const m = CARD_ID.exec(c.req.param("id") ?? "");
    if (!m) {
      throw new HttpError(400, "bad_request", "A card id looks like kind.name, in lowercase.");
    }
    return { kind: m[1] as string, slug: m[2] as string };
  };
  const guideSlug = (c: Context): string => {
    const slug = c.req.param("slug") ?? "";
    if (!GUIDE_SLUG.test(slug)) {
      throw new HttpError(400, "bad_request", "A name is lowercase letters, digits and hyphens.");
    }
    return slug;
  };

  /** The cards, without their text; ?kind= keeps one kind. */
  app.get("/api/agent/worlds/:name/cards", async (c) => {
    const { grant, slug } = await forWorld(c, "import.read");
    return c.json({ cards: await asHttp(() => cards.list(grant.userId, slug, c.req.query("kind"))) });
  });

  app.get("/api/agent/worlds/:name/cards/:id", async (c) => {
    const { grant, slug } = await forWorld(c, "import.read");
    const { kind, slug: part } = cardId(c);
    const found = await asHttp(() => cards.get(grant.userId, slug, `${kind}.${part}`));
    if (!found) throw new HttpError(404, "not_found", "There is no such card.");
    return c.json(found);
  });

  /** Save a card, making it if it is new. The id is kind.name; a kind of the world's own is fine. */
  app.put("/api/agent/worlds/:name/cards/:id", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    const { kind, slug: part } = cardId(c);
    mayWrite(grant, kind);
    const body = CardBody.parse(await c.req.json().catch(() => ({})));
    const done = await asHttp(() => cards.save(grant.userId, slug, { ...body, kind, slug: part }));
    return c.json(
      { ok: true, id: `${kind}.${part}`, created: done.created },
      done.created ? 201 : 200,
    );
  });

  app.delete("/api/agent/worlds/:name/cards/:id", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    const { kind, slug: part } = cardId(c);
    mayWrite(grant, kind);
    const removed = await asHttp(() => cards.remove(grant.userId, slug, `${kind}.${part}`));
    if (!removed) throw new HttpError(404, "not_found", "There is no such card.");
    return c.json({ ok: true });
  });

  /** Publish the cards as the world's next version, so readers and visual novels can use them. */
  app.post("/api/agent/worlds/:name/publish", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    mayWriteMore(grant);
    const body = PublishBody.parse(await c.req.json().catch(() => ({})));
    const version = await asHttp(() =>
      cards.publish(grant.userId, slug, body.note || "import by agent"),
    );
    return c.json({ versionId: version ?? null });
  });

  /** The world's skills: the author's guides to writing in it. */
  app.get("/api/agent/worlds/:name/skills", async (c) => {
    const { grant, slug } = await forWorld(c, "import.read");
    return c.json({ skills: await asHttp(() => guides.skills(grant.userId, slug)) });
  });
  app.get("/api/agent/worlds/:name/skills/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "import.read");
    const found = await asHttp(() => guides.skill(grant.userId, slug, guideSlug(c)));
    if (!found) throw new HttpError(404, "not_found", "There is no such skill.");
    return c.json(found);
  });
  app.put("/api/agent/worlds/:name/skills/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    mayWriteMore(grant);
    const body = SkillBody.parse(await c.req.json().catch(() => ({})));
    await asHttp(() => guides.saveSkill(grant.userId, slug, { ...body, slug: guideSlug(c) }));
    return c.json({ ok: true });
  });
  app.delete("/api/agent/worlds/:name/skills/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    mayWriteMore(grant);
    await asHttp(() => guides.removeSkill(grant.userId, slug, guideSlug(c)));
    return c.json({ ok: true });
  });

  /** The author's rules of writing the world. */
  app.get("/api/agent/worlds/:name/rules", async (c) => {
    const { grant, slug } = await forWorld(c, "import.read");
    return c.json({ rules: await asHttp(() => guides.rules(grant.userId, slug)) });
  });
  app.get("/api/agent/worlds/:name/rules/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "import.read");
    const found = await asHttp(() => guides.rule(grant.userId, slug, guideSlug(c)));
    if (!found) throw new HttpError(404, "not_found", "There is no such rule.");
    return c.json(found);
  });
  app.put("/api/agent/worlds/:name/rules/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    mayWriteMore(grant);
    const body = RuleBody.parse(await c.req.json().catch(() => ({})));
    await asHttp(() => guides.saveRule(grant.userId, slug, { ...body, slug: guideSlug(c) }));
    return c.json({ ok: true });
  });
  app.delete("/api/agent/worlds/:name/rules/:slug", async (c) => {
    const { grant, slug } = await forWorld(c, "import.write");
    mayWriteMore(grant);
    await asHttp(() => guides.removeRule(grant.userId, slug, guideSlug(c)));
    return c.json({ ok: true });
  });
}
