import { describe, expect, it } from "vitest";
import { DEFAULT_EXPECTATIONS, importPrompt, TOKEN_ENV, tokenBlock } from "../src/import-prompt";
import { parseKinds } from "../src/screens/import-world";

describe("the tokens block", () => {
  it("has a NAME=value line for each worker, in order", () => {
    const block = tokenBlock({
      full: "nga_a",
      characters: "nga_b",
      accessories: "nga_c",
      settings: "nga_d",
    });
    expect(block.split("\n")).toEqual([
      "NIRMATA_TOKEN_FULL=nga_a",
      "NIRMATA_TOKEN_CHARACTERS=nga_b",
      "NIRMATA_TOKEN_ACCESSORIES=nga_c",
      "NIRMATA_TOKEN_SETTINGS=nga_d",
    ]);
  });
});

describe("the prompt for the agent", () => {
  const prompt = importPrompt({
    server: "http://127.0.0.1:8788",
    world: "the-tale",
    settingsKinds: ["place", "playground"],
    expectations: "1. Only copy the markdown.\n",
  });

  it("names the server, the world and the environment variables, and never a token", () => {
    expect(prompt).toContain("http://127.0.0.1:8788");
    expect(prompt).toContain("the-tale");
    for (const name of Object.values(TOKEN_ENV)) expect(prompt).toContain(name);
    expect(prompt).not.toMatch(/nga_/);
  });

  it("carries the author's expectations as written, and the settings kinds", () => {
    expect(prompt).toContain("1. Only copy the markdown.");
    expect(prompt).toContain('"place", "playground"');
  });

  it("leaves the three places only the author knows in angle brackets", () => {
    for (const mark of ["<SOURCE-FOLDER>", "<WORKING-FOLDER>", "<NIRMATA-REPO>"]) {
      expect(prompt).toContain(mark);
    }
  });

  it("starts from expectations that keep the author's words and do not publish", () => {
    expect(DEFAULT_EXPECTATIONS).toMatch(/Do not soften, censor, summarise/);
    expect(DEFAULT_EXPECTATIONS).toMatch(/Do not publish/);
  });
});

describe("the settings kinds an author types", () => {
  it("keeps only names that can be kinds, once each", () => {
    expect(parseKinds("Place, playground  place, not-a-kind, 9x")).toEqual(["place", "playground"]);
    expect(parseKinds("  ")).toEqual([]);
  });
});
