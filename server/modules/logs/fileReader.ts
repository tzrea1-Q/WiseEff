import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import type { Database } from "../../shared/database/client";
import { putLogArtifact } from "./artifactObjects";
import type { StoredLogFile } from "./filesRepository";
import type { ObjectStore } from "./objectStore";
import { parseLogLines, type ParsedLogEntry } from "./parser";
import type { LogFormatProfile } from "./formatProfile";

const INDEX_STRIDE = 256;
// High bit marks indexes that exclude a phantom line after the final separator.
const INDEX_FORMAT = 0x80000100;
export const MAX_READER_LINE_BYTES = 64 * 1024;
export type LogFileLine = { lineNumber: number; content: string };
export class LogReaderDeadlineError extends Error {
  readonly code = "LOG_READER_TIME_CAP";
  constructor() { super("Log reader time budget exhausted."); }
}
type ReadOptions = { deadline?: number };
export type LogFileReader = {
  lineCount: number;
  lines(options?: ReadOptions): AsyncGenerator<LogFileLine>;
  entries(options?: ReadOptions): AsyncGenerator<ParsedLogEntry>;
  readRange(start: number, end: number): Promise<LogFileLine[]>;
};

async function openStream(store: ObjectStore, key: string, start = 0) {
  // Old adapters remain usable for small offline tests; shipped adapters stream ranges.
  return store.getStream ? store.getStream(key, start ? { start } : undefined)
    : Readable.from([(await store.get(key)).subarray(start)]);
}

/** Sparse byte offsets, independent of text length, UTF-8 width and stream chunk boundaries. */
export async function buildLogLineIndex(store: ObjectStore, key: string): Promise<Buffer> {
  const offsets = [0];
  let position = 0, line = 1, pendingCr = false, lastByte = 0;
  const newline = (offset: number) => { if (++line % INDEX_STRIDE === 1) offsets.push(offset); };
  for await (const value of await openStream(store, key)) {
    const chunk = value as Buffer;
    if (chunk.length) lastByte = chunk[chunk.length - 1];
    for (const byte of chunk) {
      if (pendingCr) {
        pendingCr = false; newline(position + (byte === 10 ? 1 : 0));
        if (byte === 10) { position++; continue; }
      }
      if (byte === 13) pendingCr = true;
      else if (byte === 10) newline(position + 1);
      position++;
    }
    await setImmediate();
  }
  if (pendingCr) newline(position);
  const lineCount = position === 0 ? 0 : line - (lastByte === 10 || lastByte === 13 ? 1 : 0);
  offsets.length = Math.ceil(lineCount / INDEX_STRIDE);
  const bytes = Buffer.allocUnsafe(16 + offsets.length * 8);
  bytes.writeUInt32LE(INDEX_FORMAT, 0); bytes.writeUInt32LE(lineCount, 4); bytes.writeDoubleLE(position, 8);
  offsets.forEach((offset, index) => bytes.writeDoubleLE(offset, 16 + index * 8));
  return bytes;
}

export async function ensureStoredLogIndex(db: Database, store: ObjectStore, organizationId: string, recordId: string, file: StoredLogFile) {
  if (!file.objectKey) return file;
  const { bytes, rebuilt } = await loadIndex(store, file);
  file.lineCount = bytes.readUInt32LE(4);
  if (!rebuilt) return file;
  const indexed = await putLogArtifact(db, store, recordId, { organizationId, fileName: `line-offsets-${randomUUID()}.bin`, contentType: "application/octet-stream", bytes });
  await db.query(`update log_files set line_index_key=$1, line_count=$2
    where organization_id=$3 and record_id=$4 and path=$5 and object_key=$6`,
  [indexed.storageKey, bytes.readUInt32LE(4), organizationId, recordId, file.path, file.objectKey]);
  file.lineIndexKey = indexed.storageKey; file.lineCount = bytes.readUInt32LE(4);
  return file;
}

async function loadIndex(store: ObjectStore, file: StoredLogFile) {
  if (!file.objectKey) throw new Error("File has no analyzed text object.");
  let bytes = file.lineIndexKey
    ? await (store.getBounded ? store.getBounded(file.lineIndexKey, 64 * 1024 * 1024) : store.get(file.lineIndexKey))
    : await buildLogLineIndex(store, file.objectKey);
  if (bytes.length < 16 || (bytes.length - 16) % 8
    || ![INDEX_STRIDE, INDEX_FORMAT].includes(bytes.readUInt32LE(0))
    || bytes.length !== 16 + Math.ceil(bytes.readUInt32LE(4) / INDEX_STRIDE) * 8) throw new Error("Invalid log line index.");
  const legacy = bytes.readUInt32LE(0) === INDEX_STRIDE;
  if (legacy) bytes = await buildLogLineIndex(store, file.objectKey);
  return { bytes, rebuilt: !file.lineIndexKey || legacy };
}

async function* scanLines(store: ObjectStore, key: string, startByte: number, startLine: number, endLine = Infinity, options: ReadOptions = {}): AsyncGenerator<LogFileLine> {
  let lineNumber = startLine, pendingCr = false, parts: Buffer[] = [], size = 0, truncated = false;
  const append = (bytes: Buffer) => {
    const take = Math.min(bytes.length, MAX_READER_LINE_BYTES - size);
    if (take) { parts.push(Buffer.from(bytes.subarray(0, take))); size += take; }
    if (take < bytes.length) truncated = true;
  };
  const finish = () => {
    const content = Buffer.concat(parts, size).toString("utf8") + (truncated ? "… [单行日志超过 64 KB，已截断]" : "");
    parts = []; size = 0; truncated = false;
    return { lineNumber: lineNumber++, content };
  };
  for await (const value of await openStream(store, key, startByte)) {
    if (options.deadline !== undefined && performance.now() >= options.deadline) throw new LogReaderDeadlineError();
    const chunk = value as Buffer;
    let from = 0;
    for (let at = 0; at < chunk.length; at++) {
      const byte = chunk[at];
      if (pendingCr) { pendingCr = false; if (byte === 10) { from = at + 1; continue; } }
      if (byte !== 10 && byte !== 13) continue;
      append(chunk.subarray(from, at)); from = at + 1; pendingCr = byte === 13;
      yield finish();
      if (lineNumber > endLine) return;
      if (lineNumber % 256 === 0) {
        await setImmediate();
        if (options.deadline !== undefined && performance.now() >= options.deadline) throw new LogReaderDeadlineError();
      }
    }
    append(chunk.subarray(from));
    await setImmediate();
  }
  if (lineNumber <= endLine && (size || truncated)) yield finish();
}

export async function readStoredLogRange(store: ObjectStore, file: StoredLogFile, start: number, end: number): Promise<LogFileLine[]> {
  return readIndexedRange(store, file, (await loadIndex(store, file)).bytes, start, end);
}

async function readIndexedRange(store: ObjectStore, file: StoredLogFile, index: Buffer, start: number, end: number): Promise<LogFileLine[]> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= 400) throw new Error("Invalid line window (maximum 400 lines).");
  const total = index.readUInt32LE(4);
  if (start > total) return [];
  const block = Math.floor((start - 1) / INDEX_STRIDE);
  const lines: LogFileLine[] = [];
  for await (const line of scanLines(store, file.objectKey!, index.readDoubleLE(16 + block * 8), block * INDEX_STRIDE + 1, Math.min(total, end))) {
    if (line.lineNumber >= start) lines.push(line);
  }
  return lines;
}

export function createLogFileReader(store: ObjectStore, file: StoredLogFile, profile?: LogFormatProfile,
  ensureIndex?: () => Promise<StoredLogFile>): LogFileReader {
  let index: ReturnType<typeof loadIndex> | undefined;
  const lines = async function* (options?: ReadOptions) {
    let lineCount = 0;
    for await (const line of scanLines(store, file.objectKey!, 0, 1, Infinity, options)) {
      lineCount = line.lineNumber;
      yield line;
    }
    file.lineCount = lineCount;
  };
  return {
    get lineCount() { return file.lineCount; },
    lines,
    entries: (options) => parseLogLines(lines(options), profile),
    readRange: async (start, end) => readIndexedRange(store, file,
      (await (index ??= (async () => loadIndex(store, await ensureIndex?.() ?? file))())).bytes, start, end)
  };
}
