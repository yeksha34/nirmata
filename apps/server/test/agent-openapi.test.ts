import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { rig } from "./helpers";

const SPEC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "api",
  "agent.openapi.json",
);
const METHODS = ["get", "put", "post", "delete"];

interface Spec {
  paths: Record<string, Record<string, { "x-scopes-any-of"?: string[] }>>;
}

/** The fixed reference of the agent API must say exactly what the server answers. */
describe("the agent API reference (docs/api/agent.openapi.json)", () => {
  const spec = JSON.parse(readFileSync(SPEC, "utf8")) as Spec;
  const documented = new Set(
    Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((m) => METHODS.includes(m))
        .map((m) => `${m.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`),
    ),
  );

  it("lists every agent route the server has, and no other", async () => {
    const pool: Pool = {
      connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
      end: async () => undefined,
    };
    const r = await rig([], { data: { db: new Db(pool), stores: {} } });
    const served = new Set(
      r.app.routes
        .filter((x) => x.path.startsWith("/api/agent/") && METHODS.includes(x.method.toLowerCase()))
        .map((x) => `${x.method.toUpperCase()} ${x.path}`),
    );
    expect(
      [...served].filter((x) => !documented.has(x)),
      "routes missing from the reference",
    ).toEqual([]);
    expect(
      [...documented].filter((x) => !served.has(x)),
      "documented routes the server lacks",
    ).toEqual([]);
  });

  it("names the scopes that admit each operation, all of them real", () => {
    const real = new Set(["adaptation.read", "adaptation.write", "import.read", "import.write"]);
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, o] of Object.entries(ops)) {
        expect(o["x-scopes-any-of"]?.length, `${method} ${path}`).toBeGreaterThan(0);
        for (const s of o["x-scopes-any-of"] ?? [])
          expect(real.has(s), `${method} ${path}: ${s}`).toBe(true);
      }
    }
  });
});
