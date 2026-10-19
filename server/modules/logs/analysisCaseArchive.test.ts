import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
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
