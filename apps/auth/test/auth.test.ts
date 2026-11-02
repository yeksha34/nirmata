import { describe, expect, it } from "vitest";
import { AuthError, GoTrue, SessionStore } from "../src";

const TOKEN = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: { id: "11111111-1111-4111-8111-111111111111", email: "Ann@Example.test" },
};

function fake(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string>,
    });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const client = (f: typeof fetch, now = () => 1_000_000) =>
  new GoTrue({ url: "https://p.supabase.co/", publishableKey: "pub-key", fetch: f, now });

describe("GoTrue", () => {
  it("logs in with a password and returns a session", async () => {
    const { f, calls } = fake([{ status: 200, body: TOKEN }]);
    const s = await client(f).login("ann@example.test", "pw");
    expect(s).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1_000_000 + 3_600_000,
      user: { id: TOKEN.user.id, email: "ann@example.test" },
    });
    expect(calls[0]?.url).toBe("https://p.supabase.co/auth/v1/token?grant_type=password");
    expect(calls[0]?.headers.apikey).toBe("pub-key");
    expect(calls[0]?.body).toEqual({ email: "ann@example.test", password: "pw" });
  });

  it("maps failures to plain reasons", async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }, "bad_credentials"],
      [403, { msg: "An invitation is required.", error_code: "hook_payload_invalid" }, "invitation_required"],
      [422, { msg: "Password should be longer" }, "rejected"],
      [500, {}, "unavailable"],
    ];
    for (const [status, body, failure] of cases) {
      const { f } = fake([{ status, body }]);
      await expect(client(f).login("a@b.test", "x")).rejects.toMatchObject({ failure });
    }
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(client(down).login("a@b.test", "x")).rejects.toBeInstanceOf(AuthError);
  });

  it("sign-up returns no session while the address is unconfirmed, and says where the link goes", async () => {
    const { f, calls } = fake([{ status: 200, body: { id: "x", email: "a@b.test" } }]);
    expect(await client(f).signup("a@b.test", "longenough", "http://127.0.0.1:8788/auth/callback")).toBeUndefined();
    expect(calls[0]?.url).toContain("/auth/v1/signup?redirect_to=http%3A%2F%2F127.0.0.1%3A8788%2Fauth%2Fcallback");
  });

  it("turns an email link's token into a session", async () => {
    const { f, calls } = fake([{ status: 200, body: TOKEN }]);
    await client(f).verify("hash-123", "signup");
    expect(calls[0]?.body).toEqual({ token_hash: "hash-123", type: "signup" });
  });

  it("refuses a reply with no session in it", async () => {
    const { f } = fake([{ status: 200, body: { access_token: "a" } }]);
    await expect(client(f).refresh("r")).rejects.toMatchObject({ failure: "rejected" });
  });
});

describe("SessionStore", () => {
  const session = (expiresAt: number) => ({
    accessToken: "a",
    refreshToken: "r",
    expiresAt,
    user: { id: TOKEN.user.id, email: "ann@example.test" },
  });

  it("hands out an opaque id and finds the session again", async () => {
    const { f } = fake([]);
    let now = 0;
    const store = new SessionStore(client(f), () => now);
    const id = store.create(session(10 * 60_000));
    expect(id.length).toBeGreaterThan(30);
    expect(id).not.toContain("a.r");
    expect((await store.resolve(id))?.accessToken).toBe("a");
    expect(await store.resolve("nope")).toBeUndefined();
    expect(await store.resolve(undefined)).toBeUndefined();
    now = 1;
  });

  it("refreshes a session that is about to expire, and drops one that cannot be refreshed", async () => {
    const ok = fake([{ status: 200, body: TOKEN }]);
    const store = new SessionStore(client(ok.f, () => 0), () => 0);
    const id = store.create(session(30_000));
    expect((await store.resolve(id))?.accessToken).toBe("access-1");
    expect(ok.calls[0]?.url).toContain("grant_type=refresh_token");

    const bad = fake([{ status: 400, body: { msg: "Invalid Refresh Token" } }]);
    const store2 = new SessionStore(client(bad.f), () => 0);
    const id2 = store2.create(session(30_000));
    expect(await store2.resolve(id2)).toBeUndefined();
    expect(store2.size).toBe(0);
  });

  it("ends a session at the server and at Supabase", async () => {
    const { f, calls } = fake([{ status: 204, body: {} }]);
    const store = new SessionStore(client(f), () => 0);
    const id = store.create(session(10 * 60_000));
    await store.end(id);
    expect(await store.resolve(id)).toBeUndefined();
    expect(calls[0]?.url).toContain("/auth/v1/logout");
  });
});
