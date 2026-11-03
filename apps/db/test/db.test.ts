import { describe, expect, it } from "vitest";
import { type Client, Db, dbUrlFromEnv, getRenderFile, type Pool } from "../src";

const RENDER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

/** A pool that records every statement and answers from a script. */
function fakePool(answer: (text: string) => Record<string, unknown>[] = () => []) {
  const log: string[] = [];
  const client: Client = {
    async query(text, params) {
      log.push(params ? `${text} ${JSON.stringify(params)}` : text);
      return { rows: answer(text) };
    },
    release() {
      log.push("release");
    },
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { pool, log };
}

describe("Db", () => {
  it("runs server work in a transaction with no role change", async () => {
    const { pool, log } = fakePool();
    await new Db(pool).server((q) => q("select 1"));
    expect(log).toEqual(["begin", "select 1", "commit", "release"]);
  });

  it("acts as a person: claims first, then the authenticated role", async () => {
    const { pool, log } = fakePool();
    await new Db(pool).asUser(USER, (q) => q("select 1"));
    expect(log[0]).toBe("begin");
    expect(log[1]).toContain("set_config('request.jwt.claims'");
    expect(log[1]).toContain(USER);
    expect(log[2]).toBe("set local role authenticated");
    expect(log.slice(-2)).toEqual(["commit", "release"]);
  });

  it("puts the person's address in the claims when given", async () => {
    const { pool, log } = fakePool();
    await new Db(pool).asUser(USER, (q) => q("select 1"), { email: "Ann@Example.test" });
    expect(log[1]).toContain("email");
    expect(log[1]).toContain("ann@example.test");
  });

  it("refuses a user id that is not a uuid, before touching the database", async () => {
    const { pool, log } = fakePool();
    await expect(new Db(pool).asUser("x'; drop table", async () => 1)).rejects.toThrow(/uuid/);
    expect(log).toEqual([]);
  });

  it("rolls back and releases when the work fails", async () => {
    const { pool, log } = fakePool();
    await expect(
      new Db(pool).server(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(log).toEqual(["begin", "rollback", "release"]);
  });

  it("reports who the login is", async () => {
    const { pool } = fakePool(() => [{ user: "app_rw" }]);
    expect(await new Db(pool).health()).toEqual({ ok: true, user: "app_rw" });
  });
});

describe("getRenderFile", () => {
  const row = { storage_path: "w/x.png", store: "local", content_type: "image/png", bytes: "42" };

  it("maps the row", async () => {
    const { pool, log } = fakePool(() => [row]);
    expect(await getRenderFile(new Db(pool), RENDER)).toEqual({
      storagePath: "w/x.png",
      store: "local",
      contentType: "image/png",
      bytes: 42,
    });
    expect(log.some((l) => l.includes("assets.render_file") && l.includes(RENDER))).toBe(true);
    expect(log).not.toContain("set local role authenticated");
  });

  it("asks as the person when given one", async () => {
    const { pool, log } = fakePool(() => [row]);
    await getRenderFile(new Db(pool), RENDER, USER);
    expect(log).toContain("set local role authenticated");
  });

  it("returns undefined for no row, and for an id that is not a uuid without a query", async () => {
    const { pool, log } = fakePool(() => []);
    expect(await getRenderFile(new Db(pool), RENDER)).toBeUndefined();
    log.length = 0;
    expect(await getRenderFile(new Db(pool), "../etc")).toBeUndefined();
    expect(log).toEqual([]);
  });

  it("rejects an unknown store value", async () => {
    const { pool } = fakePool(() => [{ ...row, store: "cloud" }]);
    await expect(getRenderFile(new Db(pool), RENDER)).rejects.toThrow(/Unknown store/);
  });
});

describe("dbUrlFromEnv", () => {
  it("reads DATABASE_URL_RW and treats blank as unset", () => {
    expect(dbUrlFromEnv({ DATABASE_URL_RW: " postgres://x " })).toBe("postgres://x");
    expect(dbUrlFromEnv({ DATABASE_URL_RW: "  " })).toBeUndefined();
    expect(dbUrlFromEnv({})).toBeUndefined();
  });
});
