import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const demo = { NIRMATA_PROVIDER: "demo", NIRMATA_HOST_KEY: "a-long-enough-key" };

describe("where the worlds are", () => {
  it("looks in the folder pnpm was started from, not the package folder it runs in", () => {
    const config = loadConfig({ ...demo, INIT_CWD: "/repo" }, undefined);
    expect(config.libraryDir).toBe(resolve("/repo", "worlds"));
  });

  it("falls back to the current folder, and honours NIRMATA_WORLDS", () => {
    expect(loadConfig(demo, "/here").libraryDir).toBe(resolve("/here", "worlds"));
    expect(loadConfig({ ...demo, NIRMATA_WORLDS: "elsewhere" }, "/here").libraryDir).toBe(
      resolve("/here", "elsewhere"),
    );
  });
});
