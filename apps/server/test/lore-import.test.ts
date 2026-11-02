import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, Db, type Pool } from "@nirmata/db";
import { afterEach, describe, expect, it } from "vitest";
import { cardRow, importWorldLore, slugFor } from "../src/lore-import";

const USER = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world(): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-lore-"));
  dirs.push(root);
  mkdirSync(join(root, "characters"));
  mkdirSync(join(root, "lore"));
  writeFileSync(
    join(root, "world.json"),
    JSON.stringify({ name: "Sample World", title: "Sample" }),
  );
  writeFileSync(
    join(root, "characters", "ada.md"),
    `<card id="character.ada" kind="character" name="Ada">
  <keywords>ada, keeper</keywords>
  <appearance>Tall.</appearance>
  <secrets>Knows the way out.</secrets>
# Ada

She waits.
</card>
`,
  );
  writeFileSync(
    join(root, "lore", "the-gate.md"),
    `<card id="lore.the-gate" kind="lore" name="The Gate">
The gate is shut.
</card>
`,
  );
  writeFileSync(join(root, "lore", "broken.md"), "not a card at all");
  return root;
}

/** A tiny database: remembers the draft rows so a second run can see what the first wrote. */
function fakeDb(opts: { existingWorld?: boolean } = {}) {
  const log: string[] = [];
  const drafts = new Map<string, { title: string; body: string; meta: unknown }>();
  const parts = new Map<string, Array<{ part_key: string; body: string }>>();
  const secrets = new Map<string, Array<{ body: string }>>();
  const cardIds = new Map<string, string>();
  let worldExists = opts.existingWorld ?? false;
  const client: Client = {
    async query(text, params = []) {
      log.push(text.replace(/\s+/g, " ").trim());
      if (text.includes("from world_lore.worlds where slug"))
        return { rows: worldExists ? [{ id: "w1" }] : [] };
      if (text.includes("create_world")) {
        worldExists = true;
        return { rows: [{ id: "w1" }] };
      }
      if (text.includes("from world_lore.world_lines where world_id"))
        return { rows: [{ id: "l1" }] };
      if (text.includes("insert into world_lore.cards")) {
        const slug = String(params[2]);
        if (!cardIds.has(slug)) cardIds.set(slug, `c-${slug}`);
        return { rows: [{ id: cardIds.get(slug) }] };
      }
      if (text.includes("from world_lore.card_drafts where")) {
        const d = drafts.get(String(params[1]));
        return { rows: d ? [d] : [] };
      }
      if (text.includes("from world_lore.card_draft_parts"))
        return { rows: parts.get(String(params[1])) ?? [] };
      if (text.includes("from world_lore.card_draft_secrets"))
        return { rows: secrets.get(String(params[1])) ?? [] };
      if (text.includes("insert into world_lore.card_drafts")) {
        drafts.set(String(params[1]), {
          title: String(params[3]),
          body: String(params[4]),
          meta: JSON.parse(String(params[5])),
        });
        return { rows: [] };
      }
      if (text.includes("delete from world_lore.card_draft_parts")) parts.delete(String(params[1]));
      if (text.includes("delete from world_lore.card_draft_secrets"))
        secrets.delete(String(params[1]));
      if (text.includes("insert into world_lore.card_draft_parts"))
        parts.set(String(params[1]), [
          ...(parts.get(String(params[1])) ?? []),
          { part_key: String(params[4]), body: String(params[5]) },
        ]);
      if (text.includes("insert into world_lore.card_draft_secrets"))
        secrets.set(String(params[1]), [
          ...(secrets.get(String(params[1])) ?? []),
          { body: String(params[4]) },
        ]);
      if (text.includes("head_version_id")) return { rows: [{ head_version_id: null }] };
      if (text.includes("publish_world_line")) return { rows: [{ id: "v1" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool: Pool = { connect: async () => client, end: async () => undefined };
  return { db: new Db(pool), log, drafts, parts, secrets };
}

describe("importing a world's lore", () => {
  it("makes the world and a draft of each card, keeping the Secrets apart", async () => {
    const folder = world();
    const f = fakeDb();
    const r = await importWorldLore({ db: f.db, folder, userId: USER });
    expect(r.slug).toBe("sample-world");
    expect(r.worldCreated).toBe(true);
    expect(r.worldId).toBe("w1");
    expect(r.cards).toEqual({ found: 2, added: 2, updated: 0, unchanged: 0 });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain("broken.md");
    expect(f.drafts.get("c-character-ada")?.title).toBe("Ada");
    expect(f.parts.get("c-character-ada")).toEqual([{ part_key: "appearance", body: "Tall." }]);
    expect(f.secrets.get("c-character-ada")).toEqual([{ body: "Knows the way out." }]);
    // the Secrets are never among the parts
    expect(JSON.stringify([...f.parts.values()])).not.toContain("way out");
    expect(f.log.some((l) => l.includes("publish_world_line"))).toBe(false);
  });

  it("leaves unchanged cards alone when run again", async () => {
    const folder = world();
    const f = fakeDb();
    await importWorldLore({ db: f.db, folder, userId: USER });
    const again = await importWorldLore({ db: f.db, folder, userId: USER });
    expect(again.worldCreated).toBe(false);
    expect(again.cards).toEqual({ found: 2, added: 0, updated: 0, unchanged: 2 });
    writeFileSync(
      join(folder, "lore", "the-gate.md"),
      `<card id="lore.the-gate" kind="lore" name="The Gate">\nThe gate is open.\n</card>\n`,
    );
    const changed = await importWorldLore({ db: f.db, folder, userId: USER });
    expect(changed.cards).toMatchObject({ added: 0, updated: 1, unchanged: 1 });
  });

  it("publishes only when asked, and only when something changed or nothing is published", async () => {
    const folder = world();
    const f = fakeDb();
    const r = await importWorldLore({ db: f.db, folder, userId: USER, publish: true });
    expect(r.publishedVersion).toBe("v1");
    expect(f.log.some((l) => l.includes("set_line_ready"))).toBe(true);
  });

  it("writes nothing on a dry run and reports no world id for a world it would make", async () => {
    const f = fakeDb();
    const r = await importWorldLore({ db: f.db, folder: world(), userId: USER, dryRun: true });
    expect(r.worldId).toBeUndefined();
    expect(r.cards.added).toBe(2);
    expect(f.log[f.log.length - 1]).toBe("rollback");
  });

  it("names a world for the database and turns a card into rows", () => {
    expect(slugFor("My  Odd_World!")).toBe("my-odd-world");
    const row = cardRow({
      path: "lore/x.md",
      fm: {
        id: "lore.x",
        kind: "lore",
        name: "X",
        keywords: ["a"],
        summary: "",
        always: false,
        scope: "both",
        severity: "should",
        fields: { secrets: "hush", look: "plain" },
      },
      body: "b",
    });
    expect(row.slug).toBe("lore-x");
    expect(row.parts).toEqual([{ key: "look", body: "plain" }]);
    expect(row.secrets).toEqual(["hush"]);
    expect(row.meta).toMatchObject({ id: "lore.x", path: "lore/x.md" });
  });
});
