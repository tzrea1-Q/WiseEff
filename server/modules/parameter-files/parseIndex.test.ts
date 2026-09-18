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

  it("rejects duplicate decoded keys instead of silently replacing source values", () => {
    expect(() => buildJsonParsedIndex('{"limit":1,"\\u006cimit":2}')).toThrow();
  });

  it.each([
    '{"\\u0000":1}', '{"safe":"\\u0000"}',
    '{"\\ud800":1}', '{"safe":"\\ud800"}',
    '{"\\udc00":1}', '{"safe":"\\udc00"}'
  ])("rejects strings that cannot survive PostgreSQL JSONB: %s", (source) => {
    expect(() => buildJsonParsedIndex(source)).toThrow();
  });

  it("refuses numeric changes instead of rounding source values", () => {
    for (const number of ["9007199254740993", "0.10000000000000001", "1e309", "1e-400", "-0"]) {
      expect(() => buildJsonParsedIndex(`{"value":${number}}`), number).toThrow();
    }
    expect(buildJsonParsedIndex('{"decimal":0.10,"temperature":36.5,"exp":1.2e2}')).toEqual({
      decimal: { value: "0.1" }, temperature: { value: "36.5" }, exp: { value: "120" }
    });
  });

  it("bounds source size, nesting and entry count before indexing", () => {
    expect(() => buildJsonParsedIndex(`{"x":"${"a".repeat(2 * 1024 * 1024)}"}`)).toThrow();
    expect(() => buildJsonParsedIndex("[".repeat(65) + "0" + "]".repeat(65))).toThrow();
    expect(() => buildJsonParsedIndex(`[${Array(100_001).fill("0").join(",")}]`)).toThrow();
    expect(buildJsonParsedIndex('{"合法😀":"\\ud83d\\ude00"}')).toEqual({ "合法😀": { value: "😀" } });
  });

  it("decodes source bytes as strict UTF-8 without replacement", () => {
    expect(buildJsonParsedIndex(Buffer.from('{"x":"�"}', "utf8"))).toEqual({ x: { value: "�" } });
    expect(() => buildJsonParsedIndex(Buffer.concat([
      Buffer.from('{"x":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')
    ]))).toThrow();
  });

  it("keeps slash, tilde, empty and prototype-like keys distinct in source locators", () => {
    const index = buildJsonParsedIndex('{"a/b":1,"a":{"b":2},"a~b":3,"":4,"__proto__":5}');
    expect(Object.keys(index).sort()).toEqual(["", "__proto__", "a/b", "a~0b", "a~1b"]);
    expect(index["a~1b"]?.value).toBe("1");
    expect(index["a/b"]?.value).toBe("2");
    expect(index["__proto__"]?.value).toBe("5");
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
