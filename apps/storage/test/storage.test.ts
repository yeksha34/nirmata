import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertStoragePath, LocalStore, SupabaseStore, storesFromEnv } from "../src";

const WORLD = "11111111-1111-4111-8111-111111111111";
const PATH = `${WORLD}/hero/one.png`;
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("assertStoragePath", () => {
  it("accepts a world folder path and refuses anything that escapes it", () => {
    expect(() => assertStoragePath(PATH)).not.toThrow();
    for (const bad of ["x.png", `${WORLD}/../a.png`, `/${WORLD}/a.png`, `${WORLD}//a.png`, `${WORLD}/a b.png`, "..\\x"])
      expect(() => assertStoragePath(bad)).toThrow();
  });
});

describe("LocalStore", () => {
  it("puts, gets and removes a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "nirmata-store-"));
    dirs.push(root);
    const store = new LocalStore(root);
    expect(await store.get(PATH)).toBeUndefined();
    await store.put(PATH, new Uint8Array([1, 2, 3]));
    const got = await store.get(PATH);
    expect([...(got?.data ?? [])]).toEqual([1, 2, 3]);
    expect(got?.contentType).toBe("image/png");
    await store.remove(PATH);
    expect(await store.get(PATH)).toBeUndefined();
    await expect(store.remove(PATH)).resolves.toBeUndefined();
  });

  it("will not read outside its folder", async () => {
    const store = new LocalStore(tmpdir());
    await expect(store.get(`${WORLD}/../../secret.txt`)).rejects.toThrow();
  });
});

describe("SupabaseStore", () => {
  function fake(status: number, body: BodyInit | null = null, headers: Record<string, string> = {}) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status, headers });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const options = { url: "https://p.supabase.co/", serviceRoleKey: "service-key" };

  it("reads from the private bucket with the service key", async () => {
    const { f, calls } = fake(200, new Uint8Array([9]), { "content-type": "image/png" });
    const got = await new SupabaseStore({ ...options, fetch: f }).get(PATH);
    expect([...(got?.data ?? [])]).toEqual([9]);
    expect(got?.contentType).toBe("image/png");
    expect(calls[0]?.url).toBe(`https://p.supabase.co/storage/v1/object/vn-assets/${PATH}`);
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
  });

  it("treats a missing object as undefined and other failures as errors", async () => {
    expect(await new SupabaseStore({ ...options, fetch: fake(404).f }).get(PATH)).toBeUndefined();
    await expect(new SupabaseStore({ ...options, fetch: fake(500).f }).get(PATH)).rejects.toThrow(/500/);
  });

  it("uploads without overwriting, and deletes by path", async () => {
    const up = fake(200);
    await new SupabaseStore({ ...options, fetch: up.f }).put(PATH, new Uint8Array([1]), "image/png");
    expect(up.calls[0]?.init?.method).toBe("POST");
    expect((up.calls[0]?.init?.headers as Record<string, string>)["x-upsert"]).toBe("false");
    const del = fake(200);
    await new SupabaseStore({ ...options, fetch: del.f }).remove(PATH);
    expect(del.calls[0]?.init?.method).toBe("DELETE");
    expect(JSON.parse(String(del.calls[0]?.init?.body))).toEqual({ prefixes: [PATH] });
  });

  it("refuses an unsafe path before any request", async () => {
    const { f, calls } = fake(200);
    await expect(new SupabaseStore({ ...options, fetch: f }).get("../x")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("storesFromEnv", () => {
  it("builds only the stores that are configured", () => {
    expect(storesFromEnv({})).toEqual({ local: undefined, supabase: undefined });
    const s = storesFromEnv({ NIRMATA_ASSET_DIR: "x", SUPABASE_URL: "https://p", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(s.local).toBeInstanceOf(LocalStore);
    expect(s.supabase).toBeInstanceOf(SupabaseStore);
  });
});
