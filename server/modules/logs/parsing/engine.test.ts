import { describe, expect, it } from "vitest";
import { decodeLogFiles, MAX_DECODE_EVENTS } from "./engine";
import { decodedEventSchema, parsingSpecSchema, MAX_PARSING_LINE_CHARS, MAX_PARSING_MATCH_CHARS, type FieldSpec, type ParsingSpec } from "./spec";

const specFor = (field: FieldSpec): ParsingSpec => parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [
  { id: "value", pattern: "^(?P<value>.*)$", fields: { value: field } }
] });
const run = (field: FieldSpec, raw: string) => decodeLogFiles(specFor(field), [{ file: "a.log", lines: [raw] }]);

describe("parsing/v1 engine interface", () => {
  it("rejects costly counted repetitions and oversized patterns before compilation", () => {
    const base = specFor({ type: "string" });
    for (const pattern of ["(?P<value>(?:a|b)*a(?:a|b){1000})$", "(?P<value>a{1,101})", `(?P<value>${"a".repeat(513)})`]) {
      const result = parsingSpecSchema.safeParse({ ...base, extractors: [{ ...base.extractors[0], pattern }] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toMatch(/100|512/);
    }
  });
  it("accepts the repetition/length boundaries and literal braces, and bounds multiline control patterns", () => {
    const base = specFor({ type: "string" });
    const prefix = "(?P<value>";
    for (const pattern of ["(?P<value>a{100})", "(?P<value>a{1,100})", "(?P<value>a{100,})", "(?P<value>\\{1000\\})", "(?P<value>[{}01]+)",
      "(?P<value>\\Q{1000}\\E)", `${prefix}${"a".repeat(512 - prefix.length - 1)})`]) {
      expect(parsingSpecSchema.safeParse({ ...base, extractors: [{ ...base.extractors[0], pattern }] }).success).toBe(true);
    }
    for (const name of ["start", "continue", "end"] as const) {
      const result = parsingSpecSchema.safeParse({ ...base, extractors: [{ ...base.extractors[0], multiline: { start: "START", [name]: "a{101}", maxLines: 3 } }] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["extractors", 0, "multiline", name], message: expect.stringContaining("100") })]));
    }
  });
  it.each<[string, string, number | boolean]>([
    ["int", "-42", -42], ["int", "-0x2a", -42], ["int", "+0b101", 5],
    ["uint", "42", 42], ["uint", "0xFF", 255], ["uint", "0b110", 6],
    ["float", "-1.25e2", -125], ["float", ".5", 0.5],
    ...["true", "1", "yes", "on", "TRUE", "Yes"].map((raw): [string, string, boolean] => ["bool", raw, true]),
    ...["false", "0", "no", "off", "FALSE", "Off"].map((raw): [string, string, boolean] => ["bool", raw, false])
  ])("decodes %s %s", (type, raw, value) => {
    const decoded = run({ type } as FieldSpec, String(raw));
    expect(decoded.events[0].fields.value).toEqual({ raw, value });
    expect(decoded.counts.errors).toEqual({});
    expect(decodedEventSchema.safeParse(decoded.events[0]).success).toBe(true);
  });
  it("preserves strings and raw enum values, and normalizes bytes", () => {
    expect(run({ type: "string" }, "hello").events[0].fields.value).toBe("hello");
    expect(run({ type: "enum", values: { "2": "thermal" } }, "2").events[0].fields.value).toEqual({ raw: "2", value: "thermal" });
    expect(run({ type: "hexbytes" }, "00 FF 0a").events[0].fields.value).toEqual({ raw: "00 FF 0a", value: { hex: "00ff0a", length: 3 } });
    expect(run({ type: "base64bytes" }, "AP8K").events[0].fields.value).toEqual({ raw: "AP8K", value: { hex: "00ff0a", length: 3 } });
    expect(run({ type: "base64bytes" }, "Zg==").events[0].fields.value).toEqual({ raw: "Zg==", value: { hex: "66", length: 1 } });
  });
  it.each([
    ["%Y-%m-%d %H:%M:%S.%f%z", "2024-02-29 23:59:58.123456+02:30", "2024-02-29T21:29:58.123Z"],
    ["%Y-%m-%dT%H:%M:%S%z", "2026-10-19T01:02:03Z", "2026-10-19T01:02:03.000Z"],
    ["%H:%M:%S %%", "01:02:03 %", "1970-01-01T01:02:03.000Z"],
    ["%Y-%m-%d %H:%M:%S%z", "2026-10-19 00:00:00-0130", "2026-10-19T01:30:00.000Z"],
    ["%Y-%m-%d", "0099-01-01", "0099-01-01T00:00:00.000Z"]
  ])("decodes timestamp %s", (format, raw, value) => {
    expect(run({ type: "timestamp", format }, raw).events[0].fields.value).toEqual({ raw, value });
  });
  it.each([
    [{ type: "uint" }, "-1"], [{ type: "int" }, "9007199254740992"], [{ type: "int" }, "12abc"],
    [{ type: "float" }, "Infinity"], [{ type: "bool" }, "maybe"], [{ type: "enum", values: {} }, "unknown"],
    [{ type: "hexbytes" }, "a"], [{ type: "base64bytes" }, "Zh=="], [{ type: "base64bytes" }, "?"],
    [{ type: "timestamp", format: "%Y-%m-%d" }, "2023-02-29"],
    [{ type: "timestamp", format: "%H:%M:%S%z" }, "24:00:00+2500"]
  ])("records conversion errors without failing for %j %s", (field, raw) => {
    expect(run(field as FieldSpec, raw)).toMatchObject({ counts: { total: 1, errors: { invalid_field: 1 } },
      events: [{ fields: {}, errors: [{ field: "value", code: "invalid_field" }] }] });
  });
  it("matches file globs and defaults to every analyzed file", () => {
    const spec = specFor({ type: "int" });
    spec.extractors[0].files = ["kernel?.log", "device/**/trace*.log"];
    const files = ["kernel1.log", "kernel12.log", "device/a/b/trace.log", "other.log"].map((file) => ({ file, lines: ["1"] }));
    expect(decodeLogFiles(spec, files).events.map((e) => e.file)).toEqual(["kernel1.log", "device/a/b/trace.log"]);
    delete spec.extractors[0].files;
    expect(decodeLogFiles(spec, files).counts.total).toBe(4);
    spec.extractors[0].files = ["**/*.log"];
    expect(decodeLogFiles(spec, files).counts.total).toBe(4);
  });
  it("names the extractor and field for group mismatches and rejects unimplemented keys and backreferences", () => {
    const spec = specFor({ type: "string" });
    spec.extractors[0].pattern = "(?P<other>.*)";
    const parsed = parsingSpecSchema.safeParse(spec);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["extractors", 0, "fields", "other"], message: expect.stringContaining("value") }),
      expect.objectContaining({ path: ["extractors", 0, "fields", "value"], message: expect.stringContaining("value") })
    ]));
    for (const pattern of ["(?P<value>a)\\1", "(?P<value>a)(b)"]) expect(parsingSpecSchema.safeParse({ ...spec, extractors: [{ ...spec.extractors[0], pattern }] }).success).toBe(false);
    expect(parsingSpecSchema.safeParse({ ...specFor({ type: "string" }), frames: {} }).success).toBe(false);
    expect(parsingSpecSchema.safeParse({ ...spec, extractors: [{ ...specFor({ type: "string" }).extractors[0], extra: true }] }).success).toBe(false);
    expect(parsingSpecSchema.safeParse({ schemaVersion: "parsing/v1", extractors: [{ ...specFor({ type: "string" }).extractors[0], fields: { value: { type: "string", decode: {} } } }] }).success).toBe(false);
    for (const format of ["%Q", "%Y%Y", "%", "%%%Q"]) expect(parsingSpecSchema.safeParse(specForTimestamp(format)).success).toBe(false);
    expect(parsingSpecSchema.safeParse({ ...spec, extractors: [{ ...specFor({ type: "string" }).extractors[0], files: ["?".repeat(1024)] }] }).success).toBe(false);
  });
  it("assembles interleaved keys, anchoring the start and end in the correct file", () => {
    const spec = multiline();
    const result = decodeLogFiles(spec, [{ file: "a.log", lines: ["START a", "START b", "DATA a 42", "DATA b 7", "END b", "END a"] }]);
    expect(result.events).toMatchObject([
      { file: "a.log", line: 2, endLine: 5, fields: { key: "b", value: { raw: "7", value: 7 } } },
      { file: "a.log", line: 1, endLine: 6, fields: { key: "a", value: { raw: "42", value: 42 } } }
    ]);
    expect(result.unmatchedLineCount).toBe(0);
    expect(parsingSpecSchema.safeParse({ ...spec, extractors: [{ ...spec.extractors[0], multiline: { ...spec.extractors[0].multiline, maxLines: 201 } }] }).success).toBe(false);
    expect(parsingSpecSchema.safeParse({ ...spec, extractors: [{ ...spec.extractors[0], multiline: { ...spec.extractors[0].multiline, end: "END" } }] }).success).toBe(false);
  });
  it("flushes unkeyed groups at EOF or a new start, reports maxLines, and skips oversized UTF-8 lines", () => {
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "block", pattern: "(?P<value>.*)", fields: { value: { type: "string" } },
      multiline: { start: "^START", maxLines: 3 } }] });
    const result = decodeLogFiles(spec, [{ file: "a.log", lines: ["START", "one", "two", "START", "end", "START", "new", "START", "last"] }]);
    expect(result.events.map(({ line, endLine }) => [line, endLine])).toEqual([[1, 3], [4, 5], [6, 7], [8, 9]]);
    expect(result.counts.errors).toEqual({ max_lines: 1 });
    expect(run({ type: "string" }, "界".repeat(3000))).toMatchObject({ events: [], counts: { errors: { line_cap: 1 } }, unmatchedLineCount: 1 });
    expect(run({ type: "string" }, "a".repeat(MAX_PARSING_LINE_CHARS)).counts.total).toBe(1);
    expect(run({ type: "string" }, "a".repeat(MAX_PARSING_LINE_CHARS + 1))).toMatchObject({ events: [], counts: { errors: { match_input_cap: 1 } } });
    spec.extractors[0].multiline = { start: "^START", end: "^END", maxLines: 3 };
    expect(decodeLogFiles(spec, [{ file: "a.log", lines: ["START", "body", "END"] }]).events[0])
      .toMatchObject({ line: 1, endLine: 3, fields: { value: "START\nbody\nEND" } });
  });
  it("caps assembled match input without extracting fields from a truncated prefix", () => {
    const spec = specFor({ type: "string" });
    spec.extractors[0].multiline = { start: "^START", maxLines: 200 };
    const result = decodeLogFiles(spec, [{ file: "a.log", lines: ["START", ...Array(4).fill("a".repeat(MAX_PARSING_MATCH_CHARS / 4))] }]);
    expect(result.events).toMatchObject([{ fields: {}, errors: [{ code: "match_input_cap" }] }]);
    expect(result.counts.errors).toEqual({ match_input_cap: 1 });
  });
  it("records both bytes caps, allowing exactly 4096 decoded bytes", () => {
    expect(run({ type: "base64bytes" }, Buffer.alloc(4097).toString("base64")).events[0].errors).toMatchObject([{ code: "byte_cap", field: "value" }]);
    expect(run({ type: "base64bytes" }, Buffer.alloc(4096).toString("base64")).counts.errors).toEqual({});
    const spec = specFor({ type: "hexbytes" });
    spec.extractors[0].multiline = { start: "^aa", end: "bb$", maxLines: 3 };
    expect(decodeLogFiles(spec, [{ file: "a.log", lines: ["aa".repeat(3000), "bb".repeat(1097)] }]).counts.errors).toEqual({ byte_cap: 1 });
  });
  it("caps events across files, preserving the completed run result", () => {
    expect(MAX_DECODE_EVENTS).toBe(50_000);
    const result = decodeLogFiles(specFor({ type: "string" }), [{ file: "a.log", lines: Array(3).fill("a") }, { file: "b.log", lines: ["b"] }], 3);
    expect(result.events).toHaveLength(3);
    expect(result.counts).toEqual({ total: 3, byExtractor: { value: 3 }, errors: { event_cap: 1 } });
  }, 30_000);
});

function specForTimestamp(format: string) {
  return { schemaVersion: "parsing/v1", extractors: [{ id: "time", pattern: "(?P<value>.*)", fields: { value: { type: "timestamp", format } } }] };
}
function multiline(): ParsingSpec {
  return parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "message",
    pattern: "^START (?P<key>\\w+)\\nDATA \\w+ (?P<value>\\d+)\\nEND \\w+$", fields: { key: { type: "string" }, value: { type: "uint" } },
    multiline: { start: "^START (?P<key>\\w+)$", continue: "^DATA (?P<key>\\w+) \\d+$", end: "^END (?P<key>\\w+)$", keyField: "key", maxLines: 3 } }] });
}
