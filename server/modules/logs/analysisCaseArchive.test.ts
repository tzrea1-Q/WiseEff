import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { stringify as stringifyYaml } from "yaml";
import { describe, expect, it, vi } from "vitest";
import {
  AnalysisCaseArchiveError, analysisCaseArchiveLimits, exportAnalysisCaseArchive, importAnalysisCaseArchive
} from "./analysisCaseArchive";
import { goldenCaseYamlSchema } from "./eval/goldenCases";

const annotation = {
  domain: "generic", summary: "A preserved original bundle", realLog: false,
  rootCauseCategory: "software-fault", rootCausePoints: ["A crash occurred"],
  keyEvidenceLines: [1], expectedActions: ["Inspect the crash"]
};
async function zip(entries: Record<string, Buffer | string>, compression: "STORE" | "DEFLATE" = "STORE") {
  const archive = new JSZip();
  for (const [name, data] of Object.entries(entries)) archive.file(name, data, { createFolders: false });
  return archive.generateAsync({ type: "nodebuffer", compression });
}

describe("analysis case archive", () => {
  it.each(["traversal", "duplicate", "directory-alias", "long-name", "local-name-length", "declared-total", "declared-file", "encrypted", "entry-zip64", "extra-fields",
    "unicode-traversal", "unicode-long", "unicode-alias"])("bounds %s metadata before JSZip parsing", async (attack) => {
    let bytes = await zip({ "generic/case/a.log": "12345678", "generic/case/b.log": "12345678" });
    const limits = { ...analysisCaseArchiveLimits };
    if (attack === "traversal") bytes = await zip({ "../escape.log": "ERROR" });
    if (attack === "directory-alias") bytes = await zip({ "generic/case/log.txt": "ERROR", "generic/case/log.txt/": "" });
    if (attack === "long-name") bytes = await zip({ ["generic/case/" + "a".repeat(1024)]: "ERROR" });
    if (attack.startsWith("unicode-")) {
      const name = attack === "unicode-traversal" ? "../中文.log" : attack === "unicode-long" ? "generic/case/" + "中".repeat(400) : "generic/case/中文.log";
      bytes = await new JSZip().file(name, "ERROR", { createFolders: false }).generateAsync({ type: "nodebuffer",
        encodeFileName: (value) => value ? "generic/case/safe.log" : "" });
    }
    const start = bytes.readUInt32LE(bytes.length - 6);
    if (attack === "duplicate") {
      const length = bytes.readUInt16LE(start + 28), second = start + 46 + length;
      const local = bytes.readUInt32LE(second + 42);
      bytes.copy(bytes, second + 46, start + 46, start + 46 + length);
      bytes.copy(bytes, local + 30, start + 46, start + 46 + length);
    }
    if (attack === "local-name-length") bytes.writeUInt16LE(0xffff, 26);
    if (attack === "declared-total") limits.maxUnpackedBytes = 15;
    if (attack === "declared-file") limits.maxFileBytes = 7;
    if (attack === "encrypted") { bytes.writeUInt16LE(1, start + 8); bytes.writeUInt16LE(1, 6); }
    if (attack === "entry-zip64") bytes.writeUInt32LE(0xffffffff, start + 24);
    if (attack === "extra-fields") {
      const extra = Buffer.alloc(34 * 4);
      for (let index = 0; index < 34; index++) extra.writeUInt16LE(0xa000 + index, index * 4);
      const insertion = start + 46 + bytes.readUInt16LE(start + 28), size = bytes.readUInt32LE(bytes.length - 10);
      bytes.writeUInt16LE(extra.length, start + 30);
      bytes = Buffer.concat([bytes.subarray(0, insertion), extra, bytes.subarray(insertion)]);
      bytes.writeUInt32LE(size + extra.length, bytes.length - 10);
    }
    const parse = vi.spyOn(JSZip, "loadAsync");
    try {
      await expect(importAnalysisCaseArchive(bytes, limits)).rejects.toBeInstanceOf(AnalysisCaseArchiveError);
      expect(parse.mock.calls.length).toBe(0);
    } finally { parse.mockRestore(); }
  });

  it.each([true, false])("preserves UTF-8 Chinese fixture names with the UTF-8 flag set to %s", async (utf8) => {
    const entries = { "generic/unicode/case.yaml": stringifyYaml({ ...annotation, bundleFiles: ["fixtures/设备.log"], keyEvidence: [{ file: "设备.log", line: 1 }] }),
      "generic/unicode/log.txt": "ERROR crash\n", "generic/unicode/fixtures/设备.log": "ERROR crash\r\n" };
    const bytes = await zip(entries);
    if (!utf8) {
      for (let at = bytes.readUInt32LE(bytes.length - 6); at < bytes.length - 22;) {
        bytes.writeUInt16LE(bytes.readUInt16LE(at + 8) & ~0x800, at + 8);
        const local = bytes.readUInt32LE(at + 42);
        bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) & ~0x800, local + 6);
        at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
      }
    }
    const [item] = await importAnalysisCaseArchive(bytes);
    expect(item.files.find((file) => file.path === "fixtures/设备.log")?.bytes.toString()).toBe(entries["generic/unicode/fixtures/设备.log"]);
  });

  it.each(["declared", "underreported", "directories", "file-limit"])("rejects %s excessive ZIP entries before JSZip parsing", async (count) => {
    const bytes = await zip(Object.fromEntries(Array.from({ length: count === "file-limit" ? 3 : 5 }, (_, index) => [
      count === "directories" ? `directory-${index}/` : `generic/case/file-${index}.log`, ""
    ])));
    if (count === "underreported" || count === "directories") {
      bytes.writeUInt16LE(1, bytes.length - 22 + 8);
      bytes.writeUInt16LE(1, bytes.length - 22 + 10);
    }
    const parse = vi.spyOn(JSZip, "loadAsync");
    try {
      await expect(importAnalysisCaseArchive(bytes, { ...analysisCaseArchiveLimits, maxFiles: 2 })).rejects.toBeInstanceOf(AnalysisCaseArchiveError);
      expect(parse.mock.calls.length).toBe(0);
    } finally { parse.mockRestore(); }
  });

  it.each(["missing-eocd", "ambiguous-eocd", "zip64", "directory-size", "entry-length", "entry-count"])("rejects %s ZIP directory metadata before JSZip parsing", async (corruption) => {
    let bytes = await zip({ "generic/case/log.txt": "ERROR crash" });
    const end = bytes.length - 22, start = bytes.readUInt32LE(end + 16);
    if (corruption === "missing-eocd") bytes = bytes.subarray(0, end);
    if (corruption === "ambiguous-eocd") { bytes.writeUInt16LE(4, end + 20); bytes = Buffer.concat([bytes, Buffer.from([0x50, 0x4b, 0x05, 0x06])]); }
    if (corruption === "zip64") bytes.writeUInt16LE(0xffff, end + 10);
    if (corruption === "directory-size") bytes.writeUInt32LE(1, end + 12);
    if (corruption === "entry-length") bytes.writeUInt16LE(0xffff, start + 28);
    if (corruption === "entry-count") { bytes.writeUInt16LE(2, end + 8); bytes.writeUInt16LE(2, end + 10); }
    const parse = vi.spyOn(JSZip, "loadAsync");
    try {
      await expect(importAnalysisCaseArchive(bytes)).rejects.toBeInstanceOf(AnalysisCaseArchiveError);
      expect(parse.mock.calls.length).toBe(0);
    } finally { parse.mockRestore(); }
  });

  it("round-trips every real repository annotation and fixture byte identically", async () => {
    const entries: Record<string, Buffer> = {};
    const root = join(process.cwd(), "eval-cases/logs");
    for (const domain of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      for (const item of readdirSync(join(root, domain.name), { withFileTypes: true }).filter((item) => item.isDirectory())) {
        for (const file of ["case.yaml", "log.txt"]) {
          entries[`${domain.name}/${item.name}/${file}`] = readFileSync(join(root, domain.name, item.name, file));
        }
      }
    }
    expect(Object.keys(entries).length).toBeGreaterThan(0);
    const imported = await importAnalysisCaseArchive(await zip(entries));
    const exported = await JSZip.loadAsync(await exportAnalysisCaseArchive(imported));
    expect(Object.keys(exported.files).sort()).toEqual(Object.keys(entries).sort());
    for (const [name, bytes] of Object.entries(entries)) expect(await exported.file(name)!.async("nodebuffer"), name).toEqual(bytes);
    expect(await importAnalysisCaseArchive(await exportAnalysisCaseArchive(imported))).toEqual(imported);
  });

  it("retains original archive and binary fixtures without expanding or decoding their bytes", async () => {
    const original = await zip({ "device/a.log": "ERROR crash\r\n", "device/b.bin": Buffer.from([0, 255, 129]) });
    const yaml = `# preserve this comment and CRLF\r\n${stringifyYaml({ ...annotation, bundleFiles: ["fixtures/original.zip"] }).replaceAll("\n", "\r\n")}`;
    const input = { "generic/original/case.yaml": Buffer.from(yaml), "generic/original/fixtures/original.zip": original,
      "generic/original/log.txt": Buffer.from("ERROR crash\n") };
    const cases = await importAnalysisCaseArchive(await zip(input));
    expect(cases[0].files).toContainEqual({ path: "fixtures/original.zip", bytes: original });
    const output = await JSZip.loadAsync(await exportAnalysisCaseArchive(cases));
    for (const [name, bytes] of Object.entries(input)) expect(await output.file(name)!.async("nodebuffer")).toEqual(bytes);
  });

  it("reports exact annotation field and fixture paths", async () => {
    const source = await zip({
      "generic/bad/case.yaml": stringifyYaml({ ...annotation, keyEvidenceLines: [2], keyEvidence: [{ file: "missing.log", line: 1 }] }),
      "generic/bad/log.txt": "ERROR crash\n"
    });
    await expect(importAnalysisCaseArchive(source)).rejects.toThrow("generic/bad/case.yaml:keyEvidenceLines.0: generic/bad/log.txt:2");
    await expect(importAnalysisCaseArchive(source)).rejects.toThrow("generic/bad/case.yaml:keyEvidence.0.file: missing fixture missing.log");
    await expect(importAnalysisCaseArchive(await zip({ "generic/bad/case.yaml": "summary: [unclosed" }))).rejects.toThrow("generic/bad/case.yaml: invalid YAML");
    await expect(importAnalysisCaseArchive(await zip({ "generic/bad/case.yaml": stringifyYaml(annotation) }))).rejects.toThrow("generic/bad/log.txt: missing fixture");
    const { realLog: _realLog, ...missingField } = annotation;
    await expect(importAnalysisCaseArchive(await zip({ "generic/bad/case.yaml": stringifyYaml(missingField), "generic/bad/log.txt": "ERROR crash" })))
      .rejects.toThrow("generic/bad/case.yaml:realLog: required golden-case field");
  });

  it("rejects traversal, links, compressed bombs and too many cases before storage", async () => {
    await expect(importAnalysisCaseArchive(await zip({ "../escape.log": "secret" }))).rejects.toThrow("../escape.log: unsafe archive path");
    const link = new JSZip().file("generic/link/log.txt", "outside", { unixPermissions: 0o120777, createFolders: false });
    await expect(importAnalysisCaseArchive(await link.generateAsync({ type: "nodebuffer", platform: "UNIX" }))).rejects.toBeInstanceOf(AnalysisCaseArchiveError);
    const bomb = await zip({ "generic/bomb/log.txt": "A".repeat(2 * 1024 * 1024) }, "DEFLATE");
    await expect(importAnalysisCaseArchive(bomb)).rejects.toBeInstanceOf(AnalysisCaseArchiveError);
    const valid = await zip({ "generic/valid/case.yaml": stringifyYaml(annotation), "generic/valid/log.txt": "ERROR crash" });
    await expect(importAnalysisCaseArchive(valid, { ...analysisCaseArchiveLimits, maxCases: 0 })).rejects.toThrow("case count exceeds 0");
    await expect(importAnalysisCaseArchive(valid, { ...analysisCaseArchiveLimits, maxCaseBytes: 1 })).rejects.toThrow("generic/valid: case bundle size");
    await expect(importAnalysisCaseArchive(valid, { ...analysisCaseArchiveLimits, maxCompressedBytes: 1 })).rejects.toThrow("compressed size limit");
  });

  it("exports newly authored annotations in the golden vocabulary and rejects invalid evidence patterns", async () => {
    const cases = await importAnalysisCaseArchive(await exportAnalysisCaseArchive([{
      archivePath: "generic/new-case", annotation: goldenCaseYamlSchema.parse(annotation), files: [{ path: "log.txt", bytes: Buffer.from("ERROR crash") }]
    }]));
    expect(cases[0].annotation.rootCausePoints).toEqual(["A crash occurred"]);
    await expect(importAnalysisCaseArchive(await zip({
      "generic/bad/case.yaml": stringifyYaml({ ...annotation, keyEvidence: [{ file: "log.txt", pattern: "(" }] }), "generic/bad/log.txt": "ERROR crash"
    }))).rejects.toThrow("generic/bad/case.yaml:keyEvidence.0.pattern");
  });

  it("adds a runnable log.txt projection and maps file-aware evidence for a newly saved bundle", async () => {
    const original = await zip({ "device/a.log": "INFO boot\r\n", "device/b.log": "ERROR crash\r\n" });
    const exported = await exportAnalysisCaseArchive([{
      archivePath: "generic/bundle", annotation: { ...goldenCaseYamlSchema.parse(annotation),
        bundleFiles: ["fixtures/original.zip"], keyEvidence: [{ file: "device/b.log", line: 1 }] },
      files: [{ path: "fixtures/original.zip", bytes: original }]
    }]);
    const [imported] = await importAnalysisCaseArchive(exported);
    expect(imported.annotation.keyEvidenceLines).toEqual([2]);
    expect(imported.files.find((file) => file.path === "log.txt")?.bytes.toString()).toBe("INFO boot\nERROR crash");
    expect(imported.files.find((file) => file.path === "fixtures/original.zip")?.bytes).toEqual(original);
    expect(goldenCaseYamlSchema.safeParse(imported.annotation).success).toBe(true);
  });

  it("bounds original bundle bytes separately from YAML and the duplicated eval projection", async () => {
    const original = Buffer.from("INFO heartbeat\n".repeat(400_000));
    expect(original.length).toBeGreaterThan(analysisCaseArchiveLimits.maxCaseBytes / 2);
    const archive = await exportAnalysisCaseArchive([{
      archivePath: "generic/large-original", annotation: { ...goldenCaseYamlSchema.parse(annotation), bundleFiles: ["fixtures/device.log"] },
      files: [{ path: "fixtures/device.log", bytes: original }]
    }]);
    const [item] = await importAnalysisCaseArchive(archive);
    expect(item.files.find((file) => file.path === "fixtures/device.log")?.bytes.equals(original)).toBe(true);
    expect(item.files.reduce((size, file) => size + file.bytes.length, 0)).toBeGreaterThan(analysisCaseArchiveLimits.maxCaseBytes);
    await expect(importAnalysisCaseArchive(archive, { ...analysisCaseArchiveLimits, maxCaseBytes: original.length - 1 }))
      .rejects.toThrow("generic/large-original: case bundle size exceeds");
  });

  it("sizes the archive envelope for the full bounded corpus, including eval projections", async () => {
    const limits = { ...analysisCaseArchiveLimits, maxCaseBytes: 10_000, maxMetadataBytes: 2_000,
      maxCompressedBytes: 440_000, maxUnpackedBytes: 440_000, maxFileBytes: 10_000 };
    const cases = Array.from({ length: 6 }, (_, index) => ({
      archivePath: `generic/case-${index}`, annotation: { ...goldenCaseYamlSchema.parse(annotation), bundleFiles: ["fixtures/device.log"] },
      files: [{ path: "fixtures/device.log", bytes: Buffer.from("INFO heartbeat\n".repeat(400)) }]
    }));
    const archive = await exportAnalysisCaseArchive(cases, limits);
    expect(archive.length).toBeGreaterThan(50_000);
    expect(await importAnalysisCaseArchive(archive, limits)).toHaveLength(cases.length);
    await expect(importAnalysisCaseArchive(archive, { ...limits, maxMetadataBytes: 1 })).rejects.toThrow("case.yaml: annotation size exceeds");
  });

  it("remaps edited file-aware expectations when the canonical log.txt already exists", async () => {
    const [original] = await importAnalysisCaseArchive(await zip({
      "generic/edited/case.yaml": stringifyYaml(annotation), "generic/edited/log.txt": "INFO boot\nERROR crash\n"
    }));
    const [edited] = await importAnalysisCaseArchive(await exportAnalysisCaseArchive([{
      ...original, sourceYaml: undefined, annotation: { ...original.annotation, bundleFiles: ["log.txt"],
        keyEvidenceLines: [], keyEvidence: [{ file: "log.txt", line: 2 }] }
    }]));
    expect(edited.annotation.keyEvidenceLines).toEqual([2]);
    expect(goldenCaseYamlSchema.safeParse(edited.annotation).success).toBe(true);
    expect(edited.files[0].bytes).toEqual(original.files[0].bytes);
  });

  it("rejects ungrounded evidence patterns and missing numeric eval projections on import", async () => {
    const files = { "generic/pattern/case.yaml": stringifyYaml({ ...annotation, keyEvidence: [{ file: "log.txt", pattern: "not present" }] }),
      "generic/pattern/log.txt": "INFO boot\nERROR crash\n" };
    await expect(importAnalysisCaseArchive(await zip(files))).rejects.toThrow("generic/pattern/case.yaml:keyEvidence.0.pattern: pattern matches no non-blank original log line");
    await expect(importAnalysisCaseArchive(await zip({ ...files, "generic/pattern/case.yaml": stringifyYaml({ ...annotation,
      keyEvidenceLines: [], keyEvidence: [{ file: "log.txt", pattern: "crash" }] }) }))).rejects.toThrow("generic/pattern/case.yaml:keyEvidenceLines");
    await expect(importAnalysisCaseArchive(await zip({ "generic/pattern/case.yaml": stringifyYaml({ ...annotation, bundleFiles: ["device.log"] }),
      "generic/pattern/device.log": "ERROR crash" }))).rejects.toThrow("generic/pattern/log.txt: missing canonical eval projection");
    const source = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ERROR crash\r\n", "utf16le")]);
    const [imported] = await importAnalysisCaseArchive(await zip({
      "generic/utf16/case.yaml": stringifyYaml({ ...annotation, bundleFiles: ["fixtures/device.log"], keyEvidence: [{ file: "device.log", pattern: "crash" }] }),
      "generic/utf16/fixtures/device.log": source, "generic/utf16/log.txt": "ERROR crash\n"
    }));
    expect(imported.files.find((file) => file.path === "fixtures/device.log")?.bytes).toEqual(source);
    const [wildcard] = await importAnalysisCaseArchive(await exportAnalysisCaseArchive([{
      archivePath: "generic/wildcard", annotation: { ...goldenCaseYamlSchema.parse(annotation), bundleFiles: ["fixtures/device.log"],
        keyEvidence: [{ file: "device.log", pattern: ".*" }] }, files: [{ path: "fixtures/device.log", bytes: Buffer.from("INFO boot\n\nERROR crash\n") }]
    }]));
    expect(wildcard.annotation.keyEvidenceLines).toEqual([1, 3]);
  });
});
