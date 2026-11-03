import {
  type AgentGrant,
  type AgentScope,
  AgentTokenError,
  type AgentTokens,
} from "@nirmata/adaptation";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { HttpError } from "./errors";
import { WORLD_NAME } from "./files";
import type { Seat } from "./table";

const Make = z.object({
  label: z.string().trim().min(1).max(80),
  days: z.number().int().min(1).max(365).optional(),
});

/** A database refusal (`42501`) or a problem with the request, in the words callers get. */
async function asHttp<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof AgentTokenError) throw new HttpError(404, "not_found", e.message);
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
    if (!WORLD_NAME.test(name))
      throw new HttpError(400, "bad_request", "That is not a world name.");
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

  const grantOf = agentGrantOf(tokens);
  /** Who the agent is, and where it may work. Lets it check its token before it starts. */
  app.get("/api/agent/me", async (c) => {
    const grant = await grantOf(c, "adaptation.read");
    return c.json({ worldId: grant.worldId, scopes: grant.scopes });
  });
}
