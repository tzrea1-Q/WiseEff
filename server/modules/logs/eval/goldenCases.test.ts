import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { defaultGoldenCasesRoot, goldenCaseYamlSchema, loadGoldenLogCases } from "./goldenCases";
import { buildEvalCaseDraft } from "../../../../src/domain/logs/evalCaseDraft";

const tempRoots: string[] = [];

function makeCaseDir(files: { yaml?: string; log?: string }, domain = "charging-power", caseId = "case-under-test") {
  const root = mkdtempSync(path.join(tmpdir(), "wiseeff-golden-"));
  tempRoots.push(root);
  const caseDir = path.join(root, domain, caseId);
  mkdirSync(caseDir, { recursive: true });
  if (files.yaml !== undefined) {
    writeFileSync(path.join(caseDir, "case.yaml"), files.yaml, "utf8");
  }
  if (files.log !== undefined) {
    writeFileSync(path.join(caseDir, "log.txt"), files.log, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const validYaml = [
  "domain: charging-power",
  "summary: Thermal foldback during fast charge.",
  "realLog: false",
  "rootCauseCategory: thermal-protection",
  "rootCausePoints:",
  "  - Foldback engaged above the thermal threshold.",
  "keyEvidenceLines: [2]",
  "expectedActions:",
  "  - Inspect the cooling path."
].join("\n");

const validLog = ["INFO session start", "ERROR thermal foldback engaged code=E_THERMAL_FOLDBACK", "INFO recovering"].join("\n");

const publicDataset = {
  tier: "realistic",
  provenance: "public-dataset",
  scenarioTags: ["public-labelled"],
  datasetSource: { name: "Example", version: "v1", url: "https://example.org/logs", license: "CC-BY-4.0", file: "device.log", lines: [4, 10] }
};

describe("goldenCaseYamlSchema", () => {
  it("requires deIdentified: true on real logs", () => {
    const result = goldenCaseYamlSchema.safeParse({
      domain: "charging-power",
      summary: "Real case",
      realLog: true,
      rootCauseCategory: "thermal-protection",
      rootCausePoints: ["x"],
      keyEvidenceLines: [1],
      expectedActions: ["y"]
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "deIdentified")).toBe(true);
    }
  });

  it("requires root cause, evidence, and actions on non-refusal cases", () => {
    const result = goldenCaseYamlSchema.safeParse({
      domain: "charging-power",
      summary: "Empty annotation",
      realLog: false,
      rootCauseCategory: "thermal-protection"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("rootCausePoints");
      expect(paths).toContain("keyEvidenceLines");
      expect(paths).toContain("expectedActions");
    }
  });

  it("allows refusal cases to omit root cause fields", () => {
    const result = goldenCaseYamlSchema.safeParse({
      domain: "uncategorized",
      summary: "Nominal log",
      realLog: false,
      rootCauseCategory: "no-fault",
      expectRefusal: true
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown root cause categories", () => {
    const result = goldenCaseYamlSchema.safeParse({
      domain: "charging-power",
      summary: "Bad category",
      realLog: false,
      rootCauseCategory: "cosmic-rays",
      rootCausePoints: ["x"],
      keyEvidenceLines: [1],
      expectedActions: ["y"]
    });
    expect(result.success).toBe(false);
  });
});

describe("loadGoldenLogCases", () => {
  it.each([
    ["illegal golden", { tier: "golden" }, "provenance"],
    ["illegal synthetic", { tier: "synthetic", provenance: "production" }, "provenance"],
    ["production marked non-real", { realLog: false, tier: "golden", provenance: "production" }, "realLog"],
    ["authored marked real", { realLog: true, tier: "realistic", provenance: "authored" }, "realLog"],
    ["realistic de-identification declaration", { ...publicDataset, deIdentified: false }, "deIdentified"],
    ["unknown scenario tag", { ...publicDataset, scenarioTags: ["made-up"] }, "scenarioTags.0"],
    ["missing checklist", { tier: "realistic", provenance: "authored" }, "realismChecklist"],
    ["explicit synthetic without checklist", { tier: "synthetic", provenance: "authored" }, "realismChecklist"],
    ["incomplete checklist", { tier: "realistic", provenance: "authored", realismChecklist: { lineFormat: "dmesg" } }, "realismChecklist.noiseRatio"],
    ["missing dataset source", { ...publicDataset, datasetSource: undefined }, "datasetSource"],
    ["missing license", { ...publicDataset, datasetSource: { ...publicDataset.datasetSource, license: " " } }, "datasetSource.license"]
  ])("rejects %s", (_name, metadata, field) => {
    const yaml = stringify({ domain: "charging-power", summary: "test", realLog: false,
      rootCauseCategory: "no-fault", expectRefusal: true, ...metadata });
    const result = loadGoldenLogCases(makeCaseDir({ yaml, log: validLog }));
    expect(result.cases).toEqual([]);
    expect(result.problems).toEqual(expect.arrayContaining([expect.stringContaining(`: ${field} —`)]));
  });

  it("loads public dataset metadata without a production attestation", () => {
    const root = makeCaseDir({ yaml: `${validYaml}\n${stringify(publicDataset)}`, log: validLog });
    const { cases, problems } = loadGoldenLogCases(root);
    expect(problems).toEqual([]);
    expect(cases[0]).toMatchObject(publicDataset);
  });

  it("loads the existing draft export as golden once de-identified and annotated", () => {
    const draft = buildEvalCaseDraft({
      id: "record", reportId: "report", fileName: "device.log", logDomainName: "charging-power",
      conclusion: "Thermal foldback reduced output.", suggestedActions: ["Check cooling."],
      rawLines: validLog.split("\n"), evidence: [{ lineNumbers: [2] }]
    });
    const unfinished = makeCaseDir({ yaml: draft.caseYaml, log: draft.logText });
    expect(loadGoldenLogCases(unfinished).cases).toEqual([]);
    const reviewed = makeCaseDir({ yaml: draft.caseYaml.replace("deIdentified: false\n", "deIdentified: true\n")
      .replace("rootCauseCategory: TODO\n", "rootCauseCategory: thermal-protection\n"), log: draft.logText });
    const result = loadGoldenLogCases(reviewed);
    expect(result.problems).toEqual([]);
    expect(result.cases[0]).toMatchObject({ realLog: true, tier: "golden", provenance: "production" });
  });

  it("loads a valid case with raw lines and identity", () => {
    const root = makeCaseDir({ yaml: validYaml, log: validLog });
    const result = loadGoldenLogCases(root);

    expect(result.problems).toEqual([]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({
      id: "charging-power/case-under-test",
      domain: "charging-power",
      realLog: false,
      tier: "synthetic",
      provenance: "authored",
      keyEvidenceLines: [2]
    });
    expect(result.cases[0].rawLines).toHaveLength(3);
  });

  it("collects problems for missing files, bad YAML, and mismatched domains", () => {
    const missingLog = makeCaseDir({ yaml: validYaml });
    expect(loadGoldenLogCases(missingLog).problems[0]).toContain("missing log.txt");

    const badYaml = makeCaseDir({ yaml: "domain: [unclosed", log: validLog });
    expect(loadGoldenLogCases(badYaml).problems[0]).toContain("not valid YAML");

    const wrongDomain = makeCaseDir({ yaml: validYaml.replace("charging-power", "uncategorized"), log: validLog });
    expect(loadGoldenLogCases(wrongDomain).problems[0]).toContain("does not match its directory");
  });

  it("rejects evidence lines that are missing or blank in the log", () => {
    const root = makeCaseDir({
      yaml: validYaml.replace("keyEvidenceLines: [2]", "keyEvidenceLines: [99]"),
      log: validLog
    });
    const result = loadGoldenLogCases(root);
    expect(result.problems[0]).toContain("keyEvidenceLines reference missing or blank lines");
  });

  it("rejects an invalid formatProfile", () => {
    const root = makeCaseDir({
      yaml: `${validYaml}\nformatProfile:\n  timestampPattern: '(['`,
      log: validLog
    });
    const result = loadGoldenLogCases(root);
    expect(result.problems[0]).toContain("formatProfile is invalid");
  });

  it("rejects a bundle whose projection would mislabel evidence", () => {
    const root = makeCaseDir({ yaml: `${validYaml}\nbundleFiles: [device.log]\n`, log: validLog });
    writeFileSync(path.join(root, "charging-power", "case-under-test", "device.log"), `INFO extra line\n${validLog}`);
    const result = loadGoldenLogCases(root);
    expect(result.cases).toEqual([]);
    expect(result.problems[0]).toContain("log.txt must match the flattened bundleFiles projection");
  });

  it("loads the six unmodified synthetic seeds and the three authored demonstrations", () => {
    const result = loadGoldenLogCases(defaultGoldenCasesRoot());

    expect(result.problems).toEqual([]);
    const seeds = result.cases.filter((item) => item.id.split("/")[1].startsWith("synthetic-"));
    expect(seeds.length).toBeGreaterThanOrEqual(6);
    expect(seeds.every((item) => !item.realLog && item.tier === "synthetic" && item.provenance === "authored")).toBe(true);
    expect(new Set(seeds.map((goldenCase) => goldenCase.domain))).toEqual(
      new Set(["charging-power", "uncategorized"])
    );
    expect(seeds.some((goldenCase) => goldenCase.expectRefusal)).toBe(true);
    expect(seeds.some((goldenCase) => goldenCase.formatProfile)).toBe(true);
    expect(result.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "charging-power/realistic-thermal-foldback-bundle", tier: "realistic", provenance: "authored" }),
      expect.objectContaining({ id: "linux-kernel/realistic-i2c-bus-recovery", tier: "realistic", provenance: "authored" }),
      expect.objectContaining({ id: "service-jsonl/realistic-healthy-queue", tier: "realistic", provenance: "authored", expectRefusal: true })
    ]));
  });
});
