import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultGoldenCasesRoot, goldenCaseYamlSchema, loadGoldenLogCases } from "./goldenCases";

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
  it("loads a valid case with raw lines and identity", () => {
    const root = makeCaseDir({ yaml: validYaml, log: validLog });
    const result = loadGoldenLogCases(root);

    expect(result.problems).toEqual([]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({
      id: "charging-power/case-under-test",
      domain: "charging-power",
      realLog: false,
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

  it("loads the committed seed set cleanly (all synthetic, format coverage only)", () => {
    const result = loadGoldenLogCases(defaultGoldenCasesRoot());

    expect(result.problems).toEqual([]);
    expect(result.cases.length).toBeGreaterThanOrEqual(6);
    // Seed policy: only realLog:false format-coverage cases may be committed until
    // expert-annotated real cases arrive (external dependency, see README).
    expect(result.cases.every((goldenCase) => goldenCase.realLog === false)).toBe(true);
    expect(new Set(result.cases.map((goldenCase) => goldenCase.domain))).toEqual(
      new Set(["charging-power", "uncategorized"])
    );
    expect(result.cases.some((goldenCase) => goldenCase.expectRefusal)).toBe(true);
    expect(result.cases.some((goldenCase) => goldenCase.formatProfile)).toBe(true);
  });
});
