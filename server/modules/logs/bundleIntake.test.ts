import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bundleFileUtf8Bytes, decodeLogBundleFile, defaultBundleLimits, intakeLogBundle } from "./bundleIntake";
import { loadLogBundleLimits } from "../../config/env";

it("counts CRLF and converts UTF-16 across decoder chunks, bounding expanded UTF-8 before persistence", () => {
  const content = "界".repeat(32766) + "\r\nend";
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from(content, "utf16le")]);
  const file = decodeLogBundleFile("test.log", bytes);
  expect(file).toMatchObject({ encoding: "utf-16le", lineCount: 2, lossy: false, status: "analyzed" });
  expect(bundleFileUtf8Bytes(file).toString()).toBe(content);
  const result = intakeLogBundle({ fileName: "test.log", bytes }, { ...defaultBundleLimits, maxFileBytes: bytes.length, maxUnpackedBytes: bytes.length });
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("UTF-8") });
});

it("allows sample text extensions through the shared decoder without allowing binary input", () => {
  const text = Buffer.from('{"level":"error"}\n');
  expect(decodeLogBundleFile("sample.jsonl", text, false)).toMatchObject({ status: "analyzed", encoding: "utf-8", lineCount: 1 });
  expect(decodeLogBundleFile("sample.jsonl", text)).toMatchObject({ status: "skipped", skipReason: "不支持的文件扩展名" });
  expect(decodeLogBundleFile("sample.jsonl", Buffer.from([0, 1, 2]), false)).toMatchObject({ status: "skipped", skipReason: "二进制文件" });
});

function tar(entries: Array<{ name: string; content?: Buffer | string; type?: string; prefix?: string }>) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "INFO ok\n");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100); header.write("0000644\0", 100); header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.fill(32, 148, 156); header.write(entry.type ?? "0", 156); header.write("ustar\0", 257); header.write(entry.prefix ?? "", 345, 155);
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
async function zip(entries: Record<string, Buffer | string>, options: { compression?: "STORE" | "DEFLATE"; mode?: number } = {}) {
  const archive = new JSZip();
  for (const [name, data] of Object.entries(entries)) archive.file(name, data, { createFolders: false, unixPermissions: options.mode });
  return archive.generateAsync({ type: "nodebuffer", compression: options.compression ?? "STORE", platform: "UNIX" });
}
function intake(fileName: string, bytes: Buffer, limits = defaultBundleLimits) { return intakeLogBundle({ fileName, bytes }, limits); }
function reject(result: ReturnType<typeof intake>, rule: RegExp) { expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(rule) }); }

function zipDirectoryEntries(archive: Buffer) {
  const entries: Buffer[] = [];
  for (let at = archive.readUInt32LE(archive.length - 6); at < archive.length - 22;) {
    const end = at + 46 + archive.readUInt16LE(at + 28) + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    entries.push(archive.subarray(at, end)); at = end;
  }
  return entries;
}
function replaceZipDirectory(archive: Buffer, entries: Buffer[]) {
  const end = Buffer.from(archive.subarray(-22));
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(entries.reduce((sum, entry) => sum + entry.length, 0), 12);
  return Buffer.concat([archive.subarray(0, end.readUInt32LE(16)), ...entries, end]);
}

describe("log bundle intake", () => {
  it("rejects repeated central entries referencing the same compressed local header", async () => {
    const archive = await zip({ "empty.tar": Buffer.alloc(64 * 1024), "ok.log": "INFO ok" }, { compression: "DEFLATE" });
    const [container, log] = zipDirectoryEntries(archive);
    const repeated = replaceZipDirectory(archive, [...Array<Buffer>(10).fill(container), log]);
    reject(intake("repeat.zip", repeated, { ...defaultBundleLimits, maxUnpackedBytes: 64 * 1024 }), /本地头重复/);
  });
  it("rejects overlapping ZIP data ranges from distinct local headers", async () => {
    const inner = await zip({ "inner.log": "INFO inner" });
    const innerLocalBytes = inner.subarray(0, inner.readUInt32LE(inner.length - 6));
    const outer = await zip({ "outer.bin": innerLocalBytes });
    const innerDirectory = Buffer.from(zipDirectoryEntries(inner)[0]);
    const outerDataStart = 30 + outer.readUInt16LE(26) + outer.readUInt16LE(28);
    innerDirectory.writeUInt32LE(outerDataStart, 42);
    const overlapping = replaceZipDirectory(outer, [...zipDirectoryEntries(outer), innerDirectory]);
    reject(intake("overlap.zip", overlapping), /数据区间重叠/);
  });
  it("spends cumulative inflation budget on containers even when they yield no files", async () => {
    const archive = await zip({ "a.tar": Buffer.alloc(64 * 1024), "b.tar": Buffer.alloc(64 * 1024), "ok.log": "INFO ok" }, { compression: "DEFLATE" });
    reject(intake("containers.zip", archive, { ...defaultBundleLimits, maxUnpackedBytes: 100 * 1024 }), /解压大小/);
  });
  it("shares one remaining budget between gzip and raw-deflate nested containers", async () => {
    const text = Buffer.alloc(32 * 1024, 97);
    const inner = await zip({ "a.log": text }, { compression: "DEFLATE" });
    const archive = gzipSync(inner);
    reject(intake("nested.zip.gz", archive, { ...defaultBundleLimits, maxUnpackedBytes: text.length }), /解压大小/);
    expect(intake("nested.zip.gz", archive, { ...defaultBundleLimits, maxUnpackedBytes: text.length + inner.length })).toMatchObject({ ok: true });
  });
  it("counts directories and nested archive entries toward twice the file-count cap", async () => {
    const limits = { ...defaultBundleLimits, maxFiles: 1 };
    expect(intake("a.zip", await zip({ "one/": "", "a.log": "ok" }), limits)).toMatchObject({ ok: true });
    reject(intake("a.zip", await zip({ "one/": "", "two/": "", "a.log": "ok" }), limits), /条目数量/);
    reject(intake("a.tar", tar([{ name: "one", type: "5" }, { name: "two", type: "5" }, { name: "a.log" }]), limits), /条目数量/);
    reject(intake("nested.zip", await zip({ "inner.tar": tar([{ name: "one", type: "5" }, { name: "a.log" }]) }), limits), /条目数量/);
  });
  it("defaults to the stock-container 100 MiB envelope and preserves overrides", () => {
    expect(defaultBundleLimits).toEqual({ maxCompressedBytes: 100 * 1024 * 1024, maxUnpackedBytes: 100 * 1024 * 1024,
      maxFiles: 2000, maxFileBytes: 100 * 1024 * 1024 });
    expect(loadLogBundleLimits({})).toEqual(defaultBundleLimits);
  });
  it.each(["", "one", "one\n", "one\r\ntwo\rthree\n", "\r\n\n\r"])("counts lines without retaining decoded text: %j", (text) => {
    const bytes = Buffer.from(text);
    const result = intake("a.log", bytes);
    const lines = text.split(/\r\n|\n|\r/);
    if (lines.at(-1) === "") lines.pop();
    expect(result).toMatchObject({ ok: true, files: [{ lineCount: lines.length }] });
    if (result.ok) {
      expect(result.files[0]).not.toHaveProperty("text");
      expect(result.files[0].bytes).toBe(bytes);
    }
  });
  it("accepts plain, gzip, tar, tar.gz, tgz and multi-entry zip", async () => {
    const text = Buffer.from("INFO ok\n");
    const archive = tar([{ name: "dir/a.log" }, { name: "b.txt" }]);
    for (const [name, bytes, count] of [
      ["a.log", text, 1], ["a.log.gz", gzipSync(text), 1], ["a.tar", archive, 2],
      ["a.tar.gz", gzipSync(archive), 2], ["a.tgz", gzipSync(archive), 2],
      ["a.zip", await zip({ "dir/a.log": text, "b.txt": text }, { compression: "DEFLATE" }), 2]
    ] as const) {
      const result = intake(name, bytes);
      expect(result, name).toMatchObject({ ok: true });
      if (result.ok) { expect(result.files).toHaveLength(count); expect(result.files[0]).toMatchObject({ status: "analyzed", encoding: "utf-8", lossy: false }); }
    }
  });
  it("supports GNU long names, ustar prefixes and pax paths; skips directories", () => {
    const pax = "26 path=deep/pax-file.log\n";
    expect(Buffer.byteLength(pax)).toBe(26);
    const result = intake("a.tar", tar([
      { name: "folder", type: "5", content: "" }, { name: "a.log", prefix: "dir" },
      { name: "././@LongLink", type: "L", content: "long/file.log\0" }, { name: "short" },
      { name: "pax", type: "x", content: pax }, { name: "ignored" }
    ]));
    expect(result).toMatchObject({ ok: true, files: [{ path: "dir/a.log" }, { path: "long/file.log" }, { path: "deep/pax-file.log" }] });
  });
  it("recognizes a tar inner name from the gzip header and validates that name", () => {
    const compressed = gzipSync(tar([{ name: "a.log" }]));
    const named = (name: string) => Buffer.concat([compressed.subarray(0, 3), Buffer.from([8]), compressed.subarray(4, 10), Buffer.from(`${name}\0`), compressed.subarray(10)]);
    expect(intake("archive.gz", named("inside.tar"))).toMatchObject({ ok: true, files: [{ path: "a.log" }] });
    reject(intake("archive.gz", named("../inside.tar")), /路径/);
  });
  it("accepts one nested archive of every format and rejects two levels", async () => {
    for (const [name, bytes] of [["inner.tar", tar([{ name: "a.log" }])], ["inner.tgz", gzipSync(tar([{ name: "a.log" }]))],
      ["inner.log.gz", gzipSync(Buffer.from("INFO ok"))], ["inner.zip", await zip({ "a.log": "ok" })]] as const) {
      expect(intake("outer.zip", await zip({ [name]: bytes }))).toMatchObject({ ok: true });
    }
    reject(intake("outer.tar", tar([{ name: "middle.zip", content: await zip({ "inner.tar": tar([{ name: "a.log" }]) }) }])), /嵌套/);
  });
  it.each(["../bad.log", "a/../bad.log", "/bad.log", "C:/bad.log", "\\bad.log", "\\\\host\\bad.log"])("rejects unsafe path %s", async (name) => {
    reject(intake("a.tar", tar([{ name }])), /路径/);
    reject(intake("a.zip", await zip({ [name]: "ok" })), /路径/);
  });
  it.each(["1", "2", "3", "4", "6"])("rejects tar link/device/FIFO type %s", (type) => reject(intake("a.tar", tar([{ name: "bad.log", type }])), /条目类型/));
  it.each([0o120777, 0o020666, 0o060666, 0o010666])("rejects zip special mode %s", async (mode) => reject(intake("a.zip", await zip({ "a.log": "ok" }, { mode })), /条目类型/));
  it("rejects encrypted entries, corrupt archives and normalized duplicates", async () => {
    const encrypted = await zip({ "a.log": "ok" });
    encrypted.writeUInt16LE(1, encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    reject(intake("a.zip", encrypted), /加密/);
    reject(intake("a.zip", Buffer.from("bad")), /完整性/);
    reject(intake("a.gz", Buffer.from("bad")), /完整性/);
    reject(intake("a.tar", tar([{ name: "./a.log" }, { name: "a.log" }])), /重复/);
    reject(intake("a.zip", await zip({ "./a.log": "ok", "a.log": "ok" })), /重复/);
    reject(intakeLogBundle([{ fileName: "a.log", bytes: Buffer.from("ok") }, { fileName: "a.log", bytes: Buffer.from("ok") }]), /重复/);
  });
  it("rejects Unix hardlink metadata in a zip extra header", async () => {
    const original = await zip({ "a.log": "ok" });
    const central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const insertion = central + 46 + original.readUInt16LE(central + 28);
    const extra = Buffer.alloc(17); extra.writeUInt16LE(0x000d); extra.writeUInt16LE(13, 2); extra[16] = 97;
    const linked = Buffer.concat([original.subarray(0, insertion), extra, original.subarray(insertion)]);
    linked.writeUInt16LE(17, central + 30);
    const end = linked.length - 22;
    linked.writeUInt32LE(linked.readUInt32LE(end + 12) + 17, end + 12);
    reject(intake("link.zip", linked), /链接/);
  });
  it("hides internal failures for truncated zip directories and tar headers", async () => {
    const archive = await zip({ "a.log": "ok" });
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    // Keep a valid EOCD pointing at an incomplete central-directory header.
    const truncated = Buffer.concat([archive.subarray(0, central + 12), archive.subarray(-22)]);
    truncated.writeUInt32LE(12, truncated.length - 10);
    for (const [name, bytes] of [["a.zip", truncated], ["a.tar", tar([{ name: "a.log" }]).subarray(0, 200)],
      ["a.gz", Buffer.from("invalid gzip")]] as const) {
      expect(intake(name, bytes)).toEqual({ ok: false, reason: "压缩包完整性规则：压缩包损坏或格式不受支持" });
    }
  });
  it("bounds compressed, total, per-file, count, ratio and live inflated output", async () => {
    reject(intake("a.log", Buffer.alloc(12), { ...defaultBundleLimits, maxCompressedBytes: 10 }), /上传大小/);
    reject(intake("a.tar", tar([{ name: "a.log", content: "123456" }]), { ...defaultBundleLimits, maxFileBytes: 5 }), /单文件/);
    reject(intake("a.tar", tar([{ name: "a.log", content: "1234" }, { name: "b.log", content: "1234" }]), { ...defaultBundleLimits, maxUnpackedBytes: 7 }), /总大小/);
    reject(intake("a.tar", tar([{ name: "a.log" }, { name: "b.log" }]), { ...defaultBundleLimits, maxFiles: 1 }), /文件数量/);
    reject(intake("bomb.zip", await zip({ "a.log": Buffer.alloc(2 * 1024 * 1024, 97) }, { compression: "DEFLATE" })), /200 倍/);
    reject(intake("many.zip", await zip({ "a.log": Buffer.alloc(600_000, 97), "b.log": Buffer.alloc(600_000, 98) }, { compression: "DEFLATE" })), /200 倍/);
    reject(intake("a.log.gz", gzipSync(Buffer.from("123456789")), { ...defaultBundleLimits, maxFileBytes: 5 }), /解压大小/);
    expect(loadLogBundleLimits({ LOG_BUNDLE_MAX_FILES: "2", LOG_BUNDLE_MAX_FILE_BYTES: "5", LOG_BUNDLE_MAX_COMPRESSED_BYTES: "6", LOG_BUNDLE_MAX_UNPACKED_BYTES: "7" }))
      .toEqual({ maxFiles: 2, maxFileBytes: 5, maxCompressedBytes: 6, maxUnpackedBytes: 7 });
  });
  it("detects encodings, lossy decoding, binary and unsupported extensions", () => {
    const le = Buffer.concat([Buffer.from([255, 254]), Buffer.from("你好\n", "utf16le")]);
    const be = Buffer.from(le).swap16();
    for (const [bytes, encoding, lossy] of [[Buffer.from("你好"), "utf-8", false], [Buffer.from("\ufeff你好"), "utf-8", false],
      [le, "utf-16le", false], [be, "utf-16be", false], [Buffer.from([0xff, 0x61]), "utf-8", true]] as const) {
      expect(intake("a.log", bytes)).toMatchObject({ ok: true, files: [{ encoding, lossy, status: "analyzed" }] });
    }
    for (const bytes of [Buffer.from([97, 0]), Buffer.from([1, 2, 3, 4])]) expect(intake("a.log", bytes)).toMatchObject({ ok: true, files: [{ status: "skipped", skipReason: "二进制文件" }] });
    expect(intake("a.png", Buffer.from("text"))).toMatchObject({ ok: true, files: [{ status: "skipped", skipReason: "不支持的文件扩展名" }] });
    expect(intake("messages", Buffer.from("INFO ok"))).toMatchObject({ ok: true, files: [{ status: "analyzed" }] });
  });
});
