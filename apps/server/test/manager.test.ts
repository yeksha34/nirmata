import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client, HOST_KEY, rig } from "./helpers";

type Rig = Awaited<ReturnType<typeof rig>>;

async function host(r: Rig) {
  const c = new Client(r.app);
  expect((await c.join("x", { hostKey: HOST_KEY })).status).toBe(201);
  return c;
}

const form = {
  kind: "character",
  name: "Old Tam",
  keywords: ["tam", "ferryman"],
  summary: "Ferryman who never speaks.",
  always: false,
  body: "# Old Tam\n\n- **Wants:** to be left alone & paid in salt.\n",
};

const read = (r: Rig, path: string) => readFile(join(r.world.root, path), "utf8");

describe("the story manager: adding cards", () => {
  it("makes a card from the form, in XML around markdown, with its own file and id", async () => {
    const r = await rig();
    const dana = await host(r);

    const made = await dana.put("/api/worlds/example-world/cards", { form });
    expect(made.status).toBe(200);
    expect(made.body.card).toEqual({ path: "characters/old-tam.md", id: "char.old-tam" });
    expect(await read(r, "characters/old-tam.md")).toBe(
      `<card id="char.old-tam" kind="character" name="Old Tam">
  <keywords>tam, ferryman</keywords>
  <summary>Ferryman who never speaks.</summary>

# Old Tam

- **Wants:** to be left alone & paid in salt.
</card>
`,
    );

    const again = await dana.put("/api/worlds/example-world/cards", { form });
    expect(again.body.card).toEqual({ path: "characters/old-tam-2.md", id: "char.old-tam-2" });

    const page = (await dana.get("/api/worlds/example-world")).body;
    const tam = page.cards.find((c: { fm: { id: string } }) => c.fm.id === "char.old-tam");
    expect(tam.fm.keywords).toEqual(["tam", "ferryman"]);
    expect(tam.file).toMatch(/^<card /);
    expect(page.broken).toEqual([]);
  });

  it("puts each kind in its own folder", async () => {
    const r = await rig();
    const dana = await host(r);
    const at = async (kind: string) =>
      (await dana.put("/api/worlds/example-world/cards", { form: { ...form, kind } })).body.card;
    expect((await at("lore")).path).toBe("lore/old-tam.md");
    expect((await at("place")).path).toBe("setting/places/old-tam.md");
    expect((await at("arc")).path).toBe("plot/arcs/old-tam.md");
    expect((await at("rule")).path).toBe(".agents/rules/old-tam.md");
  });

  it("is for the host only, and refuses what is not a card in plain words", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    expect((await sam.put("/api/worlds/example-world/cards", { form })).status).toBe(403);
    expect(
      (await dana.put("/api/worlds/example-world/cards", { form: { ...form, name: " " } })).status,
    ).toBe(400);
    expect(
      (await dana.put("/api/worlds/example-world/cards", { form: { ...form, kind: "dragon" } }))
        .status,
    ).toBe(400);
    expect((await dana.put("/api/worlds/nowhere/cards", { form })).body.error.code).toBe(
      "nothing_to_do",
    );
    expect(await readdir(join(r.world.root, "characters"))).not.toContain("old-tam.md");
  });
});

describe("the story manager: changing cards", () => {
  it("rewrites an older card in the new syntax, keeping its file, id and extra fields", async () => {
    const r = await rig();
    const dana = await host(r);
    const file = join(r.world.root, "characters", "marrow.md");
    await writeFile(
      file,
      "---\nid: char.marrow\nkind: character\nname: Marrow\nkeywords: [marrow]\nmood: wary\nplotMax: 2\n---\n\n# Marrow\n\nGruff.\n",
    );

    const done = await dana.put("/api/worlds/example-world/cards", {
      path: "characters/marrow.md",
      form: { ...form, name: "Marrow the Keeper", body: "# Marrow\n\nGruffer.\n" },
    });
    expect(done.body.card).toEqual({ path: "characters/marrow.md", id: "char.marrow" });
    const text = await readFile(file, "utf8");
    expect(text).toMatch(
      /^<card id="char\.marrow" kind="character" name="Marrow the Keeper" mood="wary" plotMax="2">/,
    );
    expect(text).toContain("Gruffer.");

    const page = (await dana.get("/api/worlds/example-world")).body;
    const marrow = page.cards.find((c: { fm: { id: string } }) => c.fm.id === "char.marrow");
    expect(marrow.fm).toMatchObject({ mood: "wary", plotMax: 2 });
  });

  it("will not take an id another card has, and writes nothing", async () => {
    const r = await rig();
    const dana = await host(r);
    const before = await read(r, "characters/marrow.md");
    const res = await dana.put("/api/worlds/example-world/cards", {
      path: "characters/marrow.md",
      text: before.replace(`id="char.marrow"`, `id="lore.the-fog"`),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/duplicate id "lore.the-fog"/);
    expect(await read(r, "characters/marrow.md")).toBe(before);
  });

  it("saves the file's text exactly as written, and refuses text that is not a card", async () => {
    const r = await rig();
    const dana = await host(r);
    const text = `<card id="char.marrow" kind="character" name="Marrow">\n<summary>Terse.</summary>\n\nHand written.\n</card>\n`;
    expect(
      (await dana.put("/api/worlds/example-world/cards", { path: "characters/marrow.md", text }))
        .status,
    ).toBe(200);
    expect(await read(r, "characters/marrow.md")).toBe(text);

    const bad = await dana.put("/api/worlds/example-world/cards", {
      path: "characters/marrow.md",
      text: `<card id="char.marrow" kind=character name="Marrow">\n</card>`,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/name="value"/);
    expect(await read(r, "characters/marrow.md")).toBe(text);

    const outside = await dana.put("/api/worlds/example-world/cards", {
      path: "../world.json",
      text,
    });
    expect(outside.status).toBe(400);
  });

  it("shows a card that cannot be read instead of failing the page, and lets it be fixed as text", async () => {
    const r = await rig();
    const dana = await host(r);
    await writeFile(
      join(r.world.root, "lore", "oops.md"),
      '<card id="lore.oops" kind="lore">\nno name\n</card>\n',
    );

    const page = (await dana.get("/api/worlds/example-world")).body;
    expect(page.cards.length).toBeGreaterThan(0);
    expect(page.broken).toHaveLength(1);
    expect(page.broken[0].path).toBe("lore/oops.md");
    expect(page.broken[0].problems.join(" ")).toMatch(/name/);
    expect(page.broken[0].file).toContain("no name");

    // as a form it says to use text; as text it can be mended
    const asForm = await dana.put("/api/worlds/example-world/cards", {
      path: "lore/oops.md",
      form,
    });
    expect(asForm.body.error.message).toMatch(/Edit it as text/);
    const fixed = await dana.put("/api/worlds/example-world/cards", {
      path: "lore/oops.md",
      text: '<card id="lore.oops" kind="lore" name="Oops">\nFixed.\n</card>\n',
    });
    expect(fixed.status).toBe(200);
    expect((await dana.get("/api/worlds/example-world")).body.broken).toEqual([]);
  });
});

describe("the story manager: removing cards and describing the world", () => {
  it("removes a card, even an unreadable one, and says so plainly when there is none", async () => {
    const r = await rig();
    const dana = await host(r);
    const sam = await new Client(r.app).asPlayer("Sam");
    await writeFile(join(r.world.root, "lore", "oops.md"), "not a card");

    expect((await sam.del("/api/worlds/example-world/cards?path=lore/oops.md")).status).toBe(403);
    expect((await dana.del("/api/worlds/example-world/cards?path=lore/oops.md")).status).toBe(200);
    expect(
      (await dana.del("/api/worlds/example-world/cards?path=characters/marrow.md")).status,
    ).toBe(200);
    expect(await readdir(join(r.world.root, "characters"))).not.toContain("marrow.md");

    const missing = await dana.del("/api/worlds/example-world/cards?path=characters/marrow.md");
    expect(missing.body.error.code).toBe("nothing_to_do");
    expect((await dana.del("/api/worlds/example-world/cards")).status).toBe(400);
    expect((await dana.del("/api/worlds/example-world/cards?path=world.json")).status).toBe(400);
  });

  it("changes genre, tone and point of view, and keeps the rest of world.json", async () => {
    const r = await rig();
    const dana = await host(r);
    const done = await dana.patch("/api/worlds/example-world", {
      genre: ["gothic", "sea"],
      tone: ["wry"],
      perspective: "third-person",
    });
    expect(done.status).toBe(200);
    const page = (await dana.get("/api/worlds/example-world")).body;
    expect(page.manifest).toMatchObject({
      genre: ["gothic", "sea"],
      tone: ["wry"],
      perspective: "third-person",
    });
    expect(
      (await dana.patch("/api/worlds/example-world", { perspective: "fourth-person" })).status,
    ).toBe(400);
  });

  it("makes a new world's premise card in the new syntax", async () => {
    const r = await rig(undefined, { world: "none" });
    const dana = await host(r);
    await dana.post("/api/worlds", { title: "Ashfall", premise: "Ash & more ash." });
    const text = await readFile(join(r.library.root, "ashfall", "lore", "premise.md"), "utf8");
    expect(text).toBe(
      '<card id="lore.premise" kind="lore" name="Premise" always="true">\nAsh & more ash.\n</card>\n',
    );
  });
});

describe("the story manager: named parts and templates", () => {
  it("lists the templates, the same for everyone", async () => {
    const r = await rig();
    const sam = await new Client(r.app).asPlayer("Sam");
    const res = await sam.get("/api/card-templates");
    expect(res.status).toBe(200);
    const ids = res.body.templates.map((t: { id: string }) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["character.person", "place.location", "lore.concept"]),
    );
    const person = res.body.templates.find((t: { id: string }) => t.id === "character.person");
    expect(person.fields[0]).toEqual({ id: "kind", label: "Kind", hint: expect.any(String) });
  });

  it("writes the named parts as tags, drops empty ones, and shows them on the page", async () => {
    const r = await rig();
    const dana = await host(r);
    const fields = {
      age: "61",
      appearance: "Weathered.\n\nOne lamp-blind eye.",
      voice: "  ",
      wants: "Quiet.",
    };
    const made = await dana.put("/api/worlds/example-world/cards", { form: { ...form, fields } });
    expect(made.status).toBe(200);
    const text = await read(r, "characters/old-tam.md");
    expect(text).toContain("  <age>61</age>\n");
    expect(text).toContain("  <appearance>\nWeathered.\n\nOne lamp-blind eye.\n  </appearance>\n");
    expect(text).toContain("  <wants>Quiet.</wants>\n");
    expect(text).not.toContain("<voice>");

    const page = (await dana.get("/api/worlds/example-world")).body;
    const tam = page.cards.find((c: { fm: { id: string } }) => c.fm.id === "char.old-tam");
    expect(tam.fm.fields).toEqual({
      age: "61",
      appearance: "Weathered.\n\nOne lamp-blind eye.",
      wants: "Quiet.",
    });
  });

  it("replaces a card's parts when it is edited, and refuses a part with a bad name", async () => {
    const r = await rig();
    const dana = await host(r);
    const made = await dana.put("/api/worlds/example-world/cards", {
      form: { ...form, fields: { age: "61", wants: "Quiet." } },
    });
    const path = made.body.card.path;
    await dana.put("/api/worlds/example-world/cards", {
      path,
      form: { ...form, fields: { wants: "Salt." } },
    });
    const page = (await dana.get("/api/worlds/example-world")).body;
    expect(page.cards.find((c: { path: string }) => c.path === path).fm.fields).toEqual({
      wants: "Salt.",
    });

    const before = await read(r, path);
    const bad = await dana.put("/api/worlds/example-world/cards", {
      path,
      form: { ...form, fields: { "Not A Name": "x" } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/lowercase letters, digits and hyphens/);
    expect(await read(r, path)).toBe(before);
  });
});
