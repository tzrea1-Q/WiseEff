import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { buildLogLineIndex, createLogFileReader, readStoredLogRange } from "./fileReader";
import { createMemoryObjectStore } from "../../testing/objectStore";
import type { StoredLogFile } from "./filesRepository";
import { parseLogText } from "./parser";

describe("offset-backed log file reader", () => {
  it("streams without an index and initializes the persisted index only on the first range read", async () => {
    const store = createMemoryObjectStore();
    const object = await store.put({ organizationId: "org", fileName: "lazy.log", contentType: "text/plain", bytes: Buffer.from("INFO first\nERROR last\n") });
    const file: StoredLogFile = { path: "lazy.log", objectKey: object.storageKey, sizeBytes: 21, lineCount: 0,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null };
    let initializations = 0;
    const reader = createLogFileReader(store, file, undefined, async () => {
      initializations++;
      const index = await store.put({ organizationId: "org", fileName: "index.bin", contentType: "application/octet-stream", bytes: await buildLogLineIndex(store, object.storageKey) });
      file.lineIndexKey = index.storageKey;
      return file;
    });
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries).toHaveLength(2);
    expect(reader.lineCount).toBe(2);
    expect(initializations).toBe(0);
    const expected = [{ lineNumber: 2, content: "ERROR last" }];
    expect(await reader.readRange(2, 2)).toEqual(expected);
    expect(await reader.readRange(2, 2)).toEqual(expected);
    expect(initializations).toBe(1);
  });
  it("interrupts oversized lines and unfinished multiline entries at a chunk deadline", async () => {
    const store = createMemoryObjectStore();
    const file: StoredLogFile = { path: "huge.log", objectKey: "huge", sizeBytes: 1, lineCount: 1,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null };
    let chunks = 0, closed = false;
    store.getStream = async () => Readable.from((async function* () {
      try { while (true) { chunks++; yield Buffer.alloc(65536, " "); } } finally { closed = true; }
    })());
    const reader = createLogFileReader(store, file, { multiline: { mode: "indent" } });
    await expect(reader.entries({ deadline: performance.now() + 20 }).next()).rejects.toMatchObject({ code: "LOG_READER_TIME_CAP" });
    expect(chunks).toBeGreaterThan(0); expect(closed).toBe(true);
  });
  it.each(["\r\n", "\r", "\n"])("preserves UTF-8 and sparse block boundaries for %j", async (newline) => {
    const store = createMemoryObjectStore();
    const lines = Array.from({ length: 770 }, (_, index) => `${index + 1} 设备 😀`);
    const text = lines.join(newline);
    const object = await store.put({ organizationId: "org", fileName: "utf8.log", contentType: "text/plain", bytes: Buffer.from(text) });
    // Force CRLF and UTF-8 sequences across chunk boundaries.
    store.getStream = async (key, range) => {
      const bytes = store.entries.get(key)!;
      return Readable.from((function* () { for (let at = range?.start ?? 0; at < bytes.length; at += 7) yield bytes.subarray(at, at + 7); })());
    };
    const index = await store.put({ organizationId: "org", fileName: "index.bin", contentType: "application/octet-stream", bytes: await buildLogLineIndex(store, object.storageKey) });
    const file: StoredLogFile = { path: "utf8.log", objectKey: object.storageKey, lineIndexKey: index.storageKey,
      sizeBytes: Buffer.byteLength(text), encoding: "utf-8", lossy: false, lineCount: lines.length, status: "analyzed", skipReason: null };
    for (const [start, end] of [[1, 2], [255, 258], [512, 514], [768, 770]]) {
      expect(await readStoredLogRange(store, file, start, end)).toEqual(lines.slice(start - 1, end).map((content, at) => ({ lineNumber: start + at, content })));
    }
    const streamed = [];
    for await (const line of createLogFileReader(store, file).lines()) streamed.push(line.content);
    expect(streamed).toEqual(lines);
  });

  it.each<[string, string[]]>([
    ["", []], ["a\n", ["a"]], ["a\r\n", ["a"]], ["a\r", ["a"]], ["a", ["a"]],
    ["\n", [""]], ["a\n\n", ["a", ""]]
  ])("counts only actual lines for %j", async (text, expected) => {
    const store = createMemoryObjectStore();
    const object = await store.put({ organizationId: "org", fileName: "test.log", contentType: "text/plain", bytes: Buffer.from(text) });
    const file: StoredLogFile = { path: "test.log", objectKey: object.storageKey, sizeBytes: text.length,
      encoding: "utf-8", lossy: false, lineCount: expected.length, status: "analyzed", skipReason: null };
    const index = await buildLogLineIndex(store, object.storageKey);
    expect(index.readUInt32LE(4)).toBe(expected.length);
    expect((await readStoredLogRange(store, file, 1, 400)).map((line) => line.content)).toEqual(expected);
    const streamed = [];
    for await (const line of createLogFileReader(store, file).lines()) streamed.push(line.content);
    expect(streamed).toEqual(expected);
    expect(parseLogText({ fileName: "test.log", content: text })).toMatchObject({ ok: true, rawLines: expected });
  });

  it.each([43, 92, 256, 512])("excludes the terminal separator at %i lines and sparse block boundaries", async (count) => {
    const store = createMemoryObjectStore();
    const lines = Array.from({ length: count }, (_, index) => `INFO line ${index + 1}`);
    const bytes = Buffer.from(lines.join("\r\n") + "\r\n");
    const object = await store.put({ organizationId: "org", fileName: "test.log", contentType: "text/plain", bytes });
    const index = await buildLogLineIndex(store, object.storageKey);
    expect(index.readUInt32LE(4)).toBe(count);
    expect(index.length).toBe(16 + Math.ceil(count / 256) * 8);
    const file: StoredLogFile = { path: "test.log", objectKey: object.storageKey, sizeBytes: bytes.length,
      encoding: "utf-8", lossy: false, lineCount: count, status: "analyzed", skipReason: null };
    expect(await readStoredLogRange(store, file, count, count + 1)).toEqual([{ lineNumber: count, content: lines[count - 1] }]);
    expect(await readStoredLogRange(store, file, count + 1, count + 1)).toEqual([]);
    const legacy = Buffer.alloc(16 + Math.ceil((count + 1) / 256) * 8);
    index.copy(legacy);
    legacy.writeUInt32LE(256, 0); legacy.writeUInt32LE(count + 1, 4);
    if (count % 256 === 0) legacy.writeDoubleLE(bytes.length, legacy.length - 8);
    const oldIndex = await store.put({ organizationId: "org", fileName: "legacy.bin", contentType: "application/octet-stream", bytes: legacy });
    file.lineIndexKey = oldIndex.storageKey;
    expect(await readStoredLogRange(store, file, count, count + 1)).toEqual([{ lineNumber: count, content: lines[count - 1] }]);
  });
});
