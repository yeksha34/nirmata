import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, Db, type Pool } from "@nirmata/db";
import type { Stores } from "@nirmata/storage";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "../src/files";
import { DbImages } from "../src/image-store";

const USER = "22222222-2222-4222-8222-222222222222";
const WORLD_ID = "11111111-1111-4111-8111-111111111111";
const RENDER = "33333333-3333-4333-8333-333333333333";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A library with one world whose dataset has a local copy of the image. */
function library(images?: DbImages): Library {
  const root = mkdtempSync(join(tmpdir(), "nirmata-img-"));
  dirs.push(root);
  const run = join(root, "sample", "assets", "dataset", "scene1", "ada", "run1");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(root, "sample", "world.json"), JSON.stringify({ name: "sample", title: "S" }));
  writeFileSync(join(run, "generated_image.png"), "local-bytes");
  return new Library(root, { images });
}

function fakeDb(opts: { store?: string; hasRender?: boolean } = {}) {
  const asked: string[] = [];
  const client: Client = {
    async query(text, params = []) {
      if (text.includes("from world_lore.worlds")) return { rows: [{ id: WORLD_ID }] };
      if (text.includes("from assets.renders where lower(storage_path)")) {
        asked.push(String(params[0]));
        return { rows: opts.hasRender === false ? [] : [{ id: RENDER }] };
      }
      if (text.includes("assets.render_file"))
        return {
          rows: [
            {
              storage_path: `${WORLD_ID}/scene1/ada/run1.png`,
              store: opts.store ?? "local",
              content_type: "image/png",
              bytes: 8,
            },
          ],
        };
      return { rows: [] };
    },
    release() {},
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { db: new Db(pool), asked };
}

const stores: Stores = {
  local: {
    get: async () => ({ data: new Uint8Array(Buffer.from("db-bytes")), contentType: "image/png" }),
  },
} as unknown as Stores;

const text = async (r: Promise<{ data: Buffer } | undefined>) => (await r)?.data.toString();

describe("dataset images of an imported world", () => {
  it("come from the database copy for the signed-in host, by the path the importer used", async () => {
    const f = fakeDb();
    const lib = library(new DbImages(f.db, stores, () => USER));
    expect(await text(lib.readDatasetImage("sample", "scene1", "ada", "run1", true))).toBe(
      "db-bytes",
    );
    expect(f.asked).toEqual([`${WORLD_ID}/scene1/ada/run1.png`]);
  });

  it("find a run named by its time, whose capital letters must not be lowered", async () => {
    const f = fakeDb();
    const lib = library(new DbImages(f.db, stores, () => USER));
    await lib.readDatasetImage("sample", "scene1", "ada", "2026-11-03T10-00-00-000Z", true);
    expect(f.asked).toEqual([`${WORLD_ID}/scene1/ada/2026-11-03T10-00-00-000Z.png`]);
  });

  it("come from the folder for anyone else, and when the world has no such render", async () => {
    const f = fakeDb();
    const lib = library(new DbImages(f.db, stores, () => USER));
    expect(await text(lib.readDatasetImage("sample", "scene1", "ada", "run1", false))).toBe(
      "local-bytes",
    );
    expect(f.asked).toEqual([]);

    const none = library(new DbImages(fakeDb({ hasRender: false }).db, stores, () => USER));
    expect(await text(none.readDatasetImage("sample", "scene1", "ada", "run1", true))).toBe(
      "local-bytes",
    );

    const nobody = library(new DbImages(fakeDb().db, stores, () => undefined));
    expect(await text(nobody.readDatasetImage("sample", "scene1", "ada", "run1", true))).toBe(
      "local-bytes",
    );
  });

  it("do not come back from an old local file once the render was deleted", async () => {
    const lib = library(new DbImages(fakeDb({ store: "none" }).db, stores, () => USER));
    expect(await lib.readDatasetImage("sample", "scene1", "ada", "run1", true)).toBeUndefined();
  });
});
