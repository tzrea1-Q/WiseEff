import { setImmediate, clearImmediate } from "node:timers";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeLogFiles, DECODE_BATCH_LINES, MAX_DECODE_EVENTS } from "./engine";
import { parsingSpecSchema } from "./spec";
import { decodeLogFilesCooperatively, gzipDecodedEvents, indexDecodedEvents, logDecodeLimits } from "./workerDecoding";

afterEach(() => vi.unstubAllEnvs());
const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "value", pattern: "(?P<value>.+)", fields: { value: { type: "string" } } }] });

describe("worker decoding", () => {
  it("hard-stops preview work inside a single slow line and keeps earlier completed events", async () => {
    const slow = new Proxy(["slow"], { get(target, key, receiver) {
      if (key === "0") { const end = performance.now() + 300; while (performance.now() < end) { /* simulate an expensive RE2 call */ } }
      return Reflect.get(target, key, receiver);
    } });
    const started = performance.now();
    const result = await decodeLogFilesCooperatively(spec, [{ file: "first.log", lines: ["kept"] }, { file: "slow.log", lines: slow }], { maxMs: 30, hardTimeout: true });
    expect(performance.now() - started).toBeLessThan(250);
    expect(result.events).toHaveLength(1);
    expect(result.counts).toEqual({ total: 1, byExtractor: { value: 1 }, errors: { time_cap: 1 } });
    expect(result.unmatchedLineCount).toBe(1);
  });
  it("checks time on each line even for a batch of sixteen lines", async () => {
    let reads = 0;
    const lines = new Proxy(Array(16).fill("a"), { get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    const result = await decodeLogFilesCooperatively(spec, [{ file: "a.log", lines }], { maxMs: 10, now: () => reads });
    expect(reads).toBeLessThan(16);
    expect(result.counts.errors.time_cap).toBe(1);
  });
  it("lets a heartbeat advance between batches, including the initial line-length scan", async () => {
    let reads = 0;
    const observed: number[] = [];
    const source = Array(DECODE_BATCH_LINES * 3).fill("value");
    const lines = new Proxy(source, { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
    let heartbeat: NodeJS.Immediate;
    const tick = () => { observed.push(reads); heartbeat = setImmediate(tick); };
    heartbeat = setImmediate(tick);
    try {
      const result = await decodeLogFilesCooperatively(spec, [{ file: "a.log", lines }]);
      expect(result.counts.total).toBe(source.length);
      const during = observed.filter((count) => count > 0 && count < reads);
      expect(new Set(during).size).toBeGreaterThanOrEqual(4);
      // One raw-line read per classification/extraction visit. No whole-file synchronous pass.
      expect(Math.max(...observed.slice(1).map((count, i) => count - observed[i]))).toBeLessThanOrEqual(DECODE_BATCH_LINES);
    } finally { clearImmediate(heartbeat); }
  });
  it("keeps keyed multiline state, file filters, EOF flushing, errors and extractor order across checkpoints", async () => {
    const multiline = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "message", files: ["*.log"],
      pattern: "^START (?P<key>\\w+)\\nDATA \\w+ (?P<value>\\d+)\\nEND \\w+$", fields: { key: { type: "string" }, value: { type: "uint" } },
      multiline: { start: "^START (?P<key>\\w+)$", continue: "^DATA (?P<key>\\w+) \\d+$", end: "^END (?P<key>\\w+)$", keyField: "key", maxLines: 3 }
    }, { id: "data", pattern: "DATA (?P<key>\\w+)", fields: { key: { type: "string" } } }] });
    const files = [{ file: "a.log", lines: [...Array(1998).fill("ignore"), "START a", "START b", "DATA a 42", "DATA b 7", "END b", "END a", "START c", "DATA c 9"] },
      { file: "b.txt", lines: ["START a", "DATA a 1", "END a"] }];
    expect(await decodeLogFilesCooperatively(multiline, files)).toEqual(decodeLogFiles(multiline, files));
  });
  it("streams repeated extractor passes with identical keyed multiline output and closes readers", async () => {
    const multiline = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "message",
      pattern: "START (?P<value>.+)", fields: { value: { type: "string" } },
      multiline: { start: "^START", maxLines: 3 }
    }, spec.extractors[0]] });
    const files = [{ file: "a.log", lines: ["START a", "body", "START b", "end", "x".repeat(9000), "START c"] },
      { file: "b.log", lines: ["START other", "body"] }];
    let opened = 0, closed = 0;
    const streamed = files.map(({ file, lines }) => ({ file, reader: { lineCount: lines.length, async* lines() {
      opened++;
      try { for (const [index, content] of lines.entries()) yield { lineNumber: index + 1, content }; }
      finally { closed++; }
    } } }));
    expect(await decodeLogFilesCooperatively(multiline, streamed)).toEqual(decodeLogFiles(multiline, files));
    expect(opened).toBe(files.length * (multiline.extractors.length + 1));
    expect(closed).toBe(opened);
  });
  it("shares the streaming deadline across files and closes an unfinished reader", async () => {
    let reads = 0, closed = 0;
    const files = ["a.log", "b.log"].map((file) => ({ file, reader: { lineCount: 3, async* lines() {
      try { for (let lineNumber = 1; lineNumber <= 3; lineNumber++) { reads++; yield { lineNumber, content: "value" }; } }
      finally { closed++; }
    } } }));
    const result = await decodeLogFilesCooperatively(spec, files, { maxMs: 8, now: () => reads });
    expect(result.counts.errors.time_cap).toBe(1);
    expect(result.events).toHaveLength(3);
    expect(reads).toBe(8);
    expect(closed).toBe(3);
    expect(result).not.toHaveProperty("readLine");
  });
  it("preserves completed events when a reader deadline interrupts a long physical line", async () => {
    const deadlines: Array<number | undefined> = [];
    let closed = 0;
    const files = ["kept.log", "slow.log"].map((file) => ({ file, reader: { lineCount: 1,
      async* lines(options?: { deadline?: number }) {
        deadlines.push(options?.deadline);
        try {
          if (file === "slow.log") throw Object.assign(new Error("Reader time cap"), { code: "LOG_READER_TIME_CAP" });
          yield { lineNumber: 1, content: "kept" };
        } finally { closed++; }
      }
    } }));
    const result = await decodeLogFilesCooperatively(spec, files);
    expect(result).toMatchObject({ events: [{ file: "kept.log", line: 1 }], counts: { total: 1, errors: { time_cap: 1 } }, unmatchedLineCount: 1 });
    expect(deadlines).toHaveLength(3);
    expect(deadlines.every((deadline) => Number.isFinite(deadline))).toBe(true);
    expect(closed).toBe(3);
    expect(result).not.toHaveProperty("readLine");
  });
  it("stops on the run deadline with completed events, without failing or exceeding a configured event cap", async () => {
    let time = 0;
    const files = [{ file: "a.log", lines: Array(6000).fill("value") }];
    const result = await decodeLogFilesCooperatively(spec, files, { maxMs: 6, now: () => time++ / 3000 });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThan(files[0].lines.length);
    expect(result.counts.errors).toEqual({ time_cap: 1 });
    expect(result.unmatchedLineCount).toBe(files[0].lines.length - result.counts.total);
    vi.stubEnv("LOG_DECODE_MAX_EVENTS", "3");
    const capped = await decodeLogFilesCooperatively(spec, files.slice(0, 1).map((file) => ({ ...file, lines: ["a", "b", "c", "d", "e"] })));
    expect(capped.counts).toEqual({ total: 3, byExtractor: { value: 3 }, errors: { event_cap: 2 } });
  });
  it("reads the time cap from env and discards incomplete multiline groups on timeout", async () => {
    vi.stubEnv("LOG_DECODE_MAX_MS", "5");
    const multiline = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ ...spec.extractors[0], multiline: { start: "^START", maxLines: 200 } }] });
    const source = [...Array(1997).fill("ignore"), "START", ...Array(2002).fill("body")];
    let reads = 0;
    const lines = new Proxy(source, { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
    const result = await decodeLogFilesCooperatively(multiline, [{ file: "a.log", lines }], { now: () => reads > 5000 ? 5 : 0 });
    expect(result).toMatchObject({ events: [], counts: { total: 0, errors: { time_cap: 1 } }, unmatchedLineCount: source.length });
  });
  it("checks the deadline while selecting files even when no extractor applies", async () => {
    let visited = 0, time = 0;
    const excluded = { ...spec, extractors: [{ ...spec.extractors[0], files: ["*.log"] }] };
    const files = Array.from({ length: 20 }, () => ({ get file() { visited++; return "skip.bin"; }, lines: ["ignored"] }));
    const result = await decodeLogFilesCooperatively(excluded, files, { maxMs: 3, now: () => time++ });
    expect(result.counts.errors).toEqual({ time_cap: 1 });
    expect(visited).toBeLessThan(files.length);
  });
  it("defaults to the stock container bounds and rejects malformed env overrides", () => {
    expect(MAX_DECODE_EVENTS).toBe(50_000);
    expect(logDecodeLimits({})).toEqual({ maxMs: 15_000, maxEvents: 50_000 });
    expect(logDecodeLimits({ LOG_DECODE_MAX_MS: "60000" }).maxMs).toBe(20_000);
    expect(logDecodeLimits({ LOG_DECODE_MAX_MS: "1234", LOG_DECODE_MAX_EVENTS: "60000" })).toEqual({ maxMs: 1234, maxEvents: 60000 });
    for (const value of ["0", "-1", "1.5", "Infinity", "wrong", "9007199254740992"]) {
      expect(logDecodeLimits({ LOG_DECODE_MAX_MS: value, LOG_DECODE_MAX_EVENTS: value })).toEqual({ maxMs: 15_000, maxEvents: 50_000 });
    }
  });
  it("streams gzip JSONL in event order and shares event objects with the evidence index", async () => {
    const result = decodeLogFiles(spec, [{ file: "a.log", lines: ["a", "b", "c"] }]);
    const bytes = await gzipDecodedEvents(result.events);
    expect(gunzipSync(bytes).toString()).toBe(result.events.map((event) => JSON.stringify(event) + "\n").join(""));
    const index = indexDecodedEvents(result.events);
    expect(index.get(JSON.stringify(["a.log", 1]))?.[0]).toBe(result.events[0]);
    expect(gunzipSync(await gzipDecodedEvents([])).toString()).toBe("");
    await expect(gzipDecodedEvents((function* () { yield result.events[0]; throw new Error("bad source"); })())).rejects.toThrow("bad source");
  });
});
