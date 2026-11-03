import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldSource } from "@nirmata/adaptation";
import { type Client, Db, type Pool } from "@nirmata/db";
import { afterEach, describe, expect, it } from "vitest";
import { dbWorldCreator } from "../src/db-worlds";
import { Library } from "../src/files";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const empty = (): string => {
  const d = mkdtempSync(join(tmpdir(), "nirmata-lib-"));
  dirs.push(d);
  return d;
};

const pool: Pool = {
  connect: async (): Promise<Client> => ({
    query: async (text) => ({
      rows: text.includes("create_world") ? [{ id: "W1" }] : [],
    }),
    release: () => undefined,
  }),
  end: async () => undefined,
};

/** The database holds `coast` with a manifest. */
const world: WorldSource = {
  names: async () => ["coast"],
  manifest: async (slug) =>
    slug === "coast" ? { name: "coast", title: "The Coast", tagline: "Fog." } : undefined,
};

describe("worlds that live in the database", () => {
  it("are listed with no folder behind them", async () => {
    const root = empty();
    const library = new Library(root, { db: { world } });
    const all = await library.list();
    expect(all).toEqual([{ name: "coast", title: "The Coast", tagline: "Fog.", stories: 0 }]);
    expect(await library.open("coast").exists()).toBe(true);
  });

  it("are made in the database, and no folder is made", async () => {
    const root = empty();
    const library = new Library(root, {
      db: { world },
      create: dbWorldCreator(new Db(pool), () => "22222222-2222-4222-8222-222222222222"),
    });
    const made = await library.create({ title: "New Tale", tagline: "t", premise: "p" });
    expect(made).toMatchObject({ name: "new-tale", title: "New Tale", stories: 0 });
    expect(readdirSync(root)).toEqual([]);
  });

  it("need someone signed in to be made", async () => {
    const library = new Library(empty(), { create: dbWorldCreator(new Db(pool), () => undefined) });
    await expect(library.create({ title: "T", tagline: "", premise: "" })).rejects.toThrow(
      "Sign in to make a world.",
    );
  });

  it("without a database are made as a folder, as before", async () => {
    const root = empty();
    const made = await new Library(root).create({ title: "Folder Tale", tagline: "", premise: "" });
    expect(readdirSync(root)).toContain(made.name);
  });
});
