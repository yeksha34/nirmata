import { type Client, Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { CardStore } from "../src/card-store";

const USER = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";

function mockDb(recordQuery?: (sql: string, params: unknown[]) => void) {
  const pool: Pool = {
    connect: async () => ({
      query: async (text: string, params: unknown[] = []) => {
        recordQuery?.(text, params);
        const t = text.replace(/\s+/g, " ");
        if (t.includes("from world_lore.worlds where slug")) {
          return { rows: [{ id: WORLD }] };
        }
        if (t.includes("from world_lore.world_lines where world_id")) {
          return { rows: [{ id: "line-default" }] };
        }
        if (t.includes("length(d.body) as body_size")) {
          return {
            rows: [
              {
                card_id: "c1-uuid",
                kind: "character",
                slug: "tina",
                chapter_slug: "chapter-1",
                vn_slug: null,
                title: "Tina Marsh",
                meta: { id: "character.tina" },
                body_size: 10,
                parts: [],
                part_size: 0,
                secret_size: 0,
              },
            ],
          };
        }
        if (t.includes("select c.id as card, c.kind")) {
          return {
            rows: [
              {
                card: "c1-uuid",
                kind: "character",
                slug: "tina",
                chapter_slug: "chapter-1",
                vn_slug: null,
                title: "Tina Marsh",
                body: "Body text",
                meta: { id: "character.tina" },
              },
            ],
          };
        }
        if (t.includes("from world_lore.card_draft_parts") || t.includes("from world_lore.card_draft_secrets")) {
          return { rows: [] };
        }
        if (t.includes("from world_lore.cards where world_id")) {
          return { rows: [{ id: "c1-uuid" }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return new CardStore(new Db(pool));
}

describe("CardStore parameter binding and scoping (BUG-011)", () => {
  it("supplies 5 parameters matching $1..$5 prepared statement when listing chapter cards hierarchically", async () => {
    let executedSql = "";
    let suppliedParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("length(d.body) as body_size")) {
        executedSql = sql;
        suppliedParams = params;
      }
    });

    const res = await store.list(USER, "sample-world", {
      chapterSlug: "chapter-1",
      hierarchical: true,
    });

    expect(res).toHaveLength(1);
    expect(res[0]!.cardId).toBe("c1-uuid");
    expect(res[0]!.slug).toBe("tina");

    // Must supply 5 parameters
    expect(suppliedParams).toHaveLength(5);
    expect(suppliedParams[0]).toBe("line-default");
    expect(suppliedParams[1]).toBe(WORLD);
    expect(suppliedParams[2]).toBeNull();
    expect(suppliedParams[3]).toBe("chapter-1");
    expect(suppliedParams[4]).toBeNull();

    // SQL statement MUST explicitly reference both $4 and $5 to avoid prepared statement param count mismatch
    expect(executedSql).toContain("$4::text is not null and c.chapter_slug = $4");
    expect(executedSql).toContain("$5::text is not null and c.vn_slug = $5");
  });

  it("supplies 5 parameters matching $1..$5 when listing VN cards non-hierarchically", async () => {
    let executedSql = "";
    let suppliedParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("length(d.body) as body_size")) {
        executedSql = sql;
        suppliedParams = params;
      }
    });

    const res = await store.list(USER, "sample-world", {
      vnSlug: "vn-prologue",
      hierarchical: false,
    });

    expect(res).toHaveLength(1);
    expect(suppliedParams).toHaveLength(5);
    expect(suppliedParams[3]).toBeNull();
    expect(suppliedParams[4]).toBe("vn-prologue");

    expect(executedSql).toContain("coalesce(c.chapter_slug, '') = coalesce($4::text, '')");
    expect(executedSql).toContain("coalesce(c.vn_slug, '') = coalesce($5::text, '')");
  });

  it("supplies 5 parameters matching $1..$5 when listing global cards without filter", async () => {
    let executedSql = "";
    let suppliedParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("length(d.body) as body_size")) {
        executedSql = sql;
        suppliedParams = params;
      }
    });

    await store.list(USER, "sample-world");
    expect(suppliedParams).toHaveLength(5);
    expect(suppliedParams[3]).toBeNull();
    expect(suppliedParams[4]).toBeNull();
    expect(executedSql).toContain("$4::text");
    expect(executedSql).toContain("$5::text");
  });

  it("exposes cardId, slug, and hierarchical fallback in get", async () => {
    let getParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("select c.id as card, c.kind")) {
        getParams = params;
      }
    });

    const card = await store.get(USER, "sample-world", "character.tina", {
      chapterSlug: "chapter-1",
    });

    expect(card).toBeDefined();
    expect(card?.cardId).toBe("c1-uuid");
    expect(card?.slug).toBe("tina");
    expect(getParams[3]).toBe("chapter-1");
    expect(getParams[4]).toBeNull();
  });

  it("removes a scoped card without colliding with global scope", async () => {
    let executedSql = "";
    let suppliedParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("coalesce(chapter_slug")) {
        executedSql = sql;
        suppliedParams = params;
      }
    });

    const removed = await store.remove(USER, "sample-world", "character.tina", {
      chapterSlug: "chapter-1",
    });

    expect(removed).toBe(true);
    expect(executedSql).toContain("coalesce(chapter_slug, '') = coalesce($3, '')");
    expect(executedSql).toContain("coalesce(vn_slug, '') = coalesce($4, '')");
    expect(suppliedParams[2]).toBe("chapter-1");
    expect(suppliedParams[3]).toBeNull();
  });
});
