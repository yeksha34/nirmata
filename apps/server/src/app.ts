import { PlayerMode } from "@nirmata/core";
import { FLAVOR_STYLES } from "@nirmata/host";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { describeError, HttpError } from "./errors";
import type { Seat, Send, Table } from "./table";

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

export interface AppOptions {
  table: Table;
  /** Called with the cause of any failure the caller is only told "went wrong" about. */
  log?: ((message: string) => void) | undefined;
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
export function createApp({ table, log }: AppOptions): Hono {
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
  app.get("/api/table", async (c) => c.json(await table.info()));

  app.post("/api/join", async (c) => {
    const body = await json(c, Join);
    const seat = table.join(body.nick ?? "", {
      ...(body.confirmedAdult !== undefined ? { confirmedAdult: body.confirmedAdult } : {}),
      ...(body.hostKey !== undefined ? { hostKey: body.hostKey } : {}),
    });
    return c.json({ token: seat.token, you: table.you(seat) }, 201);
  });

  // ---- one connection, everything that happens ----------------------------------------------

  app.get("/api/events", (c) => events(table, seatOf(c)));

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
