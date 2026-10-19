import JSZip from "jszip";
import { stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { resolveRouteBodyLimit } from "../../app";
import { exportSkillPackageArchive, importSkillPackageArchive } from "./skillPackageArchive";

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
    ["parsing.yaml", "schemaVersion: [\n", "invalid YAML"],
    ["SKILL.md", "No frontmatter", "frontmatter"],
    ["SKILL.md", "---\nname: Portable\nschemaVersion: skill/v1\ndefaultSourceSnapshotId: other-tenant\n---\n", "defaultSourceSnapshotId"],
    ["knowledge/entry.md", "---\ntitle: Entry\nsource:\n  type: unknown\n---\nBody", "source.type"],
    ["knowledge/entry.md", Buffer.from([0xff]), "UTF-8"],
    ["source/snapshot.zip", "content", "unsupported package file"]
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
      problems: ["cases/generic/broken/case.yaml: missing annotation"]
    });
  });

  it("rejects binary-only original cases before writes with the complete bundle metadata path", async () => {
    const zip = await JSZip.loadAsync(await archive());
    zip.file("cases/generic/binary/case.yaml", stringifyYaml({ domain: "generic", summary: "Binary-only fixture", realLog: false,
      rootCauseCategory: "software-fault", rootCausePoints: ["Crash"], keyEvidenceLines: [1], expectedActions: ["Inspect"], bundleFiles: ["fixtures/raw.bin"] }), { createFolders: false });
    zip.file("cases/generic/binary/log.txt", "ERROR crash", { createFolders: false });
    zip.file("cases/generic/binary/fixtures/raw.bin", Buffer.from([0, 1, 2, 3]), { createFolders: false });
    await expect(importSkillPackageArchive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({
      problems: ["cases/generic/binary/case.yaml:bundleFiles: no analyzable files"]
    });
  });

  it("bounds skill-package HTTP collection for all router slash aliases", () => {
    for (const path of ["/api/v1/log-skills/import", "//api//v1//log-skills//import/"]) {
      expect(resolveRouteBodyLimit({ method: "POST", path, contentType: "multipart/form-data" })).toBe(440 * 1024 * 1024 + 64 * 1024);
      expect(() => resolveRouteBodyLimit({ method: "POST", path, contentType: "application/json" })).toThrow("multipart/form-data");
    }
    expect(resolveRouteBodyLimit({ method: "GET", path: "/api/v1/log-skills/import" })).toBe(Infinity);
  });
});
