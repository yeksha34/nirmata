import { type Client, Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { SceneStateStore } from "../src/scene-state-store";

const USER = "11111111-1111-4111-8111-111111111111";
const WORLD = "22222222-2222-4222-8222-222222222222";
const CARD_UUID = "33333333-3333-4333-8333-333333333333";

function mockDb(recordQuery?: (sql: string, params: unknown[]) => void) {
  const pool: Pool = {
    connect: async () => ({
      query: async (text: string, params: unknown[] = []) => {
        recordQuery?.(text, params);
        if (text.includes("from world_lore.worlds where slug")) {
          return { rows: [{ id: WORLD }] };
        }
        if (text.includes("select c.id from world_lore.cards c")) {
          // Slug resolver query
          const slug = params[1];
          if (slug === "character.hero" || slug === "character-hero" || slug === "hero") {
            return { rows: [{ id: CARD_UUID }] };
          }
          return { rows: [] };
        }
        if (text.includes("world_lore.set_scene_card_state")) {
          return { rows: [{ id: "state-uuid-1" }] };
        }
        if (text.includes("world_lore.remove_scene_card_state")) {
          return { rows: [] };
        }
        if (text.includes("from world_lore.scene_card_states s")) {
          return {
            rows: [
              {
                scene_id: "scene_1",
                chapter_slug: "chapter_1",
                vn_slug: null,
                card_id: CARD_UUID,
                character_state: "transformed",
                clothing_state: null,
                role: null,
                card_slug: "character-hero",
                card_kind: "character",
                card_name: "The Hero",
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return new SceneStateStore(new Db(pool));
}

describe("SceneStateStore card UUID resolution and matrix operations", () => {
  it("resolves card slug to UUID when setting state with human-friendly card id", async () => {
    let resolverCalled = false;
    let setParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("select c.id from world_lore.cards c")) {
        resolverCalled = true;
      }
      if (sql.includes("set_scene_card_state")) {
        setParams = params;
      }
    });

    const id = await store.setCardState(USER, "sample-world", {
      chapterSlug: "chapter_1",
      sceneId: "scene_1",
      cardId: "character.hero",
      characterState: "transformed",
    });

    expect(id).toBe("state-uuid-1");
    expect(resolverCalled).toBe(true);
    // set_scene_card_state should receive the resolved UUID at param 5 ($5)
    expect(setParams[4]).toBe(CARD_UUID);
    expect(setParams[5]).toBe("transformed");
  });

  it("passes UUID directly without slug resolution query when cardId is already a UUID", async () => {
    let resolverCalled = false;
    let setParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("select c.id from world_lore.cards c")) {
        resolverCalled = true;
      }
      if (sql.includes("set_scene_card_state")) {
        setParams = params;
      }
    });

    const id = await store.setCardState(USER, "sample-world", {
      chapterSlug: "chapter_1",
      sceneId: "scene_1",
      cardId: CARD_UUID,
      characterState: "base",
    });

    expect(id).toBe("state-uuid-1");
    expect(resolverCalled).toBe(false);
    expect(setParams[4]).toBe(CARD_UUID);
  });

  it("resolves card slug when removing a card state", async () => {
    let removeParams: unknown[] = [];
    const store = mockDb((sql, params) => {
      if (sql.includes("remove_scene_card_state")) {
        removeParams = params;
      }
    });

    await store.removeCardState(USER, "sample-world", {
      chapterSlug: "chapter_1",
      sceneId: "scene_1",
      cardId: "character.hero",
    });

    expect(removeParams[4]).toBe(CARD_UUID);
  });

  it("returns scene matrix rows with structured card assignments", async () => {
    const store = mockDb();
    const matrix = await store.getMatrix(USER, "sample-world", { chapterSlug: "chapter_1" });
    expect(matrix).toHaveLength(1);
    const row = matrix[0]!;
    expect(row.sceneId).toBe("scene_1");
    expect(row.cards).toHaveLength(1);
    const card = row.cards[0]!;
    expect(card.cardId).toBe(CARD_UUID);
    expect(card.characterState).toBe("transformed");
  });
});
