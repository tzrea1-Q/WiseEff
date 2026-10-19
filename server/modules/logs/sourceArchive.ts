import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname, posix } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createGunzip, createInflateRaw } from "node:zlib";

const MiB = 1024 * 1024;
export type SourceSnapshotLimits = { maxCompressedBytes: number; maxUnpackedBytes: number; maxFileBytes: number; maxFiles: number };
export const defaultSourceSnapshotLimits: SourceSnapshotLimits = {
  maxCompressedBytes: 100 * MiB, maxUnpackedBytes: 1024 * MiB, maxFileBytes: 2 * MiB, maxFiles: 20_000
};
export function getSourceSnapshotLimits(env: NodeJS.ProcessEnv = process.env): SourceSnapshotLimits {
  const read = (key: string, fallback: number) => {
    const value = env[key];
    if (value === undefined || value === "") return fallback;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${key} must be a positive safe integer.`);
    return Number(value);
  };
  return {
    maxCompressedBytes: read("LOG_SOURCE_MAX_COMPRESSED_BYTES", defaultSourceSnapshotLimits.maxCompressedBytes),
    maxUnpackedBytes: read("LOG_SOURCE_MAX_UNPACKED_BYTES", defaultSourceSnapshotLimits.maxUnpackedBytes),
    maxFileBytes: read("LOG_SOURCE_MAX_FILE_BYTES", defaultSourceSnapshotLimits.maxFileBytes),
    maxFiles: read("LOG_SOURCE_MAX_FILES", defaultSourceSnapshotLimits.maxFiles)
  };
}

const languages: Record<string, string> = {
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp", ".S": "assembly", ".s": "assembly",
  ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".py": "python", ".go": "go", ".rs": "rust",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".tsx": "typescript",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell", ".mk": "make", ".cmake": "cmake", ".dts": "devicetree", ".dtsi": "devicetree",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".gradle": "gradle", ".xml": "xml", ".properties": "properties",
  ".cfg": "config", ".conf": "config", ".ini": "config", ".proto": "protobuf", ".sql": "sql", ".rb": "ruby", ".swift": "swift", ".m": "objective-c", ".mm": "objective-cpp"
};
const buildNames: Record<string, string> = { makefile: "make", gnumakefile: "make", "cmakelists.txt": "cmake", kconfig: "kconfig", dockerfile: "docker", meson: "meson", "meson.build": "meson", "meson_options.txt": "meson", build: "bazel", "build.bazel": "bazel", workspace: "bazel" };
const excludedDirectories = new Set(["third_party", "third-party", "thirdparty", "vendor", "vendors", "node_modules", "external", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv"]);
function isArchiveMetadata(path: string) {
  return path.split("/").some((part) => part.startsWith("._") || part === "__MACOSX" || part === ".DS_Store");
}
export function sourceLanguage(path: string): string | null {
  const name = basename(path).toLowerCase();
  return buildNames[name] ?? (/^kconfig\./.test(name) ? "kconfig" : languages[extname(path)] ?? languages[extname(path).toLowerCase()] ?? null);
}
export function classifySourcePath(path: string, sizeBytes: number, limits = defaultSourceSnapshotLimits): string | null {
  if (path.split("/").slice(0, -1).some((part) => excludedDirectories.has(part.toLowerCase()))) return "第三方或忽略目录";
  if (!sourceLanguage(path)) return "不支持的文件类型";
  return sizeBytes > limits.maxFileBytes ? "超过单文件大小上限" : null;
}
export type SourceIndexedFile = { path: string; sizeBytes: number; sha256: string; lineCount: number; language: string; text: string };
export type SourceArchiveSummary = { fileCount: number; filesProcessed: number; filesTotal: number; skippedCount: number; skippedFiles: Array<{ path: string; reason: string }> };

function safePath(raw: string, directory: boolean) {
  const value = raw.replaceAll("\\", "/");
  if (!value || value.startsWith("/") || /^[a-z]:/i.test(value) || value.includes("\0") || value.split("/").includes("..")) throw new Error("源码路径安全规则：不允许绝对路径或路径穿越");
  const normalized = posix.normalize(value).replace(/\/$/, "");
  if ((!directory && normalized === ".") || Buffer.byteLength(normalized) > 1024) throw new Error("源码路径安全规则：路径为空或超过 1024 字节");
  return normalized;
}

/** Holds only the current stream block; callers request at most one file's bounded bytes. */
class ByteReader {
  private iterator: AsyncIterator<Buffer>;
  private block: Buffer = Buffer.alloc(0);
  private offset = 0;
  private total = 0;
  constructor(stream: Readable, private budget: number) { this.iterator = stream[Symbol.asyncIterator](); }
  async take(size: number, retain = true, target?: Buffer): Promise<Buffer> {
    const output = retain ? target?.subarray(0, size) ?? Buffer.allocUnsafe(size) : Buffer.alloc(0);
    let remaining = size;
    while (remaining > 0) {
      if (this.offset === this.block.length) {
        const next = await this.iterator.next();
        if (next.done) throw new Error("源码压缩包截断");
        this.block = next.value; this.offset = 0; this.total += this.block.length;
        if (this.total > this.budget) throw new Error("源码解包总大小超过上限");
      }
      const length = Math.min(remaining, this.block.length - this.offset);
      if (retain) this.block.copy(output, size - remaining, this.offset, this.offset + length);
      this.offset += length; remaining -= length;
    }
    return output;
  }
  async drain() {
    for (;;) {
      const next = await this.iterator.next();
      if (next.done) return;
      this.total += next.value.length;
      if (this.total > this.budget) throw new Error("源码解包总大小超过上限");
    }
  }
}

function tarNumber(header: Buffer, start: number, length: number) {
  const value = header.subarray(start, start + length).toString("utf8").split("\0")[0].trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("源码 tar 数字字段无效");
  const number = parseInt(value || "0", 8);
  if (!Number.isSafeInteger(number)) throw new Error("源码 tar 大小字段无效");
  return number;
}
export function parseSourcePaxAttributes(data: Buffer) {
  const values: Record<string, string> = {};
  for (let at = 0; at < data.length;) {
    const space = data.indexOf(32, at), count = data.subarray(at, space).toString();
    const length = Number(count);
    if (space < at || !/^\d+$/.test(count) || length <= space - at + 1 || at + length > data.length || data[at + length - 1] !== 10) throw new Error("源码 tar 扩展头无效");
    const pair = data.subarray(space + 1, at + length - 1).toString("utf8"), equals = pair.indexOf("=");
    if (equals < 1) throw new Error("源码 tar 扩展头无效");
    const key = pair.slice(0, equals);
    if (/sparse/i.test(key)) throw new Error("源码压缩包不允许稀疏文件");
    // Global headers may repeat indefinitely: retain only the three attributes we consume.
    if (["path", "size", "linkpath"].includes(key)) values[key] = pair.slice(equals + 1);
    at += length;
  }
  return values;
}

export async function indexSourceArchive(input: {
  archivePath: string; fileName: string; limits?: SourceSnapshotLimits;
  onFile?: (file: SourceIndexedFile) => Promise<void>;
  onProgress?: (summary: SourceArchiveSummary) => Promise<void>;
}): Promise<SourceArchiveSummary> {
  const limits = input.limits ?? getSourceSnapshotLimits();
  const compressedBytes = (await stat(input.archivePath)).size;
  if (compressedBytes > limits.maxCompressedBytes) throw new Error("源码压缩上传大小超过上限");
  const summary: SourceArchiveSummary = { fileCount: 0, filesProcessed: 0, filesTotal: 0, skippedCount: 0, skippedFiles: [] };
  // Reuse one file buffer after each awaited sink; total source size never drives native allocation.
  const fileBuffer = Buffer.allocUnsafe(Math.min(limits.maxFileBytes, limits.maxUnpackedBytes));
  const paths = new Set<string>();
  let entries = 0;
  const countEntry = () => { if (++entries > limits.maxFiles * 2) throw new Error("源码压缩包条目数量超过上限"); };
  const register = (path: string) => {
    if (paths.has(path)) throw new Error("源码压缩包包含重复路径");
    paths.add(path);
    if (++summary.filesTotal > limits.maxFiles) throw new Error("源码文件数量超过上限");
  };
  const accept = async (path: string, size: number, bytes: Buffer, reason: string | null) => {
    let text = "";
    if (!reason) {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { reason = "二进制或非 UTF-8 文件"; }
      if (text.includes("\0") || /[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(text)) reason = "二进制或非 UTF-8 文件";
    }
    if (reason) {
      summary.skippedCount++;
      if (summary.skippedFiles.length < 200) summary.skippedFiles.push({ path, reason });
    } else {
      let lineCount = text.length ? 1 : 0;
      for (let at = 0; at < text.length; at++) {
        if (text[at] === "\n" || text[at] === "\r") { lineCount++; if (text[at] === "\r" && text[at + 1] === "\n") at++; }
      }
      await input.onFile?.({ path, sizeBytes: size, sha256: createHash("sha256").update(bytes).digest("hex"), lineCount, language: sourceLanguage(path)!, text });
      summary.fileCount++;
    }
    summary.filesProcessed++;
    await input.onProgress?.(summary);
  };
  if (/\.(tar\.gz|tgz)$/i.test(input.fileName)) {
    // A bounded validation/count pass makes the denominator stable before indexing begins.
    for (const indexing of [false, true]) {
      const stream = createGunzip();
      const completion = pipeline(createReadStream(input.archivePath), stream);
      void completion.catch(() => undefined);
      const reader = new ByteReader(stream, limits.maxUnpackedBytes + limits.maxFiles * 2048 + 1024);
      let totalSize = 0, longName: string | undefined, localPax: Record<string, string> = {}, globalPax: Record<string, string> = {};
      const field = (header: Buffer, start: number, size: number) => header.subarray(start, start + size).toString("utf8").split("\0")[0];
      try {
        for (;;) {
          const header = await reader.take(512);
          if (header.every((byte) => byte === 0)) { await reader.drain(); break; }
          if (!indexing) countEntry();
          const checksum = header.reduce((sum, byte, at) => sum + (at >= 148 && at < 156 ? 32 : byte), 0);
          if (checksum !== tarNumber(header, 148, 8)) throw new Error("源码 tar 校验和无效");
          const size = tarNumber(header, 124, 12), type = field(header, 156, 1) || "0";
          totalSize += size;
          if (totalSize > limits.maxUnpackedBytes) throw new Error("源码解包总大小超过上限");
          if (["L", "x", "g"].includes(type)) {
            if (size > 64 * 1024) throw new Error("源码 tar 扩展头过大");
            const data = await reader.take(size);
            if (type === "L") longName = data.toString("utf8").replace(/\0.*$/s, "").replace(/\n$/, "");
            else if (type === "g") globalPax = { ...globalPax, ...parseSourcePaxAttributes(data) };
            else localPax = parseSourcePaxAttributes(data);
          } else {
            const attributes = { ...globalPax, ...localPax };
            if (attributes.linkpath || Object.keys(attributes).some((key) => /sparse/i.test(key))) throw new Error("源码压缩包不允许链接或稀疏文件");
            const prefix = field(header, 345, 155);
            const path = safePath(attributes.path ?? longName ?? `${prefix ? `${prefix}/` : ""}${field(header, 0, 100)}`, type === "5");
            longName = undefined; localPax = {};
            if (attributes.size && Number(attributes.size) !== size) throw new Error("源码 tar 大小字段不一致");
            if (type !== "0" && type !== "5") throw new Error("源码压缩包不允许链接、设备或特殊文件");
            if (type === "5" || isArchiveMetadata(path)) { await reader.take(size, false); }
            else {
              if (!indexing) register(path);
              const reason = classifySourcePath(path, size, limits);
              const bytes = await reader.take(size, indexing && !reason, fileBuffer);
              if (indexing) await accept(path, size, bytes, reason);
            }
          }
          await reader.take((512 - size % 512) % 512, false);
        }
        await completion;
      } finally { stream.destroy(); await completion.catch(() => undefined); }
      if (!indexing) await input.onProgress?.(summary);
    }
  } else if (/\.zip$/i.test(input.fileName)) {
    const handle = await open(input.archivePath, "r");
    const read = async (at: number, length: number) => {
      if (at < 0 || at + length > compressedBytes) throw new Error("源码 zip 范围无效");
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, at);
      if (bytesRead !== length) throw new Error("源码 zip 截断");
      return bytes;
    };
    try {
      const tailStart = Math.max(0, compressedBytes - 65557), tail = await read(tailStart, compressedBytes - tailStart);
      let end = -1;
      for (let at = tail.length - 22; at >= 0; at--) if (tail.readUInt32LE(at) === 0x06054b50 && at + 22 + tail.readUInt16LE(at + 20) === tail.length) { end = at; break; }
      if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw new Error("源码 zip 格式无效");
      const count = tail.readUInt16LE(end + 10), centralStart = tail.readUInt32LE(end + 16), centralEnd = centralStart + tail.readUInt32LE(end + 12);
      if (count === 65535 || tail.readUInt16LE(end + 8) !== count || centralEnd !== tailStart + end || count > 2 * limits.maxFiles) throw new Error("源码 zip 不支持 ZIP64 或条目数量超过上限");
      const members: Array<{ path: string; start: number; end: number; local: number; size: number; method: number; checksum: number; ignored: boolean }> = [];
      let at = centralStart;
      for (let index = 0; index < count; index++) {
        countEntry();
        const central = await read(at, 46);
        if (central.readUInt32LE(0) !== 0x02014b50) throw new Error("源码 zip 中央目录无效");
        const flags = central.readUInt16LE(8), method = central.readUInt16LE(10), packed = central.readUInt32LE(20), size = central.readUInt32LE(24), local = central.readUInt32LE(42);
        const nameLength = central.readUInt16LE(28), extraLength = central.readUInt16LE(30), commentLength = central.readUInt16LE(32), mode = central.readUInt32LE(38) >>> 16;
        if (nameLength > 1024 || flags & 0x41 || ![0, 8].includes(method) || (mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) throw new Error("源码 zip 不允许加密、特殊条目或不支持的压缩格式");
        const name = (await read(at + 46, nameLength)).toString("utf8"), directory = name.endsWith("/") || (mode & 0xf000) === 0x4000;
        validateZipExtras(await read(at + 46 + nameLength, extraLength));
        const path = safePath(name, directory);
        const header = await read(local, 30), localNameLength = header.readUInt16LE(26), localExtraLength = header.readUInt16LE(28);
        if (localNameLength > 1024 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) !== flags || header.readUInt16LE(8) !== method || (await read(local + 30, localNameLength)).toString("utf8") !== name) throw new Error("源码 zip 本地头无效");
        validateZipExtras(await read(local + 30 + localNameLength, localExtraLength));
        const start = local + 30 + localNameLength + localExtraLength;
        if (start + packed > centralStart) throw new Error("源码 zip 数据范围无效");
        const ignored = directory || isArchiveMetadata(path);
        members.push({ path, local, start, end: start + packed, size, method, checksum: central.readUInt32LE(16), ignored });
        at += 46 + nameLength + extraLength + commentLength;
        if (at > centralEnd) throw new Error("源码 zip 中央目录范围无效");
        if (!ignored) register(path);
      }
      if (at !== centralEnd) throw new Error("源码 zip 中央目录范围无效");
      const ranges = [...members].sort((a, b) => a.local - b.local);
      for (let index = 1; index < ranges.length; index++) if (ranges[index].local < ranges[index - 1].end || ranges[index].local === ranges[index - 1].local) throw new Error("源码 zip 条目数据区间重叠");
      let totalSize = 0;
      for (const member of members) {
        if (member.method === 8 && member.end === member.start) throw new Error("源码 zip deflate 数据无效");
        const reason = member.ignored ? "元数据或目录" : classifySourcePath(member.path, member.size, limits);
        const output = reason ? Buffer.alloc(0) : fileBuffer.subarray(0, member.size);
        let size = 0, checksum = 0;
        const packedStream = member.end > member.start ? createReadStream(input.archivePath, { start: member.start, end: member.end - 1 }) : null;
        const inflater = member.method === 8 ? createInflateRaw() : null;
        const stream = inflater ?? packedStream;
        const completion = inflater && packedStream ? pipeline(packedStream, inflater) : null;
        void completion?.catch(() => undefined);
        try {
          if (stream) for await (const block of stream) {
            const bytes = block as Buffer;
            size += bytes.length; totalSize += bytes.length;
            if (totalSize > limits.maxUnpackedBytes || size > member.size) throw new Error("源码解包大小超过上限或与声明不一致");
            checksum = crc32(bytes, checksum);
            if (!reason) bytes.copy(output, size - bytes.length);
          }
          await completion;
        } finally { packedStream?.destroy(); stream?.destroy(); await completion?.catch(() => undefined); }
        if (size !== member.size || checksum !== member.checksum) throw new Error("源码 zip 完整性校验失败");
        if (!member.ignored) await accept(member.path, size, output, reason);
      }
    } finally { await handle.close(); }
  } else throw new Error("源码压缩包仅支持 .tar.gz、.tgz 或 .zip");
  return summary;
}

function validateZipExtras(extra: Buffer) {
  for (let at = 0; at < extra.length;) {
    if (at + 4 > extra.length) throw new Error("源码 zip 扩展头无效");
    const id = extra.readUInt16LE(at), size = extra.readUInt16LE(at + 2), end = at + 4 + size;
    if (end > extra.length || id === 1) throw new Error("源码 zip 扩展头无效或不支持 ZIP64");
    if (id === 0x000d && size > 12) throw new Error("源码 zip 不允许 Unix 链接或设备");
    if (id === 0x756e && (size !== 14 || ![0, 0x8000, 0x4000].includes(extra.readUInt16LE(at + 8) & 0xf000))) throw new Error("源码 zip 不允许 Unix 链接或设备");
    at = end;
  }
}

/** Keep a very long source line bounded too; repeated line numbers preserve exact addressing. */
export function* sourceChunks(text: string): Generator<{ startLine: number; endLine: number; content: string }> {
  let start = 0, line = 1, startLine = 1;
  for (let at = 0; at < text.length; at++) {
    const newline = text[at] === "\n" || text[at] === "\r";
    if (newline && text[at] === "\r" && text[at + 1] === "\n") at++;
    if (at - start + 1 >= 32 * 1024 || newline && line - startLine >= 199) {
      if (text.charCodeAt(at) >= 0xd800 && text.charCodeAt(at) <= 0xdbff && text.charCodeAt(at + 1) >= 0xdc00 && text.charCodeAt(at + 1) <= 0xdfff) at++;
      yield { startLine, endLine: line, content: text.slice(start, at + 1) };
      start = at + 1; startLine = newline ? line + 1 : line;
    }
    if (newline) line++;
  }
  if (start < text.length) yield { startLine, endLine: line, content: text.slice(start) };
}
