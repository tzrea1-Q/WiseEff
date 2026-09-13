import { chmodSync, linkSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertL1Results, assertRequiredResults, createL1Receipt, l1CommandIds, readPrivateReport, validateNativeReport } from "./ci-required-results";

const identity = {
  event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/828/merge",
  base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40),
  runId: "100", attempt: "1",
};
const docs = { docs_only: "true", run_l1: "false", run_quality: "false", run_smoke: "false", run_l2: "false" };
const docNeeds = {
  detect: { result: "success", outputs: docs },
  "build-and-test": { result: "success", outputs: { identity: JSON.stringify(identity) } },
  "acceptance-quality": { result: "skipped" }, "acceptance-smoke": { result: "skipped" },
  "acceptance-local-non-hdc": { result: "skipped" }, "target-synthetic-acceptance": { result: "skipped" },
  "minimal-upgrade": { result: "skipped" },
};

describe("strict CI required results", () => {
  it("accepts docs-only with a successful stable Build and test", () => {
    expect(() => assertRequiredResults({ identity, needs: docNeeds })).not.toThrow();
  });
  it("requires the always-running Build and test gate on docs-only changes", () => {
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, "build-and-test": { result: "skipped" } } })).toThrow();
  });
  it.each(["failure", "cancelled", "missing", ""])("rejects %s even for unselected jobs", (result) => {
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, "acceptance-smoke": { result } } })).toThrow();
  });
  it.each(["run_l1", "run_l2", "run_quality", "run_smoke", "docs_only"])("rejects unknown %s", (flag) => {
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, detect: { result: "success", outputs: { ...docs, [flag]: "unknown" } } } })).toThrow();
  });
  it.each(["push", "schedule"])("requires complete main L1, quality and L2 for %s", (event) => {
    const mainIdentity = { ...identity, event, ref: "refs/heads/main", base: "", head: "" };
    const needs = { ...docNeeds, "build-and-test": { result: "success", outputs: { identity: JSON.stringify(mainIdentity) } }, detect: { result: "success", outputs: { docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "false", run_l2: "true" } }, "acceptance-quality": { result: "success" }, "acceptance-local-non-hdc": { result: "success" } };
    expect(() => assertRequiredResults({ identity: mainIdentity, needs })).not.toThrow();
    expect(() => assertRequiredResults({ identity: mainIdentity, needs: { ...needs, "acceptance-local-non-hdc": { result: "skipped" } } })).toThrow();
  });
  it.each(["local-non-hdc", "target-non-hdc", "full-pilot", "minimal-upgrade"])("retains %s manual dispatch requirements", (mode) => {
    const local = mode === "local-non-hdc";
    const target = mode === "target-non-hdc" || mode === "full-pilot";
    const needs = { ...docNeeds, detect: { result: "success", outputs: { docs_only: "false", run_l1: "false", run_quality: String(local), run_smoke: "false", run_l2: String(local) } }, "acceptance-quality": { result: local ? "success" : "skipped" }, "acceptance-local-non-hdc": { result: local ? "success" : "skipped" }, "target-synthetic-acceptance": { result: target ? "success" : "skipped" }, "minimal-upgrade": { result: mode === "minimal-upgrade" ? "success" : "skipped" } };
    const dispatchIdentity = { ...identity, event: "workflow_dispatch", base: "", head: "", mode };
    needs["build-and-test"] = { result: "success", outputs: { identity: JSON.stringify(dispatchIdentity) } };
    expect(() => assertRequiredResults({ identity: dispatchIdentity, needs })).not.toThrow();
  });
  it("rejects unknown events, modes, failed detection and unmapped jobs", () => {
    for (const changed of [{ event: "merge_group" }, { mode: "custom" }]) expect(() => assertRequiredResults({ identity: { ...identity, ...changed }, needs: docNeeds })).toThrow();
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, detect: { result: "failure", outputs: docs } } })).toThrow();
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, "upgrade-components": { result: "skipped" } } })).toThrow();
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, detect: { result: "success", outputs: { ...docs, docs_only: "false", run_l1: "true" } } } })).toThrow();
  });
  it("rejects a green aggregate from another execution tree", () => {
    expect(() => assertRequiredResults({ identity: { ...identity, tree: "5".repeat(40) }, needs: docNeeds })).toThrow();
  });
  it("preserves full-acceptance even for docs-only PRs", () => {
    const labeled = { ...identity, fullAcceptance: true };
    const needs = { ...docNeeds, "build-and-test": { result: "success", outputs: { identity: JSON.stringify(labeled) } },
      detect: { result: "success", outputs: { ...docs, run_quality: "true", run_l2: "true" } },
      "acceptance-quality": { result: "success" }, "acceptance-local-non-hdc": { result: "success" } };
    expect(() => assertRequiredResults({ identity: labeled, needs })).not.toThrow();
  });
});

describe("L1 invocation receipts", () => {
  const report = (command: string) => ({ version: 1, command, identity, passed: 3, skipped: 0, files: 1, optionalSkips: {}, sha256: "a".repeat(64), filesSha256: "b".repeat(64) });
  const steps = (job: string) => Object.fromEntries(l1CommandIds[job].map((id) => [id, { outcome: "success", outputs: { report: JSON.stringify(report(id)) } }]));
  const receipts = () => Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "success", outputs: { receipt: JSON.stringify(createL1Receipt({ identity, job, steps: steps(job) })) } }]));
  const flags = { ...docs, docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "true" };
  it("requires every fixed command and report from the same run, attempt, SHA and tree", () => {
    const needs = { detect: { result: "success", outputs: flags }, ...receipts() };
    expect(() => assertL1Results({ identity, needs })).not.toThrow();
    for (const key of ["sha", "tree", "runId", "attempt", "head", "base"]) {
      const altered = { ...identity, [key]: ["runId", "attempt"].includes(key) ? "2" : "6".repeat(40) };
      expect(() => assertL1Results({ identity: altered, needs })).toThrow();
    }
    for (const result of ["skipped", "cancelled", "missing", "failure"]) expect(() => assertL1Results({ identity, needs: { ...needs, "l1-server": { result } } })).toThrow();
  });
  it("rejects a failed selected child even when its receipt is forged green", () => {
    const needs = { detect: { result: "success", outputs: flags }, ...receipts() };
    expect(() => assertL1Results({ identity, needs: { ...needs, "l1-server": { ...needs["l1-server"], result: "failure" } } })).toThrow();
  });
  it("does not turn a native report or digest into proof of a failed/missing command", () => {
    const selected = steps("l1-frontend");
    expect(() => createL1Receipt({ identity, job: "l1-frontend", steps: { ...selected, frontend: { ...selected.frontend, outcome: "failure" } } })).toThrow();
    expect(() => createL1Receipt({ identity, job: "l1-frontend", steps: { ...selected, frontend: { outcome: "success", outputs: {} } } })).toThrow();
    delete selected.install;
    expect(() => createL1Receipt({ identity, job: "l1-frontend", steps: selected })).toThrow();
  });
  it("keeps only DTS seed compile advisory", () => {
    const selected = steps("l1-scripts");
    selected.advisory.outcome = "failure";
    expect(() => createL1Receipt({ identity, job: "l1-scripts", steps: selected })).not.toThrow();
    selected.toolchain.outcome = "failure";
    expect(() => createL1Receipt({ identity, job: "l1-scripts", steps: selected })).toThrow();
  });
  it.each([
    ["l1-server", "ff4d3c7da48c45f7b33975d69db251e5"],
    ["l1-scripts", "24111a62073a40ca8fdefe3a90fe6230"],
  ] as const)("rejects Hosted toJSON(steps) extras and accepts the explicit %s projection", (job, generatedId) => {
    const hostedSteps = { ...steps(job), [generatedId]: { outcome: "success" } };
    expect(() => createL1Receipt({ identity, job, steps: hostedSteps })).toThrow();
    const projectedSteps = Object.fromEntries(l1CommandIds[job].map((id) => [id, hostedSteps[id]]));
    expect(() => createL1Receipt({ identity, job, steps: projectedSteps })).not.toThrow();
  });
  it("accepts the always-running docs-only aggregate without fake test receipts", () => {
    expect(() => assertL1Results({ identity, needs: { detect: docNeeds.detect, ...Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "skipped" }])) } })).not.toThrow();
  });
  it("reads only a fresh private regular report and rejects symlinks and missing reports", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "ci-report-test-"));
    try {
      const file = path.join(directory, "report.json");
      expect(() => readPrivateReport(file)).toThrow();
      writeFileSync(file, "{}");
      expect(readPrivateReport(file).toString()).toBe("{}");
      const link = path.join(directory, "link.json");
      symlinkSync(file, link);
      expect(() => readPrivateReport(link)).toThrow();
      const hardlink = path.join(directory, "hard.json");
      linkSync(file, hardlink);
      expect(() => readPrivateReport(file)).toThrow();
      rmSync(hardlink);
      chmodSync(directory, 0o755);
      expect(() => readPrivateReport(file)).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("native test report completeness", () => {
  // Shape observed from Vitest 4.1.5: nested describe counts as suites, not files.
  const options = { command: "frontend", root: "/repo", startedAt: 100, finishedAt: 400, platform: "linux", missingPathDts: false, missingRehearsalContainer: false };
  const passed = { ancestorTitles: ["outer", "inner"], title: "passes", status: "passed", failureMessages: [] };
  const native = () => ({ numTotalTestSuites: 3, numPassedTestSuites: 3, numFailedTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, startTime: 200, success: true,
    testResults: [{ name: "/repo/src/example.test.ts", status: "passed", message: "", assertionResults: [passed] }] });
  it("rejects an absent native report even if a command returned success", () => {
    expect(() => validateNativeReport(null, ["/repo/src/example.test.ts"], options)).toThrow();
  });
  it("reconciles assertion counts without equating nested suites to file count", () => {
    expect(validateNativeReport(native(), ["/repo/src/example.test.ts"], options)).toEqual({ passed: 1, skipped: 0, files: 1, optionalSkips: {} });
  });
  it.each(["numTotalTests", "numPassedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites"])("rejects inconsistent %s", (key) => {
    expect(() => validateNativeReport({ ...native(), [key]: 2 }, ["/repo/src/example.test.ts"], options)).toThrow();
  });
  it("rejects missing files, duplicate files, empty suites, stale reports and all-required-skipped", () => {
    for (const report of [
      { ...native(), testResults: [] }, { ...native(), testResults: [native().testResults[0], native().testResults[0]] },
      { ...native(), startTime: 99 },
      { ...native(), testResults: [{ ...native().testResults[0], assertionResults: [] }] },
      { ...native(), numPassedTests: 0, numPendingTests: 1, testResults: [{ ...native().testResults[0], assertionResults: [{ ...passed, status: "skipped" }] }] },
    ]) expect(() => validateNativeReport(report, ["/repo/src/example.test.ts"], options)).toThrow();
  });
  it("allows only the exact optional DTS suite when its current tool condition is absent", () => {
    const file = "/repo/scripts/vendorDtSchemaGenerator.test.ts";
    const assertion = { ...passed, ancestorTitles: ["vendor schema real dt-validate fixtures"], status: "skipped" };
    const report = { ...native(), numTotalTests: 2, numPendingTests: 1, testResults: [{ ...native().testResults[0], name: file, assertionResults: [passed, assertion] }] };
    const optional = { ...options, command: "scripts", missingPathDts: true };
    expect(validateNativeReport(report, [file], optional).optionalSkips).toEqual({ "missing-path-dts": 1 });
    expect(() => validateNativeReport(report, [file], { ...optional, missingPathDts: false })).toThrow();
    expect(() => validateNativeReport({ ...report, testResults: [{ ...report.testResults[0], assertionResults: [passed, { ...assertion, ancestorTitles: ["required"] }] }] }, [file], optional)).toThrow();
  });
});
