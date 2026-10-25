import type { Actor, Card } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { HostError, type SourceBackend, SourceCards } from "../src";
import { loadWorld } from "./helpers";

const host: Actor = { id: "owner", role: "host" };
const player: Actor = { id: "guest", role: "player" };

function memoryBackend() {
  const { world, cards } = loadWorld("example-world");
  const store = new Map(cards.map((c) => [c.fm.id, c]));
  const writes: string[] = [];
  const backend: SourceBackend = {
    world: async () => world,
    cards: async () => [...store.values()],
    save: async (card) => {
      writes.push(`save ${card.fm.id}`);
      store.set(card.fm.id, card);
    },
    remove: async (id) => {
      writes.push(`remove ${id}`);
      store.delete(id);
    },
  };
  return { source: new SourceCards(backend), store, writes };
}

const marrowText = (body: string) =>
  `---\nid: char.marrow\nkind: character\nname: Marrow\nkeywords: [marrow]\nsummary: Edited.\n---\n\n# Marrow\n\n${body}\n`;

describe("a host", () => {
  it("can edit a source card, from a card object or from markdown text", async () => {
    const { source, store } = memoryBackend();
    const marrow = store.get("char.marrow") as Card;
    await source.update(host, { ...marrow, body: "# Marrow\n\nNew body." });
    expect(store.get("char.marrow")?.body).toContain("New body.");

    const card = await source.editFromText(
      host,
      "characters/marrow.md",
      marrowText("Typed in the editor."),
    );
    expect(card.fm.summary).toBe("Edited.");
    expect(store.get("char.marrow")?.body).toContain("Typed in the editor.");
  });

  it("can add a new card and remove one", async () => {
    const { source, store, writes } = memoryBackend();
    await source.editFromText(
      host,
      "lore/tides.md",
      "---\nid: lore.tides\nkind: lore\nname: Tides\n---\n\nThey turn.\n",
    );
    expect(store.has("lore.tides")).toBe(true);
    await source.remove(host, "lore.tides");
    expect(store.has("lore.tides")).toBe(false);
    expect(writes).toEqual(["save lore.tides", "remove lore.tides"]);
  });

  it("is refused invalid cards, with the problems listed, and nothing is written", async () => {
    const { source, writes } = memoryBackend();
    await expect(source.editFromText(host, "x.md", "# no frontmatter")).rejects.toMatchObject({
      code: "invalid_card",
    });
    await expect(
      source.editFromText(host, "x.md", "---\nid: Bad Id\nkind: dragon\nname: X\n---\n"),
    ).rejects.toThrow(/id must look like.*kind:/s);
    expect(writes).toEqual([]);
  });

  it("cannot make two cards share an id", async () => {
    const { source, writes } = memoryBackend();
    await expect(
      source.editFromText(host, "characters/impostor.md", marrowText("Another Marrow.")),
    ).rejects.toThrow(/duplicate id "char.marrow"/);
    expect(writes).toEqual([]);
  });

  it("cannot remove a card that does not exist", async () => {
    const { source } = memoryBackend();
    await expect(source.remove(host, "nope.card")).rejects.toMatchObject({ code: "nothing_to_do" });
  });
});

describe("a player", () => {
  it("cannot edit, add or remove source cards, and nothing is written", async () => {
    const { source, store, writes } = memoryBackend();
    const marrow = store.get("char.marrow") as Card;
    const before = JSON.stringify([...store.values()]);

    const attempts = [
      source.update(player, { ...marrow, body: "Vandalised." }),
      source.editFromText(player, "characters/marrow.md", marrowText("Vandalised.")),
      source.editFromText(player, "lore/new.md", "---\nid: lore.new\nkind: lore\nname: New\n---\n"),
      source.remove(player, "char.marrow"),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toBeInstanceOf(HostError);
      await expect(attempt).rejects.toMatchObject({
        code: "forbidden",
        message: "Only the host can edit the source cards.",
      });
    }
    expect(writes).toEqual([]);
    expect(JSON.stringify([...store.values()])).toBe(before);
  });

  it("is refused before the card is even looked at", async () => {
    const { source } = memoryBackend();
    await expect(source.editFromText(player, "x.md", "not a card at all")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("can read the cards but cannot take the copy that starts an adventure", async () => {
    const { source } = memoryBackend();
    expect((await source.list()).length).toBeGreaterThan(0);
    expect((await source.world()).name).toBe("example-world");
    await expect(source.snapshot(player)).rejects.toMatchObject({ code: "forbidden" });
    const snap = await source.snapshot(host);
    expect(snap.cards.length).toBeGreaterThan(0);
  });
});
