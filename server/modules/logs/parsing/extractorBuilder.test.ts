import { describe, expect, it } from "vitest";
import { decodeLogFiles, generateExtractorPattern } from "./engine";
import { compileParsingPattern, parsingSpecSchema } from "./spec";
import type { ExtractorPatternInput } from "./extractorBuilder";

function segment(line: string, text: string, name: string, type: ExtractorPatternInput["segments"][number]["type"]) {
  const start = line.indexOf(text);
  return { start, end: start + text.length, name, type };
}

describe("extractor pattern engine interface", () => {
  it.each([
    { line: "[ 123.456] charger: vbus=9012 ibus=1450 temp=71", fields: [["9012", "vbus", "uint"], ["1450", "ibus", "uint"], ["71", "temp", "int"]],
      same: "[ 124.789] charger: vbus=5000 ibus=900 temp=-2", other: "[ 124.789] battery: vbus=5000 ibus=900 temp=-2", values: { vbus: 5000, ibus: 900, temp: -2 } },
    { line: "10-19 12:34:56.789 1234 5678 I Charger: current=1450", fields: [["1450", "current", "int"]],
      same: "10-20 13:35:57.123 2345 6789 I Charger: current=900", other: "10-20 13:35:57.123 2345 6789 E Camera: current=900", values: { current: 900 } },
    { line: "chip=bq25890 reg=0x0B value=0x20", fields: [["0x0B", "register", "hex"], ["0x20", "value", "hex"]],
      same: "chip=bq25890 reg=0x0C value=AF", other: "chip=bq25891 reg=0x0C value=AF", values: { register: 12, value: 175 } },
    { line: 'charger state="thermal hold"', fields: [['"thermal hold"', "state", "quoted"]],
      same: 'charger state="charging"', other: 'camera state="charging"', values: { state: "charging" } }
  ] as const)("generalizes realistic $line without matching unrelated lines", ({ line, fields, same, other, values }) => {
    const result = generateExtractorPattern({ line, segments: fields.map(([text, name, type]) => segment(line, text, name, type)), sampleLines: [line, same, other, `${same} extra`], generalizeNumbers: true });
    expect(result).toMatchObject({ matchCount: 2, totalLines: 4, coverage: 0.5, matchedLines: [{ line: 1, text: line }, { line: 2, text: same }] });
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "generated", pattern: result.pattern, fields: result.fields }] });
    const decoded = decodeLogFiles(spec, [{ file: "sample.log", lines: [same, other] }]);
    expect(decoded.events).toHaveLength(1);
    expect(Object.fromEntries(Object.entries(decoded.events[0].fields).map(([key, field]) => [key, typeof field === "object" && field !== null && "value" in field ? field.value : field]))).toEqual(values);
  });

  it.each([
    ["int", "-12", ["+3", "0", "-99"], ["1.5", "0x20"]],
    ["uint", "12", ["3", "0", "99"], ["-1", "+2", "1.5"]],
    ["hex", "0xAF", ["0x0B", "FA", "123"], ["0xGG", "-1"]],
    ["float", "-1.5", ["2", "+.25", "3.", "-2e-3", "1.2E+4"], ["nan", "1e", "0xFF"]],
    ["string", "ready", ["waiting", "thermal_hold"], ["", "two words"]],
    ["quoted", '"two words"', ['""', '"other words"'], ["unquoted", '"broken']]
  ] as const)("generalizes %s correctly", (type, selected, matches, misses) => {
    const line = `value=${selected};`;
    const { pattern } = generateExtractorPattern({ line, segments: [segment(line, selected, "value", type)], sampleLines: [] });
    const compiled = compileParsingPattern(pattern);
    for (const value of matches) expect(compiled.test(`value=${value};`), value).toBe(true);
    for (const value of misses) expect(compiled.test(`value=${value};`), value).toBe(false);
  });

  it("escapes literals, generalizes whitespace, and captures quote interiors only", () => {
    const line = '[a.b]+(x)? $^|{tag}\\ value="one word"';
    const result = generateExtractorPattern({ line, segments: [segment(line, "one word", "text", "quoted")], sampleLines: [line] });
    expect(compileParsingPattern(result.pattern).exec('[a.b]+(x)?\t$^|{tag}\\   value="different word"')?.groups).toEqual({ text: "different word" });
    expect(result.fields).toEqual({ text: { type: "string" } });
  });

  it("keeps unselected numbers literal by default and supports selected multi-word strings", () => {
    const line = "123 message=thermal hold done";
    const { pattern } = generateExtractorPattern({ line, segments: [segment(line, "thermal hold", "message", "string")], sampleLines: [] });
    expect(compileParsingPattern(pattern).test("123 message=charge ready done")).toBe(true);
    expect(compileParsingPattern(pattern).test("124 message=charge ready done")).toBe(false);
  });

  it("validates advanced RE2 and reports coverage and named fields", () => {
    expect(generateExtractorPattern({ line: "", segments: [], pattern: "^value=(?P<v>\\d+)$", sampleLines: ["value=12", "other=12"] }))
      .toMatchObject({ fields: { v: { type: "string" } }, matchCount: 1, coverage: 0.5 });
    for (const pattern of ["(?=bad)", "(unnamed)", "(?P<v>a{101})", "x".repeat(513)]) {
      expect(() => generateExtractorPattern({ line: "", segments: [], pattern, sampleLines: [] })).toThrow();
    }
    expect(generateExtractorPattern({ line: "", segments: [], pattern: "^value=(?P<v>\\d+)$", sampleLines: Array(10).fill("value=12") }))
      .toMatchObject({ matchCount: 10, coverage: 1, matchedLines: Array.from({ length: 5 }, (_, index) => ({ line: index + 1, text: "value=12" })) });
  });

  it("rejects invalid ranges, names, types, values and bounded inputs", () => {
    const input: ExtractorPatternInput = { line: "n=12", segments: [{ start: 2, end: 4, name: "n", type: "uint" }], sampleLines: [] };
    for (const overrides of [
      { line: "x".repeat(6145) }, { line: "n=1\nn=2" }, { sampleLines: ["x".repeat(6145)] },
      { sampleLines: Array(501).fill("x") }, { sampleLines: Array(500).fill("界".repeat(1000)) },
      { segments: Array(33).fill(input.segments[0]) }, { segments: [{ ...input.segments[0], end: 5 }] },
      { segments: [{ ...input.segments[0], start: -1 }] }, { segments: [{ ...input.segments[0], name: "bad-name" }] },
      { segments: [{ ...input.segments[0], type: "bool" }] }, { line: "n=-1" }, { segments: [] },
      { segments: [input.segments[0], input.segments[0]] }
    ]) expect(() => generateExtractorPattern({ ...input, ...overrides } as ExtractorPatternInput)).toThrow();
  });
});
