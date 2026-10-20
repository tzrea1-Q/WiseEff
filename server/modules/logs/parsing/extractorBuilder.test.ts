import { describe, expect, it } from "vitest";
import { decodeLogFiles, generateExtractorPattern } from "./engine";
import { compileParsingPattern, parsingSpecSchema } from "./spec";
import type { ExtractorPatternInput } from "./extractorBuilder";

function segment(line: string, text: string, name: string, type: ExtractorPatternInput["segments"][number]["type"]) {
  const start = line.indexOf(text);
  return { start, end: start + text.length, name, type };
}

describe("extractor pattern engine interface", () => {
  it("generalizes all ISO timestamp numbers identified by the profile, including numbers beside T and Z", () => {
    const line = "2026-10-19T12:30:00Z charger vbus=9012";
    const result = generateExtractorPattern({ line, segments: [segment(line, "9012", "vbus", "uint")], timestampPattern: "^\\S+\\s+",
      sampleLines: [line, "2027-11-20T14:35:20Z charger vbus=5000", "2027-11-20T14:35:20Z thermal foldback temp=71"] });
    expect(result).toMatchObject({ matchCount: 2, totalLines: 3, coverage: 2 / 3 });
  });
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

  it("generalizes unselected counters by default and can keep them literal", () => {
    const line = "123 message=thermal hold done";
    const input = { line, segments: [segment(line, "thermal hold", "message", "string")], sampleLines: [] };
    expect(compileParsingPattern(generateExtractorPattern(input).pattern).test("124 message=charge ready done")).toBe(true);
    const literal = compileParsingPattern(generateExtractorPattern({ ...input, generalizeNumbers: false }).pattern);
    expect(literal.test("123 message=charge ready done")).toBe(true);
    expect(literal.test("124 message=charge ready done")).toBe(false);
  });

  it("matches the charger walkthrough with or without a timestamp and excludes trailing empty lines", () => {
    const line = "[  101.600000] charger: vbus=9012 ibus=1450 temp=71";
    const sampleLines = ["thermal foldback: temp=71", line, "charger: vbus=9012 ibus=800 temp=71", ""];
    const input = { line, segments: [segment(line, "9012", "vbus", "uint"), segment(line, "1450", "ibus", "uint"), segment(line, "71", "temp", "uint")], sampleLines };
    for (const timestampPattern of [undefined, "^\\[\\s*(\\d+\\.\\d+)\\]"]) {
      const result = generateExtractorPattern({ ...input, timestampPattern });
      expect(result).toMatchObject({ matchCount: 2, totalLines: 3, coverage: 2 / 3,
        matchedLines: [{ line: 2, text: line }, { line: 3, text: sampleLines[2] }] });
      expect(compileParsingPattern(result.pattern).test("[  102.900000] charger: vbus=5000 ibus=900 temp=55")).toBe(true);
      expect(compileParsingPattern(result.pattern).test("prefix charger: vbus=5000 ibus=900 temp=55")).toBe(false);
    }
    expect(generateExtractorPattern({ ...input, generalizeNumbers: false })).toMatchObject({ matchCount: 1, totalLines: 3, coverage: 1 / 3 });
  });

  it("prefers the profile timestamp region and preserves interior empty row numbers", () => {
    const line = "clock=101.600 charger: value=12";
    const result = generateExtractorPattern({ line, timestampPattern: "^clock=\\d+\\.\\d+", segments: [segment(line, "12", "value", "uint")],
      sampleLines: ["", "clock=102.700 charger: value=13", "charger: value=14", "", ""] });
    expect(result).toMatchObject({ matchCount: 2, totalLines: 3, coverage: 2 / 3, matchedLines: [
      { line: 2, text: "clock=102.700 charger: value=13" }, { line: 3, text: "charger: value=14" }
    ] });
    expect(() => generateExtractorPattern({ line, timestampPattern: "(?=clock)", segments: [segment(line, "12", "value", "uint")], sampleLines: [] })).toThrow();
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
