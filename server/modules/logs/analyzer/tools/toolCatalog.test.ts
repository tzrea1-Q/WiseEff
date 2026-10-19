import { describe, expect, it } from "vitest";

import { MAX_LOG_PATTERN_INPUT_LENGTH } from "../../adminPattern";
import { parseLogText } from "../../parser";
import { runLogPrefilter } from "../../prefilter";
import { availableLogAnalysisTools, executeLogAnalysisTool, MAX_SIGNAL_TOOL_BYTES } from "./toolCatalog";
import { parsingSpecSchema } from "../../parsing/spec";
import { decodeLogFiles } from "../../parsing/engine";
import type { LogAnalysisToolContext } from "./toolContext";
import { createLogFileReader } from "../../fileReader";
import { createMemoryObjectStore } from "../../../../testing/objectStore";

function buildContext(overrides: Partial<LogAnalysisToolContext> = {}): LogAnalysisToolContext {
  const content = [
    "2026-08-10T08:00:01Z INFO charge session started requested_ma=6000",
    "2026-08-10T08:00:02Z INFO battery_temp=38C pack ok",
    "2026-08-10T08:00:03Z WARN thermal foldback engaged battery_temp=52C",
    "2026-08-10T08:00:04Z ERROR charge current reduced code=E_THERMAL_FOLDBACK requested_ma=6000 charge_current_ma=2000",
    "2026-08-10T08:00:05Z INFO charge continuing at reduced rate",
    "2026-08-10T08:00:06Z INFO session heartbeat ok"
  ].join("\n");
  const parsed = parseLogText({ fileName: "charging.log", content });
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return {
    parsed,
    prefilter: runLogPrefilter(parsed.entries),
    ...overrides
  };
}

describe("executeLogAnalysisTool dispatch", () => {
  it("locates source statements from indexed anchors beyond the parsed preview", async () => {
    const context = buildContext({ sourceSnapshot: { id: "snapshot", status: "ready" },
      locateLogStatement: async (line) => {
        expect(line).toBe("WARN thermal foldback at EOF");
        return { items: [], truncated: false };
      } });
    const store = createMemoryObjectStore();
    const content = [...Array.from({ length: 400 }, () => "INFO healthy"), "WARN thermal foldback at EOF"].join("\r\n");
    const object = await store.put({ organizationId: "org", fileName: "tail.log", contentType: "text/plain", bytes: Buffer.from(content) });
    const file = { path: "tail.log", sizeBytes: content.length, encoding: "utf-8" as const, lossy: false, lineCount: 401,
      status: "analyzed" as const, skipReason: null, objectKey: object.storageKey };
    context.files = [{ ...file, parsed: context.parsed, reader: createLogFileReader(store, file) }];
    expect(await executeLogAnalysisTool("locate_log_statement", { file: file.path, anchorLine: 401 }, context))
      .toMatchObject({ ok: true, result: { items: [] } });
    expect(await executeLogAnalysisTool("locate_log_statement", { file: file.path, anchorLine: 402 }, context)).toMatchObject({ ok: false });
  });

  it("offers source location only for ready snapshots, resolves log anchors and caps returned citations", async () => {
    let observed = "";
    const context = buildContext({ filePath: "charging.log", sourceSnapshot: { id: "snapshot", status: "ready" },
      locateLogStatement: async (line) => {
        observed = line;
        return { items: Array.from({ length: 20 }, (_, index) => ({ snapshotId: "snapshot", path: "thermal.c", line: index + 1,
          startLine: 1, versionLabel: "v1", excerpt: "界".repeat(2000), confidence: 0.9 })), truncated: false };
      } });
    expect(availableLogAnalysisTools(context)).toContain("locate_log_statement");
    const result = await executeLogAnalysisTool("locate_log_statement", { file: "charging.log", anchorLine: 3 }, context);
    expect(observed).toContain("thermal foldback");
    expect(result).toMatchObject({ ok: true, result: { truncated: true } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(16 * 1024);
    expect(await executeLogAnalysisTool("locate_log_statement", { file: "missing.log", anchorLine: 3 }, context)).toMatchObject({ ok: false });
    expect(await executeLogAnalysisTool("locate_log_statement", { line: "x".repeat(4001) }, context)).toMatchObject({ ok: false });
    for (const status of ["queued", "indexing", "failed", "archived"] as const) {
      context.sourceSnapshot = { id: "snapshot", status };
      expect(availableLogAnalysisTools(context)).not.toContain("locate_log_statement");
      expect(await executeLogAnalysisTool("locate_log_statement", { line: "thermal foldback" }, context)).toMatchObject({ ok: false });
    }
  });

  it("always exposes signal tools, filters signals, pages templates and caps serialized output", async () => {
    const context = buildContext({ filePath: "charging.log" });
    expect(availableLogAnalysisTools(context)).toEqual(expect.arrayContaining(["get_signals", "get_line_templates", "get_timeline"]));
    expect(await executeLogAnalysisTool("get_signals", { kind: "first-error", severity: "Warning", limit: 1 }, context))
      .toMatchObject({ ok: true, result: { total: 1, signals: [{ kind: "first-error", anchors: [{ file: "charging.log", line: 4 }] }] } });
    const templates = await executeLogAnalysisTool("get_line_templates", { limit: 1 }, context);
    expect(templates).toMatchObject({ ok: true, result: { nextOffset: 1, templates: [{ first: { file: "charging.log" }, last: { file: "charging.log" } }] } });
    expect(await executeLogAnalysisTool("get_line_templates", { offset: 1, limit: 1 }, context)).toMatchObject({ ok: true, result: { nextOffset: 2 } });
    expect(await executeLogAnalysisTool("get_signals", { severity: "Critical" }, context)).toMatchObject({ ok: true, result: { signals: [], total: 0 } });
    const anchor = { file: "界".repeat(200), line: 1, content: "界".repeat(400) };
    context.signalSummary = { signals: Array.from({ length: 20 }, () => ({ kind: "crash", severity: "Critical", source: "generic", title: "界".repeat(400), count: 10,
      anchors: Array.from({ length: 5 }, () => anchor) })), templates: [], truncatedSignals: false, truncatedTemplates: false };
    const bounded = await executeLogAnalysisTool("get_signals", { limit: 20 }, context);
    expect(bounded).toMatchObject({ ok: true, result: { truncated: true, nextOffset: 1 } });
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(MAX_SIGNAL_TOOL_BYTES);
    for (const [tool, args] of [["get_signals", { limit: 21 }], ["get_signals", { severity: "error" }], ["get_line_templates", { offset: -1 }],
      ["get_timeline", {}], ["get_timeline", { time: "invalid" }], ["get_timeline", { file: "charging.log" }],
      ["get_timeline", { time: "2026-10-19T00:00:00Z", file: "charging.log", line: 1 }],
      ["get_timeline", { file: "charging.log", line: 1, before: 21 }]] as const) {
      expect(await executeLogAnalysisTool(tool, args, context)).toMatchObject({ ok: false });
    }
  });

  it("returns a bounded cross-file timestamp order around an exact anchor or time", async () => {
    const context = buildContext({ filePath: "charging.log" });
    context.files = ["a.log", "b.log"].map((path, i) => {
      const parsed = parseLogText({ fileName: path, content: ["INFO no timestamp",
        `2026-10-19T00:00:0${2 + i}Z INFO late`, `2026-10-19T00:00:0${i}Z INFO early`].join("\n") });
      if (!parsed.ok) throw new Error("Fixture must parse");
      return { path, parsed, sizeBytes: 100, lineCount: 3, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null };
    });
    expect(await executeLogAnalysisTool("get_timeline", { file: "a.log", line: 2, before: 1, after: 1 }, context))
      .toMatchObject({ ok: true, result: { truncated: true, lines: [{ file: "b.log", line: 3 }, { file: "a.log", line: 2 }, { file: "b.log", line: 2 }] } });
    expect(await executeLogAnalysisTool("get_timeline", { time: "2026-10-19T00:00:01Z", before: 0, after: 0 }, context))
      .toMatchObject({ ok: true, result: { lines: [{ file: "b.log", line: 3 }] } });
    expect(await executeLogAnalysisTool("get_timeline", { file: "a.log", line: 1 }, context)).toMatchObject({ ok: false });
    expect(await executeLogAnalysisTool("get_timeline", { file: "missing.log", line: 1 }, context)).toMatchObject({ ok: false });
    const parsed = parseLogText({ fileName: "big.log", content: Array.from({ length: 100 }, (_, i) => `2026-10-19T00:00:${String(i % 60).padStart(2, "0")}Z INFO ${"界".repeat(400)}`).join("\n") });
    if (!parsed.ok) throw new Error("Fixture must parse");
    context.files = [{ ...context.files[0], path: "big.log", parsed }];
    const bounded = await executeLogAnalysisTool("get_timeline", { file: "big.log", line: 25, before: 20, after: 20 }, context);
    expect(bounded.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(MAX_SIGNAL_TOOL_BYTES);
    if (bounded.ok) expect((bounded.result as { lines: Array<{ line: number }> }).lines.some((line) => line.line === 25)).toBe(true);
    const tied = parseLogText({ fileName: "big.log", content: Array.from({ length: 40 }, () => `2026-10-19T00:00:00Z INFO ${"界".repeat(400)}`).join("\n") });
    if (!tied.ok) throw new Error("Fixture must parse");
    context.files[0].parsed = tied;
    const tiedWindow = await executeLogAnalysisTool("get_timeline", { file: "big.log", line: 40, before: 20, after: 0 }, context);
    expect(tiedWindow.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(tiedWindow))).toBeLessThanOrEqual(MAX_SIGNAL_TOOL_BYTES);
    if (tiedWindow.ok) expect((tiedWindow.result as { lines: Array<{ line: number }> }).lines.some((line) => line.line === 40)).toBe(true);
  });
  it("bounds serialized decoded output and fields without mutating stored events, preserving pagination", async () => {
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "large", pattern: "(?P<v>.*)", fields: { v: { type: "string" } } }] });
    const events = Array.from({ length: 50 }, (_, i) => ({ v: 1 as const, source: "declarative" as const, extractor: "large", file: "a.log", line: i + 1,
      fields: { v: { raw: "界".repeat(8000), value: "界".repeat(8000) } } }));
    const context = buildContext({ decoding: { spec, events, counts: { total: 50, byExtractor: { large: 50 }, errors: {} } } });
    const outcome = await executeLogAnalysisTool("query_events", { extractor: "large" }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect((outcome.result as { truncated: boolean }).truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(outcome))).toBeLessThanOrEqual(16 * 1024);
    if (outcome.ok) {
      const result = outcome.result as { events: typeof events; nextCursor: string };
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.nextCursor).toBe(String(result.events.length));
      expect(Buffer.byteLength(JSON.stringify(result.events[0].fields.v))).toBeLessThanOrEqual(1024);
      expect(events[0].fields.v.raw).toHaveLength(8000);
      const next = await executeLogAnalysisTool("query_events", { extractor: "large", cursor: result.nextCursor,
        where: [{ field: "v", op: "eq", value: events[0].fields.v.value }], limit: 1 }, context);
      expect(next.ok).toBe(true);
      if (next.ok) expect((next.result as { events: typeof events }).events[0].line).toBe(result.events.length + 1);
    }
    const invalid = await executeLogAnalysisTool("query_events", { extractor: "large", ["x".repeat(20_000)]: true }, context);
    expect(invalid.ok).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(invalid))).toBeLessThanOrEqual(16 * 1024);
  });
  it("returns nested register fields and meanings within existing output caps", async () => {
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "register", pattern: "(?P<val>0x[0-9A-Fa-f]+)",
      fields: { val: { type: "hex", decode: { register: "fault" } } } }],
    registers: { fault: { width: 8, fields: [{ bits: [5, 4], name: "CHRG_FAULT", enum: { "2": "thermal_shutdown" } }] } } });
    const context = buildContext({ decoding: { spec, ...decodeLogFiles(spec, [{ file: "a.log", lines: ["0x20"] }]) } });
    expect(await executeLogAnalysisTool("query_events", { extractor: "register" }, context)).toMatchObject({ ok: true, result: {
      events: [{ fields: { val: { raw: "0x20", value: 32, fields: { CHRG_FAULT: { value: 2, meaning: "thermal_shutdown" } } } } }], truncated: false
    } });
    const nested = { raw: "0x20", value: 32, fields: { CHRG_FAULT: { raw: "2", value: 2, meaning: "界".repeat(2000) } } };
    const events = Array.from({ length: 50 }, (_, i) => ({ v: 1 as const, source: "declarative" as const, extractor: "register", file: "a.log", line: i + 1, fields: { val: nested } }));
    context.decoding = { spec, events, counts: { total: events.length, byExtractor: { register: events.length }, errors: {} } };
    const outcome = await executeLogAnalysisTool("query_events", { extractor: "register" }, context);
    expect(outcome).toMatchObject({ ok: true, result: { truncated: true } });
    expect(Buffer.byteLength(JSON.stringify(outcome))).toBeLessThanOrEqual(16 * 1024);
    if (outcome.ok) {
      const result = outcome.result as { events: Array<{ fields: { val: unknown } }>; nextCursor: string };
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.nextCursor).toBe(String(result.events.length));
      expect(Buffer.byteLength(JSON.stringify(result.events[0].fields.val))).toBeLessThanOrEqual(1024);
    }
    expect(nested.fields.CHRG_FAULT.meaning).toHaveLength(2000);
  });
  it("composes decoded tools per revision, describes counts, and queries typed values with bounded pagination", async () => {
    const context = buildContext();
    expect(await executeLogAnalysisTool("query_events", { extractor: "value" }, context)).toMatchObject({ ok: false });
    expect(await executeLogAnalysisTool("describe_event_schema", {}, context)).toMatchObject({ ok: false });
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "value", pattern: "(?P<n>\\d+)", fields: { n: { type: "uint" } } }] });
    context.decoding = { spec, ...decodeLogFiles(spec, [{ file: "a.log", lines: Array.from({ length: 55 }, (_, i) => String(i)) }, { file: "b.log", lines: ["5"] }]) };
    expect(await executeLogAnalysisTool("describe_event_schema", {}, context)).toMatchObject({ ok: true, result: { extractors: [{ id: "value", fields: { n: { type: "uint" } }, count: 56 }] } });
    const first = await executeLogAnalysisTool("query_events", { extractor: "value" }, context);
    expect(first).toMatchObject({ ok: true, result: { nextCursor: "50" } });
    if (first.ok) expect((first.result as { events: unknown[] }).events).toHaveLength(50);
    expect(await executeLogAnalysisTool("query_events", { extractor: "value", cursor: "50" }, context)).toMatchObject({ ok: true, result: { nextCursor: null } });
    for (const [op, expected, values] of [["eq", 5, [5]], ["ne", 5, [0, 1]], ["lt", 2, [0, 1]], ["lte", 1, [0, 1]], ["gt", 52, [53, 54]], ["gte", 53, [53, 54]], ["in", [3, 4], [3, 4]]] as const) {
      const outcome = await executeLogAnalysisTool("query_events", { extractor: "value", file: "a.log", where: [{ field: "n", op, value: expected }], limit: 2 }, context);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect((outcome.result as { events: Array<{ fields: { n: { value: number } } }> }).events.map((e) => e.fields.n.value)).toEqual(values);
    }
    for (const args of [{ extractor: "unknown" }, { extractor: "value", limit: 51 }, { extractor: "value", cursor: "bad" },
      { extractor: "value", where: [{ field: "missing", op: "eq", value: 1 }] }, { extractor: "value", where: [{ field: "n", op: "in", value: 1 }] }]) {
      expect(await executeLogAnalysisTool("query_events", args, context)).toMatchObject({ ok: false });
    }
    const labels = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "labels", pattern: "(?P<state>\\d+) (?P<data>\\w+) (?P<time>.+)", fields: {
      state: { type: "enum", values: { "2": "thermal" } }, data: { type: "hexbytes" }, time: { type: "timestamp", format: "%Y-%m-%d" }
    } }] });
    context.decoding = { spec: labels, ...decodeLogFiles(labels, [{ file: "a.log", lines: ["2 ff 2026-10-19"] }]) };
    for (const condition of [{ field: "state", op: "eq", value: "thermal" }, { field: "data", op: "eq", value: { hex: "ff", length: 1 } }, { field: "time", op: "gt", value: "2026-10-18T00:00:00.000Z" }]) {
      expect(await executeLogAnalysisTool("query_events", { extractor: "labels", where: [condition] }, context)).toMatchObject({ ok: true, result: { events: [{ extractor: "labels" }] } });
    }
  });
  it("lists inventory, filters search by file glob, and requires an explicit range file", async () => {
    const context = buildContext();
    context.files = ["device/a.log", "device/b.log"].map((path) => ({ path, sizeBytes: 100, lineCount: context.parsed.rawLines.length,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null, parsed: context.parsed }));
    context.files.push({ path: "image.bin", sizeBytes: 2, lineCount: 0, encoding: "utf-8", lossy: false, status: "skipped", skipReason: "二进制文件" });
    const inventory = await executeLogAnalysisTool("list_files", {}, context);
    expect(inventory).toMatchObject({ ok: true, result: { total: 3, files: [{ path: "device/a.log" }, { path: "device/b.log" }, { skipReason: "二进制文件" }] } });
    if (inventory.ok) expect(JSON.stringify(inventory.result)).not.toContain("rawLines");
    const filtered = await executeLogAnalysisTool("search_lines", { pattern: "thermal", file: "device/a.*", neighborhood: 0 }, context);
    expect(filtered).toMatchObject({ ok: true, result: { lines: [{ file: "device/a.log", line: 3 }, { file: "device/a.log", line: 4 }] } });
    expect(await executeLogAnalysisTool("read_line_range", { startLine: 1, endLine: 2 }, context)).toMatchObject({ ok: false, error: expect.stringContaining("file is required") });
    expect(await executeLogAnalysisTool("read_line_range", { file: "device/b.log", startLine: 1, endLine: 2 }, context))
      .toMatchObject({ ok: true, result: { lines: [{ file: "device/b.log", line: 1 }, { file: "device/b.log", line: 2 }] } });
    expect(await executeLogAnalysisTool("read_line_range", { file: "image.bin", startLine: 1, endLine: 2 }, context)).toMatchObject({ ok: false });
  });
  it("rejects unknown tool names with the available catalog", async () => {
    const outcome = await executeLogAnalysisTool("write_parameter", {}, buildContext());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('Unknown tool "write_parameter"');
      for (const name of availableLogAnalysisTools(buildContext())) {
        expect(outcome.error).toContain(name);
      }
    }
  });

  it("rejects invalid arguments through the zod schema", async () => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern: "" }, buildContext());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('Invalid arguments for tool "search_log_lines"');
    }
  });
});

describe("search_log_lines", () => {
  it.each(["(?=ERROR)ERROR", "(ERROR)\\1"])("returns a correctable tool error for %s", async (pattern) => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern, isRegex: true }, buildContext());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Invalid regular expression:");
  });

  it("uses case-insensitive regex search and skips over-long raw lines", async () => {
    const context = buildContext();
    context.parsed.rawLines = [`error ${"a".repeat(MAX_LOG_PATTERN_INPUT_LENGTH)}`, "error"];
    const outcome = await executeLogAnalysisTool(
      "search_log_lines", { pattern: "(?<level>ERROR)", isRegex: true, neighborhood: 0 }, context
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result).toMatchObject({ totalMatches: 1, lines: [{ lineNumber: 2 }] });
  });

  it("finds keyword matches case-insensitively with neighborhood context", async () => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern: "THERMAL", neighborhood: 1 }, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as {
        totalMatches: number;
        lines: Array<{ lineNumber: number; isMatch: boolean }>;
      };
      expect(result.totalMatches).toBe(2);
      const matchLines = result.lines.filter((line) => line.isMatch).map((line) => line.lineNumber);
      expect(matchLines).toEqual([3, 4]);
      // Neighborhood pulls in lines 2 and 5 as context.
      expect(result.lines.map((line) => line.lineNumber)).toEqual([2, 3, 4, 5]);
    }
  });

  it("supports regex matching and reports invalid regexes as tool errors", async () => {
    const regexOutcome = await executeLogAnalysisTool(
      "search_log_lines",
      { pattern: "code=E_[A-Z_]+", isRegex: true, neighborhood: 0 },
      buildContext()
    );
    expect(regexOutcome.ok).toBe(true);
    if (regexOutcome.ok) {
      const result = regexOutcome.result as { lines: Array<{ lineNumber: number }> };
      expect(result.lines.map((line) => line.lineNumber)).toEqual([4]);
    }

    const invalidOutcome = await executeLogAnalysisTool(
      "search_log_lines",
      { pattern: "([unclosed", isRegex: true },
      buildContext()
    );
    expect(invalidOutcome.ok).toBe(false);
    if (!invalidOutcome.ok) {
      expect(invalidOutcome.error).toContain("Invalid regular expression");
    }
  });

  it("truncates matches at maxMatches and reports the truncation", async () => {
    const outcome = await executeLogAnalysisTool(
      "search_log_lines",
      { pattern: "2026-08-10", maxMatches: 2, neighborhood: 0 },
      buildContext()
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { totalMatches: number; returnedMatches: number; truncated: boolean };
      expect(result.totalMatches).toBe(6);
      expect(result.returnedMatches).toBe(2);
      expect(result.truncated).toBe(true);
    }
  });

  it("caps maxMatches at the hard limit through the schema", async () => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern: "a", maxMatches: 100 }, buildContext());
    expect(outcome.ok).toBe(false);
  });
});

describe("read_line_range", () => {
  it("reads a clamped range and rejects inverted or out-of-file ranges", async () => {
    const context = buildContext();
    const outcome = await executeLogAnalysisTool("read_line_range", { startLine: 3, endLine: 99 }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { endLine: number; totalLines: number; lines: Array<{ lineNumber: number }> };
      expect(result.endLine).toBe(6);
      expect(result.lines.map((line) => line.lineNumber)).toEqual([3, 4, 5, 6]);
    }

    const inverted = await executeLogAnalysisTool("read_line_range", { startLine: 5, endLine: 3 }, context);
    expect(inverted.ok).toBe(false);

    const beyond = await executeLogAnalysisTool("read_line_range", { startLine: 100, endLine: 120 }, context);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) {
      expect(beyond.error).toContain("beyond the end of the log");
    }
  });

  it("truncates ranges longer than 40 lines and flags it", async () => {
    const content = Array.from({ length: 100 }, (_, index) => `2026-08-10T08:00:01Z INFO line ${index + 1}`).join("\n");
    const parsed = parseLogText({ fileName: "long.log", content });
    if (!parsed.ok) throw new Error("fixture must parse");
    const context = buildContext({ parsed });

    const outcome = await executeLogAnalysisTool("read_line_range", { startLine: 1, endLine: 100 }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { endLine: number; truncated: boolean; lines: unknown[] };
      expect(result.lines).toHaveLength(40);
      expect(result.endLine).toBe(40);
      expect(result.truncated).toBe(true);
    }
  });
});

describe("get_prefilter_findings", () => {
  it("returns the deterministic prefilter signals and rejects stray arguments", async () => {
    const outcome = await executeLogAnalysisTool("get_prefilter_findings", {}, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as {
        ruleHits: string[];
        errorCodeStats: Array<{ code: string }>;
        severityCounts: { error: number };
      };
      expect(result.ruleHits).toContain("thermal-foldback");
      expect(result.errorCodeStats.map((stat) => stat.code)).toContain("E_THERMAL_FOLDBACK");
      expect(result.severityCounts.error).toBe(1);
    }

    const strayArgs = await executeLogAnalysisTool("get_prefilter_findings", { extra: true }, buildContext());
    expect(strayArgs.ok).toBe(false);
  });
});

describe("read_domain_knowledge", () => {
  it("states unavailability honestly when no retrieval backend is bound", async () => {
    const outcome = await executeLogAnalysisTool("read_domain_knowledge", { query: "thermal foldback" }, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ available: false, items: [] });
    }
  });

  it("passes the query to the bound backend, truncates excerpts, and labels the generic fallback scope", async () => {
    const longExcerpt = "knowledge ".repeat(100);
    const queries: string[] = [];
    const context = buildContext({
      searchDomainKnowledge: async (query) => {
        queries.push(query);
        return {
          scope: "organization-generic",
          retrievalMode: "fts_only",
          items: Array.from({ length: 8 }, (_, index) => ({
            entryId: `entry-${index}`,
            title: `Entry ${index}`,
            contentForm: "markdown" as const,
            tags: [],
            excerpt: longExcerpt,
            updatedAt: "2026-08-13T00:00:00.000Z",
            revisionId: null
          }))
        };
      }
    });

    const outcome = await executeLogAnalysisTool("read_domain_knowledge", { query: "E_THERMAL_FOLDBACK meaning" }, context);
    expect(queries).toEqual(["E_THERMAL_FOLDBACK meaning"]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as {
        scope: string;
        scopeNote: string;
        items: Array<{ excerpt: string }>;
      };
      expect(result.scope).toBe("organization-generic");
      expect(result.scopeNote).toContain("organization-wide generic retrieval");
      expect(result.items).toHaveLength(5);
      expect(result.items[0].excerpt.length).toBeLessThanOrEqual(401);
    }
  });

  it("labels domain-linked scope when the backend restricted retrieval", async () => {
    const context = buildContext({
      searchDomainKnowledge: async () => ({
        scope: "domain-linked",
        retrievalMode: "semantic_fts",
        items: [
          {
            entryId: "entry-1",
            title: "E_THERMAL_FOLDBACK handbook",
            contentForm: "markdown" as const,
            tags: ["charging"],
            excerpt: "Thermal foldback error code meanings.",
            updatedAt: "2026-08-13T00:00:00.000Z",
            revisionId: "rev-1"
          }
        ]
      })
    });

    const outcome = await executeLogAnalysisTool("read_domain_knowledge", { query: "foldback" }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({
        scope: "domain-linked",
        retrievalMode: "semantic_fts",
        items: [{ entryId: "entry-1", title: "E_THERMAL_FOLDBACK handbook" }]
      });
    }
  });
});

describe("get_related_parameter_context", () => {
  it("reports no related parameter when no backend is bound", async () => {
    const outcome = await executeLogAnalysisTool("get_related_parameter_context", {}, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ available: false });
    }
  });

  it("returns the parameter summary with recent changes capped at 5", async () => {
    const context = buildContext({
      loadRelatedParameterContext: async () => ({
        parameterId: "binding-1",
        name: "battery-temp-target",
        description: "Target pack temperature",
        unit: "C",
        projectId: "proj-1",
        currentValue: "45",
        schemaDefault: "40",
        policyTarget: "42",
        recentChanges: Array.from({ length: 9 }, (_, index) => ({
          value: String(40 + index),
          changedAt: `2026-08-0${(index % 9) + 1}T00:00:00.000Z`
        }))
      })
    });

    const outcome = await executeLogAnalysisTool("get_related_parameter_context", {}, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { available: boolean; parameter: { recentChanges: unknown[] } };
      expect(result.available).toBe(true);
      expect(result.parameter.recentChanges).toHaveLength(5);
    }
  });

  it("stays honest when the parameter is missing from the organization", async () => {
    const context = buildContext({ loadRelatedParameterContext: async () => null });
    const outcome = await executeLogAnalysisTool("get_related_parameter_context", {}, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ available: false });
    }
  });
});
