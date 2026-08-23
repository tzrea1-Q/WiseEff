import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateOperationEvidence,
  parseOperationEvidenceCheckArgs,
  readOperationEvidenceRecords,
  renderOperationEvidenceMarkdown,
  runFocusedOperationEvidenceCheck,
  writeOperationEvidenceIndex,
  type OperationEvidenceRecord
} from "./check-operation-evidence";
import {
  operationEvidenceFileName,
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "../e2e/acceptance/helpers/operationEvidence";
import {
  prepareEvidenceRun,
  publishLatestFullEvidenceRun,
  readLatestFullEvidenceRun,
  resolveEvidenceRunContext
} from "../e2e/acceptance/helpers/evidenceRun";

describe("operation evidence helper", () => {
  it("builds stable evidence file names from operation id and title", () => {
    expect(operationEvidenceFileName("PARAM-DRAFT-EDIT-001", "edits draft before submit")).toBe(
      "PARAM-DRAFT-EDIT-001-edits-draft-before-submit.json"
    );
  });

  it("redacts token and key values from evidence notes", async () => {
    const fileName = operationEvidenceFileName("PARAM-DRAFT-EDIT-002", "redacts sensitive notes");
    const filePath = join("test-results/acceptance-operation-evidence", fileName);

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-DRAFT-EDIT-002",
        title: "redacts sensitive notes",
        status: "passed",
        notes: "token=abc123 key secret456"
      });

      const content = readFileSync(result.path, "utf8");
      expect(content).toContain("token=[redacted]");
      expect(content).toContain("key [redacted]");
      expect(content).not.toContain("abc123");
      expect(content).not.toContain("secret456");
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("records role, route, and assertions from the operation matrix", async () => {
    const fileName = operationEvidenceFileName("PARAM-HAPPY-001", "records operation metadata");
    const filePath = join("test-results/acceptance-operation-evidence", fileName);

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-HAPPY-001",
        title: "records operation metadata",
        status: "passed"
      });

      expect(result.record).toMatchObject({
        operationId: "PARAM-HAPPY-001",
        role: "Hardware User, Hardware Committer, Software Committer, Software User, Admin",
        route: "/parameters",
        assertions: ["ui", "api", "db", "audit"]
      });
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("summarizes API responses with request IDs and redacted response text", () => {
    const summary = summarizeApiResponse(
      {
        status: () => 201,
        headers: () => ({
          "x-request-id": "req-123"
        })
      },
      {
        method: "POST",
        path: "/api/v1/example",
        responseSummary: "authorization Bearer abc.def token=secret"
      }
    );

    expect(summary).toEqual({
      method: "POST",
      path: "/api/v1/example",
      status: 201,
      requestId: "req-123",
      responseSummary: "authorization [redacted] token=[redacted]"
    });
  });

  it("writes an attached JSON artifact from observed operation data", async () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-artifact-"));
    const attach = vi.fn();
    const testInfo = {
      outputPath: (name: string) => join(root, name),
      attach
    };

    try {
      const artifactPath = await writeOperationJsonArtifact(
        testInfo as never,
        "observed-response.json",
        { status: 200, result: "allowed" }
      );

      expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toEqual({ status: 200, result: "allowed" });
      expect(attach).toHaveBeenCalledWith("operation-json-evidence", {
        path: artifactPath,
        contentType: "application/json"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps JSON artifacts outside Playwright's disposable output directory", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "wiseeff-playwright-output-"));
    const evidenceRoot = mkdtempSync(join(tmpdir(), "wiseeff-evidence-runs-"));
    const attach = vi.fn();
    const testInfo = {
      file: "/repo/e2e/acceptance/focused.acceptance.spec.ts",
      titlePath: ["focused suite", "focused operation"],
      outputPath: (name: string) => join(outputRoot, name),
      attach
    };
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_ROOT", evidenceRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID", "full-run-123");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT", "abc123");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND", "full");

    try {
      const artifactPath = await writeOperationJsonArtifact(
        testInfo as never,
        "observed-response.json",
        { status: 200 }
      );

      expect(artifactPath).toContain(join(evidenceRoot, "runs", "abc123", "full-run-123", "artifacts"));
      rmSync(outputRoot, { recursive: true, force: true });
      expect(existsSync(artifactPath)).toBe(true);
      expect(attach).toHaveBeenCalledWith("operation-json-evidence", {
        path: artifactPath,
        contentType: "application/json"
      });
    } finally {
      vi.unstubAllEnvs();
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it("records run and source commit identity in the same immutable namespace", async () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), "wiseeff-evidence-runs-"));
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_ROOT", evidenceRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID", "full-run-456");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT", "def456");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND", "full");

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-HAPPY-001",
        title: "namespaced record",
        status: "passed"
      });

      expect(result.path).toContain(join(evidenceRoot, "runs", "def456", "full-run-456", "records"));
      expect(result.record).toMatchObject({
        runId: "full-run-456",
        sourceCommit: "def456",
        runKind: "full"
      });
    } finally {
      vi.unstubAllEnvs();
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it("records Gate0 report and trace paths from the owned run artifacts", async () => {
    const ownedRunRoot = mkdtempSync(join(tmpdir(), "wiseeff-owned-evidence-paths-"));
    const evidenceRoot = join(ownedRunRoot, "operation-evidence");
    const reportPath = join(ownedRunRoot, "artifacts", "browser", "playwright-report", "index.html");
    const tracePath = join(ownedRunRoot, "artifacts", "browser", "test-results");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_ROOT", evidenceRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID", "full-run-owned");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT", "abc123");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND", "full");
    vi.stubEnv("WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR", join(ownedRunRoot, "artifacts", "browser", "playwright-report"));
    vi.stubEnv("WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR", tracePath);

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-HAPPY-001",
        title: "owned artifact paths",
        status: "passed",
      });

      expect(result.record.report).toEqual({ path: reportPath, format: "html" });
      expect(result.record.trace).toMatchObject({ path: tracePath });
    } finally {
      vi.unstubAllEnvs();
      rmSync(ownedRunRoot, { recursive: true, force: true });
    }
  });
});

describe("operation evidence checker", () => {
  it("rejects owned Gate0 report and trace paths outside the declared run root", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-owned-evidence-validation-"));
    const runRoot = join(root, "run");
    const outside = join(root, "outside");
    const artifactPath = join(runRoot, "operation.json");
    const descriptorSnapshot = join(runRoot, "runtime-evidence-snapshot.json");
    const reportPath = join(outside, "index.html");
    const tracePath = join(outside, "test-results");
    mkdirSync(runRoot, { recursive: true });
    mkdirSync(tracePath, { recursive: true });
    writeFileSync(artifactPath, "{}\n");
    writeFileSync(descriptorSnapshot, "{}\n");
    writeFileSync(reportPath, "report\n");

    try {
      const result = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        expectedRun: { runId: "full-run-owned", sourceCommit: "abc123" },
        records: [{
          operationId: "PARAM-HAPPY-001",
          runId: "full-run-owned",
          sourceCommit: "abc123",
          runKind: "full",
          status: "passed",
          role: "Admin",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: [artifactPath],
          runtime: {
            mode: "api",
            apiBaseUrl: "http://127.0.0.1:18800",
            ownedRuntime: {
              runRoot,
              descriptorPath: join(runRoot, "runtime.json"),
              descriptorSnapshotPath: descriptorSnapshot,
              descriptorSnapshotSha256: "a".repeat(64),
              runId: "full-run-owned",
              sourceCommit: "abc123",
              databaseName: "wiseeff_acceptance_full_owned",
              objectMarkerSha256: "b".repeat(64),
              apiUrl: "http://127.0.0.1:18800",
              frontendUrl: "http://127.0.0.1:5180",
              apiPid: process.pid,
              frontendPid: process.pid,
            },
          },
          report: { path: reportPath, format: "html" },
          trace: { mode: "retain-on-failure", path: tracePath },
          reproduction: { steps: ["Open parameters", "Verify operation"] },
        } as OperationEvidenceRecord],
      });

      expect(result.status).toBe("failed");
      expect(result.validationErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: "report", message: expect.stringMatching(/run root/i) }),
        expect.objectContaining({ field: "trace", message: expect.stringMatching(/run root/i) }),
        expect.objectContaining({ field: "runtime", message: expect.stringMatching(/digest|sha256/i) }),
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts existing owned report/trace descendants bound to an immutable runtime snapshot", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "wiseeff-owned-evidence-valid-"));
    const descriptorPath = join(runRoot, "runtime.json");
    const descriptorSnapshotPath = join(runRoot, "runtime-operation-evidence-snapshot.json");
    const reportPath = join(runRoot, "artifacts", "browser", "playwright-report", "index.html");
    const tracePath = join(runRoot, "artifacts", "browser", "test-results");
    const artifactPath = join(runRoot, "operation.json");
    mkdirSync(join(runRoot, "artifacts", "browser", "playwright-report"), { recursive: true });
    mkdirSync(tracePath, { recursive: true });
    writeFileSync(descriptorPath, "{}\n");
    writeFileSync(reportPath, "report\n");
    writeFileSync(artifactPath, "{}\n");
    const snapshot = `${JSON.stringify({
      kind: "wiseeff-owned-local-acceptance-operation-evidence-runtime",
      run: { id: "full-run-owned", sourceCommit: "abc123" },
      artifacts: { runRoot, descriptor: descriptorPath },
    })}\n`;
    writeFileSync(descriptorSnapshotPath, snapshot);

    try {
      const result = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        expectedRun: { runId: "full-run-owned", sourceCommit: "abc123" },
        records: [{
          operationId: "PARAM-HAPPY-001",
          runId: "full-run-owned",
          sourceCommit: "abc123",
          runKind: "full",
          status: "passed",
          role: "Admin",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: [artifactPath],
          runtime: {
            mode: "api",
            apiBaseUrl: "http://127.0.0.1:18800",
            ownedRuntime: {
              runRoot,
              descriptorPath,
              descriptorSnapshotPath,
              descriptorSnapshotSha256: createHash("sha256").update(snapshot).digest("hex"),
              runId: "full-run-owned",
              sourceCommit: "abc123",
              databaseName: "wiseeff_acceptance_full_owned",
              objectMarkerSha256: "b".repeat(64),
              apiUrl: "http://127.0.0.1:18800",
              frontendUrl: "http://127.0.0.1:5180",
              apiPid: process.pid,
              frontendPid: process.pid,
            },
          },
          report: { path: reportPath, format: "html" },
          trace: { mode: "retain-on-failure", path: tracePath },
          reproduction: { steps: ["Open parameters", "Verify operation"] },
        }],
      });

      expect(result.status).toBe("passed");
      expect(result.validationErrors).toEqual([]);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });


  it("publishes only completed full runs as latest evidence", () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), "wiseeff-evidence-runs-"));
    const full = resolveEvidenceRunContext({
      WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: evidenceRoot,
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: "full-run-1",
      WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: "abc123",
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: "full"
    });
    const focused = resolveEvidenceRunContext({
      WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: evidenceRoot,
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: "focused-run-2",
      WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: "abc123",
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: "focused"
    });

    try {
      prepareEvidenceRun(full);
      publishLatestFullEvidenceRun(full);
      expect(readLatestFullEvidenceRun(evidenceRoot)).toMatchObject({
        runId: "full-run-1",
        sourceCommit: "abc123",
        runKind: "full"
      });

      prepareEvidenceRun(focused);
      expect(() => publishLatestFullEvidenceRun(focused)).toThrow(/full evidence run/i);
      expect(readLatestFullEvidenceRun(evidenceRoot)).toMatchObject({
        runId: "full-run-1",
        sourceCommit: "abc123"
      });
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  it("rejects records mixed across run IDs or source commits", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));
    const artifactPath = join(root, "artifact.png");
    writeFileSync(artifactPath, "fake-png", "utf8");
    const baseRecord = {
      status: "passed" as const,
      role: "Admin",
      route: "/parameters",
      assertions: ["ui" as const],
      artifacts: [artifactPath],
      runtime: { mode: "api", apiBaseUrl: "http://127.0.0.1:8787" },
      report: { path: "playwright-report/acceptance/index.html", format: "html" as const },
      trace: { mode: "retain-on-failure" as const, path: "test-results/acceptance" },
      reproduction: { steps: ["Open parameters", "Verify operation"] }
    };

    try {
      const result = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
        expectedRun: { runId: "full-run-1", sourceCommit: "abc123" },
        records: [
          {
            ...baseRecord,
            operationId: "PARAM-HAPPY-001",
            runId: "full-run-1",
            sourceCommit: "abc123"
          },
          {
            ...baseRecord,
            operationId: "PARAM-HAPPY-001:foreign",
            runId: "focused-run-2",
            sourceCommit: "def456"
          }
        ]
      });

      expect(result.status).toBe("failed");
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationId: "PARAM-HAPPY-001:foreign", field: "run" })
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a required automated operation has no evidence record", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-DRAFT-EDIT-001", priority: "P0", coverage: "automated" }],
      records: []
    });

    expect(result.status).toBe("failed");
    expect(result.missingOperationIds).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("allows child evidence ids to satisfy a parent required operation", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));

    try {
      const artifactPath = join(root, "admin.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const result = evaluateOperationEvidence({
        operations: [{ id: "PERM-MATRIX-001", priority: "P0", coverage: "automated" }],
        records: [
          {
            operationId: "PERM-MATRIX-001:Admin",
            status: "passed",
            role: "Admin",
            route: "core routes",
            assertions: ["ui"],
            artifacts: [artifactPath],
            runtime: {
              mode: "api",
              apiBaseUrl: "http://127.0.0.1:8787"
            },
            report: {
              path: "playwright-report/acceptance/index.html",
              format: "html"
            },
            trace: {
              mode: "retain-on-failure",
              path: "test-results/acceptance"
            },
            reproduction: {
              steps: ["Open core route", "Verify Admin route access"]
            }
          }
        ]
      });

      expect(result.status).toBe("passed");
      expect(result.missingOperationIds).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when required automated operation evidence lacks review metadata", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
      records: [
        {
          operationId: "PARAM-HAPPY-001",
          status: "passed",
          artifacts: []
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
  });

  it("fails when required automated operation evidence has no artifact path", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
      records: [
        {
          operationId: "PARAM-HAPPY-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: []
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
  });

  it("fails when evidence for API, DB, or audit assertions lacks matching summaries", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));

    try {
      const artifactPath = join(root, "artifact.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const result = evaluateOperationEvidence({
        operations: [
          {
            id: "PARAM-HAPPY-001",
            priority: "P0",
            coverage: "automated"
          }
        ],
        records: [
          {
            operationId: "PARAM-HAPPY-001",
            status: "passed",
            role: "Hardware User",
            route: "/parameters",
            assertions: ["ui", "api", "db", "audit"],
            artifacts: [artifactPath],
            runtime: {
              mode: "api",
              apiBaseUrl: "http://127.0.0.1:8787"
            },
            report: {
              path: "playwright-report/acceptance/index.html",
              format: "html"
            },
            trace: {
              mode: "retain-on-failure",
              path: "test-results/acceptance"
            },
            reproduction: {
              steps: ["Open /parameters", "Run parameter happy path"]
            }
          }
        ]
      });

      expect(result.status).toBe("failed");
      expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([
          {
            operationId: "PARAM-HAPPY-001",
            field: "api",
            message: "API assertions require at least one API request/response summary."
          },
          {
            operationId: "PARAM-HAPPY-001",
            field: "db",
            message: "DB assertions require at least one database assertion summary."
          },
          {
            operationId: "PARAM-HAPPY-001",
            field: "audit",
            message: "Audit assertions require at least one audit event summary."
          }
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when evidence omits assertions required by the operation matrix", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));

    try {
      const artifactPath = join(root, "artifact.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const result = evaluateOperationEvidence({
        operations: [
          {
            id: "PERM-USER-MGMT-001",
            priority: "P1",
            coverage: "automated",
            assertions: ["ui", "api", "db", "audit"]
          }
        ],
        records: [
          {
            operationId: "PERM-USER-MGMT-001",
            status: "passed",
            role: "Admin",
            route: "/user-permissions",
            assertions: ["ui"],
            artifacts: [artifactPath],
            runtime: {
              mode: "api",
              apiBaseUrl: "http://127.0.0.1:8787"
            },
            report: {
              path: "playwright-report/acceptance/index.html",
              format: "html"
            },
            trace: {
              mode: "retain-on-failure",
              path: "test-results/acceptance"
            },
            reproduction: {
              steps: ["Open /user-permissions", "Run user governance operation"]
            }
          }
        ]
      });

      expect(result.status).toBe("failed");
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([
          {
            operationId: "PERM-USER-MGMT-001",
            field: "assertions",
            message: "Evidence is missing required operation assertions: api, db, audit."
          }
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes evidence with required forensic summaries and renders them in Markdown", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));

    try {
      const artifactPath = join(root, "artifact.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const record: OperationEvidenceRecord = {
        operationId: "PARAM-HAPPY-001",
        status: "passed",
        role: "Hardware User",
        route: "/parameters",
        assertions: ["ui", "api", "db", "audit"],
        artifacts: [artifactPath],
        api: [
          {
            method: "POST",
            path: "/api/v1/parameter-submission-rounds",
            status: 201,
            requestId: "req-submit",
            responseSummary: "created request req-1"
          }
        ],
        db: [
          {
            table: "parameter_change_requests",
            predicate: "id=req-1",
            observed: "status=merged",
            rowCount: 1
          }
        ],
        audit: [
          {
            id: "audit-1",
            kind: "parameter-merge",
            action: "merge",
            targetId: "req-1",
            requestId: "req-submit"
          }
        ],
        runtime: {
          mode: "api",
          apiBaseUrl: "http://127.0.0.1:8787",
          envSummary: {
            DATABASE_URL: "set"
          }
        },
        report: {
          path: "playwright-report/acceptance/index.html",
          format: "html"
        },
        trace: {
          mode: "retain-on-failure",
          path: "test-results/acceptance"
        },
        reproduction: {
          seed: "seed-1",
          steps: ["Open /parameters", "Submit and merge parameter request"]
        }
      };

      const result = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
        records: [record]
      });
      const markdown = renderOperationEvidenceMarkdown({
        status: "passed",
        coveredOperationIds: ["PARAM-HAPPY-001"],
        missingOperationIds: [],
        invalidEvidenceIds: [],
        validationErrors: [],
        records: [record]
      });

      expect(result.status).toBe("passed");
      expect(result.invalidEvidenceIds).toEqual([]);
      expect(markdown).toContain("req-submit");
      expect(markdown).toContain("parameter_change_requests");
      expect(markdown).toContain("audit-1");
      expect(markdown).toContain("playwright-report/acceptance/index.html");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when passed evidence lacks runtime, replay, or reproduction metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));

    try {
      const artifactPath = join(root, "artifact.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const result = evaluateOperationEvidence({
        operations: [{ id: "AUTH-RUNTIME-001", priority: "P0", coverage: "automated" }],
        records: [
          {
            operationId: "AUTH-RUNTIME-001",
            status: "passed",
            role: "Admin",
            route: "/",
            assertions: ["ui"],
            artifacts: [artifactPath]
          }
        ]
      });

      expect(result.status).toBe("failed");
      expect(result.validationErrors.map((error) => error.field)).toEqual(
        expect.arrayContaining(["runtime", "report", "trace", "reproduction"])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when required automated operation evidence points at a missing artifact", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
      records: [
        {
          operationId: "PARAM-HAPPY-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: ["test-results/acceptance-operation-evidence/missing-artifact.png"]
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
  });

  it("renders an operation evidence index", () => {
    const markdown = renderOperationEvidenceMarkdown({
      status: "passed",
      coveredOperationIds: ["PARAM-DRAFT-EDIT-001"],
      missingOperationIds: [],
      invalidEvidenceIds: [],
      validationErrors: [],
      records: [
        {
          operationId: "PARAM-DRAFT-EDIT-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui", "api"],
          artifacts: ["test-results/acceptance-operation-evidence/example.png"]
        }
      ]
    });

    expect(markdown).toContain("# Operation Evidence Index");
    expect(markdown).toContain("| Operation ID | Status | Role | Route | Assertions | API | DB | Audit | Replay | Artifacts |");
    expect(markdown).toContain("`PARAM-DRAFT-EDIT-001`");
    expect(markdown).toContain("Hardware User");
  });

  it("reads evidence records and writes an evidence index", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));
    try {
      const artifactPath = join(root, "artifact.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const records: OperationEvidenceRecord[] = [
        {
          operationId: "PARAM-DRAFT-EDIT-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: [artifactPath]
        }
      ];

      const indexPath = writeOperationEvidenceIndex({
        outputPath: join(root, "index.md"),
        evaluation: {
          status: "passed",
          coveredOperationIds: ["PARAM-DRAFT-EDIT-001"],
          missingOperationIds: [],
          invalidEvidenceIds: [],
          validationErrors: [],
          records
        }
      });

      expect(indexPath).toBe(join(root, "index.md"));
      expect(readOperationEvidenceRecords(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("focused run evidence check (--run mode, TD-088)", () => {
  const operations = [
    { id: "LOG-HAPPY-001", priority: "P0", coverage: "automated" },
    { id: "LOG-DEGRADED-001", priority: "P1", coverage: "automated" }
  ];

  function writeRunRecord(runRoot: string, record: OperationEvidenceRecord) {
    writeFileSync(join(runRoot, "records", `${record.operationId.replace(/[^A-Za-z0-9-]/g, "-")}.json`), JSON.stringify(record), "utf8");
  }

  function makeFocusedRun(records: OperationEvidenceRecord[]): { root: string; runRoot: string } {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-focused-evidence-"));
    const runRoot = join(root, "runs", "abc123", "focused-run-1");
    const context = resolveEvidenceRunContext({
      WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: root,
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: "focused-run-1",
      WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: "abc123",
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: "focused"
    });
    prepareEvidenceRun(context);
    for (const record of records) {
      writeRunRecord(runRoot, record);
    }
    return { root, runRoot };
  }

  function validFocusedRecord(root: string, operationId: string): OperationEvidenceRecord {
    const artifactPath = join(root, `${operationId}.png`);
    writeFileSync(artifactPath, "fake-png", "utf8");
    return {
      operationId,
      status: "passed",
      runId: "focused-run-1",
      sourceCommit: "abc123",
      runKind: "focused",
      role: "Admin",
      route: "/logs",
      assertions: ["ui"],
      artifacts: [artifactPath],
      runtime: { mode: "api", apiBaseUrl: "http://127.0.0.1:8787" },
      report: { path: "playwright-report/acceptance/index.html", format: "html" },
      trace: { mode: "retain-on-failure", path: "test-results/acceptance" },
      reproduction: { steps: ["Open /logs", "Run the focused operation"] }
    };
  }

  it("parses --run and --require arguments in both syntaxes", () => {
    expect(parseOperationEvidenceCheckArgs([])).toEqual({ requireOperationIds: [] });
    expect(parseOperationEvidenceCheckArgs(["--run", "some/dir"])).toEqual({
      runDir: "some/dir",
      requireOperationIds: []
    });
    expect(
      parseOperationEvidenceCheckArgs(["--run=some/dir", "--require=LOG-HAPPY-001, LOG-DEGRADED-001"])
    ).toEqual({
      runDir: "some/dir",
      requireOperationIds: ["LOG-HAPPY-001", "LOG-DEGRADED-001"]
    });
    expect(() => parseOperationEvidenceCheckArgs(["--unknown"])).toThrow(/Unknown or incomplete/);
    expect(() => parseOperationEvidenceCheckArgs(["--require", "LOG-HAPPY-001"])).toThrow(/--require is only valid/);
  });

  it("passes a focused run whose records are forensically complete", () => {
    const { root, runRoot } = makeFocusedRun([]);
    try {
      writeRunRecord(runRoot, validFocusedRecord(root, "LOG-HAPPY-001"));

      const result = runFocusedOperationEvidenceCheck({ runDir: runRoot, operations });

      expect(result.status).toBe("passed");
      expect(result.coveredOperationIds).toEqual(["LOG-HAPPY-001"]);
      expect(result.missingOperationIds).toEqual([]);
      // Focused runs report their own identity without latest-full gating.
      expect(result).toMatchObject({ runId: "focused-run-1", sourceCommit: "abc123" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not demand operations the focused run never touched, unless required explicitly", () => {
    const { root, runRoot } = makeFocusedRun([]);
    try {
      writeRunRecord(runRoot, validFocusedRecord(root, "LOG-HAPPY-001"));

      const withoutRequire = runFocusedOperationEvidenceCheck({ runDir: runRoot, operations });
      expect(withoutRequire.status).toBe("passed");
      expect(withoutRequire.missingOperationIds).toEqual([]);

      const withRequire = runFocusedOperationEvidenceCheck({
        runDir: runRoot,
        operations,
        requireOperationIds: ["LOG-DEGRADED-001"]
      });
      expect(withRequire.status).toBe("failed");
      expect(withRequire.missingOperationIds).toEqual(["LOG-DEGRADED-001"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails a focused run whose evidence lacks declared assertion payloads", () => {
    const { root, runRoot } = makeFocusedRun([]);
    try {
      const record = validFocusedRecord(root, "LOG-HAPPY-001");
      // Declares api evidence but records no API summary — the P1 lesson.
      record.assertions = ["ui", "api"];
      writeRunRecord(runRoot, record);

      const result = runFocusedOperationEvidenceCheck({ runDir: runRoot, operations });

      expect(result.status).toBe("failed");
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ operationId: "LOG-HAPPY-001", field: "api" })])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a records directory directly and rejects unknown --require ids and missing dirs", () => {
    const { root, runRoot } = makeFocusedRun([]);
    try {
      writeRunRecord(runRoot, validFocusedRecord(root, "LOG-HAPPY-001"));

      const direct = runFocusedOperationEvidenceCheck({ runDir: join(runRoot, "records"), operations });
      expect(direct.status).toBe("passed");

      expect(() =>
        runFocusedOperationEvidenceCheck({ runDir: runRoot, operations, requireOperationIds: ["NOPE-001"] })
      ).toThrow(/unknown operation ids/);
      expect(() =>
        runFocusedOperationEvidenceCheck({ runDir: join(root, "does-not-exist"), operations })
      ).toThrow(/does not exist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
