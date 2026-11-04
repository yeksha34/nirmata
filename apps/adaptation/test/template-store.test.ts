import { describe, expect, it } from "vitest";
import { parseGraph, parseKind, TemplateError, templateKindOf } from "../src";

describe("workflow templates", () => {
  it("names the template kind after the asset kind", () => {
    expect(templateKindOf("sprite")).toBe("workflow_sprite");
    expect(templateKindOf("bg")).toBe("workflow_bg");
    expect(templateKindOf("clothes")).toBe("workflow_clothes");
  });

  it("accepts a ComfyUI API graph", () => {
    const graph = { "1": { class_type: "KSampler", inputs: { steps: 20 } } };
    expect(parseGraph(graph)).toEqual(graph);
  });

  it("refuses what is not a graph", () => {
    const bad = [null, [], "x", {}, { "1": null }, { "1": { inputs: {} } }, { "1": { class_type: "K" } }];
    for (const input of bad) {
      expect(() => parseGraph(input), JSON.stringify(input)).toThrow(TemplateError);
    }
  });

  it("refuses a graph that is too large", () => {
    const big = { "1": { class_type: "K", inputs: { text: "x".repeat(262144) } } };
    expect(() => parseGraph(big)).toThrow(TemplateError);
  });

  it("knows the kinds of asset", () => {
    expect(parseKind("object")).toBe("object");
    expect(() => parseKind("weapon")).toThrow(TemplateError);
  });
});
