import {
  AuthError,
  type AuthSession,
  type GoTrue,
  type SessionStore,
  type VerifyType,
} from "@nirmata/auth";
import type { Db } from "@nirmata/db";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { HttpError } from "./errors";

/** Sign-in through the server: the browser talks only to these routes, never to Supabase. */
export interface AuthDeps {
  gotrue: GoTrue;
  sessions: SessionStore;
  /** Needed for onboarding and the profile; sign-in itself works without it. */
  db?: Db | undefined;
  /** Where the server is reached, e.g. http://127.0.0.1:8788 (email links come back here). */
  siteUrl: string;
}

const COOKIE = "nirmata_session";
const MAX_AGE_S = 7 * 24 * 60 * 60;

const Login = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
const Signup = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
const Register = z.object({
  token: z.string().trim().min(8).max(200),
  password: z.string().min(8).max(200),
});
const Onboard = z.object({
  attestAdult: z.boolean().optional(),
  token: z.string().trim().min(8).max(200).optional(),
});
const VERIFY_TYPES = ["signup", "invite", "recovery", "magiclink", "email"] as const;

const SAFE_NEXT = /^\/(?!\/)[A-Za-z0-9\-._~/#?=&%]*$/;

function secure(c: Context): boolean {
  return c.req.url.startsWith("https:") || c.req.header("x-forwarded-proto") === "https";
}

/** A browser may only change things from this site's own pages. */
function sameSite(c: Context): void {
  const origin = c.req.header("origin");
  if (!origin) return;
  let host: string | undefined;
  try {
    host = new URL(origin).host;
  } catch {
    host = undefined;
  }
  if (host !== new URL(c.req.url).host) {
    throw new HttpError(403, "cross_site", "That request came from another site.");
  }
}

function failureOf(e: unknown): never {
  if (e instanceof AuthError) {
    if (e.failure === "bad_credentials")
      throw new HttpError(401, "bad_credentials", "Wrong email or password.");
    if (e.failure === "invitation_required") {
      throw new HttpError(403, "invitation_required", "An invitation is required to sign up.");
    }
    if (e.failure === "exists") {
      throw new HttpError(
        409,
        "account_exists",
        "An account with that address already exists. Sign in instead.",
      );
    }
    if (e.failure === "unavailable")
      throw new HttpError(503, "auth_unavailable", "Sign-in is not available right now.");
    throw new HttpError(
      400,
      "signup_rejected",
      "That did not work. Check the details and try again.",
    );
  }
  throw e;
}

/** The address a pending invitation is for; 404 when the token is wrong, used or expired. */
async function invitationEmail(db: Db, token: string): Promise<string> {
  const row =
    token.length < 8
      ? undefined
      : (await db.server((q) => q("select identity.invitation_email($1) as email", [token])))
          .rows[0];
  if (typeof row?.email !== "string") {
    throw new HttpError(404, "invitation_invalid", "That invitation is not valid.");
  }
  return row.email;
}

export interface Profile {
  displayName: string;
  /** May found worlds: the host (invited with invite-host). */
  canFoundWorlds: boolean;
  ageConfirmed: boolean;
}

/** The signed-in person's profile, or null before they have finished onboarding. */
export async function readProfile(db: Db, session: AuthSession): Promise<Profile | null> {
  const row = (
    await db.asUser(
      session.user.id,
      (q) =>
        q(
          `select p.display_name, p.can_found_worlds, coalesce(a.age_confirmed, false) as age_confirmed
             from identity.profiles p left join identity.profile_age a using (user_id) where p.user_id = $1`,
          [session.user.id],
        ),
      { email: session.user.email },
    )
  ).rows[0];
  if (!row) return null;
  return {
    displayName: String(row.display_name),
    canFoundWorlds: row.can_found_worlds === true,
    ageConfirmed: row.age_confirmed === true,
  };
}

/**
 * Adds /api/auth/* and /auth/callback. Returns a function that finds who is signed in for a
 * request, for the routes that will need a person (it refreshes the Supabase token when due).
 */
export function registerAuthRoutes(
  app: Hono,
  deps: AuthDeps,
): (c: Context) => Promise<AuthSession | undefined> {
  const { gotrue, sessions, db } = deps;
  const callback = `${deps.siteUrl.replace(/\/+$/, "")}/auth/callback`;

  const userOf = (c: Context) => sessions.resolve(getCookie(c, COOKIE));
  const requireUser = async (c: Context): Promise<AuthSession> => {
    const session = await userOf(c);
    if (!session) throw new HttpError(401, "sign_in_required", "Sign in first.");
    return session;
  };
  const startSession = (c: Context, session: AuthSession) => {
    setCookie(c, COOKIE, sessions.create(session), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: MAX_AGE_S,
      secure: secure(c),
    });
  };
  const publicUser = (s: AuthSession) => ({ id: s.user.id, email: s.user.email });

  app.post("/api/auth/login", async (c) => {
    sameSite(c);
    const body = Login.parse(await c.req.json().catch(() => ({})));
    try {
      const session = await gotrue.login(body.email, body.password);
      startSession(c, session);
      return c.json({ user: publicUser(session) });
    } catch (e) {
      return failureOf(e);
    }
  });

  // the invitation check runs inside Supabase (a hook on user creation); without a pending
  // invitation for this address the account is refused
  app.post("/api/auth/signup", async (c) => {
    sameSite(c);
    const body = Signup.parse(await c.req.json().catch(() => ({})));
    try {
      const session = await gotrue.signup(body.email, body.password, callback);
      if (!session) return c.json({ status: "check_email" }, 202);
      startSession(c, session);
      return c.json({ status: "signed_in", user: publicUser(session) });
    } catch (e) {
      return failureOf(e);
    }
  });

  // which address an invitation is for, so the page can show it; the token is the proof
  app.get("/api/auth/invitation", async (c) => {
    if (!db)
      throw new HttpError(
        503,
        "database_unavailable",
        "The database is not set up on this server.",
      );
    const email = await invitationEmail(db, c.req.query("token") ?? "");
    return c.json({ email });
  });

  // no email is sent: the person holds the invitation link, the server makes the account for the
  // address it was made for, and signs them in. Then the page calls /api/auth/onboard.
  app.post("/api/auth/register", async (c) => {
    sameSite(c);
    if (!db)
      throw new HttpError(
        503,
        "database_unavailable",
        "The database is not set up on this server.",
      );
    const body = Register.parse(await c.req.json().catch(() => ({})));
    const email = await invitationEmail(db, body.token);
    try {
      await gotrue.createUser(email, body.password);
      const session = await gotrue.login(email, body.password);
      startSession(c, session);
      return c.json({ user: publicUser(session) }, 201);
    } catch (e) {
      return failureOf(e);
    }
  });

  // email links (confirm, invite, reset) land here with ?token_hash=…&type=… and finish sign-in
  app.get("/auth/callback", async (c) => {
    const type = c.req.query("type") ?? "";
    const hash = c.req.query("token_hash") ?? "";
    const next = c.req.query("next") ?? "/";
    const target = SAFE_NEXT.test(next) ? next : "/";
    if (!hash || !(VERIFY_TYPES as readonly string[]).includes(type))
      return c.redirect("/?auth=failed");
    try {
      startSession(c, await gotrue.verify(hash, type as VerifyType));
      return c.redirect(target);
    } catch {
      return c.redirect("/?auth=failed");
    }
  });

  app.post("/api/auth/logout", async (c) => {
    sameSite(c);
    await sessions.end(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", async (c) => {
    const session = await requireUser(c);
    let profile: Profile | null = null;
    if (db) {
      try {
        profile = await readProfile(db, session);
      } catch {
        profile = null; // signed in, but the profile cannot be read right now
      }
    }
    return c.json({ user: publicUser(session), profile });
  });

  // once per person: make the profile, confirm adulthood, and accept the invitation (all or nothing)
  app.post("/api/auth/onboard", async (c) => {
    sameSite(c);
    const session = await requireUser(c);
    if (!db)
      throw new HttpError(
        503,
        "database_unavailable",
        "The database is not set up on this server.",
      );
    const body = Onboard.parse(await c.req.json().catch(() => ({})));
    try {
      const joined = await db.asUser(
        session.user.id,
        async (q) => {
          await q("select identity.ensure_profile()");
          if (body.attestAdult) await q("select identity.attest_adult()");
          if (!body.token) return null;
          return (
            (await q("select identity.accept_invitation($1) as joined", [body.token])).rows[0]
              ?.joined ?? null
          );
        },
        { email: session.user.email },
      );
      return c.json({ ok: true, joined });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "P0001" && /age_confirmation_required/.test(err.message ?? "")) {
        throw new HttpError(
          409,
          "age_confirmation_required",
          "Confirm that you are an adult first.",
        );
      }
      if (err.code === "P0002")
        throw new HttpError(404, "invitation_invalid", "That invitation is not valid.");
      if (err.code === "42501")
        throw new HttpError(403, "invitation_refused", "You may not accept that invitation.");
      throw e;
    }
  });

  return userOf;
}
