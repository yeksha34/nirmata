import { type Client, Db, type Pool } from "@nirmata/db";
import { describe, expect, it } from "vitest";
import { createWorldInDb, WorldNotAllowed, worldNameFor } from "../src/world-create";

const USER = "22222222-2222-4222-8222-222222222222";

/** A database that already holds some world names, and records what is written. */
function fake(options: { taken?: string[]; forbidden?: boolean } = {}) {
  const taken = new Set(options.taken ?? []);
  const made: string[] = [];
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const pool: Pool = {
    connect: async (): Promise<Client> => ({
      query: async (text, params = []) => {
        const t = text.replace(/\s+/g, " ");
        calls.push({ text: t, params });
        if (t.includes("world_lore.create_world")) {
          if (options.forbidden) throw Object.assign(new Error("no"), { code: "42501" });
          const name = String(params[0]);
          if (taken.has(name)) throw Object.assign(new Error("dup"), { code: "23505" });
          made.push(name);
          return { rows: [{ id: "W1" }] };
        }
        if (t.includes("from world_lore.world_lines")) return { rows: [{ id: "L1" }] };
        if (t.includes("insert into world_lore.cards")) return { rows: [{ id: "C1" }] };
        return { rows: [] };
      },
      release: () => undefined,
    }),
    end: async () => undefined,
  };
  return { db: new Db(pool), made, calls };
}

describe("making a world in the database", () => {
  it("names the world after its title, and keeps names legal", () => {
    expect(worldNameFor("The Lantern Coast")).toBe("the-lantern-coast");
    expect(worldNameFor("The Lantern Coast", 3)).toBe("the-lantern-coast-3");
    expect(worldNameFor("संसार")).toBe("world"); // no letters the database accepts
    expect(worldNameFor("x")).toBe("x0");
    expect(worldNameFor("a".repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it("makes the world, its manifest and a premise card", async () => {
    const f = fake();
    const out = await createWorldInDb(f.db, USER, {
      title: "The Lantern Coast",
      tagline: "A coast.",
      premise: "Fog rules the quay.",
    });
    expect(out).toEqual({ name: "the-lantern-coast", title: "The Lantern Coast", tagline: "A coast." });
    expect(f.made).toEqual(["the-lantern-coast"]);
    const manifest = f.calls.find((c) => c.text.includes("save_world_manifest"));
    expect(JSON.parse(String(manifest?.params[1]))).toMatchObject({
      name: "the-lantern-coast",
      perspective: "second-person",
    });
    const draft = f.calls.find((c) => c.text.includes("insert into world_lore.card_drafts"));
    expect(draft?.params[3]).toBe("Premise");
    expect(draft?.params[4]).toBe("Fog rules the quay.");
  });

  it("writes no premise card when there is no premise", async () => {
    const f = fake();
    await createWorldInDb(f.db, USER, { title: "Plain", tagline: "", premise: "  " });
    expect(f.calls.some((c) => c.text.includes("insert into world_lore.card_drafts"))).toBe(false);
  });

  it("takes the next name when one is taken, even by a world the person cannot see", async () => {
    const f = fake({ taken: ["the-lantern-coast", "the-lantern-coast-2"] });
    const out = await createWorldInDb(f.db, USER, { title: "The Lantern Coast", tagline: "", premise: "" });
    expect(out.name).toBe("the-lantern-coast-3");
  });

  it("says when the person may not found worlds", async () => {
    await expect(
      createWorldInDb(fake({ forbidden: true }).db, USER, { title: "T", tagline: "", premise: "" }),
    ).rejects.toBeInstanceOf(WorldNotAllowed);
  });
});
