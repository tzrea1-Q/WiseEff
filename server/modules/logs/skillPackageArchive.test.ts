import JSZip from "jszip";
import { stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { resolveRouteBodyLimit } from "../../app";
import { exportSkillPackageArchive, importSkillPackageArchive } from "./skillPackageArchive";
import { archiveYamlLimits, parseArchiveYaml } from "./analysisCaseArchive";
import { logSkillTemplates } from "./skillTemplates";
import { seededChargingRuleSet } from "./chargingSignalRules";
import type { LogSkillSpec } from "./skillSpec";

const basic = { schemaVersion: "skill/v1" as const, description: "Portable diagnostic", procedure: "Check the evidence." };
const archive = () => exportSkillPackageArchive("Portable skill", "portable-skill", basic, [], new Map());
describe("skill package format", () => {
  it("round-trips optional constructs, excludes tenant bindings and emits stable sorted files", async () => {
    const bytes = await exportSkillPackageArchive("Portable skill", "portable-skill", { ...basic,
      defaultSourceSnapshotId: "tenant-snapshot", knowledgeEntryIds: ["00000000-0000-4000-8000-000000000001"] }, [], new Map());
    expect(bytes).toEqual(await archive());
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(["README.md", "SKILL.md", "parsing.yaml", "signals.yaml", "tests.yaml"]);
    expect(await zip.file("README.md")!.async("string")).toContain("Upload source snapshots separately");
    expect(await importSkillPackageArchive(bytes)).toEqual({ name: "Portable skill", skillKey: "portable-skill", spec: { ...basic, parseTests: [] }, knowledge: [], cases: [] });
  });

  it.each([
    ["parsing.yaml", "schemaVersion: invalid\n", "schemaVersion"],
    ["signals.yaml", "schemaVersion: signals/v1\nrules: [invalid]\n", "rules[0]"],
    ["tests.yaml", "- id: invalid\n", "[0].name"],
    ["parsing.yaml", "schemaVersion: [\n", "YAML 语法无效"],
    ["SKILL.md", "No frontmatter", "frontmatter"],
    ["SKILL.md", "---\nname: Portable\nschemaVersion: skill/v1\ndefaultSourceSnapshotId: other-tenant\n---\n", "defaultSourceSnapshotId"],
    ["knowledge/entry.md", "---\ntitle: Entry\nsource:\n  type: unknown\n---\nBody", "source.type"],
    ["knowledge/entry.md", Buffer.from([0xff]), "UTF-8"],
    ["source/snapshot.zip", "content", "不支持的技能包文件"]
  ])("validates %s with the exact package path", async (path, content, problem) => {
    const zip = await JSZip.loadAsync(await archive());
    zip.file(path, content, { createFolders: false });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({
      problems: expect.arrayContaining([expect.stringContaining(`${path}: `)])
    });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(problem);
  });

  it("retains the cases prefix in annotation errors", async () => {
    const zip = await JSZip.loadAsync(await archive());
    zip.file("cases/generic/broken/log.txt", "ERROR crash", { createFolders: false });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({
      problems: ["cases/generic/broken/case.yaml: 缺少用例说明文件"]
    });
    zip.file("cases/generic/broken/case.yaml", "summary: [unclosed", { createFolders: false });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({
      issues: [{ path: "cases/generic/broken/case.yaml", message: expect.stringContaining("YAML 语法无效") }]
    });
  });

  it("rejects binary-only original cases before writes with the complete bundle metadata path", async () => {
    const zip = await JSZip.loadAsync(await archive());
    zip.file("cases/generic/binary/case.yaml", stringifyYaml({ domain: "generic", summary: "Binary-only fixture", realLog: false,
      rootCauseCategory: "software-fault", rootCausePoints: ["Crash"], keyEvidenceLines: [1], expectedActions: ["Inspect"], bundleFiles: ["fixtures/raw.bin"] }), { createFolders: false });
    zip.file("cases/generic/binary/log.txt", "ERROR crash", { createFolders: false });
    zip.file("cases/generic/binary/fixtures/raw.bin", Buffer.from([0, 1, 2, 3]), { createFolders: false });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({
      issues: [{ path: "cases/generic/binary/case.yaml › bundleFiles", message: "没有可分析的日志文件" }]
    });
  });

  it.each(["parsing.yaml", "SKILL.md", "knowledge/entry.md", "cases/generic/wide/case.yaml"])("rejects 50000 keys quickly in %s with an exact path", async (file) => {
    const zip = await JSZip.loadAsync(await archive());
    const source = Array.from({ length: 50_000 }, (_, index) => `k${index}: x`).join("\n");
    zip.file(file, file.endsWith(".md") ? `---\n${source}\n---\nBody` : source, { createFolders: false });
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const started = performance.now();
    await expect(importSkillPackageArchive(bytes)).rejects.toMatchObject({ issues: expect.arrayContaining([
      { path: file, message: expect.stringContaining("YAML 文档行数超过 20000 行上限") }
    ]) });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("bounds document bytes, flow and block structures, aliases and duplicate keys before conversion", () => {
    for (const [source, message] of [
      [`value: ${"x".repeat(archiveYamlLimits.maxBytes)}`, "1 MiB"],
      [`[${Array.from({ length: 50_000 }, () => "x").join(",")}]`, "20000 项"],
      [`{${Array.from({ length: 50_000 }, (_, index) => `k${index}`).join(",")}}`, "20000 项"],
      ["[".repeat(40) + "0" + "]".repeat(40), "32 层"],
      [Array.from({ length: 40 }, (_, depth) => `${" ".repeat(depth)}key:`).join("\n"), "32 层"],
      ["- ".repeat(40) + "0", "32 层"],
      ["first: &value 1\nsecond: *value", "别名"],
      ["key: 1\nkey: 2", "映射键重复"],
      ["nested: {key: 1, key: 2}", "映射键重复"],
      ["1: first\n'1': second", "映射键重复"],
      ["? [complex, key]\n: value", "映射键必须是标量"]
    ]) expect(() => parseArchiveYaml(source)).toThrow(message);
    expect(parseArchiveYaml("text: |\n  literal: [*not-an-alias]\nquoted: ': [] *value'\nempty: []"))
      .toEqual({ text: "literal: [*not-an-alias]\n", quoted: ": [] *value", empty: [] });
  });

  it("collects independent missing, schema and knowledge issues, bounded to 50", async () => {
    const zip = await JSZip.loadAsync(await archive());
    zip.remove("SKILL.md");
    zip.file("signals.yaml", "rules: [invalid]", { createFolders: false });
    zip.file("tests.yaml", "- id: invalid", { createFolders: false });
    zip.file("knowledge/entry.md", "no frontmatter", { createFolders: false });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({
      issues: expect.arrayContaining([
        { path: "SKILL.md", message: "缺少必需文件" },
        { path: "signals.yaml › rules[0]", message: "字段类型无效（预期 object，实际 string）" },
        { path: "tests.yaml › [0].name", message: "缺少必需字段（预期 string，实际 undefined）" },
        { path: "knowledge/entry.md", message: "缺少 YAML 前置信息（frontmatter）" }
      ])
    });
    for (let index = 0; index < 100; index++) zip.file(`unsupported-${index}.txt`, "invalid", { createFolders: false });
    try { await importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" })); expect.fail("Expected package rejection"); }
    catch (error) { expect((error as { issues: unknown[] }).issues).toHaveLength(archiveYamlLimits.maxIssues); }
  });

  it("imports the seeded skill, every template and a large realistic skill with 200 extractors and 4096 map entries", async () => {
    const large: LogSkillSpec = { ...basic, signalRules: seededChargingRuleSet, parsing: { schemaVersion: "parsing/v1",
      registers: Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`REG${index}`, { width: 64 as const,
        fields: Array.from({ length: 16 }, (_, bit) => ({ name: `flag${bit}`, bits: [bit, bit] as [number, number], enum: { "0": "normal", "1": "fault" } })) }])),
      registerMaps: { devices: { selectBy: "addr", cases: Object.fromEntries(Array.from({ length: 4096 }, (_, index) => [String(index), `REG${index % 32}`])) } },
      extractors: Array.from({ length: 200 }, (_, index) => ({ id: `device${index}`, pattern: "addr=(?P<addr>\\d+) value=(?P<value>0x[0-9a-f]+)",
        fields: { addr: { type: "uint" as const }, value: { type: "hex" as const, decode: { registerMap: "devices" } } } }))
    } };
    expect(Buffer.byteLength(stringifyYaml(large.parsing))).toBeGreaterThan(100_000);
    for (const spec of [{ schemaVersion: "skill/v1" as const, signalRules: seededChargingRuleSet }, ...logSkillTemplates.map((template) => template.spec), large]) {
      const bytes = await exportSkillPackageArchive("Large skill", "large-skill", spec, [], new Map());
      expect((await importSkillPackageArchive(bytes)).spec).toMatchObject(spec);
    }
  });

  it("bounds skill-package HTTP collection for all router slash aliases", () => {
    for (const path of ["/api/v1/log-skills/import", "//api//v1//log-skills//import/"]) {
      expect(resolveRouteBodyLimit({ method: "POST", path, contentType: "multipart/form-data" })).toBe(440 * 1024 * 1024 + 64 * 1024);
      expect(() => resolveRouteBodyLimit({ method: "POST", path, contentType: "application/json" })).toThrow("multipart/form-data");
    }
    expect(resolveRouteBodyLimit({ method: "GET", path: "/api/v1/log-skills/import" })).toBe(Infinity);
  });
});
