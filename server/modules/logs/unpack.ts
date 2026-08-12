import { extname } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

import { supportedLogExtensions } from "./status";

/**
 * Archive unpacking for the log upload path (P3 intake expansion): single-file
 * `.gz` and single-entry `.zip` are decompressed server-side BEFORE parsing, so
 * the stored object and the whole downstream pipeline (worker, raw lines,
 * evidence line numbers) keep operating on plain UTF-8 text.
 *
 * Zip-bomb discipline: the unpacked size is capped by an absolute limit that
 * mirrors the documented "100MB+ logs stay excluded" product bound, plus a
 * compression-ratio multiplier (with a small-archive floor) so a tiny bomb
 * cannot expand anywhere near the absolute cap. Both constants are documented
 * in the API contract and the log-analysis runbook.
 */

export const supportedLogArchiveExtensions = [".gz", ".zip"] as const;

/** Absolute unpacked-size cap: the documented 100MB text-log exclusion bound. */
export const LOG_ARCHIVE_MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
/** A compressed upload may expand at most this many times its own size... */
export const LOG_ARCHIVE_MAX_COMPRESSION_RATIO = 200;
/** ...but small archives always get this floor so the ratio cap never bites normal logs. */
export const LOG_ARCHIVE_MIN_RATIO_BUDGET_BYTES = 1024 * 1024;

const archiveExtensions = new Set<string>(supportedLogArchiveExtensions);
const textExtensions = new Set<string>(supportedLogExtensions);

export type UnpackLogArchiveResult =
  | { ok: true; bytes: Buffer; unpacked: boolean }
  | { ok: false; reason: string };

export function isLogArchiveFileName(fileName: string): boolean {
  return archiveExtensions.has(extname(fileName).toLowerCase());
}

/**
 * The file name whose extension decides text-format support: `.gz` names must
 * carry a supported inner extension (`app.log.gz` → `app.log`); a `.zip`
 * container keeps its own name — its single entry's name is checked during
 * unpacking instead.
 */
export function effectiveLogFileName(fileName: string): string {
  return extname(fileName).toLowerCase() === ".gz" ? fileName.slice(0, -".gz".length) : fileName;
}

export function isSupportedTextLogFileName(fileName: string): boolean {
  return textExtensions.has(extname(fileName).toLowerCase());
}

/**
 * Whether a STORED object's file name is parseable. Stored archive-named
 * objects always hold already-unpacked text (unpacking happens at intake), so
 * `.zip` container names pass as-is and `.gz` names are checked by their inner
 * extension.
 */
export function isSupportedStoredLogFileName(fileName: string): boolean {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".zip") {
    return true;
  }
  return isSupportedTextLogFileName(effectiveLogFileName(fileName));
}

function unpackedByteBudget(compressedBytes: number): number {
  const ratioBudget = Math.max(
    compressedBytes * LOG_ARCHIVE_MAX_COMPRESSION_RATIO,
    LOG_ARCHIVE_MIN_RATIO_BUDGET_BYTES
  );
  return Math.min(LOG_ARCHIVE_MAX_UNPACKED_BYTES, ratioBudget);
}

function archiveHelp(): string {
  return `Supported archives: single-file .gz and single-entry .zip containing ${supportedLogExtensions.join("/")} text logs.`;
}

function sizeLimitReason(): string {
  return (
    `Unpacked log exceeds the allowed size (max ${Math.floor(LOG_ARCHIVE_MAX_UNPACKED_BYTES / (1024 * 1024))}MB, ` +
    `at most ${LOG_ARCHIVE_MAX_COMPRESSION_RATIO}x the compressed size).`
  );
}

function isOutputLengthError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
}

function unpackGzip(fileName: string, bytes: Buffer): UnpackLogArchiveResult {
  if (!isSupportedTextLogFileName(effectiveLogFileName(fileName))) {
    return {
      ok: false,
      reason: `Unsupported .gz log name "${fileName}": the inner file must keep a supported text extension (for example app.log.gz). ${archiveHelp()}`
    };
  }

  try {
    return { ok: true, unpacked: true, bytes: gunzipSync(bytes, { maxOutputLength: unpackedByteBudget(bytes.byteLength) }) };
  } catch (error) {
    if (isOutputLengthError(error)) {
      return { ok: false, reason: sizeLimitReason() };
    }
    return { ok: false, reason: `Failed to decompress .gz archive: not a valid gzip stream. ${archiveHelp()}` };
  }
}

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

const zipEndOfCentralDirectorySignature = 0x06054b50;
const zipCentralDirectorySignature = 0x02014b50;
const zipLocalFileHeaderSignature = 0x04034b50;

function readZipEntries(bytes: Buffer): { entries: ZipEntry[] } | { error: string } {
  // The end-of-central-directory record sits at the end, before an optional
  // comment of up to 65535 bytes; scan backwards for its signature.
  const scanFloor = Math.max(0, bytes.length - 22 - 65535);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= scanFloor; offset -= 1) {
    if (bytes.readUInt32LE(offset) === zipEndOfCentralDirectorySignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    return { error: "missing end-of-central-directory record" };
  }

  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (centralDirectoryOffset >= bytes.length) {
    return { error: "central directory offset is out of bounds" };
  }

  const entries: ZipEntry[] = [];
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== zipCentralDirectorySignature) {
      return { error: "central directory is truncated or corrupt" };
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, flags, method, compressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return { entries };
}

function readZipEntryData(bytes: Buffer, entry: ZipEntry): Buffer | null {
  const headerOffset = entry.localHeaderOffset;
  if (headerOffset + 30 > bytes.length || bytes.readUInt32LE(headerOffset) !== zipLocalFileHeaderSignature) {
    return null;
  }
  const nameLength = bytes.readUInt16LE(headerOffset + 26);
  const extraLength = bytes.readUInt16LE(headerOffset + 28);
  const dataStart = headerOffset + 30 + nameLength + extraLength;
  // Sizes come from the central directory: local headers may carry zeros when
  // the writer streamed with data descriptors.
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) {
    return null;
  }
  return bytes.subarray(dataStart, dataEnd);
}

function unpackZip(bytes: Buffer): UnpackLogArchiveResult {
  const parsed = readZipEntries(bytes);
  if ("error" in parsed) {
    return { ok: false, reason: `Failed to read .zip archive: ${parsed.error}. ${archiveHelp()}` };
  }

  // Directory placeholders (trailing "/") don't count against the single-entry rule.
  const fileEntries = parsed.entries.filter((entry) => !entry.name.endsWith("/"));
  if (fileEntries.length !== 1) {
    return {
      ok: false,
      reason: `Unsupported .zip archive: expected exactly one log file entry, found ${fileEntries.length}. ${archiveHelp()}`
    };
  }

  const entry = fileEntries[0];
  if ((entry.flags & 0x1) !== 0) {
    return { ok: false, reason: `Unsupported .zip archive: encrypted entries are not supported. ${archiveHelp()}` };
  }
  if (!isSupportedTextLogFileName(entry.name)) {
    return {
      ok: false,
      reason: `Unsupported .zip entry "${entry.name}": the entry must keep a supported text extension. ${archiveHelp()}`
    };
  }

  const data = readZipEntryData(bytes, entry);
  if (!data) {
    return { ok: false, reason: `Failed to read .zip archive: local entry data is truncated or corrupt. ${archiveHelp()}` };
  }

  const budget = unpackedByteBudget(bytes.byteLength);
  if (entry.method === 0) {
    if (data.byteLength > budget) {
      return { ok: false, reason: sizeLimitReason() };
    }
    return { ok: true, unpacked: true, bytes: Buffer.from(data) };
  }
  if (entry.method === 8) {
    try {
      return { ok: true, unpacked: true, bytes: inflateRawSync(data, { maxOutputLength: budget }) };
    } catch (error) {
      if (isOutputLengthError(error)) {
        return { ok: false, reason: sizeLimitReason() };
      }
      return { ok: false, reason: `Failed to decompress .zip entry "${entry.name}": corrupt deflate stream. ${archiveHelp()}` };
    }
  }
  return {
    ok: false,
    reason: `Unsupported .zip compression method ${entry.method} for entry "${entry.name}" (only stored and deflate are supported). ${archiveHelp()}`
  };
}

/**
 * Unpacks an uploaded archive into plain text bytes. Non-archive names pass
 * through unchanged; failures return a human-readable reason that feeds the
 * existing unsupported-format failure path (failed record, no analysis job).
 */
export function unpackLogArchive(input: { fileName: string; bytes: Buffer }): UnpackLogArchiveResult {
  const extension = extname(input.fileName).toLowerCase();
  if (!archiveExtensions.has(extension)) {
    return { ok: true, unpacked: false, bytes: input.bytes };
  }
  return extension === ".gz" ? unpackGzip(input.fileName, input.bytes) : unpackZip(input.bytes);
}
