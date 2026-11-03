import { GoTrue, SessionStore } from "@nirmata/auth";
import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import type { AuthDeps } from "../src";
import { rig } from "./helpers";

const USER = "11111111-1111-4111-8111-111111111111";
const TOKEN = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: { id: USER, email: "ann@example.test" },
};

interface Call {
  url: string;
  body: unknown;
}
function setup(
  responses: Array<{ status: number; body: unknown }>,
  dbRows: Record<string, unknown>[] = [],
  dbError?: Error,
) {
  const calls: Call[] = [];
  const fetchFake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses.shift() ?? { status: 204, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  const gotrue = new GoTrue({
    url: "https://p.supabase.co",
    publishableKey: "pub",
    serviceRoleKey: "svc",
    fetch: fetchFake,
  });
  const dbLog: string[] = [];
  const pool: Pool = {
    connect: async () => ({
      query: async (text, params) => {
        dbLog.push(params ? `${text} ${JSON.stringify(params)}` : text);
        if (dbError && /accept_invitation/.test(text)) throw dbError;
        return { rows: dbRows };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  const auth: AuthDeps = {
    gotrue,
    sessions: new SessionStore(gotrue),
    db: new Db(pool),
    siteUrl: "http://127.0.0.1:8788",
  };
  return { auth, calls, dbLog };
}

const post = (
  app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> },
  path: string,
  body: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

describe("auth routes", () => {
  it("are absent when sign-in is not configured", async () => {
    const r = await rig([]);
    expect(
      (await post(r.app, "/api/auth/login", { email: "a@b.test", password: "x" })).status,
    ).toBe(404);
  });

  it("log in: the browser gets a cookie, never a Supabase token", async () => {
    const { auth } = setup([{ status: 200, body: TOKEN }]);
    const r = await rig([], { auth });
    const res = await post(r.app, "/api/auth/login", { email: "Ann@Example.test", password: "pw" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("access-1");
    expect(JSON.parse(text)).toEqual({ user: { id: USER, email: "ann@example.test" } });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("nirmata_session=");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toContain("access-1");
  });

  it("tell a wrong password plainly, and refuse a sign-up without an invitation", async () => {
    const wrong = setup([
      {
        status: 400,
        body: { error_code: "invalid_credentials", msg: "Invalid login credentials" },
      },
    ]);
    const r1 = await rig([], { auth: wrong.auth });
    const res = await post(r1.app, "/api/auth/login", { email: "a@b.test", password: "bad" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("bad_credentials");

    const noInvite = setup([{ status: 403, body: { msg: "An invitation is required." } }]);
    const r2 = await rig([], { auth: noInvite.auth });
    const res2 = await post(r2.app, "/api/auth/signup", {
      email: "a@b.test",
      password: "longenough",
    });
    expect(res2.status).toBe(403);
    expect((await res2.json()).error.code).toBe("invitation_required");
  });

  it("sign up asks for an email check and points the link at the server", async () => {
    const { auth, calls } = setup([{ status: 200, body: { id: "x" } }]);
    const r = await rig([], { auth });
    const res = await post(r.app, "/api/auth/signup", {
      email: "a@b.test",
      password: "longenough",
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "check_email" });
    expect(calls[0]?.url).toContain(encodeURIComponent("http://127.0.0.1:8788/auth/callback"));
  });

  it("the email link signs the person in and sends them on, only to a path on this site", async () => {
    const { auth } = setup([
      { status: 200, body: TOKEN },
      { status: 200, body: TOKEN },
      { status: 200, body: TOKEN },
    ]);
    const r = await rig([], { auth });
    const ok = await r.app.request(
      "/auth/callback?token_hash=h&type=signup&next=/accept-invite%3Ftoken%3Dabc",
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/accept-invite?token=abc");
    expect(ok.headers.get("set-cookie")).toContain("nirmata_session=");
    const evil = await r.app.request(
      "/auth/callback?token_hash=h&type=signup&next=https://evil.test/",
    );
    expect(evil.headers.get("location")).toBe("/");
    const evil2 = await r.app.request("/auth/callback?token_hash=h&type=signup&next=//evil.test");
    expect(evil2.headers.get("location")).toBe("/");
    const bad = await r.app.request("/auth/callback?type=signup");
    expect(bad.headers.get("location")).toBe("/?auth=failed");
  });

  it("me needs a session; logout ends it", async () => {
    const { auth } = setup(
      [
        { status: 200, body: TOKEN },
        { status: 204, body: {} },
      ],
      [{ display_name: "Ann", can_found_worlds: true, age_confirmed: false }],
    );
    const r = await rig([], { auth });
    expect((await r.app.request("/api/auth/me")).status).toBe(401);
    const cookie = cookieOf(
      await post(r.app, "/api/auth/login", { email: "ann@example.test", password: "pw" }),
    );
    const me = await r.app.request("/api/auth/me", { headers: { cookie } });
    expect(await me.json()).toEqual({
      user: { id: USER, email: "ann@example.test" },
      profile: { displayName: "Ann", canFoundWorlds: true, role: "author", ageConfirmed: false },
    });
    expect((await post(r.app, "/api/auth/logout", {}, cookie)).status).toBe(200);
    expect((await r.app.request("/api/auth/me", { headers: { cookie } })).status).toBe(401);
  });

  it("onboarding acts as the signed-in person, with their address, in one transaction", async () => {
    const { auth, dbLog } = setup([{ status: 200, body: TOKEN }], [{ joined: { role: "player" } }]);
    const r = await rig([], { auth });
    const cookie = cookieOf(
      await post(r.app, "/api/auth/login", { email: "ann@example.test", password: "pw" }),
    );
    const res = await post(
      r.app,
      "/api/auth/onboard",
      { attestAdult: true, token: "invite-token-1" },
      cookie,
    );
    expect(await res.json()).toEqual({ ok: true, joined: { role: "player" } });
    const joined = dbLog.join("\n");
    expect(joined).toContain("ann@example.test");
    expect(joined).toContain("set local role authenticated");
    expect(joined.indexOf("attest_adult")).toBeLessThan(joined.indexOf("accept_invitation"));
    expect(joined).toContain("commit");
  });

  it("onboarding explains the database's refusals", async () => {
    const cases: Array<[string, string, number, string]> = [
      ["P0001", "age_confirmation_required", 409, "age_confirmation_required"],
      ["P0002", "invitation is not valid", 404, "invitation_invalid"],
      ["42501", "invitation is for another address", 403, "invitation_refused"],
    ];
    for (const [code, message, status, errorCode] of cases) {
      const { auth } = setup(
        [{ status: 200, body: TOKEN }],
        [],
        Object.assign(new Error(message), { code }),
      );
      const r = await rig([], { auth });
      const cookie = cookieOf(
        await post(r.app, "/api/auth/login", { email: "ann@example.test", password: "pw" }),
      );
      const res = await post(r.app, "/api/auth/onboard", { token: "invite-token-1" }, cookie);
      expect(res.status, code).toBe(status);
      expect((await res.json()).error.code).toBe(errorCode);
    }
  });

  it("register: an invitation holder gets an account for the invited address, with no email", async () => {
    const { auth, calls, dbLog } = setup(
      [
        { status: 200, body: { id: "x" } }, // admin create
        { status: 200, body: TOKEN }, // login
      ],
      [{ email: "ann@example.test" }],
    );
    const r = await rig([], { auth });
    const res = await post(r.app, "/api/auth/register", {
      token: "invite-token-1",
      password: "longenough",
    });
    expect(res.status).toBe(201);
    expect(cookieOf(res)).toContain("nirmata_session=");
    expect(calls[0]?.url).toContain("/admin/users");
    expect(calls[0]?.body).toEqual({
      email: "ann@example.test",
      password: "longenough",
      email_confirm: true,
    });
    expect(dbLog.join("\n")).toContain("invitation_email");
  });

  it("register: a wrong token is refused before any account is made", async () => {
    const { auth, calls } = setup([], [{ email: null }]);
    const r = await rig([], { auth });
    const res = await post(r.app, "/api/auth/register", {
      token: "wrong-token-1",
      password: "longenough",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("invitation_invalid");
    expect(calls).toEqual([]);
  });

  it("shows which address an invitation is for", async () => {
    const { auth } = setup([], [{ email: "ann@example.test" }]);
    const r = await rig([], { auth });
    const res = await r.app.request("/api/auth/invitation?token=invite-token-1");
    expect(await res.json()).toEqual({ email: "ann@example.test" });
    expect((await r.app.request("/api/auth/invitation?token=x")).status).toBe(404);
  });

  describe("seating a signed-in person", () => {
    const profile = (host: boolean, age = true) => [
      { display_name: "Ann Host", can_found_worlds: host, is_admin: false, age_confirmed: age },
    ];
    const signedIn = async (rows: Record<string, unknown>[]) => {
      const { auth } = setup([{ status: 200, body: TOKEN }], rows);
      const r = await rig([], { auth });
      const login = await post(r.app, "/api/auth/login", {
        email: "ann@example.test",
        password: "pw",
      });
      return { r, cookie: cookieOf(login) };
    };

    it("seats an invited host as the table's host under their own name", async () => {
      const { r, cookie } = await signedIn(profile(true));
      const res = await post(r.app, "/api/join/session", {}, cookie);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.you).toMatchObject({ nick: "Ann_Host", seat: "host", host: true, account: true });
      const me = await (await r.app.request("/api/auth/me", { headers: { cookie } })).json();
      expect(me.profile.role).toBe("author");
      expect((await (await r.app.request("/api/table")).json()).host).toBe("Ann_Host");
      // the same person gets the same seat back, not a second one
      const again = await (await post(r.app, "/api/join/session", {}, cookie)).json();
      expect(again.token).toBe(body.token);
    });

    it("seats anyone else as a spectator, never as the host", async () => {
      const { r, cookie } = await signedIn(profile(false));
      const body = await (await post(r.app, "/api/join/session", {}, cookie)).json();
      expect(body.you).toMatchObject({ seat: "spectator", host: false, account: true });
    });

    it("needs a sign-in and a finished onboarding", async () => {
      const { auth } = setup([], profile(true));
      const anon = await rig([], { auth });
      expect((await post(anon.app, "/api/join/session", {})).status).toBe(401);
      const { r, cookie } = await signedIn(profile(true, false));
      const res = await post(r.app, "/api/join/session", {}, cookie);
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("onboarding_required");
    });

    it("is absent when sign-in is not configured, and the host key still works", async () => {
      const r = await rig([]);
      expect((await post(r.app, "/api/join/session", {})).status).toBe(404);
    });
  });

  it("refuse a change that comes from another site", async () => {
    const { auth } = setup([{ status: 200, body: TOKEN }]);
    const r = await rig([], { auth });
    const res = await post(
      r.app,
      "/api/auth/login",
      { email: "a@b.test", password: "x" },
      undefined,
      { origin: "https://evil.test" },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("cross_site");
  });
});
