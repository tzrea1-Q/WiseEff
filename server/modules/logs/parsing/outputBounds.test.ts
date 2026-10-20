import { describe, expect, it } from "vitest";
import { decodeLogFiles, decodeLogFilesSteps, MAX_DECODE_EVENT_BYTES, MAX_DECODE_OUTPUT_BYTES, MAX_DECODE_OUTPUT_FIELDS } from "./engine";
import { decodedEventSchema, MAX_REGISTERS, MAX_REGISTER_FIELDS, MAX_REGISTER_ENUM_VALUES, MAX_REGISTER_ENUM_LABEL_CHARS,
  MAX_REGISTER_DECODE_CAPTURES, parsePreviewResponseSchema, parsingSpecSchema, type DecodedValue, type ParsingSpec } from "./spec";
import { decodeLogFilesCooperatively } from "./workerDecoding";

function expandedSpec(label?: string, worstCase = false): ParsingSpec {
  const fields = Object.fromEntries(Array.from({ length: MAX_REGISTER_DECODE_CAPTURES }, (_, i) => [`v${i}`, { type: "uint", decode: { register: "wide0" } }]));
  const register = { width: 64, fields: Array.from({ length: MAX_REGISTER_FIELDS }, (_, bit) => ({
    bits: [bit, bit], name: worstCase ? `B${"X".repeat(96)}${String(bit).padStart(3, "0")}` : `b${bit}`,
    ...(label ? { enum: Object.fromEntries(Array.from({ length: worstCase ? MAX_REGISTER_ENUM_VALUES : 2 }, (_, n) => [String(n), label])) } : {}),
    ...(worstCase ? { unit: "\u0001".repeat(100), description: "d".repeat(4096) } : {})
  })) };
  return parsingSpecSchema.parse({ schemaVersion: "parsing/v1", registers: Object.fromEntries(Array.from({ length: worstCase ? MAX_REGISTERS : 1 }, (_, i) => [`wide${i}`, register])),
    extractors: [{ id: "expanded", pattern: Object.keys(fields).map((name) => `(?P<${name}>1)`).join(" "), fields }] });
}
const line = Array(MAX_REGISTER_DECODE_CAPTURES).fill("1").join(" ");
const files = [{ file: "a.log", lines: Array(500).fill(line) }, { file: "b.log", lines: Array(500).fill(line) }];
const fieldCount = (fields: Record<string, DecodedValue>): number => Object.values(fields).reduce<number>((sum, node) => sum + 1
  + (node && typeof node === "object" && "fields" in node && node.fields ? fieldCount(node.fields) : 0), 0);
const jsonlBytes = (events: unknown[]) => events.reduce<number>((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)) + 1, 0);

describe("bounded register output", () => {
  it("caps enum labels/counts, register count and register fields at stable paths", () => {
    const base = expandedSpec();
    const variants: Array<[unknown, (string | number)[]]> = [
      [{ ...base, registers: { wide0: { width: 64, fields: [{ bits: [0, 0], name: "B", enum: { "0": "x".repeat(MAX_REGISTER_ENUM_LABEL_CHARS + 1) } }] } } }, ["registers", "wide0", "fields", 0, "enum", "0"]],
      [{ ...base, registers: { wide0: { width: 64, fields: [{ bits: [0, 0], name: "B", enum: Object.fromEntries(Array.from({ length: MAX_REGISTER_ENUM_VALUES + 1 }, (_, n) => [n, "x"])) }] } } }, ["registers", "wide0", "fields", 0, "enum"]],
      [{ ...base, registers: Object.fromEntries(Array.from({ length: MAX_REGISTERS + 1 }, (_, i) => [`wide${i}`, base.registers!.wide0])) }, ["registers"]],
      [{ ...base, registers: { wide0: { ...base.registers!.wide0, fields: [...base.registers!.wide0.fields, { bits: [0, 0], name: "extra" }] } } }, ["registers", "wide0", "fields"]]
    ];
    for (const [value, path] of variants) {
      const result = parsingSpecSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path);
    }
  });
  it("trims oversized events with an event_size diagnostic, retaining complete meanings and subsequent events", () => {
    const spec = expandedSpec("\u0000".repeat(MAX_REGISTER_ENUM_LABEL_CHARS), true);
    const result = decodeLogFiles(spec, [{ file: "a.log", lines: [line, line] }]);
    expect(result.events).toHaveLength(2);
    expect(result.counts.errors).toEqual({ event_size: 2 });
    expect(result.truncated).toBeUndefined();
    for (const event of result.events) {
      expect(Buffer.byteLength(JSON.stringify(event)) + 1).toBeLessThanOrEqual(MAX_DECODE_EVENT_BYTES);
      expect(event.errors?.filter(({ code }) => code === "event_size")).toHaveLength(1);
      expect(fieldCount(event.fields)).toBeLessThan(MAX_REGISTER_DECODE_CAPTURES * 65);
      expect(JSON.stringify(event)).toContain('"meaning":"' + "\\u0000".repeat(MAX_REGISTER_ENUM_LABEL_CHARS));
      expect(decodedEventSchema.safeParse(event).success).toBe(true);
    }
  });
  it("shares the field budget across captures and files and closes streaming readers on exhaustion", async () => {
    const spec = expandedSpec();
    let closed = 0;
    const streamed = files.map(({ file, lines }) => ({ file, reader: { lineCount: lines.length, async* lines() {
      try { for (const [i, content] of lines.entries()) yield { lineNumber: i + 1, content }; }
      finally { closed++; }
    } } }));
    const result = await decodeLogFilesCooperatively(spec, streamed);
    expect(result).toMatchObject({ truncated: true, reason: "output_field_cap", counts: { truncated: true, reason: "output_field_cap", errors: { output_field_cap: 1 } } });
    expect(result.events.reduce((sum, event) => sum + fieldCount(event.fields), 0)).toBeLessThanOrEqual(MAX_DECODE_OUTPUT_FIELDS);
    expect(result.events).toHaveLength(Math.floor(MAX_DECODE_OUTPUT_FIELDS / (MAX_REGISTER_DECODE_CAPTURES * 65)));
    expect(result.unmatchedLineCount).toBe(1000 - result.events.length);
    expect(jsonlBytes(result.events)).toBeLessThanOrEqual(MAX_DECODE_OUTPUT_BYTES);
    expect(closed).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("readLine");
    expect(parsePreviewResponseSchema.safeParse({ valid: true, issues: [], ...result }).success).toBe(true);
  });
  it("keeps worst-case allowed expansion within a measured 32 MiB heap-growth bound", () => {
    const spec = expandedSpec("\u0000".repeat(MAX_REGISTER_ENUM_LABEL_CHARS), true);
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline, ticks = 0;
    const steps = decodeLogFilesSteps(spec, files);
    let step = steps.next();
    while (!step.done) {
      if (++ticks % 64 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
      step = steps.next();
    }
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    const result = step.value, bytes = jsonlBytes(result.events), fields = result.events.reduce((sum, event) => sum + fieldCount(event.fields), 0);
    console.info("register output heap probe", { events: result.events.length, bytes, fields, peakHeapGrowthBytes: peak - baseline });
    expect(result).toMatchObject({ truncated: true, reason: "output_byte_cap", counts: { truncated: true, reason: "output_byte_cap" } });
    expect(bytes).toBeLessThanOrEqual(MAX_DECODE_OUTPUT_BYTES);
    expect(fields).toBeLessThanOrEqual(MAX_DECODE_OUTPUT_FIELDS);
    expect(result.events.every((event) => Buffer.byteLength(JSON.stringify(event)) + 1 <= MAX_DECODE_EVENT_BYTES)).toBe(true);
    expect(peak - baseline).toBeLessThan(32 * 1024 * 1024);
  });
});
