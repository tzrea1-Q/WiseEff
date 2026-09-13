import { describe, expect, it } from "vitest";

import { parseReportArgs, renderRecordedReport, type RecordedReport } from "./report";

describe("recorded local verification report", () => {
  it("accepts only a strict UUID run selector", () => {
    expect(parseReportArgs(["--run", "00000000-0000-4000-8000-000000000000"])).toEqual({
      runId: "00000000-0000-4000-8000-000000000000",
    });
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
});
