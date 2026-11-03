import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, Db, type Pool } from "@nirmata/db";
import { afterEach, describe, expect, it } from "vitest";
import { importWorldStory } from "../src/story-import";

const USER = "22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "nirmata-story-"));
  dirs.push(root);
  writeFileSync(
    join(root, "world.json"),
    JSON.stringify({ name: "Sample World", title: "Sample", tagline: "A tale." }),
  );
  mkdirSync(join(root, "chapters", "scenes"), { recursive: true });
  mkdirSync(join(root, "drafts"));
  writeFileSync(join(root, "chapters", "chapter_1.md"), "# The Quay\n\nShe waited.\n");
  writeFileSync(join(root, "chapters", "scenes", "scene_1.md"), "She waits at the quay.\n");
  writeFileSync(join(root, "drafts", "draft_a.md"), "A rough start.\n");
  writeFileSync(join(root, "drafts", "_hidden.md"), "not read");
  return root;
}

interface Row {
  title: string;
  body: string;
  imported: string | null;
}

/** A tiny database: the world's manifest and its writings, with the hashes the real one computes. */
function fakeDb() {
  const state = { manifest: null as unknown, rows: new Map<string, Row>() };
  const client: Client = {
    async query(text: string, params: unknown[] = []) {
      if (text.includes("from world_lore.worlds where slug"))
        return { rows: [{ id: "w1", manifest: state.manifest }] };
      if (text.includes("save_world_manifest")) {
        state.manifest = JSON.parse(String(params[1]));
        return { rows: [] };
      }
      if (text.includes("from reader.writings")) {
        return {
          rows: [...state.rows].map(([path, r]) => ({
            path,
            body_hash: sha(r.body),
            imported_hash: r.imported,
          })),
        };
      }
      if (text.includes("reader.save_writing")) {
        const path = String(params[1]);
        const had = state.rows.get(path);
        state.rows.set(path, {
          title: String(params[2]),
          body: String(params[3]),
          imported: (params[4] as string | null) ?? had?.imported ?? null,
        });
        return { rows: [{ save_writing: "x1" }] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as Client;
  const pool: Pool = { connect: async () => client as never, end: async () => undefined };
  return { db: new Db(pool), state };
}

const run = (f: ReturnType<typeof fakeDb>, root: string, extra: object = {}) =>
  importWorldStory({ db: f.db, folder: root, userId: USER, slug: "sample", ...extra });

describe("importing a world's story", () => {
  it("copies world.json, the chapters, the scenes and the drafts, by path", async () => {
    const f = fakeDb();
    const r = await run(f, folder());
    expect(r.manifest).toBe("added");
    expect(r.writings).toEqual({ found: 3, added: 3, updated: 0, unchanged: 0 });
    expect([...f.state.rows.keys()].sort()).toEqual([
      "chapters/chapter_1.md",
      "chapters/scenes/scene_1.md",
      "drafts/draft_a.md",
    ]);
    expect(f.state.rows.get("chapters/chapter_1.md")?.title).toBe("The Quay");
    expect(f.state.rows.get("drafts/draft_a.md")?.title).toBe("Draft a");
    expect((f.state.manifest as { tagline: string }).tagline).toBe("A tale.");
  });

  it("leaves an unchanged story alone and updates a file changed since", async () => {
    const f = fakeDb();
    const root = folder();
    await run(f, root);
    const again = await run(f, root);
    expect(again.manifest).toBe("unchanged");
    expect(again.writings).toMatchObject({ added: 0, updated: 0, unchanged: 3 });

    writeFileSync(join(root, "drafts", "draft_a.md"), "A better start.\n");
    const changed = await run(f, root);
    expect(changed.writings.updated).toBe(1);
    expect(f.state.rows.get("drafts/draft_a.md")?.body).toBe("A better start.\n");
  });

  it("keeps a text edited in the database, unless forced", async () => {
    const f = fakeDb();
    const root = folder();
    await run(f, root);
    const edited = f.state.rows.get("chapters/chapter_1.md");
    if (edited) edited.body = "Edited in the app.\n";
    const kept = await run(f, root);
    expect(kept.conflicts).toEqual(["chapters/chapter_1.md"]);
    expect(f.state.rows.get("chapters/chapter_1.md")?.body).toBe("Edited in the app.\n");

    const forced = await run(f, root, { force: true });
    expect(forced.writings.updated).toBe(1);
    expect(f.state.rows.get("chapters/chapter_1.md")?.body).toBe("# The Quay\n\nShe waited.\n");
  });

  it("writes nothing on a dry run", async () => {
    const f = fakeDb();
    const r = await run(f, folder(), { dryRun: true });
    expect(r.writings.added).toBe(3);
    expect(f.state.rows.size).toBe(0);
    expect(f.state.manifest).toBeNull();
  });

  it("copes with a world with no chapters, drafts or world.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "nirmata-nostory-"));
    dirs.push(root);
    const r = await run(fakeDb(), root);
    expect(r.manifest).toBe("none");
    expect(r.writings.found).toBe(0);
    expect(r.skipped[0]).toContain("world.json");
  });
});
