import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import type { OwnedLocalAcceptanceRuntimeDescriptorV1 } from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  initializeNestedRuntimeManifest,
  recordNestedRuntimeFinish,
  recordNestedRuntimeStart,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import { captureExactOwnedDirectoryChain } from "./exact-owned-object-root";
import {
  prepareEvidenceRun,
  publishLatestFullEvidenceRun,
  readLatestFullEvidenceRun,
  resolveEvidenceRunContext
} from "../e2e/acceptance/helpers/evidenceRun";

function createNestedOwnedEvidenceFixture() {
  const root = mkdtempSync(join(tmpdir(), "wiseeff-d30-nested-evidence-"));
  const runId = "full-d30-nested-evidence";
  const sourceCommit = "d30b465ea1a9f98a92fea3c1e81359363fd0ada4";
  const runRoot = join(root, "acceptance-runtime-runs", runId);
  mkdirSync(runRoot, { recursive: true });
  const parentObjectRoot = join(runRoot, "object-store");
  const childId = "wiseeff_acceptance_disposable_mod_tree_d30_fixture";
  const childObjectRoot = join(realpathSync(runRoot), "nested-object-store", childId);
  const childApiUrl = "http://127.0.0.1:56221";
  const descriptorPath = join(runRoot, "runtime.json");
  const snapshotPath = join(runRoot, "runtime-operation-evidence-snapshot.json");
  const manifestPath = join(runRoot, "nested-runtime-manifest.json");
  const evidenceRoot = join(runRoot, "operation-evidence");
  const reportRoot = join(runRoot, "artifacts", "browser", "playwright-report");
  const traceRoot = join(runRoot, "artifacts", "browser", "test-results");
  mkdirSync(parentObjectRoot, { recursive: true });
  mkdirSync(childObjectRoot, { recursive: true });
  mkdirSync(reportRoot, { recursive: true });
  mkdirSync(traceRoot, { recursive: true });
  writeFileSync(join(reportRoot, "index.html"), "report\n");
  const processIdentity = {
    startToken: "darwin-lstart:Sun Aug 23 18:29:24 2026",
    commandSha256: "e".repeat(64),
  };
  const descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1 = {
    version: 1,
    kind: "wiseeff-owned-local-acceptance",
    run: {
      id: runId,
      sourceCommit,
      worktreeRoot: realpathSync(root),
      sourceDirtyBefore: false,
      ownerPid: 44_009,
      ownerProcessIdentity: processIdentity,
      createdAt: "2026-08-23T10:29:25.329Z",
      state: "running",
    },
    database: {
      name: "wiseeff_acceptance_full_d30_fixture",
      connection: {
        host: "127.0.0.1",
        port: 5432,
        user: "wiseeff",
        database: "wiseeff_acceptance_full_d30_fixture",
      },
      absentBeforeCreate: true,
      marker: {
        table: "wiseeff_acceptance_runtime_markers",
        purpose: "td-122-gate0",
        runId,
        sourceCommit,
      },
      migration: {
        command: "npm run db:migrate",
        appliedCount: 113,
        latest: "0115_log_webhook_delivery_retention_order.sql",
        completedAt: "2026-08-23T10:29:24.285Z",
      },
      seed: {
        command: "npm run db:seed:all",
        completedAt: "2026-08-23T10:29:24.285Z",
        sentinels: { organizations: 3 },
      },
    },
    objectStore: {
      mode: "local",
      root: parentObjectRoot,
      absentBeforeCreate: true,
      markerFile: join(parentObjectRoot, ".wiseeff-acceptance-owner.json"),
      markerSha256: "7".repeat(64),
      directoryChain: captureExactOwnedDirectoryChain(root, parentObjectRoot),
    },
    endpoints: {
      api: {
        host: "127.0.0.1",
        port: 18_800,
        url: "http://127.0.0.1:18800",
        healthUrl: "http://127.0.0.1:18800/health/live",
      },
      frontend: {
        host: "127.0.0.1",
        port: 5_180,
        url: "http://127.0.0.1:5180",
      },
    },
    processes: {
      api: {
        pid: 46_007,
        processIdentity,
        startedAt: "2026-08-23T10:29:25.329Z",
        command: "node --import tsx server/index.ts",
        log: join(runRoot, "api.log"),
      },
      frontend: {
        pid: 46_029,
        processIdentity,
        startedAt: "2026-08-23T10:29:25.329Z",
        command: "vite --host 127.0.0.1 --port 5180 --strictPort",
        log: join(runRoot, "frontend.log"),
      },
    },
    auth: {
      mode: "production",
      provider: "hmac",
      issuer: "wiseeff-full-d30-nested-evidence",
      smokeSubject: "u-xu-yun",
    },
    runtime: {
      frontendMode: "api",
      xiaozeDeterministic: true,
      logAnalysisDeterministic: true,
      localWebhookAllowed: true,
      gatewayMode: "simulator",
      hdcAvailable: false,
    },
    phases: {
      visual: { status: "passed", startedAt: "2026-08-23T10:29:25.748Z", completedAt: "2026-08-23T10:30:37.352Z" },
      browser: {
        status: "running",
        startedAt: "2026-08-23T10:30:37.360Z",
        process: { pid: 48_591, processIdentity },
      },
    },
    artifacts: {
      runRoot,
      descriptor: descriptorPath,
      operationEvidenceRuntimeSnapshot: snapshotPath,
      failureInventory: join(runRoot, "failure-inventory.json"),
      sourceWorktreeOutputManifest: join(runRoot, "source-worktree-output-manifest.json"),
      nestedRuntimeManifest: manifestPath,
      runtimeLogs: [join(runRoot, "api.log"), join(runRoot, "frontend.log")],
    },
    cleanup: {
      policy: "success-only",
      status: "pending",
      exactDatabaseName: "wiseeff_acceptance_full_d30_fixture",
      exactObjectStoreRoot: parentObjectRoot,
      resources: {
        apiProcess: { status: "pending" },
        frontendProcess: { status: "pending" },
        database: { status: "pending" },
        objectStore: { status: "pending" },
        descriptor: { status: "pending" },
        artifacts: { status: "pending" },
      },
    },
  };
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  const snapshot = {
    version: 1,
    kind: "wiseeff-owned-local-acceptance-operation-evidence-runtime",
    run: {
      id: runId,
      sourceCommit,
      worktreeRoot: descriptor.run.worktreeRoot,
      ownerPid: descriptor.run.ownerPid,
      ownerProcessIdentity: descriptor.run.ownerProcessIdentity,
      createdAt: descriptor.run.createdAt,
    },
    database: {
      name: descriptor.database.name,
      connection: descriptor.database.connection,
      marker: descriptor.database.marker,
      migration: descriptor.database.migration,
      seed: descriptor.database.seed,
    },
    objectStore: {
      root: descriptor.objectStore.root,
      markerFile: descriptor.objectStore.markerFile,
      markerSha256: descriptor.objectStore.markerSha256,
    },
    endpoints: descriptor.endpoints,
    processes: descriptor.processes,
    auth: descriptor.auth,
    runtime: descriptor.runtime,
    artifacts: { runRoot, descriptor: descriptorPath, nestedRuntimeManifest: manifestPath },
  };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  initializeNestedRuntimeManifest(manifestPath, { parentRunId: runId, sourceCommit });
  recordNestedRuntimeStart(manifestPath, {
    id: childId,
    databaseName: childId,
    markerPurpose: "mod-tree",
    migrationRunId: "3d71f178-8320-5645-a5d0-b319c294eef5",
    objectStoreRoot: childObjectRoot,
    apiUrl: childApiUrl,
    frontendUrl: "http://127.0.0.1:5173",
    apiPid: 61_222,
    frontendPid: 61_313,
    apiProcessIdentity: { pid: 61_222, port: 56_221, ...processIdentity },
    frontendProcessIdentity: { pid: 61_313, port: 5_173, ...processIdentity },
  });
  return {
    root,
    runRoot,
    runId,
    sourceCommit,
    childId,
    childObjectRoot,
    childApiUrl,
    descriptorPath,
    snapshotPath,
    manifestPath,
    evidenceRoot,
    reportRoot,
    traceRoot,
  };
}

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

  it("records descriptor-free focused evidence while a legacy disposable runtime ID is active", async () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), "wiseeff-legacy-disposable-evidence-"));
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_ROOT", evidenceRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID", "focused-legacy-disposable");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT", "abc123");
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND", "focused");
    vi.stubEnv("WISEEFF_ACCEPTANCE_NESTED_RUNTIME_ID", "wiseeff_acceptance_disposable_legacy_focus");
    vi.stubEnv("WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR", undefined);
    vi.stubEnv("WISEEFF_ACCEPTANCE_PARENT_RUNTIME_DESCRIPTOR", undefined);
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:19100");
    vi.stubEnv("DATABASE_URL", "postgres://wiseeff:secret@127.0.0.1:5432/wiseeff_acceptance_disposable_legacy_focus");

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-HAPPY-001",
        title: "legacy disposable evidence",
        status: "passed",
      });

      expect(result.record.runtime).toMatchObject({
        mode: "api",
        apiBaseUrl: "http://127.0.0.1:19100",
        envSummary: { DATABASE_URL: "set" },
      });
      expect(result.record.runtime).not.toHaveProperty("ownedRuntime");
      expect(result.record.runtime).not.toHaveProperty("nestedRuntime");
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

  it("binds a d30-derived nested-runtime evidence shape to its parent snapshot and exact child manifest record", async () => {
    const fixture = createNestedOwnedEvidenceFixture();
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_ROOT", fixture.evidenceRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID", fixture.runId);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT", fixture.sourceCommit);
    vi.stubEnv("WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND", "full");
    vi.stubEnv("WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR", fixture.reportRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR", fixture.traceRoot);
    vi.stubEnv("WISEEFF_ACCEPTANCE_PARENT_RUNTIME_DESCRIPTOR", fixture.descriptorPath);
    vi.stubEnv("WISEEFF_ACCEPTANCE_NESTED_RUNTIME_ID", fixture.childId);
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", fixture.childApiUrl);
    vi.stubEnv("DATABASE_URL", `postgres://wiseeff:secret@127.0.0.1:5432/${fixture.childId}`);

    try {
      const result = await recordOperationEvidence({
        operationId: "MOD-TREE-AUTHZ-001",
        title: "d30 nested evidence regression",
        status: "passed",
        role: "Hardware User",
        route: "/parameter-admin",
        assertions: ["ui"],
        runtime: {
          mode: "api",
          apiBaseUrl: "http://127.0.0.1:59999",
          envSummary: { D30_NESTED_EVIDENCE: "set" },
        },
      });

      expect(result.record.runtime).toMatchObject({
        apiBaseUrl: fixture.childApiUrl,
        ownedRuntime: {
          runId: fixture.runId,
          sourceCommit: fixture.sourceCommit,
          descriptorPath: fixture.descriptorPath,
          descriptorSnapshotPath: fixture.snapshotPath,
        },
        nestedRuntime: {
          id: fixture.childId,
          manifestPath: fixture.manifestPath,
          parentRunId: fixture.runId,
          sourceCommit: fixture.sourceCommit,
          databaseName: fixture.childId,
          objectStoreRoot: fixture.childObjectRoot,
          state: "running",
          apiPid: 61_222,
          frontendPid: 61_313,
        },
        envSummary: { D30_NESTED_EVIDENCE: "set" },
      });

      recordNestedRuntimeFinish(fixture.manifestPath, fixture.childId, "cleaned", {
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
        database: { status: "removed" },
        objectStore: { status: "removed" },
      });

      const evaluation = evaluateOperationEvidence({
        operations: [{ id: "MOD-TREE-AUTHZ-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        records: [result.record as OperationEvidenceRecord],
        expectedRun: { runId: fixture.runId, sourceCommit: fixture.sourceCommit },
      });
      expect(evaluation.status).toBe("passed");
      expect(evaluation.validationErrors).toEqual([]);

      const parentClaimMutations: Array<{
        label: string;
        mutate(record: OperationEvidenceRecord): void;
      }> = [
        { label: "database", mutate: (record) => { record.runtime!.ownedRuntime!.databaseName += "_foreign"; } },
        { label: "object marker", mutate: (record) => { record.runtime!.ownedRuntime!.objectMarkerSha256 = "f".repeat(64); } },
        { label: "API URL", mutate: (record) => { record.runtime!.ownedRuntime!.apiUrl = "http://127.0.0.1:18801"; } },
        { label: "frontend URL", mutate: (record) => { record.runtime!.ownedRuntime!.frontendUrl = "http://127.0.0.1:5181"; } },
        { label: "API PID", mutate: (record) => { record.runtime!.ownedRuntime!.apiPid += 1; } },
        { label: "frontend PID", mutate: (record) => { record.runtime!.ownedRuntime!.frontendPid += 1; } },
      ];
      for (const mutation of parentClaimMutations) {
        const mutated = structuredClone(result.record) as OperationEvidenceRecord;
        mutation.mutate(mutated);
        const rejected = evaluateOperationEvidence({
          operations: [{ id: "MOD-TREE-AUTHZ-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
          records: [mutated],
          expectedRun: { runId: fixture.runId, sourceCommit: fixture.sourceCommit },
        });
        expect(rejected.status, mutation.label).toBe("failed");
        expect(rejected.validationErrors, mutation.label).toContainEqual(expect.objectContaining({
          operationId: "MOD-TREE-AUTHZ-001",
          field: "runtime",
        }));
      }

      const childClaimMutations: Array<{
        label: string;
        mutate(record: OperationEvidenceRecord): void;
      }> = [
        { label: "nested database", mutate: (record) => { record.runtime!.nestedRuntime!.databaseName += "_foreign"; } },
        { label: "nested child ID", mutate: (record) => { record.runtime!.nestedRuntime!.id += "_foreign"; } },
        { label: "nested parent run", mutate: (record) => { record.runtime!.nestedRuntime!.parentRunId = "foreign-run"; } },
        { label: "nested source", mutate: (record) => { record.runtime!.nestedRuntime!.sourceCommit = "f".repeat(40); } },
        { label: "nested object root", mutate: (record) => { record.runtime!.nestedRuntime!.objectStoreRoot = join(fixture.runRoot, "foreign-object"); } },
        { label: "nested API URL", mutate: (record) => { record.runtime!.nestedRuntime!.apiUrl = "http://127.0.0.1:56222"; } },
        { label: "nested frontend URL", mutate: (record) => { record.runtime!.nestedRuntime!.frontendUrl = "http://127.0.0.1:5174"; } },
        { label: "nested API PID", mutate: (record) => { record.runtime!.nestedRuntime!.apiPid += 1; } },
        { label: "nested frontend PID", mutate: (record) => { record.runtime!.nestedRuntime!.frontendPid += 1; } },
        { label: "nested API identity", mutate: (record) => { record.runtime!.nestedRuntime!.apiProcessIdentity.startToken = "reused-process"; } },
        { label: "nested frontend identity", mutate: (record) => { record.runtime!.nestedRuntime!.frontendProcessIdentity.startToken = "reused-process"; } },
        { label: "nested manifest", mutate: (record) => { record.runtime!.nestedRuntime!.manifestPath = fixture.descriptorPath; } },
        { label: "recorded timestamp", mutate: (record) => { record.recordedAt = "not-a-timestamp"; } },
        {
          label: "omitted nested binding",
          mutate: (record) => { delete record.runtime!.nestedRuntime; },
        },
      ];
      for (const mutation of childClaimMutations) {
        const mutated = structuredClone(result.record) as OperationEvidenceRecord;
        mutation.mutate(mutated);
        const rejected = evaluateOperationEvidence({
          operations: [{ id: "MOD-TREE-AUTHZ-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
          records: [mutated],
          expectedRun: { runId: fixture.runId, sourceCommit: fixture.sourceCommit },
        });
        expect(rejected.status, mutation.label).toBe("failed");
        expect(rejected.validationErrors, mutation.label).toContainEqual(expect.objectContaining({ field: "runtime" }));
      }

      const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as {
        children: Array<{ state: string; cleanup: Record<string, { status: string }> }>;
      };
      manifest.children[0]!.state = "failed-retained";
      manifest.children[0]!.cleanup.database.status = "retained";
      manifest.children[0]!.cleanup.objectStore.status = "retained";
      writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const failedCleanup = evaluateOperationEvidence({
        operations: [{ id: "MOD-TREE-AUTHZ-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        records: [result.record as OperationEvidenceRecord],
        expectedRun: { runId: fixture.runId, sourceCommit: fixture.sourceCommit },
      });
      expect(failedCleanup.status).toBe("failed");
      expect(failedCleanup.validationErrors).toContainEqual(expect.objectContaining({
        field: "runtime",
        message: expect.stringMatching(/cleanup state/i),
      }));
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("operation evidence checker", () => {
  it("requires every expected full-run record to carry owned runtime proof", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-owned-required-"));
    const artifactPath = join(root, "artifact.json");
    writeFileSync(artifactPath, "{}\n");

    try {
      const result = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        expectedRun: { runId: "full-owned-required", sourceCommit: "abc123" },
        records: [
          {
            operationId: "PARAM-HAPPY-001",
            runId: "full-owned-required",
            sourceCommit: "abc123",
            runKind: "full",
            status: "passed",
            role: "Admin",
            route: "/parameters",
            assertions: ["ui"],
            artifacts: [artifactPath],
            runtime: { mode: "api", apiBaseUrl: "http://127.0.0.1:18800" },
            report: { path: "playwright-report/acceptance/index.html", format: "html" },
            trace: { mode: "retain-on-failure", path: "test-results/acceptance" },
            reproduction: { steps: ["Open parameters", "Verify operation"] },
          },
          {
            operationId: "OPTIONAL-SKIP-001",
            runId: "full-owned-required",
            sourceCommit: "abc123",
            runKind: "full",
            status: "skipped",
            artifacts: [],
            runtime: { mode: "api", apiBaseUrl: "http://127.0.0.1:18800" },
          },
        ],
      });

      expect(result.status).toBe("failed");
      expect(result.validationErrors).toContainEqual(expect.objectContaining({
        operationId: "PARAM-HAPPY-001",
        field: "runtime",
        message: expect.stringMatching(/owned runtime proof/i),
      }));
      expect(result.validationErrors).toContainEqual(expect.objectContaining({
        operationId: "OPTIONAL-SKIP-001",
        field: "runtime",
        message: expect.stringMatching(/owned runtime proof/i),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
      database: { name: "wiseeff_acceptance_full_owned" },
      objectStore: { markerSha256: "b".repeat(64) },
      endpoints: {
        api: { url: "http://127.0.0.1:18800" },
        frontend: { url: "http://127.0.0.1:5180" },
      },
      processes: { api: { pid: process.pid }, frontend: { pid: process.pid } },
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

      const mismatchedApi = structuredClone(result.records[0]!) as OperationEvidenceRecord;
      mismatchedApi.runtime!.apiBaseUrl = "http://127.0.0.1:18801";
      const mismatchedApiResult = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        expectedRun: { runId: "full-run-owned", sourceCommit: "abc123" },
        records: [mismatchedApi],
      });
      expect(mismatchedApiResult.status).toBe("failed");
      expect(mismatchedApiResult.validationErrors).toContainEqual(expect.objectContaining({
        field: "runtime",
        message: expect.stringMatching(/API URL/i),
      }));
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it("rejects an immutable owned snapshot that is not bound to the top-level record and expected run", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "wiseeff-owned-evidence-snapshot-mismatch-"));
    const descriptorPath = join(runRoot, "runtime.json");
    const snapshotPath = join(runRoot, "runtime-operation-evidence-snapshot.json");
    const reportPath = join(runRoot, "report.html");
    const tracePath = join(runRoot, "trace");
    const artifactPath = join(runRoot, "artifact.json");
    mkdirSync(tracePath);
    for (const file of [descriptorPath, reportPath, artifactPath]) writeFileSync(file, "{}\n");
    const snapshot = `${JSON.stringify({
      kind: "wiseeff-owned-local-acceptance-operation-evidence-runtime",
      run: { id: "foreign-run", sourceCommit: "def456" },
      artifacts: { runRoot, descriptor: descriptorPath },
    })}\n`;
    writeFileSync(snapshotPath, snapshot);

    try {
      const result = evaluateOperationEvidence({
        operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated", assertions: ["ui"] }],
        expectedRun: { runId: "expected-run", sourceCommit: "abc123" },
        records: [{
          operationId: "PARAM-HAPPY-001",
          runId: "expected-run",
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
              descriptorSnapshotPath: snapshotPath,
              descriptorSnapshotSha256: createHash("sha256").update(snapshot).digest("hex"),
              runId: "foreign-run",
              sourceCommit: "def456",
              databaseName: "wiseeff_acceptance_full_foreign",
              objectMarkerSha256: "b".repeat(64),
              apiUrl: "http://127.0.0.1:18800",
              frontendUrl: "http://127.0.0.1:5180",
              apiPid: process.pid,
              frontendPid: process.pid,
            },
          },
          report: { path: reportPath, format: "html" },
          trace: { mode: "retain-on-failure", path: tracePath },
          reproduction: { steps: ["Open parameters"] },
        }],
      });

      expect(result.status).toBe("failed");
      expect(result.validationErrors).toContainEqual(expect.objectContaining({
        field: "runtime",
        message: expect.stringMatching(/top-level record|expected run/i),
      }));
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
