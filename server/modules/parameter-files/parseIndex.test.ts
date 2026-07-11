import { describe, expect, it } from "vitest";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";

describe("buildJsonParsedIndex", () => {
  it("flattens nested keys to slash paths", () => {
    const index = buildJsonParsedIndex('{"battery":{"temp_max":85}}');
    expect(index["battery/temp_max"]?.value).toBe("85");
  });

  it("throws on invalid json", () => {
    expect(() => buildJsonParsedIndex("{not json")).toThrow();
  });
});

describe("buildDtsParsedIndex", () => {
  it("maps property assignments to node paths", () => {
    const source = "battery {\n  temp_max = <85>;\n};";
    const index = buildDtsParsedIndex(source);
    expect(index["battery/temp_max"]?.value).toBe("<85>");
  });

  it("maps nested node blocks to slash paths", () => {
    const source = "battery {\n  thermal {\n    max = <85>;\n  };\n};";
    const index = buildDtsParsedIndex(source);
    expect(index["battery/thermal/max"]?.value).toBe("<85>");
  });
});
