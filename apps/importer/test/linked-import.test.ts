import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectLinked } from "../src/linked-import";

function world() {
  const root = mkdtempSync(join(tmpdir(), "linked-"));
  for (const d of ["adornments", "clothes", "objects", "vns/one"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(
    join(root, "adornments", "Ana_ring.md"),
    '<card id="a" kind="adornment" name="Ana_ring" owner="char.ana" type="pierced">\n  <prompt>thick dull gold hoop</prompt>\n  <frames>left ear</frames>\n</card>\n',
  );
  writeFileSync(join(root, "clothes", "Ana_cloak.md"), '<card id="c" kind="clothes" name="Ana_cloak" owner="char.ana">\n  <prompt>a long grey cloak</prompt>\n</card>\n');
  writeFileSync(join(root, "objects", "lamp.md"), '<card id="o" kind="object" name="lamp" owners="char.ana" cgs="">\n  <prompt>a brass oil lamp</prompt>\n  <interaction>she lights it</interaction>\n</card>\n');
  writeFileSync(
    join(root, "vns", "one", "manifest.json"),
    JSON.stringify({ assets: { clothes: { Anya: ["cloak"] }, objects: [{ name: "lamp", owners: ["Anya"], cgs: ["night"] }] } }),
  );
  return root;
}

describe("collectLinked", () => {
  it("builds the prompt from the card and takes links from the manifests", () => {
    const found = collectLinked(world());
    const cloak = found.find((a) => a.name === "Ana_cloak");
    expect(cloak?.characters).toEqual(["Ana"]);
    expect(cloak?.positive).toContain("a long grey cloak");
    const lamp = found.find((a) => a.name === "lamp");
    expect(lamp?.characters).toEqual(["Anya"]);
    expect(lamp?.cgs).toEqual(["night"]);
    expect(lamp?.positive).toContain("a brass oil lamp");
    expect(lamp?.positive).not.toContain("lights");
  });

  it("falls back to the card's owners for an object no manifest lists", () => {
    const root = world();
    writeFileSync(
      join(root, "objects", "bell.md"),
      '<card id="b" kind="object" name="bell" owners="char.ana,char.bo" cgs="">\n  <prompt>a small bell</prompt>\n</card>\n',
    );
    expect(collectLinked(root).find((a) => a.name === "bell")?.characters).toEqual(["char.ana", "char.bo"]);
  });

  it("falls back to the owner a name starts with", () => {
    const ring = collectLinked(world()).find((a) => a.name === "Ana_ring");
    expect(ring?.characters).toEqual(["Ana"]);
    expect(ring?.positive).toContain("thick dull gold hoop");
  });
});
