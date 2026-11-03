import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Card, parseCard } from "@nirmata/core";
import { type Client, Db, type Pool } from "@nirmata/db";
import { afterEach, describe, expect, it } from "vitest";
import { type CardFile, WorldFiles } from "../src/files";
import { DbLore } from "../src/lore-store";

const USER = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FILE_CARD = `<card id="lore.on-disk" kind="lore" name="On Disk">\nFrom the folder.\n</card>\n`;

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-store-"));
  dirs.push(root);
  mkdirSync(join(root, "lore"));
  writeFileSync(
    join(root, "world.json"),
    JSON.stringify({ name: "Sample World", title: "Sample" }),
  );
  writeFileSync(join(root, "lore", "on-disk.md"), FILE_CARD);
  return root;
}

/** The database as the store sees it: one world with one card, kept in memory. */
function fakeDb(opts: { hasWorld?: boolean } = {}) {
  const hasWorld = opts.hasWorld ?? true;
  const calls: string[] = [];
  const deleted: string[] = [];
  const written: Array<Record<string, unknown>> = [];
  const client: Client = {
    async query(text, params = []) {
      calls.push(text.replace(/\s+/g, " ").trim());
      if (text.includes("from world_lore.worlds where slug"))
        return { rows: hasWorld ? [{ id: "w1" }] : [] };
      if (text.includes("from world_lore.world_lines")) return { rows: [{ id: "l1" }] };
      if (text.includes("join world_lore.card_drafts d")) {
        return {
          rows: [
            {
              id: "c1",
              kind: "character",
              slug: "character-ada",
              title: "Ada",
              body: "She waits.",
              meta: { id: "character.ada", path: "characters/ada.md", keywords: ["ada"] },
            },
          ],
        };
      }
      if (text.includes("from world_lore.card_draft_parts"))
        return { rows: [{ card_id: "c1", part_key: "appearance", body: "Tall." }] };
      if (text.includes("from world_lore.card_draft_secrets"))
        return { rows: [{ card_id: "c1", body: "Knows the way." }] };
      if (text.includes("insert into world_lore.cards")) return { rows: [{ id: "c2" }] };
      if (text.includes("insert into world_lore.card_drafts"))
        written.push({ card: params[1], title: params[3], meta: JSON.parse(String(params[5])) });
      if (text.includes("select card_id from world_lore.card_drafts"))
        return { rows: params[1] === "characters/ada.md" ? [{ card_id: "c1" }] : [] };
      if (text.includes("delete from world_lore.card_drafts")) deleted.push(String(params[1]));
      return { rows: [] };
    },
    release() {},
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { db: new Db(pool), calls, deleted, written };
}

const names = (files: CardFile[]) => files.flatMap((f) => (f.card ? [f.card.fm.id] : []));

describe("a world whose cards are in the database", () => {
  it("reads its cards from the database, not the folder, when a host is signed in", async () => {
    const f = fakeDb();
    const world = new WorldFiles(folder(), new DbLore(f.db, () => USER));
    const files = await world.cardFiles();
    expect(names(files)).toEqual(["character.ada"]);
    const card = files[0]?.card as Card;
    expect(card.path).toBe("characters/ada.md");
    expect(card.fm.name).toBe("Ada");
    expect(card.fm.fields).toEqual({ appearance: "Tall.", secrets: "Knows the way." });
    expect(files[0]?.text).toContain("<card");
    expect(parseCard(card.path, files[0]?.text ?? "").ok).toBe(true);
    expect(names(await world.cardFiles())).not.toContain("lore.on-disk");
  });

  it("says where the cards came from, for the badge on the world page", async () => {
    const root = folder();
    const f = fakeDb();
    const fromDb = await new WorldFiles(root, new DbLore(f.db, () => USER)).cardFilesFrom();
    expect(fromDb.source).toBe("database");
    const fromFiles = await new WorldFiles(root, new DbLore(f.db, () => undefined)).cardFilesFrom();
    expect(fromFiles.source).toBe("files");
  });

  it("reads the cards once for a few seconds, and again after an edit or when the time is up", async () => {
    const f = fakeDb();
    let now = 1_000;
    const lore = new DbLore(
      f.db,
      () => USER,
      5_000,
      () => now,
    );
    const world = new WorldFiles(folder(), lore);
    const reads = () => f.calls.filter((c) => c.includes("join world_lore.card_drafts d")).length;
    await world.cardFiles();
    await world.cardFiles();
    expect(reads()).toBe(1);
    now += 6_000;
    await world.cardFiles();
    expect(reads()).toBe(2);
    const parsed = parseCard(
      "lore/n.md",
      `<card id="lore.n" kind="lore" name="N">
B.
</card>
`,
    );
    if (!parsed.ok) throw new Error("fixture card is invalid");
    await world.save(parsed.card);
    await world.cardFiles();
    expect(reads()).toBe(3);
  });

  it("writes an edit to the database and leaves the folder alone", async () => {
    const root = folder();
    const f = fakeDb();
    const world = new WorldFiles(root, new DbLore(f.db, () => USER));
    const parsed = parseCard(
      "lore/new.md",
      `<card id="lore.new" kind="lore" name="New">\nBody.\n</card>\n`,
    );
    if (!parsed.ok) throw new Error("fixture card is invalid");
    await world.save(parsed.card);
    expect(f.written).toHaveLength(1);
    expect(f.written[0]).toMatchObject({
      title: "New",
      meta: { id: "lore.new", path: "lore/new.md" },
    });
    expect(existsSync(join(root, "lore", "new.md"))).toBe(false);

    await world.removeFile("characters/ada.md");
    expect(f.deleted).toEqual(["c1"]);
  });

  it("uses the folder when nobody is signed in, or the world is not in the database", async () => {
    const root = folder();
    const nobody = fakeDb();
    expect(
      names(await new WorldFiles(root, new DbLore(nobody.db, () => undefined)).cardFiles()),
    ).toEqual(["lore.on-disk"]);
    expect(nobody.calls).toEqual([]);

    const absent = fakeDb({ hasWorld: false });
    const world = new WorldFiles(root, new DbLore(absent.db, () => USER));
    expect(names(await world.cardFiles())).toEqual(["lore.on-disk"]);
    const parsed = parseCard(
      "lore/kept.md",
      `<card id="lore.kept" kind="lore" name="Kept">\nBody.\n</card>\n`,
    );
    if (!parsed.ok) throw new Error("fixture card is invalid");
    await world.save(parsed.card);
    expect(existsSync(join(root, "lore", "kept.md"))).toBe(true);
  });

  it("says so when the database cannot be reached, rather than falling back to files", async () => {
    const pool: Pool = {
      connect: async () => {
        throw new Error("connection refused");
      },
      end: async () => undefined,
    };
    const world = new WorldFiles(folder(), new DbLore(new Db(pool), () => USER));
    await expect(world.cardFiles()).rejects.toThrow("The database cannot be reached right now.");
  });
});
