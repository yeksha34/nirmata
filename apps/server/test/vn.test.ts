import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorldFiles } from "../src";
import { HOST_KEY, rig, tempWorld } from "./helpers";

describe("visual novel adaptation pipeline (server & disk)", () => {
  it("scaffolds a new visual novel adaptation on disk", async () => {
    const worldDir = await tempWorld();
    const world = new WorldFiles(worldDir);

    // Initial list is empty
    expect(await world.vns()).toEqual([]);

    // Scaffold a VN from a chapter
    const summary = await world.scaffoldVn({
      slug: "ch01-awakening",
      title: "Chapter 1: The Awakening",
      source: "chapters/01_intro.md",
      mode: "mode_1",
      mc: "Tara",
      tier: "short",
    });

    expect(summary.slug).toBe("ch01-awakening");
    expect(summary.title).toBe("Chapter 1: The Awakening");
    expect(summary.mc).toBe("Tara");
    expect(summary.slideCount).toBeGreaterThan(0);

    // List reflects the new VN
    const list = await world.vns();
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe("ch01-awakening");
    expect(list[0]?.slideCount).toBe(summary.slideCount);

    // Read full VN
    const vn = await world.vn("ch01-awakening");
    expect(vn.manifest.slug).toBe("ch01-awakening");
    expect(vn.manifest.mc).toBe("Tara");
    expect(vn.adaptationMd).toContain("## 8. Script");
    expect(vn.slides?.slides.length).toBe(summary.slideCount);

    // Verify files on disk
    const manifestOnDisk = JSON.parse(
      await readFile(join(worldDir, "vns", "ch01-awakening", "manifest.json"), "utf8"),
    );
    expect(manifestOnDisk.slug).toBe("ch01-awakening");

    const slidesOnDisk = JSON.parse(
      await readFile(join(worldDir, "vns", "ch01-awakening", "slides.json"), "utf8"),
    );
    expect(slidesOnDisk.slides.length).toBe(summary.slideCount);
  });

  it("compiles script updates and saves slides to disk", async () => {
    const worldDir = await tempWorld();
    const world = new WorldFiles(worldDir);

    await world.scaffoldVn({
      slug: "ch02-confrontation",
      title: "Chapter 2",
      source: "chapters/02.md",
    });

    // Update adaptation.md with a custom scene and menu
    const updatedScript = `
# Chapter 2 Adaptation
Source: chapters/02.md · Mode: mode_1 · MC: Tara · Tier: short

## 8. Script

## SC-01 The Ambush [route: common]
[bg forest_night] [music combat] [fade in]
[show tara alert left]
TARA: Someone's following us.

[show bandit grin right]
BANDIT: Hand over your coin!

MENU
  * "Draw weapon." (canon) → SC-02 {resolve +1}
  * "Flee."                → SC-03

## SC-02 Counterattack [route: canon]
[show tara determined left]
TARA: Not today.
[ending: victory]

## SC-03 Escape [route: divergent]
[show tara worried left]
( TARA ) I run into the dark thicket.
[ending: retreat]
`;

    await world.saveVn("ch02-confrontation", { adaptationMd: updatedScript });

    // Trigger recompile
    const { slides, diagnostics } = await world.compileVn("ch02-confrontation");

    expect(slides.sceneOrder).toEqual(["SC-01", "SC-02", "SC-03"]);
    expect(slides.slides.length).toBeGreaterThan(0);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // Verify slides were written to disk
    const reloaded = await world.vn("ch02-confrontation");
    expect(reloaded.slides?.sceneOrder).toEqual(["SC-01", "SC-02", "SC-03"]);
    const sc01 = reloaded.slides?.slides.find(
      (s) => s.sceneId === "SC-01" && s.action.type === "menu",
    );
    expect(sc01).toBeDefined();
  });

  it("exposes REST API for scaffolding, compiling and reading VNs", async () => {
    const r = await rig();

    // 1. Join as host
    const joinRes = await r.app.request("/api/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostKey: HOST_KEY, nick: "Host" }),
    });
    expect(joinRes.status).toBe(201);
    const { token } = (await joinRes.json()) as { token: string };
    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    // 2. Scaffold a VN via API
    const scaffoldRes = await r.app.request("/api/worlds/example-world/vns/scaffold", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        slug: "ch01-api-test",
        title: "API VN Test",
        source: "chapters/01.md",
        mc: "Kael",
      }),
    });
    expect(scaffoldRes.status).toBe(201);
    const { vn: scaffolded } = (await scaffoldRes.json()) as {
      vn: { slug: string; slideCount: number };
    };
    expect(scaffolded.slug).toBe("ch01-api-test");
    expect(scaffolded.slideCount).toBeGreaterThan(0);

    // 3. List VNs via API
    const listRes = await r.app.request("/api/worlds/example-world/vns", {
      headers: authHeaders,
    });
    expect(listRes.status).toBe(200);
    const { vns } = (await listRes.json()) as { vns: Array<{ slug: string }> };
    expect(vns.some((v) => v.slug === "ch01-api-test")).toBe(true);

    // 4. Get VN details via API
    const detailRes = await r.app.request("/api/worlds/example-world/vns/ch01-api-test", {
      headers: authHeaders,
    });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      manifest: { mc: string };
      slides: { slides: unknown[] };
    };
    expect(detail.manifest.mc).toBe("Kael");
    expect(detail.slides.slides.length).toBe(scaffolded.slideCount);

    // 5. Recompile via API
    const compileRes = await r.app.request("/api/worlds/example-world/vns/ch01-api-test/compile", {
      method: "POST",
      headers: authHeaders,
    });
    expect(compileRes.status).toBe(200);
    const compileResult = (await compileRes.json()) as { slides: { sceneOrder: string[] } };
    expect(compileResult.slides.sceneOrder.length).toBeGreaterThan(0);
  });
});
