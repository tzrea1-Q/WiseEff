import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import type { LogAnalysisQueue } from "./logAnalysisQueue";
import { completeRun, createFileObject, persistLogAnalysisReport } from "./repository";
import {
  archiveLogRecord,
  createLogFromFile,
  getLogRecord,
  listLogFeedbackInsights,
  listLogRecords,
  rerunLogAnalysis,
  submitLogFeedback,
  unarchiveLogRecord,
  uploadLogFile
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

function makeQueue() {
  const enqueued: Array<Parameters<LogAnalysisQueue["enqueue"]>[0]> = [];
  const queue: LogAnalysisQueue = {
    async enqueue(input) {
      enqueued.push(input);
      return {
        id: "queue-job-1",
        name: input.name,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        attempt: 0
      };
    }
  };

  return { queue, enqueued };
}

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      organizationName: "ChargeLab",
      roles: [{ projectId: "project-1", roleId: "software-user" }],
      permissions: ["logs:view", "logs:upload", "logs:feedback"]
    }),
    ...overrides
  };
}

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return makeAuth({
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["logs:view", "logs:upload", "logs:feedback", "logs:analyze", "logs:archive", "admin:access"],
    ...overrides
  });
}

function crossProjectAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return makeAuth({
    roles: [{ projectId: "project-2", roleId: "software-user" }],
    permissions: ["logs:view"],
    ...overrides
  });
}

const sampleReport = {
  confidence: 0.91,
  conclusion: "Charge current derated after thermal warning.",
  impact: "Fast charge throughput reduced.",
  severity: "Warning" as const,
  suggestedActions: ["Inspect coolant loop"],
  rawLines: ["12 WARN temp=74", "21 INFO derate=1"]
};

const sampleEvidence = [
  {
    stageId: "rootcause" as const,
    lineNumbers: [12, 21],
    inference: "Thermal warnings cluster before derating.",
    suggestedAction: "Check pack coolant loop.",
    ruleHit: "thermal-foldback"
  }
];

describe.skipIf(!databaseAvailable)("log service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "user-1", name: "Riley Chen", email: "riley@example.com" },
        { id: "other-user", name: "Casey Wu", email: "casey@example.com" }
      ]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function uploadSampleLog(auth = makeAuth(), fileName = "pack-controller.log") {
    const objectStore = createMemoryObjectStore();
    return uploadLogFile(db, objectStore, auth, {
      fileName,
      contentType: "text/plain",
      bytes: Buffer.from("line one")
    });
  }

  async function auditEvents(): Promise<Array<{ kind: string; trace_id: string | null; project_id: string | null }>> {
    const result = await db.query<{ kind: string; trace_id: string | null; project_id: string | null }>(
      "select kind, trace_id, project_id from audit_events where organization_id = $1 order by created_at asc, id asc",
      ["org-1"]
    );
    return result.rows;
  }

  it("guest can list logs but cannot upload", async () => {
    await uploadSampleLog();
    const guest = makeAuth({ roles: [{ projectId: null, roleId: "guest" }], permissions: ["logs:view"] });
    const objectStore = createMemoryObjectStore();

    const logs = await listLogRecords(db, guest, {});
    expect(logs.items).toHaveLength(1);

    await expect(
      uploadLogFile(db, objectStore, guest, {
        fileName: "pack-controller.log",
        contentType: "text/plain",
        bytes: Buffer.from("line one")
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:upload" }));
    expect(objectStore.entries.size).toBe(0);
  });

  it("scopes lists to the caller organization", async () => {
    await uploadSampleLog();
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "OtherOrg" },
      users: [{ id: "user-2", name: "Renn Ito", email: "renn@example.com" }]
    });
    const otherOrgAuth = makeTestAuthContext({
      userId: "user-2",
      organizationId: "org-2",
      organizationName: "OtherOrg",
      roleId: "software-user",
      permissions: ["logs:view", "logs:upload"]
    });
    const foreign = await uploadLogFile(db, createMemoryObjectStore(), otherOrgAuth, {
      fileName: "other-org.log",
      contentType: "text/plain",
      bytes: Buffer.from("other org line")
    });

    const logs = await listLogRecords(db, makeAuth(), {});

    expect(logs.items).toHaveLength(1);
    expect(logs.items.map((log) => log.id)).not.toContain(foreign.log.id);
  });

  it("allows org-scoped list regardless of parameter project roles", async () => {
    await uploadSampleLog();

    const logs = await listLogRecords(db, crossProjectAuth(), {});

    expect(logs.items).toHaveLength(1);
  });

  it("allows org-scoped get regardless of parameter project roles", async () => {
    const uploaded = await uploadSampleLog();

    await expect(getLogRecord(db, crossProjectAuth(), uploaded.log.id)).resolves.toMatchObject({
      id: uploaded.log.id
    });
  });

  it("user with logs:upload can upload supported .log, creating processing record and queued job", async () => {
    const objectStore = createMemoryObjectStore();
    const bytes = Buffer.from("line one");
    const checksum = createHash("sha256").update(bytes).digest("hex");

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "pack-controller.log",
      contentType: "text/plain",
      bytes
    });

    expect(objectStore.entries.size).toBe(1);
    expect(result.fileObject).toMatchObject({
      storageKey: `org-1/${checksum}-pack-controller.log`,
      fileName: "pack-controller.log",
      checksumSha256: checksum,
      uploadedByUserId: "user-1"
    });
    expect(result.log.status).toBe("processing");
    expect(result.job).toMatchObject({ kind: "log-analysis", status: "queued", currentStage: "parse" });

    const events = await auditEvents();
    expect(events.map((row) => row.kind)).toContain("log-upload");
  });

  async function seedLogDomain(input: { id: string; name: string; status?: "active" | "archived" }) {
    await db.query(
      "insert into log_domains (id, organization_id, name, status) values ($1, $2, $3, $4)",
      [input.id, "org-1", input.name, input.status ?? "active"]
    );
  }

  it("binds an active log domain on upload and stores log_domain_id", async () => {
    await seedLogDomain({ id: "domain-1", name: "charging-power" });

    const result = await uploadLogFile(db, createMemoryObjectStore(), makeAuth(), {
      fileName: "pack-controller.log",
      contentType: "text/plain",
      bytes: Buffer.from("line one"),
      logDomainId: "domain-1"
    });

    expect(result.log.logDomainId).toBe("domain-1");
    expect(result.log.logDomainName).toBe("charging-power");
    const stored = await db.query<{ log_domain_id: string | null }>(
      "select log_domain_id from log_records where id = $1",
      [result.log.id]
    );
    expect(stored.rows[0]?.log_domain_id).toBe("domain-1");
    const uploadAudit = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where kind = 'log-upload' and organization_id = $1",
      ["org-1"]
    );
    expect(JSON.stringify(uploadAudit.rows[0]?.metadata)).toContain("domain-1");
  });

  it("rejects an unknown log domain on upload with 400 before storing bytes", async () => {
    const objectStore = createMemoryObjectStore();

    await expect(
      uploadLogFile(db, objectStore, makeAuth(), {
        fileName: "pack-controller.log",
        contentType: "text/plain",
        bytes: Buffer.from("line one"),
        logDomainId: "domain-missing"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    expect(objectStore.entries.size).toBe(0);
  });

  it("rejects an archived log domain on upload with 400", async () => {
    await seedLogDomain({ id: "domain-1", name: "charging-power", status: "archived" });
    const objectStore = createMemoryObjectStore();

    await expect(
      uploadLogFile(db, objectStore, makeAuth(), {
        fileName: "pack-controller.log",
        contentType: "text/plain",
        bytes: Buffer.from("line one"),
        logDomainId: "domain-1"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    expect(objectStore.entries.size).toBe(0);
  });

  it("dispatches supported log uploads to the durable queue after the database job is created", async () => {
    const { queue, enqueued } = makeQueue();

    const result = await uploadLogFile(
      db,
      createMemoryObjectStore(),
      makeAuth(),
      {
        fileName: "pack-controller.log",
        contentType: "text/plain",
        bytes: Buffer.from("line one")
      },
      { logAnalysisQueue: queue }
    );

    expect(enqueued).toEqual([
      {
        name: "analyze-log",
        payload: {
          organizationId: "org-1",
          logId: result.log.id,
          runId: result.job?.runId,
          jobId: result.job?.id
        },
        idempotencyKey: `log-analysis:${result.job?.id}`
      }
    ]);
  });

  it("unsupported .bin creates Failed record with failureReason and no queued worker job", async () => {
    const objectStore = createMemoryObjectStore();

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "pack-controller.bin",
      contentType: "application/octet-stream",
      bytes: Buffer.from([1, 2, 3, 4])
    });

    expect(objectStore.entries.size).toBe(0);
    expect(result.fileObject).toMatchObject({ fileName: "pack-controller.bin" });
    expect(result.log.status).toBe("failed");
    expect(result.log.failureReason).toContain("Unsupported log format");
    expect(result.job).toBeNull();

    const jobs = await db.query<{ count: string }>(
      "select count(*)::text as count from jobs where organization_id = $1",
      ["org-1"]
    );
    expect(jobs.rows[0].count).toBe("0");

    const events = await auditEvents();
    expect(events.map((row) => row.kind)).toContain("log-upload-failed");
  });

  it("unpacks a .gz upload before storing so the object holds plain text and analysis is queued", async () => {
    const objectStore = createMemoryObjectStore();
    const logText = "12 WARN temp=74\n21 INFO derate=1\n";

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "pack-controller.log.gz",
      contentType: "application/gzip",
      bytes: gzipSync(Buffer.from(logText))
    });

    expect(result.log).toMatchObject({ fileName: "pack-controller.log.gz", status: "processing" });
    expect(result.job).toMatchObject({ status: "queued" });
    const storedBytes = await objectStore.get(result.fileObject.storageKey);
    expect(storedBytes.toString("utf8")).toBe(logText);
    expect(result.fileObject.fileSizeBytes).toBe(Buffer.byteLength(logText));
  });

  it("marks a multi-entry .zip upload failed with a readable reason and no job", async () => {
    const objectStore = createMemoryObjectStore();
    const { queue, enqueued } = makeQueue();

    const result = await uploadLogFile(
      db,
      objectStore,
      makeAuth(),
      {
        fileName: "bundle.zip",
        contentType: "application/zip",
        // Not a valid single-entry archive: plain bytes fail unpacking.
        bytes: Buffer.from("not a zip archive")
      },
      { logAnalysisQueue: queue }
    );

    expect(result.log.status).toBe("failed");
    expect(result.log.failureReason).toMatch(/Failed to read \.zip archive/);
    expect(result.job).toBeNull();
    expect(enqueued).toHaveLength(0);
    expect(objectStore.entries.size).toBe(0);

    const events = await auditEvents();
    expect(events.map((row) => row.kind)).toContain("log-upload-failed");
  });

  it("stops a gzip bomb at intake with the size-limit failure reason", async () => {
    const objectStore = createMemoryObjectStore();
    const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61));

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "bomb.log.gz",
      contentType: "application/gzip",
      bytes: bomb
    });

    expect(result.log.status).toBe("failed");
    expect(result.log.failureReason).toMatch(/exceeds the allowed size/);
    expect(result.job).toBeNull();
    expect(objectStore.entries.size).toBe(0);
  });

  it("createLogFromFile refuses to reanalyze a rejected (never stored) upload", async () => {
    const rejected = await uploadLogFile(db, createMemoryObjectStore(), makeAuth(), {
      fileName: "bomb.log.gz",
      contentType: "application/gzip",
      bytes: gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61))
    });
    expect(rejected.log.status).toBe("failed");

    const replay = await createLogFromFile(db, makeAuth(), {
      fileObjectId: rejected.fileObject.id,
      fileName: "bomb.log.gz"
    });

    expect(replay.log.status).toBe("failed");
    expect(replay.job).toBeNull();
  });

  it("does not dispatch unsupported uploads to the durable queue", async () => {
    const { queue, enqueued } = makeQueue();

    await uploadLogFile(
      db,
      createMemoryObjectStore(),
      makeAuth(),
      {
        fileName: "pack-controller.bin",
        contentType: "application/octet-stream",
        bytes: Buffer.from([1, 2, 3, 4])
      },
      { logAnalysisQueue: queue }
    );

    expect(enqueued).toEqual([]);
  });

  it("createLogFromFile validates canonical file name", async () => {
    await createFileObject(db, {
      id: "file-canonical",
      organizationId: "org-1",
      storageKey: "org-1/checksum-pack-controller.log",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      fileSizeBytes: 2048,
      checksumSha256: "checksum",
      uploadedByUserId: "user-1"
    });

    await expect(
      createLogFromFile(db, makeAuth(), {
        fileObjectId: "file-canonical",
        fileName: "caller-name.log"
      })
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "File name does not match the stored file object.", 400)
    );

    const records = await db.query<{ count: string }>(
      "select count(*)::text as count from log_records where organization_id = $1",
      ["org-1"]
    );
    expect(records.rows[0].count).toBe("0");
  });

  it("createLogFromFile rejects file objects uploaded by another user before writes", async () => {
    await createFileObject(db, {
      id: "file-foreign",
      organizationId: "org-1",
      storageKey: "org-1/checksum-pack-controller.log",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      fileSizeBytes: 2048,
      checksumSha256: "checksum",
      uploadedByUserId: "other-user"
    });

    await expect(
      createLogFromFile(db, makeAuth(), {
        fileObjectId: "file-foreign",
        fileName: "pack-controller.log"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "File object ownership is required.", 403));

    const written = await db.query<{ logs: string; jobs: string; audits: string }>(
      `select
         (select count(*) from log_records where organization_id = $1)::text as logs,
         (select count(*) from jobs where organization_id = $1)::text as jobs,
         (select count(*) from audit_events where organization_id = $1)::text as audits`,
      ["org-1"]
    );
    expect(written.rows[0]).toEqual({ logs: "0", jobs: "0", audits: "0" });
  });

  it("non-admin cannot archive; admin can archive and unarchive", async () => {
    const uploaded = await uploadSampleLog();
    const logId = uploaded.log.id;
    const runId = uploaded.job!.runId;
    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      report: sampleReport,
      evidence: sampleEvidence
    });
    await completeRun(db, { organizationId: "org-1", logId, runId });

    await expect(archiveLogRecord(db, makeAuth(), logId)).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:archive" })
    );

    const archived = await archiveLogRecord(db, adminAuth(), logId);
    const unarchived = await unarchiveLogRecord(db, adminAuth(), logId);

    expect(archived).toMatchObject({
      archiveState: "archived",
      reportId: `report-${runId}`,
      conclusion: "Charge current derated after thermal warning.",
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: `evidence-${runId}-0`, lineNumbers: [12, 21] }]
    });
    expect(unarchived).toMatchObject({
      archiveState: "active",
      reportId: `report-${runId}`,
      conclusion: "Charge current derated after thermal warning.",
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: `evidence-${runId}-0`, lineNumbers: [12, 21] }]
    });

    const kinds = (await auditEvents()).map((row) => row.kind);
    expect(kinds).toContain("log-archive");
    expect(kinds).toContain("log-unarchive");
  });

  it("feedback requires logs:feedback and writes audit with trace correlation", async () => {
    const uploaded = await uploadSampleLog();

    await expect(
      submitLogFeedback(db, makeAuth({ permissions: ["logs:view"] }), {
        logId: uploaded.log.id,
        rating: "helpful",
        note: "Matched the incident."
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:feedback" }));

    await submitLogFeedback(
      db,
      makeAuth(),
      {
        logId: uploaded.log.id,
        rating: "helpful",
        note: "Matched the incident."
      },
      { requestId: "request-log-feedback-1" }
    );

    const feedback = await db.query<{ rating: string; note: string | null }>(
      "select rating, note from log_feedback where organization_id = $1 and log_record_id = $2",
      ["org-1", uploaded.log.id]
    );
    expect(feedback.rows).toEqual([{ rating: "helpful", note: "Matched the incident." }]);

    const audit = (await auditEvents()).find((row) => row.kind === "log-feedback");
    expect(audit).toBeDefined();
    expect(audit?.project_id).toBeNull();
    expect(audit?.trace_id).toBe("request-log-feedback-1");
  });

  it("feedback insights require logs:view and aggregate helpful rate per group", async () => {
    const uploaded = await uploadSampleLog();
    await submitLogFeedback(db, makeAuth(), { logId: uploaded.log.id, rating: "helpful" });
    await submitLogFeedback(db, makeAuth(), { logId: uploaded.log.id, rating: "not_helpful" });

    await expect(
      listLogFeedbackInsights(db, makeAuth({ permissions: ["logs:feedback"] }), {})
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:view" }));

    const insights = await listLogFeedbackInsights(db, makeAuth(), { timeWindow: "7d" });
    expect(insights.items).toEqual([
      expect.objectContaining({ totalCount: 2, helpfulCount: 1, helpfulRate: 0.5 })
    ]);
  });

  it("rerun requires logs:analyze or admin, creates a new run and job, and keeps old run history", async () => {
    const uploaded = await uploadSampleLog();
    const logId = uploaded.log.id;
    const oldRunId = uploaded.job!.runId;
    await completeRun(db, { organizationId: "org-1", logId, runId: oldRunId });

    await expect(
      rerunLogAnalysis(db, makeAuth({ permissions: ["logs:view"] }), { logId })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:analyze" }));

    const result = await rerunLogAnalysis(db, adminAuth(), { logId, analysisQuestion: "Try again" });

    expect(result.log.status).toBe("processing");
    expect(result.log.analysisQuestion).toBe("Try again");
    expect(result.job).toMatchObject({ status: "queued" });
    expect(result.job.runId).toMatch(/[0-9a-f-]{36}/);
    // Both runs survive; the log now reads through the fresh run (stage back to parse,
    // while the completed old run had reached report). created_at ordering is not
    // observable here because now() is frozen inside the rollback-isolation transaction.
    expect(result.runs.map((run) => run.id).sort()).toEqual([result.job.runId, oldRunId].sort());
    expect(result.runs.find((run) => run.id === oldRunId)).toMatchObject({ status: "complete" });
    expect(result.runs.find((run) => run.id === result.job.runId)).toMatchObject({ status: "queued" });
    expect(result.log.stage).toBe("parse");

    const kinds = (await auditEvents()).map((row) => row.kind);
    expect(kinds).toContain("log-rerun");
  });

  it("dispatches rerun jobs to the durable queue", async () => {
    const uploaded = await uploadSampleLog();
    const logId = uploaded.log.id;
    await completeRun(db, { organizationId: "org-1", logId, runId: uploaded.job!.runId });
    const { queue, enqueued } = makeQueue();

    const result = await rerunLogAnalysis(db, adminAuth(), { logId }, { logAnalysisQueue: queue });

    expect(enqueued).toEqual([
      {
        name: "analyze-log",
        payload: {
          organizationId: "org-1",
          logId,
          runId: result.job.runId,
          jobId: result.job.id
        },
        idempotencyKey: `log-analysis:${result.job.id}`
      }
    ]);
  });
});
