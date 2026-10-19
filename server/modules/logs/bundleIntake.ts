import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import { crc32, gunzipSync, inflateRawSync } from "node:zlib";
import { supportedLogExtensions } from "./status";

const MiB = 1024 * 1024;
/** JSON parsing/base64 copies have a separate envelope from multipart uploads. */
export const MAX_LOG_JSON_UPLOAD_BYTES = 32 * MiB;
const corruptArchiveReason = "压缩包完整性规则：压缩包损坏或格式不受支持";
export type BundleLimits = { maxCompressedBytes: number; maxUnpackedBytes: number; maxFiles: number; maxFileBytes: number };
export const defaultBundleLimits: BundleLimits = {
  maxCompressedBytes: 100 * MiB, maxUnpackedBytes: 100 * MiB, maxFiles: 2000, maxFileBytes: 100 * MiB
};
export type BundleFile = {
  path: string; sizeBytes: number; sha256: string; encoding: "utf-8" | "utf-16le" | "utf-16be";
  lossy: boolean; lineCount: number; status: "analyzed" | "skipped"; skipReason: string | null;
  bytes?: Buffer;
};
export class LogBundleIntakeError extends Error {
  override name = "LogBundleIntakeError";
}

export type BundleIntakeResult = { ok: true; files: BundleFile[] } | { ok: false; reason: string };
export function isLogArchive(name: string) { return /\.(?:gz|tgz|tar|zip)$/i.test(name); }

function* decodedChunks(file: BundleFile) {
  const decoder = new TextDecoder(file.encoding);
  for (let at = 0; at < file.bytes!.length; at += 64 * 1024) yield decoder.decode(file.bytes!.subarray(at, at + 64 * 1024), { stream: true });
  yield decoder.decode();
}

function utf8Size(file: BundleFile) {
  if (file.encoding === "utf-8" && !file.lossy) return file.bytes!.length;
  let size = 0;
  for (const text of decodedChunks(file)) size += Buffer.byteLength(text);
  return size;
}

/** Preserve decoded-content semantics without copying clean UTF-8 or retaining strings. */
export function bundleFileUtf8Bytes(file: BundleFile): Buffer {
  if (!file.bytes) throw new Error("Analyzable bundle file bytes are required.");
  if (file.encoding === "utf-8" && !file.lossy) {
    return file.bytes[0] === 0xef && file.bytes[1] === 0xbb && file.bytes[2] === 0xbf
      ? file.bytes.subarray(3) : file.bytes;
  }
  const bytes = Buffer.allocUnsafe(utf8Size(file));
  let at = 0;
  for (const text of decodedChunks(file)) at += bytes.write(text, at);
  return bytes;
}

function safePath(name: string, directory = false): string {
  const path = name.replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\0")) throw new LogBundleIntakeError("路径安全规则：不允许绝对路径或无效路径");
  if (path.split("/").includes("..")) throw new LogBundleIntakeError("路径安全规则：不允许 .. 路径穿越");
  const normalized = posix.normalize(path).replace(/\/$/, "");
  if (Buffer.byteLength(normalized) > 1024) throw new LogBundleIntakeError("路径长度规则：文件路径不能超过 1024 字节");
  if (normalized === "." && !directory) throw new LogBundleIntakeError("路径安全规则：文件路径不能为空");
  return normalized;
}

function validateZipExtras(extra: Buffer) {
  for (let at = 0; at < extra.length;) {
    if (at + 4 > extra.length) throw new LogBundleIntakeError(corruptArchiveReason);
    const id = extra.readUInt16LE(at), size = extra.readUInt16LE(at + 2);
    const end = at + 4 + size;
    if (end > extra.length) throw new LogBundleIntakeError(corruptArchiveReason);
    // PKWARE Unix variable data describes links/devices; ASi Unix also carries a file mode.
    if (id === 0x000d && size > 12) throw new LogBundleIntakeError("条目类型规则：不允许 Unix 链接或设备");
    if (id === 0x756e) {
      if (size < 14) throw new LogBundleIntakeError(corruptArchiveReason);
      const kind = extra.readUInt16LE(at + 8) & 0xf000;
      if (size > 14 || (kind && kind !== 0x8000 && kind !== 0x4000)) throw new LogBundleIntakeError("条目类型规则：不允许 Unix 链接、设备或 FIFO");
    }
    at = end;
  }
}

export function decodeLogBundleFile(path: string, bytes: Buffer, requireSupportedExtension = true): BundleFile {
  const utf16 = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
  const encoding = utf16 ? (bytes[0] === 0xff ? "utf-16le" : "utf-16be") : "utf-8";
  let lossy = false;
  const decoder = new TextDecoder(encoding), validator = new TextDecoder(encoding, { fatal: true });
  let sample = "", hasNull = false, lineCount = 1, previousCr = false, lastCode: number | undefined;
  const inspect = (text: string) => {
    if (sample.length < 8192) sample += text.slice(0, 8192 - sample.length);
    hasNull ||= text.includes("\0");
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at);
      lastCode = code;
      if (code === 13 || code === 10 && !previousCr) lineCount++;
      previousCr = code === 13;
    }
  };
  for (let at = 0; at < bytes.length; at += 64 * 1024) {
    const chunk = bytes.subarray(at, at + 64 * 1024);
    if (!lossy) try { validator.decode(chunk, { stream: true }); } catch { lossy = true; }
    inspect(decoder.decode(chunk, { stream: true }));
  }
  if (!lossy) try { validator.decode(); } catch { lossy = true; }
  inspect(decoder.decode());
  if (lastCode === undefined) lineCount = 0;
  else if (lastCode === 10 || lastCode === 13) lineCount--;
  const controls = [...sample].filter((c) => c.charCodeAt(0) < 32 && !"\t\n\r".includes(c)).length;
  // UTF-16's zero octets are ordinary text; decoded U+0000 is not PostgreSQL-storable text.
  const binary = (!utf16 && bytes.subarray(0, 8192).includes(0)) || hasNull || controls / Math.max(1, sample.length) > 0.2;
  const extension = extname(path).toLowerCase();
  const skipReason = binary ? "二进制文件" : requireSupportedExtension && extension && !(supportedLogExtensions as readonly string[]).includes(extension) ? "不支持的文件扩展名" : null;
  return {
    path, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encoding, lossy,
    lineCount: binary ? 0 : lineCount,
    status: skipReason ? "skipped" : "analyzed", skipReason, ...(skipReason ? {} : { bytes })
  };
}

/** No persistence: every entry is validated, bounded and decoded before the caller writes anything. */
export function intakeLogBundle(
  uploads: { fileName: string; bytes: Buffer } | Array<{ fileName: string; bytes: Buffer }>,
  limits: BundleLimits = defaultBundleLimits
): BundleIntakeResult {
  try {
    const inputs = Array.isArray(uploads) ? uploads : [uploads];
    if (!inputs.length) throw new LogBundleIntakeError("文件数量规则：请选择至少一个文件");
    if (inputs.reduce((sum, file) => sum + file.bytes.length, 0) > limits.maxCompressedBytes) throw new LogBundleIntakeError("上传大小规则：超过 LOG_BUNDLE_MAX_COMPRESSED_BYTES 上限");
    if (inputs.length > 1 && inputs.some((file) => isLogArchive(file.fileName))) throw new LogBundleIntakeError("上传格式规则：请选择多个文本文件或一个压缩包");
    const ratioBudget = inputs.length === 1 && isLogArchive(inputs[0].fileName)
      ? Math.max(inputs[0].bytes.length * 200, MiB) : Number.POSITIVE_INFINITY;
    const unpackedBudget = Math.min(limits.maxUnpackedBytes, ratioBudget);
    const files: BundleFile[] = [];
    const paths = new Set<string>();
    let total = 0, textTotal = 0, inflatedBytes = 0, archiveEntries = 0;
    const countArchiveEntry = () => {
      if (++archiveEntries > 2 * limits.maxFiles) throw new LogBundleIntakeError("条目数量规则：压缩包条目总数超过 LOG_BUNDLE_MAX_FILES 的 2 倍上限（含目录）");
    };
    const add = (name: string, bytes: Buffer) => {
      const path = safePath(name);
      if (paths.has(path)) throw new LogBundleIntakeError(`重复路径规则：${path}`);
      paths.add(path);
      if (files.length >= limits.maxFiles) throw new LogBundleIntakeError("文件数量规则：超过 LOG_BUNDLE_MAX_FILES 上限");
      if (bytes.length > limits.maxFileBytes) throw new LogBundleIntakeError("单文件大小规则：超过 LOG_BUNDLE_MAX_FILE_BYTES 上限");
      total += bytes.length;
      if (total > limits.maxUnpackedBytes) throw new LogBundleIntakeError("解包总大小规则：超过 LOG_BUNDLE_MAX_UNPACKED_BYTES 上限");
      if (total > ratioBudget) throw new LogBundleIntakeError("压缩比规则：解包总量超过 200 倍压缩比上限（最低预算 1 MiB）");
      const file = decodeLogBundleFile(path, bytes);
      if (file.status === "analyzed") {
        const size = utf8Size(file);
        textTotal += size;
        if (size > limits.maxFileBytes || textTotal > limits.maxUnpackedBytes) throw new LogBundleIntakeError("解码文本大小规则：UTF-8 文本超过单文件或解包总大小上限");
      }
      files.push(file);
    };
    const inflate = (bytes: Buffer, gzip: boolean, container: boolean) => {
      const cap = Math.min(unpackedBudget - inflatedBytes, container ? unpackedBudget : limits.maxFileBytes, Math.max(bytes.length * 200, MiB));
      if (cap < 1) throw new LogBundleIntakeError("解包总大小规则：超过 LOG_BUNDLE_MAX_UNPACKED_BYTES 上限");
      try {
        const output = (gzip ? gunzipSync : inflateRawSync)(bytes, { maxOutputLength: cap });
        inflatedBytes += output.length;
        return output;
      }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") throw new LogBundleIntakeError("解压大小规则：超过单文件、总大小或 200 倍压缩比上限（最低预算 1 MiB）");
        throw error;
      }
    };
    const expand = (name: string, bytes: Buffer, depth: number, prefix = "") => {
      const path = safePath(name);
      if (!isLogArchive(path)) { add(posix.join(prefix, path), bytes); return; }
      if (depth > 1) throw new LogBundleIntakeError("嵌套层数规则：压缩包最多嵌套一层");
      const child = (entry: string, data: Buffer) => expand(safePath(entry), data, depth + 1, prefix);
      if (/\.(gz|tgz)$/i.test(path)) {
        let inner = path.replace(/\.tgz$/i, ".tar").replace(/\.gz$/i, "");
        // RFC 1952 FNAME, when present, is untrusted too.
        if (bytes.length > 10 && (bytes[3] & 8)) {
          let start = 10;
          if (bytes[3] & 4) {
            if (bytes.length < 12) throw new LogBundleIntakeError(corruptArchiveReason);
            start = 12 + bytes.readUInt16LE(10);
          }
          const end = bytes.indexOf(0, start);
          if (end < start) throw new LogBundleIntakeError(corruptArchiveReason);
          inner = safePath(bytes.subarray(start, end).toString("utf8"));
        }
        const data = inflate(bytes, true, isLogArchive(inner));
        // The gzip wrapper of tar.gz is part of the same archive level.
        expand(inner, data, /\.tar$/i.test(inner) ? depth : depth + 1, prefix);
        return;
      }
      if (/\.zip$/i.test(path)) {
        let end = -1;
        for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
          if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
        }
        if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new LogBundleIntakeError(corruptArchiveReason);
        const count = bytes.readUInt16LE(end + 10);
        const centralStart = bytes.readUInt32LE(end + 16);
        let at = centralStart;
        const centralEnd = at + bytes.readUInt32LE(end + 12);
        if (count === 65535) throw new LogBundleIntakeError("压缩格式规则：不支持 ZIP64");
        if (centralEnd !== end) throw new LogBundleIntakeError(corruptArchiveReason);
        if (count > 2 * limits.maxFiles - archiveEntries) throw new LogBundleIntakeError("条目数量规则：压缩包条目总数超过 LOG_BUNDLE_MAX_FILES 的 2 倍上限（含目录）");
        const localHeaders = new Set<number>();
        const dataRanges: Array<[number, number]> = [];
        for (let i = 0; i < count; i++) {
          countArchiveEntry();
          if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new LogBundleIntakeError(corruptArchiveReason);
          const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
          const size = bytes.readUInt32LE(at + 20), unpackedSize = bytes.readUInt32LE(at + 24);
          const checksum = bytes.readUInt32LE(at + 16);
          const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32);
          const local = bytes.readUInt32LE(at + 42), mode = bytes.readUInt32LE(at + 38) >>> 16;
          if (localHeaders.has(local)) throw new LogBundleIntakeError("压缩包条目规则：zip 本地头重复");
          localHeaders.add(local);
          const next = at + 46 + nameLength + extraLength + commentLength;
          if (next > end) throw new LogBundleIntakeError(corruptArchiveReason);
          const rawName = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
          validateZipExtras(bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength));
          const entry = safePath(rawName, rawName.endsWith("/"));
          if (flags & 0x41) throw new LogBundleIntakeError("加密规则：不支持加密 zip 条目");
          const kind = mode & 0xf000;
          if (kind && kind !== 0x8000 && kind !== 0x4000) throw new LogBundleIntakeError("条目类型规则：不允许链接、设备或 FIFO");
          if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new LogBundleIntakeError(corruptArchiveReason);
          const localNameLength = bytes.readUInt16LE(local + 26);
          const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
          validateZipExtras(bytes.subarray(local + 30 + localNameLength, start));
          if (start + size > centralStart || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags || bytes.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== rawName) throw new LogBundleIntakeError(corruptArchiveReason);
          // ponytail: the range scan is bounded by 2 * maxFiles; use an interval index if that cap grows.
          if (dataRanges.some(([from, to]) => (start === from && start + size === to) || (size > 0 && to > from && start < to && from < start + size))) throw new LogBundleIntakeError("压缩包条目规则：zip 数据区间重叠");
          dataRanges.push([start, start + size]);
          at = next;
          if (rawName.endsWith("/") || kind === 0x4000) continue;
          if (files.length >= limits.maxFiles) throw new LogBundleIntakeError("文件数量规则：超过 LOG_BUNDLE_MAX_FILES 上限");
          const data = bytes.subarray(start, start + size);
          if (method !== 0 && method !== 8) throw new LogBundleIntakeError("压缩格式规则：zip 仅支持 stored 和 deflate");
          const output = method === 8 ? inflate(data, false, isLogArchive(entry)) : data;
          if (output.length !== unpackedSize) throw new LogBundleIntakeError(corruptArchiveReason);
          if (crc32(output) !== checksum) throw new LogBundleIntakeError(corruptArchiveReason);
          const nestedPrefix = isLogArchive(entry) ? posix.join(prefix, entry) : prefix;
          expand(entry, output, depth + 1, nestedPrefix);
        }
        if (at !== centralEnd) throw new LogBundleIntakeError(corruptArchiveReason);
        return;
      }
      let at = 0, longName: string | undefined;
      let pax: Record<string, string> = {}, globalPax: Record<string, string> = {};
      const field = (header: Buffer, start: number, length: number) => header.subarray(start, start + length).toString("utf8").split("\0")[0];
      const number = (header: Buffer, start: number, length: number) => {
        const value = field(header, start, length).trim();
        if (!/^[0-7]*$/.test(value)) throw new LogBundleIntakeError("压缩格式规则：不支持的 tar 数字字段");
        return parseInt(value || "0", 8);
      };
      while (at + 512 <= bytes.length) {
        const header = bytes.subarray(at, at + 512);
        if (header.every((byte) => byte === 0)) return;
        countArchiveEntry();
        const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
        if (checksum !== number(header, 148, 8)) throw new LogBundleIntakeError(corruptArchiveReason);
        const size = number(header, 124, 12), type = field(header, 156, 1) || "0";
        at += 512;
        if (!Number.isSafeInteger(size) || at + size > bytes.length) throw new LogBundleIntakeError(corruptArchiveReason);
        const data = bytes.subarray(at, at + size);
        at += Math.ceil(size / 512) * 512;
        if (["L", "x", "g"].includes(type)) {
          if (size > 1024 * 1024) throw new LogBundleIntakeError("压缩格式规则：tar 扩展头过大");
          if (type === "L") longName = data.toString("utf8").replace(/\0.*$/s, "").replace(/\n$/, "");
          else {
            const values: Record<string, string> = {};
            let cursor = 0;
            while (cursor < data.length) {
              const space = data.indexOf(32, cursor), lengthText = data.subarray(cursor, space).toString();
              const length = Number(lengthText);
              if (space < cursor || !/^\d+$/.test(lengthText) || length <= space - cursor + 1 || cursor + length > data.length || data[cursor + length - 1] !== 10) throw new LogBundleIntakeError(corruptArchiveReason);
              const value = data.subarray(space + 1, cursor + length - 1).toString("utf8"), equals = value.indexOf("=");
              if (equals < 1) throw new LogBundleIntakeError(corruptArchiveReason);
              values[value.slice(0, equals)] = value.slice(equals + 1); cursor += length;
            }
            if (type === "g") globalPax = { ...globalPax, ...values }; else pax = values;
          }
          continue;
        }
        const attributes = { ...globalPax, ...pax };
        const tarPrefix = header[262] === 32 ? "" : field(header, 345, 155);
        const entry = safePath(attributes.path ?? longName ?? `${tarPrefix ? `${tarPrefix}/` : ""}${field(header, 0, 100)}`, type === "5");
        longName = undefined; pax = {};
        if (attributes.linkpath || Object.keys(attributes).some((key) => /sparse/i.test(key))) throw new LogBundleIntakeError("条目类型规则：不允许链接或稀疏文件");
        if (type === "5") continue;
        if (type !== "0") throw new LogBundleIntakeError("条目类型规则：不允许符号链接、硬链接、设备或 FIFO");
        if (attributes.size && Number(attributes.size) !== size) throw new LogBundleIntakeError(corruptArchiveReason);
        if (isLogArchive(entry)) expand(entry, data, depth + 1, posix.join(prefix, entry));
        else child(entry, data);
      }
      if (at !== bytes.length || longName || Object.keys(pax).length) throw new LogBundleIntakeError(corruptArchiveReason);
    };
    for (const input of inputs) expand(input.fileName, input.bytes, 0);
    if (!files.length) throw new LogBundleIntakeError("文件数量规则：压缩包中没有文件");
    return { ok: true, files };
  } catch (error) {
    return { ok: false, reason: error instanceof LogBundleIntakeError ? error.message : corruptArchiveReason };
  }
}
