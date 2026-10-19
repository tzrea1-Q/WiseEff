import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { classifySourcePath, defaultSourceSnapshotLimits, getSourceSnapshotLimits, indexSourceArchive, parseSourcePaxAttributes, sourceChunks, sourceLanguage, type SourceIndexedFile } from "./sourceArchive";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function archive(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "source-archive-test-")); directories.push(directory);
  const path = join(directory, "archive"); await writeFile(path, bytes); return path;
}
function tar(files: Array<[string, Buffer, string?]>) {
  const blocks: Buffer[] = [];
  for (const [name, bytes, type = "0"] of files) {
    const header = Buffer.alloc(512); header.write(name, 0, 100); header.write("0000644\0", 100);
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124); header.fill(32, 148, 156);
    header.write(type, 156); header.write("ustar\0", 257);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function zip(files: Array<[string, Buffer]>, stored = false) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name), packed = stored ? bytes : deflateRawSync(bytes), checksum = crc32(bytes), method = stored ? 0 : 8;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(method, 10);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(packed.length, 20); record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, packed); central.push(record, nameBytes); offset += header.length + nameBytes.length + packed.length;
  }
  const records = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, records, end]);
}

describe("source archive policy", () => {
  it.each(["tgz", "zip"])("silently ignores macOS metadata and directories in %s inventories", async (extension) => {
    const metadata = Buffer.from([0, 5, 22, 7]);
    const files: Array<[string, Buffer, string?]> = [
      ["charger/", Buffer.alloc(0), "5"], ["._charger", metadata],
      ["charger/src/", Buffer.alloc(0), "5"], ["charger/src/._charger_9.c", metadata],
      ["__MACOSX/", Buffer.alloc(0), "5"], ["__MACOSX/charger/ghost.c", Buffer.from("int ghost;")],
      ["charger/.DS_Store", metadata], ["charger/src/.DS_Store", metadata],
      ["charger/src/charger_9.c", Buffer.from("int charge = 9;\n")], ["charger/Makefile", Buffer.from("all:\n\tcc src/charger_9.c\n")],
      ["charger/third_party/zlib/inflate.c", Buffer.from("int vendor;\n")], ["charger/assets/logo.bin", metadata]
    ];
    const indexed: SourceIndexedFile[] = [];
    const result = await indexSourceArchive({ archivePath: await archive(extension === "zip" ? zip(files.map(([name, bytes]) => [name, bytes])) : tar(files)),
      fileName: `source.${extension}`, async onFile(file) { indexed.push(file); } });
    expect(result).toMatchObject({ filesProcessed: 4, filesTotal: 4, fileCount: 2, skippedCount: 2 });
    expect(indexed.map((file) => file.path)).toEqual(["charger/src/charger_9.c", "charger/Makefile"]);
    expect(result.skippedFiles.map((file) => file.path)).toEqual(["charger/third_party/zlib/inflate.c", "charger/assets/logo.bin"]);
    const make = extension === "zip" ? zip : tar;
    await expect(indexSourceArchive({ archivePath: await archive(make([["__MACOSX/../escape.c", metadata]])), fileName: `unsafe.${extension}` })).rejects.toThrow("路径");
    await expect(indexSourceArchive({ archivePath: await archive(make([["._large", Buffer.alloc(101)]])), fileName: `oversize.${extension}`,
      limits: { ...defaultSourceSnapshotLimits, maxUnpackedBytes: 100 } })).rejects.toThrow("解包");
  });
  it("drops unconsumed attributes across many global PAX headers and rejects sparse declarations", async () => {
    const pax = (key: string, value: string) => {
      const pair = `${key}=${value}\n`;
      let length = Buffer.byteLength(pair) + 2;
      while (Buffer.byteLength(`${length} ${pair}`) !== length) length = Buffer.byteLength(`${length} ${pair}`);
      return Buffer.from(`${length} ${pair}`);
    };
    const headers: Array<[string, Buffer, string?]> = [];
    let global: Record<string, string> = {};
    for (let index = 0; index < 128; index++) {
      const data = pax(`unknown.${index}`, "x".repeat(32 * 1024));
      global = { ...global, ...parseSourcePaxAttributes(data) };
      headers.push([`pax-${index}`, data, "g"]);
    }
    expect(global).toEqual({});
    expect(parseSourcePaxAttributes(pax("path", "src/main.c"))).toEqual({ path: "src/main.c" });
    expect(() => parseSourcePaxAttributes(pax("GNU.sparse.map", "0,100"))).toThrow("稀疏");
    headers.push(["main.c", Buffer.from("int x;")]);
    const result = await indexSourceArchive({ archivePath: await archive(tar(headers)), fileName: "source.tgz" });
    expect(result.fileCount).toBe(1);
  });
  it("recognizes source and build files and excludes nested vendored directories", () => {
    for (const name of ["main.c", "types.hpp", "Main.kt", "main.py", "main.go", "lib.rs", "main.tsx", "init.sh", "Makefile", "CMakeLists.txt", "Kconfig.arm", "board.dtsi"]) expect(sourceLanguage(name)).not.toBeNull();
    expect(sourceLanguage("blob.exe")).toBeNull();
    expect(classifySourcePath("src/vendor/codec.c", 1)).toBe("第三方或忽略目录");
    expect(classifySourcePath("src/external/codec.c", 1)).toBe("第三方或忽略目录");
    expect(classifySourcePath("src/main.c", 2 * 1024 * 1024 + 1)).toBe("超过单文件大小上限");
  });
  it("uses defaults and strictly validates environment limits", () => {
    expect(getSourceSnapshotLimits({})).toEqual(defaultSourceSnapshotLimits);
    expect(getSourceSnapshotLimits({ LOG_SOURCE_MAX_FILES: "9", LOG_SOURCE_MAX_FILE_BYTES: "15" })).toMatchObject({ maxFiles: 9, maxFileBytes: 15 });
    for (const value of ["0", "-1", "1.5", "42junk", "Infinity", "9007199254740992"]) expect(() => getSourceSnapshotLimits({ LOG_SOURCE_MAX_FILES: value })).toThrow("positive safe integer");
  });
  it.each(["tar.gz", "zip"])("indexes allowed %s members, lists skips, and preserves line ranges", async (extension) => {
    const files: Array<[string, Buffer]> = [["src/main.c", Buffer.from("int main() {\r\nreturn 0;\r\n}\n")], ["vendor/lib.c", Buffer.from("external")],
      ["src/binary.c", Buffer.from([0, 1, 2])], ["src/large.c", Buffer.alloc(100, 97)], ["notes.txt", Buffer.from("not source")]];
    const path = await archive(extension === "zip" ? zip(files) : tar(files)), indexed: SourceIndexedFile[] = [];
    const result = await indexSourceArchive({ archivePath: path, fileName: `source.${extension}`, limits: { ...defaultSourceSnapshotLimits, maxFileBytes: 50 }, async onFile(file) { indexed.push(file); } });
    expect(result).toMatchObject({ filesProcessed: 5, filesTotal: 5, fileCount: 1, skippedCount: 4 });
    expect(result.skippedFiles.map((file) => file.reason)).toEqual(["第三方或忽略目录", "二进制或非 UTF-8 文件", "超过单文件大小上限", "不支持的文件类型"]);
    expect(indexed[0]).toMatchObject({ path: "src/main.c", lineCount: 4, language: "c" });
    expect(indexed[0].sha256).toHaveLength(64);
    expect([...sourceChunks(indexed[0].text)]).toEqual([{ startLine: 1, endLine: 4, content: indexed[0].text }]);
  });
  it.each(["tar.gz", "zip"])("rejects traversal and enforces actual total bytes for %s including skipped files", async (extension) => {
    const make = extension === "zip" ? zip : tar;
    await expect(indexSourceArchive({ archivePath: await archive(make([["../escape.c", Buffer.from("int x;")]])), fileName: `source.${extension}` })).rejects.toThrow("路径");
    const archivePath = await archive(make([["vendor/lib.c", Buffer.alloc(60)], ["src/main.c", Buffer.alloc(60)]]));
    await expect(indexSourceArchive({ archivePath, fileName: `source.${extension}`, limits: { ...defaultSourceSnapshotLimits, maxUnpackedBytes: 100 } })).rejects.toThrow("解包");
  });
  it.each(["tar.gz", "zip"])("reuses the bounded file buffer without corrupting earlier %s file text", async (extension) => {
    const files: Array<[string, Buffer]> = [["first.c", Buffer.from("int first = 1;\n")], ["second.c", Buffer.from("int second = 2;\n".repeat(20))]];
    const indexed: SourceIndexedFile[] = [];
    await indexSourceArchive({ archivePath: await archive(extension === "zip" ? zip(files) : tar(files)), fileName: `source.${extension}`,
      async onFile(file) { indexed.push(file); } });
    expect(indexed.map((file) => file.text)).toEqual(files.map(([, bytes]) => bytes.toString()));
    expect(indexed[0].sha256).not.toEqual(indexed[1].sha256);
  });
  it("rejects overlapping zip local ranges and content corruption", async () => {
    const inner = zip([["other.c", Buffer.from("x")]], true).subarray(0, 30 + 7 + 1);
    const bytes = zip([["first.c", inner], ["other.c", Buffer.from("x")]], true);
    const end = bytes.length - 22, central = bytes.readUInt32LE(end + 16), second = central + 46 + Buffer.byteLength("first.c");
    bytes.writeUInt32LE(30 + 7, second + 42);
    await expect(indexSourceArchive({ archivePath: await archive(bytes), fileName: "source.zip" })).rejects.toThrow("重叠");
    const corrupt = zip([["main.c", Buffer.from("int main;")]]);
    corrupt.writeUInt32LE(1, corrupt.readUInt32LE(corrupt.length - 22 + 16) + 16);
    await expect(indexSourceArchive({ archivePath: await archive(corrupt), fileName: "source.zip" })).rejects.toThrow("完整性");
    const bogusSize = zip([["large.c", Buffer.alloc(100_000, 97)]]);
    bogusSize.writeUInt32LE(1, bogusSize.readUInt32LE(bogusSize.length - 22 + 16) + 24);
    await expect(indexSourceArchive({ archivePath: await archive(bogusSize), fileName: "source.zip" })).rejects.toThrow("大小");
  });
  it("enforces compressed and file-count caps and bounds skipped details", async () => {
    const archivePath = await archive(tar(Array.from({ length: 205 }, (_, index) => [`vendor/file${index}.c`, Buffer.from("int x;")] as [string, Buffer])));
    const result = await indexSourceArchive({ archivePath, fileName: "source.tgz" });
    expect(result.skippedCount).toBe(205); expect(result.skippedFiles).toHaveLength(200);
    await expect(indexSourceArchive({ archivePath, fileName: "source.tgz", limits: { ...defaultSourceSnapshotLimits, maxCompressedBytes: 1 } })).rejects.toThrow("压缩上传");
    await expect(indexSourceArchive({ archivePath, fileName: "source.tgz", limits: { ...defaultSourceSnapshotLimits, maxFiles: 2 } })).rejects.toThrow("数量");
  });
  it("chunks huge lines and many short lines with exact reconstructable content", () => {
    const text = `${"a".repeat(100_000)}\r\n${"int x;\n".repeat(401)}`;
    const chunks = [...sourceChunks(text)];
    expect(chunks.map((chunk) => chunk.content).join("")).toBe(text);
    expect(Math.max(...chunks.map((chunk) => chunk.content.length))).toBeLessThanOrEqual(32 * 1024 + 1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 1 });
    expect(chunks.at(-1)?.endLine).toBe(403);
    const unicode = `${"a".repeat(32 * 1024 - 1)}😀tail`;
    const unicodeChunks = [...sourceChunks(unicode)];
    expect(unicodeChunks.map((chunk) => Buffer.from(chunk.content).toString()).join("")).toBe(unicode);
  });
});
