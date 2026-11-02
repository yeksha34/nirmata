import { CARD_KINDS, CARD_TEMPLATES, PlayerMode } from "@nirmata/core";
import { FLAVOR_STYLES } from "@nirmata/host";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type DataDeps, registerAssetRoutes } from "./asset-routes";
import { type AuthDeps, readProfile, registerAuthRoutes } from "./auth-routes";
import { describeError, HttpError } from "./errors";
import { type CardInput, WORLD_NAME } from "./files";
import type { Seat, Send, Table } from "./table";
import { uiHandler } from "./ui";

const Nick = z.string().trim().min(1).max(64);
const Style = z.enum(FLAVOR_STYLES as [string, ...string[]]).optional();

const Join = z
  .object({
    nick: Nick.optional(),
    confirmedAdult: z.boolean().optional(),
    hostKey: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.hostKey !== undefined || v.nick !== undefined, {
    message: "Pick a nickname to join with.",
  });

const Tags = z.array(z.string().trim().min(1).max(40)).max(12);
const Draft = z.object({ mode: PlayerMode, text: z.string().max(4000) });
const Text = z.object({ text: z.string().min(1).max(1000) });
const Object_ = z.object({ about: Nick, text: z.string().min(1).max(1000) });
const Moderate = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["kick", "mute", "unmute"]), nick: Nick, style: Style }),
  z.object({ action: z.literal("rename"), nick: Nick, newNick: Nick, style: Style }),
]);

const SettingsPatch = z
  .object({
    model: z.string().min(1).optional(),
    params: z
      .object({
        temperature: z.number().min(0).max(5),
        topP: z.number().min(0).max(1),
        topK: z.number().int().min(0),
        maxTokens: z.number().int().min(1).max(32768),
      })
      .partial()
      .strict()
      .optional(),
    budget: z
      .object({
        maxTokens: z.number().int().min(256),
        reserveReply: z.number().int().min(0),
      })
      .partial()
      .strict()
      .optional(),
    plot: z
      .object({
        enabled: z.boolean(),
        everyPlayerTurns: z.number().int().min(0),
        maxPoints: z.number().int().min(1).max(50),
        maxTurns: z.number().int().min(1).max(100),
        model: z.string().min(1),
      })
      .partial()
      .strict()
      .optional(),
    ruleCheck: z.enum(["off", "must", "all"]).optional(),
    maxRegenerations: z.number().int().min(0).max(5).optional(),
    revokesSurviveUndo: z.boolean().optional(),
    playersMayRead: z.boolean().optional(),
  })
  .strict();

const ScaffoldVn = z.object({
  slug: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1),
  mode: z.enum(["mode_1", "mode_2a", "mode_2b", "mode_2_open"]).optional(),
  mc: z.string().trim().max(100).optional(),
  tier: z.enum(["micro", "short", "mid", "large"]).optional(),
});

const SaveVn = z.object({
  manifest: z.any().optional(),
  adaptationMd: z.string().optional(),
  slides: z.any().optional(),
});

const GenerateAsset = z.object({
  type: z.enum(["sprite", "cg", "bg"]),
  name: z.string().trim().min(1),
  targetPath: z.string().optional(),
  positivePrompt: z.string().trim().min(1),
  negativePrompt: z.string().optional(),
  steps: z.number().int().min(1).max(100).optional(),
  cfg: z.number().min(1).max(30).optional(),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  seed: z.number().int().optional(),
  feedback: z.record(z.enum(["better", "keep", "worse"])).optional(),
  workflowOverride: z.record(z.unknown()).optional(),
});

export interface AppOptions {
  table: Table;
  /** Called with the cause of any failure the caller is only told "went wrong" about. */
  log?: ((message: string) => void) | undefined;
  /** The folder of built screens to serve at the front door. */
  ui?: string | undefined;
  /** The database and file stores; without them the server runs from files alone. */
  data?: DataDeps | undefined;
  /** Sign-in through Supabase Auth; without it only the host-key login works. */
  auth?: AuthDeps | undefined;
}

const PING_MS = 15_000;

/**
 * The HTTP face of a table. Every route is a thin wrapper: it finds who is asking from their
 * token, checks the body, and calls the table, which decides what that person may do.
 *
 * Streaming operations (starting a story, retry, a closed round) answer at once with 202; their
 * progress arrives on `GET /api/events` like everything else, so that every connection sees the
 * same story at the same moment.
 */
export function createApp({ table, log, ui, data, auth }: AppOptions): Hono {
  const app = new Hono();

  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json(tooBig(), 400) }));

  app.onError((e, c) => {
    const { status, body } = describeError(e);
    if (status === 500)
      log?.(`Request failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return c.json(body, status);
  });

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "There is nothing at that address." } }, 404),
  );

  const tokenOf = (c: Context): string | undefined => {
    const header = c.req.header("authorization");
    if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
    return c.req.query("token") ?? undefined;
  };
  const seatOf = (c: Context): Seat => table.seat(tokenOf(c));
  const json = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.output<T>> => {
    const raw: unknown = await c.req.json().catch(() => ({}));
    return schema.parse(raw);
  };
  const ok = (c: Context) => c.json({ ok: true });
  const accepted = (c: Context) => c.json({ accepted: true }, 202);

  // ---- open to anyone -----------------------------------------------------------------------

  app.get("/api/health", (c) => c.json({ ok: true }));
  if (data) registerAssetRoutes(app, data, seatOf);
  const userOf = auth ? registerAuthRoutes(app, auth) : undefined;
  app.get("/api/comfyui/status", async (c) => c.json(await table.comfyStatus()));
  app.get("/api/table", async (c) => c.json(await table.info()));

  // visual novel assets list (must precede wildcard /assets/*)
  app.get("/api/worlds/:name/vns/:slug/assets", async (c) =>
    c.json(await table.listWorldVnAssets(seatOf(c), c.req.param("name"), c.req.param("slug"))),
  );
  // detailed asset view & prompt parameters
  app.get("/api/worlds/:name/vns/:slug/asset-meta/:type/:assetName", async (c) =>
    c.json(
      await table.getWorldVnAssetDetail(
        seatOf(c),
        c.req.param("name"),
        c.req.param("slug"),
        c.req.param("type") as "sprite" | "cg" | "bg",
        c.req.param("assetName"),
      ),
    ),
  );
  // trigger comfyui asset generation with feedback
  app.post("/api/worlds/:name/vns/:slug/assets/generate", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, GenerateAsset);
    return c.json(
      table.startWorldVnAsset(seat, c.req.param("name"), c.req.param("slug"), body),
      202,
    );
  });
  // follow generations (survives a page refresh: the server holds the record)
  app.get("/api/vn-jobs", (c) => c.json({ jobs: table.listGenerationJobs(seatOf(c)) }));
  app.get("/api/vn-jobs/:id", (c) => c.json(table.getGenerationJob(seatOf(c), c.req.param("id"))));
  app.post("/api/vn-jobs/:id/cancel", async (c) =>
    c.json(await table.cancelGenerationJob(seatOf(c), c.req.param("id"))),
  );

  // archive all assets in a vn or shared pool
  app.post("/api/worlds/:name/vns/:slug/assets/archive-all", async (c) =>
    c.json(
      await table.archiveAllWorldVnAssets(seatOf(c), c.req.param("name"), c.req.param("slug")),
    ),
  );

  // delete all rendered assets in a vn or shared pool
  app.post("/api/worlds/:name/vns/:slug/assets/delete-all", async (c) =>
    c.json(await table.deleteAllWorldVnAssets(seatOf(c), c.req.param("name"), c.req.param("slug"))),
  );

  // archive a single asset
  app.post("/api/worlds/:name/vns/:slug/asset-meta/:type/:assetName/archive", async (c) =>
    c.json(
      await table.archiveWorldVnAsset(
        seatOf(c),
        c.req.param("name"),
        c.req.param("slug"),
        c.req.param("type") as "sprite" | "cg" | "bg",
        c.req.param("assetName"),
      ),
    ),
  );

  // delete a single asset
  app.delete("/api/worlds/:name/vns/:slug/asset-meta/:type/:assetName", async (c) =>
    c.json(
      await table.deleteWorldVnAsset(
        seatOf(c),
        c.req.param("name"),
        c.req.param("slug"),
        c.req.param("type") as "sprite" | "cg" | "bg",
        c.req.param("assetName"),
      ),
    ),
  );

  app.get("/api/worlds/:name/vns/:slug/assets/*", async (c) => {
    const worldName = c.req.param("name");
    const slug = c.req.param("slug");
    const prefix = `/api/worlds/${worldName}/vns/${slug}/assets/`;
    const assetPath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    const asset = await table.readWorldVnAsset(worldName, slug, assetPath);
    if (!asset) throw new HttpError(404, "not_found", "Asset not found.");
    return c.body(new Uint8Array(asset.data), 200, {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=86400",
    });
  });

  app.get("/api/worlds/:name/dataset/:slug/:assetName/:timestamp/image", async (c) => {
    // the database copy is private: only the signed-in host's own cookie reaches it
    const host = table.hostUserId();
    const fromDatabase = host !== undefined && (await userOf?.(c))?.user.id === host;
    const asset = await table.readDatasetImage(
      c.req.param("name"),
      c.req.param("slug"),
      c.req.param("assetName"),
      c.req.param("timestamp"),
      fromDatabase,
    );
    if (!asset) throw new HttpError(404, "not_found", "Asset not found.");
    return c.body(new Uint8Array(asset.data), 200, {
      "Content-Type": asset.contentType,
      "Cache-Control": fromDatabase ? "private, max-age=300" : "public, max-age=86400",
    });
  });

  // delete one run from the gallery (host only); the database copy goes with it for the signed-in host
  app.delete("/api/worlds/:name/dataset/:slug/:assetName/:timestamp", async (c) => {
    const seat = seatOf(c);
    const host = table.hostUserId();
    const fromDatabase = host !== undefined && (await userOf?.(c))?.user.id === host;
    const done = await table.deleteDatasetRun(
      seat,
      c.req.param("name"),
      c.req.param("slug"),
      c.req.param("assetName"),
      c.req.param("timestamp"),
      fromDatabase,
    );
    if (!done.database && !done.files)
      throw new HttpError(404, "not_found", "There is no such run.");
    return c.json({ ok: true, ...done });
  });

  app.post("/api/join", async (c) => {
    const body = await json(c, Join);
    const seat = table.join(body.nick ?? "", {
      ...(body.confirmedAdult !== undefined ? { confirmedAdult: body.confirmedAdult } : {}),
      ...(body.hostKey !== undefined ? { hostKey: body.hostKey } : {}),
    });
    return c.json({ token: seat.token, you: table.you(seat) }, 201);
  });

  // Come to the table as the signed-in person. Who is the host comes from the account (the host
  // invitation sets it), not from a key; the same person always gets the same seat back.
  app.post("/api/join/session", async (c) => {
    if (!auth || !userOf)
      throw new HttpError(404, "not_found", "There is nothing at that address.");
    const session = await userOf(c);
    if (!session) throw new HttpError(401, "sign_in_required", "Sign in first.");
    if (!auth.db)
      throw new HttpError(
        503,
        "database_unavailable",
        "The database is not set up on this server.",
      );
    const profile = await readProfile(auth.db, session).catch(() => {
      throw new HttpError(503, "profile_unavailable", "Your profile cannot be read right now.");
    });
    if (!profile?.ageConfirmed)
      throw new HttpError(409, "onboarding_required", "Finish setting up your account first.");
    const seat = table.joinAccount({
      userId: session.user.id,
      name: profile.displayName,
      role: profile.role,
    });
    return c.json({ token: seat.token, you: table.you(seat) }, 201);
  });

  // ---- one connection, everything that happens ----------------------------------------------

  app.get("/api/events", (c) => events(table, seatOf(c)));

  // ---- the library of worlds (host) ----------------------------------------------------------

  app.get("/api/worlds", async (c) => c.json({ worlds: await table.worlds(seatOf(c)) }));
  app.post("/api/worlds/open", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, z.object({ name: z.string().min(1).max(64) }));
    return c.json({ world: await table.openWorld(seat, body.name) });
  });
  app.post("/api/worlds", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z.object({
        title: z.string().trim().min(1, "A world needs a title.").max(120),
        tagline: z.string().trim().max(200).default(""),
        premise: z.string().trim().max(4000).default(""),
      }),
    );
    return c.json({ world: await table.createWorld(seat, body) }, 201);
  });
  // the starting shapes for cards (a person, a place, a custom ...): the same for everyone
  app.get("/api/card-templates", (c) => c.json({ templates: CARD_TEMPLATES }));
  app.get("/api/recent", async (c) => c.json({ stories: await table.recent(seatOf(c)) }));
  app.get("/api/worlds/:name", async (c) =>
    c.json(await table.worldDetail(seatOf(c), c.req.param("name"))),
  );
  // a chapter or a draft in a world's folder, to read
  app.get("/api/worlds/:name/writing", async (c) => {
    const path = c.req.query("path");
    if (!path) throw new HttpError(400, "bad_request", "Say which chapter or draft to read.");
    return c.json(await table.worldWriting(seatOf(c), c.req.param("name"), path));
  });
  // visual novel adaptations in a world
  app.get("/api/worlds/:name/vns", async (c) =>
    c.json({ vns: await table.worldVns(seatOf(c), c.req.param("name")) }),
  );
  app.get("/api/worlds/:name/vns/:slug", async (c) =>
    c.json(await table.worldVn(seatOf(c), c.req.param("name"), c.req.param("slug"))),
  );
  app.post("/api/worlds/:name/vns/scaffold", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, ScaffoldVn);
    return c.json({ vn: await table.scaffoldWorldVn(seat, c.req.param("name"), body) }, 201);
  });
  app.put("/api/worlds/:name/vns/:slug", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, SaveVn);
    await table.saveWorldVn(seat, c.req.param("name"), c.req.param("slug"), body);
    return c.json({ ok: true });
  });
  app.post("/api/worlds/:name/vns/:slug/compile", async (c) =>
    c.json(await table.compileWorldVn(seatOf(c), c.req.param("name"), c.req.param("slug"))),
  );
  // list all visual novels across worlds (for /vn index)
  app.get("/api/vns", async (c) => c.json({ vns: await table.listAllVns(seatOf(c)) }));
  app.patch("/api/worlds/:name", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z
        .object({
          title: z.string().trim().min(1, "A world needs a title.").max(120).optional(),
          tagline: z.string().trim().max(200).optional(),
          genre: Tags.optional(),
          tone: Tags.optional(),
          perspective: z.enum(["first-person", "second-person", "third-person"]).optional(),
        })
        .strict(),
    );
    return c.json({ world: await table.editWorld(seat, c.req.param("name"), body) });
  });
  // a world's cards, without opening it: add or change one (the form's fields, or the file's text)
  app.put("/api/worlds/:name/cards", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z.union([
        z.object({ path: z.string().min(1).max(200), text: z.string().max(60000) }),
        z.object({
          path: z.string().min(1).max(200).optional(),
          form: z.object({
            kind: z.enum(CARD_KINDS),
            name: z.string().trim().min(1, "A card needs a name.").max(120),
            keywords: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
            summary: z.string().trim().max(300).default(""),
            always: z.boolean().default(false),
            fields: z.record(z.string(), z.string().max(8000)).default({}),
            role: z.string().trim().max(40).optional(),
            scope: z.enum(["chapter", "story", "both"]).optional(),
            severity: z.enum(["must", "should"]).optional(),
            body: z.string().max(60000).default(""),
          }),
        }),
      ]),
    );
    return c.json({ card: await table.saveCard(seat, c.req.param("name"), body as CardInput) });
  });
  app.delete("/api/worlds/:name/cards", async (c) => {
    const seat = seatOf(c);
    const path = c.req.query("path");
    if (!path) throw new HttpError(400, "bad_request", "Say which card to remove.");
    await table.removeCard(seat, c.req.param("name"), path);
    return ok(c);
  });
  app.post("/api/worlds/:name/archive", async (c) => {
    await table.archiveWorld(seatOf(c), c.req.param("name"));
    return ok(c);
  });
  app.post("/api/worlds/:name/stories", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, z.object({ arcId: z.string().min(1).optional() }));
    const id = await table.startStoryIn(
      seat,
      c.req.param("name"),
      body.arcId ? { arcId: body.arcId } : {},
    );
    return c.json({ id }, 202);
  });
  app.post("/api/worlds/:name/stories/:id/resume", async (c) => {
    await table.resumeStoryIn(seatOf(c), c.req.param("name"), c.req.param("id"));
    return ok(c);
  });

  app.get("/api/state", (c) => c.json(table.snapshot(seatOf(c))));
  app.post("/api/leave", (c) => {
    table.leave(seatOf(c));
    return ok(c);
  });
  app.post("/api/play", (c) => c.json({ you: table.play(seatOf(c)) }));
  app.post("/api/watch", (c) => c.json({ you: table.watch(seatOf(c)) }));

  // ---- the shared board ---------------------------------------------------------------------

  app.put("/api/board/draft", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, Draft);
    table.setDraft(seat, body.mode, body.text);
    return ok(c);
  });
  app.post("/api/board/ready", (c) => {
    table.ready(seatOf(c));
    return ok(c);
  });
  app.post("/api/board/unready", (c) => {
    table.unready(seatOf(c));
    return ok(c);
  });
  app.post("/api/board/remark", async (c) => {
    const seat = seatOf(c);
    table.remark(seat, (await json(c, Text)).text);
    return ok(c);
  });
  app.post("/api/board/object", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, Object_);
    table.object(seat, body.about, body.text);
    return ok(c);
  });
  app.delete("/api/board/remarks/:id", (c) => {
    table.withdraw(seatOf(c), c.req.param("id"));
    return ok(c);
  });
  app.post("/api/board/close", (c) => {
    table.closeRound(seatOf(c));
    return accepted(c);
  });
  app.post("/api/board/moderate", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, Moderate);
    table.moderate(
      seat,
      body.action === "rename"
        ? { action: "rename", nick: body.nick, newNick: body.newNick, style: body.style as never }
        : { action: body.action, nick: body.nick, style: body.style as never },
    );
    return ok(c);
  });

  // ---- stories ------------------------------------------------------------------------------

  app.get("/api/stories", async (c) => c.json({ stories: await table.stories(seatOf(c)) }));
  app.post("/api/stories", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, z.object({ arcId: z.string().min(1).optional() }));
    const id = await table.startStory(seat, body.arcId ? { arcId: body.arcId } : {});
    return c.json({ id }, 202);
  });
  app.post("/api/stories/:id/resume", async (c) => {
    await table.resumeStory(seatOf(c), c.req.param("id"));
    return ok(c);
  });

  app.post("/api/story/close", (c) => {
    table.closeStory(seatOf(c));
    return ok(c);
  });
  app.post("/api/story/retry", (c) => {
    table.retry(seatOf(c));
    return accepted(c);
  });
  app.post("/api/story/continue", (c) => {
    table.continueStory(seatOf(c));
    return accepted(c);
  });
  app.post("/api/story/stop", (c) => {
    table.stop(seatOf(c));
    return ok(c);
  });
  app.post("/api/story/plot", (c) => {
    table.extractPlot(seatOf(c));
    return accepted(c);
  });
  app.post("/api/story/undo", async (c) => c.json({ undone: await table.undo(seatOf(c)) }));
  app.post("/api/story/edit", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z.object({ id: z.string().min(1), text: z.string().min(1).max(8000) }),
    );
    await table.edit(seat, body.id, body.text);
    return ok(c);
  });
  app.post("/api/story/goto", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, z.object({ id: z.string().min(1).nullable() }));
    await table.goto(seat, body.id);
    return ok(c);
  });
  app.post("/api/story/pin", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z.object({ fact: z.string().min(1).max(500), on: z.boolean().default(true) }),
    );
    await table.pin(seat, body.fact, body.on);
    return ok(c);
  });
  app.post("/api/story/break", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, z.object({ title: z.string().trim().min(1).max(120).optional() }));
    await table.breakChapter(seat, body.title);
    return ok(c);
  });
  app.post("/api/story/save-as-world", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z.object({
        name: z
          .string()
          .regex(WORLD_NAME, "A world's name uses lowercase letters, digits and hyphens."),
        title: z.string().trim().min(1).max(120).optional(),
        at: z.string().min(1).optional(),
      }),
    );
    return c.json({ world: await table.saveAsWorld(seat, body) }, 201);
  });
  app.post("/api/story/plot-points", async (c) => {
    const seat = seatOf(c);
    const body = await json(
      c,
      z.object({ card: z.string().min(1), text: z.string().min(1).max(1000) }),
    );
    await table.addPlotPoint(seat, body.card, body.text);
    return ok(c);
  });
  app.post("/api/story/plot-points/undo", async (c) =>
    c.json({ undone: await table.undoLastPlot(seatOf(c)) }),
  );
  app.delete("/api/story/plot-points/:id", async (c) => {
    await table.revokePlotPoint(seatOf(c), c.req.param("id"));
    return ok(c);
  });

  // ---- the host's own: source cards and settings --------------------------------------------

  app.get("/api/source/world", async (c) => {
    const seat = seatOf(c);
    return c.json({ world: await table.cards.world(table.actorFor(seat)) });
  });
  app.get("/api/source/cards", async (c) => {
    const seat = seatOf(c);
    return c.json({ cards: await table.cards.list(table.actorFor(seat)) });
  });
  app.put("/api/source/cards", async (c) => {
    const seat = seatOf(c);
    const body = await json(c, z.object({ path: z.string().min(1), text: z.string().min(1) }));
    const card = await table.cards.editFromText(table.actorFor(seat), body.path, body.text);
    return c.json({ card: { path: card.path, id: card.fm.id } });
  });
  app.delete("/api/source/cards/:id", async (c) => {
    const seat = seatOf(c);
    await table.cards.remove(table.actorFor(seat), c.req.param("id"));
    return ok(c);
  });

  app.get("/api/settings", (c) => {
    const seat = seatOf(c);
    if (!seat.host) throw new HttpError(403, "forbidden", "Only the host can see the settings.");
    return c.json(table.settingsView());
  });
  app.patch("/api/settings", async (c) => {
    const seat = seatOf(c);
    return c.json(table.changeSettings(seat, await json(c, SettingsPatch)));
  });

  // last, so the screens never shadow the API
  if (ui) app.get("*", uiHandler(ui));

  return app;
}

/**
 * The live connection (server-sent events). The first message is a full snapshot, so a browser
 * that reconnects after a dropped connection simply gets the current state again and needs no
 * replay. Closing the stream lets whatever is already queued, such as "you were sent away",
 * reach the browser first.
 */
function events(table: Table, seat: Seat): Response {
  const encoder = new TextEncoder();
  let end = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let unsubscribe = () => {};
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          end();
        }
      };
      const ping = setInterval(() => write(frame("ping", {})), PING_MS);
      end = () => {
        if (!open) return;
        open = false;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the browser
        }
      };
      const send: Send = (event, data) => write(frame(event, data));
      unsubscribe = table.subscribe(seat, send, end);
    },
    cancel() {
      end();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** One server-sent event: a name, a JSON body, and a blank line to end it. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function tooBig() {
  return { error: { code: "too_big", message: "That is too much to send at once." } };
}
