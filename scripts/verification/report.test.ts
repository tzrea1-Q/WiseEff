import { describe, expect, it } from "vitest";

import { implementationRoot, SOURCE_PATHS, taskSpec } from "./run";
import { parseReportArgs, parseRunRecord, renderRecordedReport, type RecordedReport } from "./report";

const RUN_ID = "00000000-0000-4000-8000-000000000000";

function validRecord(discovery: Record<string, unknown> = phase()): Record<string, unknown> {
  const spec = taskSpec("ci-changed-paths");
  const files = spec.files.map((file) => `${implementationRoot}/${file}`);
  const argv = ["/repo/vitest.mjs", "list", "--filesOnly", "--json"];
  return {
    schemaVersion: 1,
    complete: true,
    scope: "fresh-local-feedback",
    runId: RUN_ID,
    root: implementationRoot,
    taskId: "ci-changed-paths",
    acceptedBase: "a".repeat(40),
    head: "b".repeat(40),
    tree: "c".repeat(40),
    executedSha: "d".repeat(40),
    headTree: "e".repeat(40),
    sourceDigest: "f".repeat(64),
    sourceFiles: SOURCE_PATHS.map((path) => ({ path, bytes: 1, sha256: "0".repeat(64) })),
    policyDigest: "1".repeat(64),
    nodeVersion: "v22.0.0",
    dependencies: { packageVersion: "0.1.0", vitestVersion: "4.1.5", packageJsonSha256: "2".repeat(64), vitestPackageSha256: "3".repeat(64), vitestEntrySha256: "4".repeat(64) },
    childEnvRuntimeMode: "mock",
    testConfigRuntimeMode: null,
    discoveryArgv: argv,
    runArgv: [...argv, "run"],
    discovery,
    execution: phase(),
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    wallMs: 1,
    activityBudgetMs: 1,
    exitCode: 0,
    signal: null,
    native: { discoveredFiles: files, files: 1, passed: 1, skipped: 0, reportSha256: "5".repeat(64) },
    logs: { stdoutSha256: "6".repeat(64), stderrSha256: "7".repeat(64), stdoutBytes: 0, stderrBytes: 0 },
    claimedStatus: "passed",
    error: null,
    memo: "disabled",
    acceptancePending: true,
    tokenUsage: null,
  };
}

function phase(): Record<string, unknown> {
  return { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null, stdoutBytes: 0, stderrBytes: 0, lifecycleSettled: true };
}

describe("recorded local verification report", () => {
  it("accepts only a strict UUID run selector", () => {
    expect(parseReportArgs(["--run", "00000000-0000-4000-8000-000000000000"])).toEqual({
      runId: "00000000-0000-4000-8000-000000000000",
    });
    expect(() => parseReportArgs(["--run", RUN_ID, "--run", RUN_ID])).toThrow("DUPLICATE_ARGUMENT");
    expect(() => parseReportArgs(["--run", "../record.json"])).toThrow("INVALID_ARGUMENTS");
    expect(() => parseReportArgs(["--run", "00000000-0000-4000-8000-000000000000", "--fresh"])).toThrow("INVALID_ARGUMENTS");
  });

  it("labels a readable record as unverified data", () => {
    const report: RecordedReport = {
      version: 1,
      status: "record-readable",
      scope: "recorded-local-data",
      freshness: "unverified",
      acceptancePending: true,
      memo: "disabled",
      tokenUsage: null,
      runId: "00000000-0000-4000-8000-000000000000",
      taskId: "ci-changed-paths",
      claimedStatus: "passed",
      sourceSha: "a".repeat(40),
      tree: "b".repeat(40),
      sourceDigest: "c".repeat(64),
      native: { files: 1, passed: 8, skipped: 0 },
      observed: { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null },
    };
    const output = JSON.parse(renderRecordedReport(report));
    expect(output.status).toBe("record-readable");
    expect(output.scope).toBe("recorded-local-data");
    expect(output.freshness).toBe("unverified");
    expect(output.claimedStatus).toBe("passed");
  });

  it("validates nested phase fields instead of trusting their shape", () => {
    const malformed = validRecord({ ...phase(), extra: "forged" });
    expect(() => parseRunRecord(malformed, RUN_ID)).toThrow("RECORD_SCHEMA");
  });

  it("keeps a self-consistent green claim visibly unverified", () => {
    const output = JSON.parse(renderRecordedReport({
      version: 1,
      status: "record-readable",
      scope: "recorded-local-data",
      freshness: "unverified",
      acceptancePending: true,
      memo: "disabled",
      tokenUsage: null,
      runId: RUN_ID,
      taskId: "ci-changed-paths",
      claimedStatus: "passed",
      sourceSha: "a".repeat(40),
      tree: "b".repeat(40),
      sourceDigest: "c".repeat(64),
      native: { files: 1, passed: 1, skipped: 0 },
      observed: { startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), wallMs: 1, exitCode: 0, signal: null },
    }));
    expect(output.claimedStatus).toBe("passed");
    expect(output.status).toBe("record-readable");
    expect(output.freshness).toBe("unverified");
  });
});
