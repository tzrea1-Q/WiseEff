import { gzipSync, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  effectiveLogFileName,
  isLogArchiveFileName,
  isSupportedStoredLogFileName,
  LOG_ARCHIVE_MAX_COMPRESSION_RATIO,
  LOG_ARCHIVE_MAX_UNPACKED_BYTES,
  LOG_ARCHIVE_MIN_RATIO_BUDGET_BYTES,
  unpackLogArchive
} from "./unpack";

type ZipTestEntry = {
  name: string;
  data?: Buffer;
  method?: 0 | 8;
  flags?: number;
};

/** Minimal zip writer for tests: local headers + central directory + EOCD (CRC left 0; the reader does not verify it). */
function buildZip(entries: ZipTestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = entry.name.endsWith("/") ? Buffer.alloc(0) : entry.data ?? Buffer.from("payload");
    const compressed = entry.name.endsWith("/") ? Buffer.alloc(0) : method === 8 ? deflateRawSync(data) : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, nameBytes, compressed]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBytes]));

    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, endRecord]);
}

const logText = "2026-08-13T00:00:00Z INFO charge started\n2026-08-13T00:00:05Z ERROR E_THERMAL_FOLDBACK derate\n";

describe("unpackLogArchive", () => {
  it("passes non-archive files through unchanged", () => {
    const bytes = Buffer.from(logText);
    const result = unpackLogArchive({ fileName: "charging.log", bytes });

    expect(result).toEqual({ ok: true, unpacked: false, bytes });
  });

  it("unpacks a valid .gz upload back to the original text", () => {
    const result = unpackLogArchive({ fileName: "charging.log.gz", bytes: gzipSync(Buffer.from(logText)) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unpacked).toBe(true);
      expect(result.bytes.toString("utf8")).toBe(logText);
    }
  });

  it("rejects a .gz whose inner name has no supported text extension", () => {
    for (const fileName of ["dump.bin.gz", "archive.gz"]) {
      const result = unpackLogArchive({ fileName, bytes: gzipSync(Buffer.from(logText)) });
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("inner file must keep a supported text extension") });
    }
  });

  it("rejects corrupt gzip streams with a readable reason", () => {
    const result = unpackLogArchive({ fileName: "charging.log.gz", bytes: Buffer.from("definitely-not-gzip") });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("not a valid gzip stream") });
  });

  it("stops a gzip bomb at the compression-ratio budget instead of inflating it", () => {
    // ~5MB of a single repeated byte compresses to a few KB, so the ratio
    // budget (max(compressed x ratio, 1MB floor)) is far below the real size.
    const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61));
    expect(bomb.byteLength * LOG_ARCHIVE_MAX_COMPRESSION_RATIO).toBeLessThan(5 * 1024 * 1024);

    const result = unpackLogArchive({ fileName: "bomb.log.gz", bytes: bomb });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("exceeds the allowed size") });
  });

  it("unpacks a single-entry deflated .zip", () => {
    const result = unpackLogArchive({
      fileName: "charging.zip",
      bytes: buildZip([{ name: "charging.log", data: Buffer.from(logText) }])
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.toString("utf8")).toBe(logText);
    }
  });

  it("unpacks a stored (uncompressed) zip entry and ignores directory placeholders", () => {
    const result = unpackLogArchive({
      fileName: "charging.zip",
      bytes: buildZip([
        { name: "logs/" },
        { name: "logs/charging.txt", data: Buffer.from(logText), method: 0 }
      ])
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.toString("utf8")).toBe(logText);
    }
  });

  it("rejects multi-entry zips with an explicit count", () => {
    const result = unpackLogArchive({
      fileName: "bundle.zip",
      bytes: buildZip([
        { name: "one.log", data: Buffer.from("a") },
        { name: "two.log", data: Buffer.from("b") }
      ])
    });

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("expected exactly one log file entry, found 2")
    });
  });

  it("rejects encrypted zip entries", () => {
    const result = unpackLogArchive({
      fileName: "secret.zip",
      bytes: buildZip([{ name: "secret.log", data: Buffer.from(logText), flags: 0x1 }])
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("encrypted entries are not supported") });
  });

  it("rejects zip entries without a supported text extension", () => {
    const result = unpackLogArchive({
      fileName: "dump.zip",
      bytes: buildZip([{ name: "dump.bin", data: Buffer.from(logText) }])
    });

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining('entry "dump.bin"')
    });
  });

  it("rejects bytes that are not a zip archive", () => {
    const result = unpackLogArchive({ fileName: "broken.zip", bytes: Buffer.from("not a zip at all") });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("missing end-of-central-directory") });
  });

  it("stops a zip bomb at the compression-ratio budget", () => {
    const bomb = buildZip([{ name: "bomb.log", data: Buffer.alloc(5 * 1024 * 1024, 0x61) }]);
    expect(bomb.byteLength).toBeLessThan(LOG_ARCHIVE_MIN_RATIO_BUDGET_BYTES);

    const result = unpackLogArchive({ fileName: "bomb.zip", bytes: bomb });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("exceeds the allowed size") });
  });

  it("caps every unpack at the absolute 100MB bound", () => {
    expect(LOG_ARCHIVE_MAX_UNPACKED_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe("archive file-name helpers", () => {
  it("classifies archive names and strips .gz for the effective name", () => {
    expect(isLogArchiveFileName("a.log.gz")).toBe(true);
    expect(isLogArchiveFileName("a.zip")).toBe(true);
    expect(isLogArchiveFileName("a.log")).toBe(false);
    expect(effectiveLogFileName("a.log.gz")).toBe("a.log");
    expect(effectiveLogFileName("a.zip")).toBe("a.zip");
  });

  it("treats stored archive-named objects as parseable text carriers", () => {
    expect(isSupportedStoredLogFileName("a.log")).toBe(true);
    expect(isSupportedStoredLogFileName("a.log.gz")).toBe(true);
    expect(isSupportedStoredLogFileName("a.zip")).toBe(true);
    expect(isSupportedStoredLogFileName("a.bin.gz")).toBe(false);
    expect(isSupportedStoredLogFileName("a.bin")).toBe(false);
  });
});
