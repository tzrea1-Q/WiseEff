import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore, StoredObject } from "./objectStore";
import {
  archiveLogRecord,
  createLogFromFile,
  getLogRecord,
  listLogRecords,
  rerunLogAnalysis,
  submitLogFeedback,
  unarchiveLogRecord,
  uploadLogFile
} from "./service";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const transactions: QueryCall[][] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(calls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => {
      const result = await fn(tx);
      transactions.push([...txCalls]);
      return result;
    }
  };

  return { calls, txCalls, transactions, db };
}

function makeObjectStore(stored: StoredObject = storedObject()) {
  const puts: Array<{ organizationId: string; fileName: string; contentType: string; bytes: Buffer }> = [];
  const objectStore: ObjectStore = {
    async put(input) {
      puts.push(input);
      return stored;
    },
    async get() {
      return Buffer.from("stored");
    }
  };

  return { objectStore, puts };
}

function storedObject(overrides: Partial<StoredObject> = {}): StoredObject {
  return {
    storageKey: "org-1/checksum-pack-controller.log",
    fileName: "pack-controller.log",
    contentType: "text/plain",
    fileSizeBytes: 2048,
    checksumSha256: "checksum",
    ...overrides
  };
}

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "software-user" }],
    permissions: ["logs:view", "logs:upload", "logs:feedback"],
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
    ...overrides
  });
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    report_id: null,
    file_name: "pack-controller.log",
    project_id: "project-1",
    source: "upload",
    file_size_bytes: 2048,
    status: "processing",
    archive_state: "active",
    stage: "parse",
    confidence: null,
    conclusion: null,
    impact: null,
    suggested_actions: null,
    severity: null,
    raw_lines: null,
    captured_at: "2026-05-25T02:00:00.000Z",
    updated_at: "2026-05-25T02:00:00.000Z",
    submitted_by: "Riley Chen",
    related_parameter_id: null,
    failure_reason: null,
    analysis_question: null,
    ...overrides
  };
}

describe("log service", () => {
  it("guest can list logs but cannot upload", async () => {
    const { db, calls } = createFakeDb([[logRow()]]);
    const guest = makeAuth({ roles: [{ projectId: null, roleId: "guest" }], permissions: ["logs:view"] });
    const { objectStore, puts } = makeObjectStore();

    const logs = await listLogRecords(db, guest, {});

    expect(logs.items).toHaveLength(1);
    expect(calls[0].text).toContain("from log_records");

    await expect(
      uploadLogFile(db, objectStore, guest, {
        projectId: "project-1",
        fileName: "pack-controller.log",
        contentType: "text/plain",
        bytes: Buffer.from("line one")
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:upload" }));
    expect(puts).toHaveLength(0);
  });

  it("scopes list queries to the caller project roles", async () => {
    const { db, calls } = createFakeDb([[logRow()]]);

    await listLogRecords(db, makeAuth(), {});

    expect(calls[0].text).toContain("lr.project_id = any");
    expect(calls[0].values).toEqual(["org-1", ["project-1"]]);
  });

  it("denies cross-project list and upload before object storage", async () => {
    const { db } = createFakeDb();
    const { objectStore, puts } = makeObjectStore();

    await expect(listLogRecords(db, crossProjectAuth(), { projectId: "project-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Log project access is required.", 403)
    );
    await expect(
      uploadLogFile(db, objectStore, crossProjectAuth(), {
        projectId: "project-1",
        fileName: "pack-controller.log",
        contentType: "text/plain",
        bytes: Buffer.from("line one")
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Log project access is required.", 403));

    expect(puts).toHaveLength(0);
  });

  it("denies cross-project get, rerun, archive, and feedback before writes", async () => {
    const { db, calls, txCalls } = createFakeDb([
      [logRow({ project_id: "project-1" })],
      [],
      [logRow({ project_id: "project-1" })],
      [],
      [logRow({ project_id: "project-1" })],
      [],
      [logRow({ project_id: "project-1" })],
      []
    ]);

    await expect(getLogRecord(db, crossProjectAuth(), "log-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Log project access is required.", 403)
    );
    await expect(rerunLogAnalysis(db, adminAuth({ roles: [{ projectId: "project-2", roleId: "admin" }] }), { logId: "log-1" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Log project access is required.", 403)
    );
    await expect(archiveLogRecord(db, adminAuth({ roles: [{ projectId: "project-2", roleId: "admin" }] }), "log-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Log project access is required.", 403)
    );
    await expect(
      submitLogFeedback(db, crossProjectAuth(), {
        logId: "log-1",
        rating: "helpful"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Log project access is required.", 403));

    expect(calls.length + txCalls.length).toBeGreaterThan(0);
    expect(txCalls.some((call) => call.text.includes("insert into jobs"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("user with logs:upload can upload supported .log, creating processing record and queued job", async () => {
    const { db, txCalls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          project_id: "project-1",
          storage_key: "org-1/checksum-pack-controller.log",
          file_name: "pack-controller.log",
          content_type: "text/plain",
          file_size_bytes: 2048,
          checksum_sha256: "checksum",
          uploaded_by_user_id: "user-1",
          created_at: "2026-05-25T02:00:00.000Z"
        }
      ],
      [logRow()],
      [{ id: "run-1", log_record_id: "log-1", status: "queued", current_stage: "parse", progress: 0, error_message: null, updated_at: "2026-05-25T02:00:00.000Z" }],
      [{ id: "job-1", kind: "log-analysis", target_id: "run-1", status: "queued", progress: 0, current_stage: "parse", error_message: null, updated_at: "2026-05-25T02:00:00.000Z" }],
      [logRow()],
      []
    ]);
    const { objectStore, puts } = makeObjectStore();

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      projectId: "project-1",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      bytes: Buffer.from("line one")
    });

    expect(puts).toHaveLength(1);
    expect(result.log.status).toBe("processing");
    expect(result.job).toMatchObject({ kind: "log-analysis", status: "queued", currentStage: "parse" });
    expect(txCalls.some((call) => call.text.includes("insert into log_file_objects"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into jobs"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("log-upload");
  });

  it("unsupported .bin creates Failed record with failureReason and no queued worker job", async () => {
    const { db, txCalls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          project_id: "project-1",
          storage_key: "org-1/checksum-pack-controller.bin",
          file_name: "pack-controller.bin",
          content_type: "application/octet-stream",
          file_size_bytes: 4,
          checksum_sha256: "checksum",
          uploaded_by_user_id: "user-1",
          created_at: "2026-05-25T02:00:00.000Z"
        }
      ],
      [logRow({ file_name: "pack-controller.bin", status: "failed", failure_reason: "Unsupported log format. Supported extensions: .log, .txt, .csv." })],
      []
    ]);
    const { objectStore, puts } = makeObjectStore(
      storedObject({
        storageKey: "org-1/checksum-pack-controller.bin",
        fileName: "pack-controller.bin",
        contentType: "application/octet-stream",
        fileSizeBytes: 4
      })
    );

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      projectId: "project-1",
      fileName: "pack-controller.bin",
      contentType: "application/octet-stream",
      bytes: Buffer.from([1, 2, 3, 4])
    });

    expect(puts).toHaveLength(0);
    expect(result.log.status).toBe("failed");
    expect(result.log.failureReason).toContain("Unsupported log format");
    expect(result.job).toBeNull();
    expect(txCalls.some((call) => call.text.includes("insert into jobs"))).toBe(false);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("log-upload-failed");
  });

  it("createLogFromFile validates file object ownership and canonical file name", async () => {
    const { db, txCalls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          project_id: "project-2",
          storage_key: "org-1/checksum-pack-controller.log",
          file_name: "pack-controller.log",
          content_type: "text/plain",
          file_size_bytes: 2048,
          checksum_sha256: "checksum",
          uploaded_by_user_id: "user-1",
          created_at: "2026-05-25T02:00:00.000Z"
        }
      ]
    ]);

    await expect(
      createLogFromFile(db, makeAuth(), {
        projectId: "project-1",
        fileObjectId: "file-1",
        fileName: "caller-name.log"
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "File object does not belong to the requested project.", 400));

    expect(txCalls.some((call) => call.text.includes("insert into log_records"))).toBe(false);
  });

  it("createLogFromFile rejects file objects uploaded by another user before writes", async () => {
    const { db, txCalls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          project_id: "project-1",
          storage_key: "org-1/checksum-pack-controller.log",
          file_name: "pack-controller.log",
          content_type: "text/plain",
          file_size_bytes: 2048,
          checksum_sha256: "checksum",
          uploaded_by_user_id: "other-user",
          created_at: "2026-05-25T02:00:00.000Z"
        }
      ]
    ]);

    await expect(
      createLogFromFile(db, makeAuth(), {
        projectId: "project-1",
        fileObjectId: "file-1",
        fileName: "pack-controller.log"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "File object ownership is required.", 403));

    expect(txCalls.some((call) => call.text.includes("insert into log_records"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into jobs"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("non-admin cannot archive; admin can archive and unarchive", async () => {
    const { db, txCalls } = createFakeDb([
      [logRow({ archive_state: "archived" })],
      [],
      [logRow({ archive_state: "archived" })],
      [],
      [logRow({ archive_state: "active" })],
      [],
      [logRow({ archive_state: "active" })],
      []
    ]);

    await expect(archiveLogRecord(db, makeAuth(), "log-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:archive" })
    );

    const archived = await archiveLogRecord(db, adminAuth(), "log-1");
    const unarchived = await unarchiveLogRecord(db, adminAuth(), "log-1");

    expect(archived.archiveState).toBe("archived");
    expect(unarchived.archiveState).toBe("active");
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("log-archive");
    expect(txCalls.filter((call) => call.text.includes("insert into audit_events"))[1].values).toContain("log-unarchive");
  });

  it("feedback requires logs:feedback and writes audit", async () => {
    const { db, txCalls } = createFakeDb([[logRow()], [], [], []]);

    await expect(
      submitLogFeedback(db, makeAuth({ permissions: ["logs:view"] }), {
        logId: "log-1",
        rating: "helpful",
        note: "Matched the incident."
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:feedback" }));

    await submitLogFeedback(db, makeAuth(), {
      logId: "log-1",
      rating: "helpful",
      note: "Matched the incident."
    });

    expect(txCalls.some((call) => call.text.includes("insert into log_feedback"))).toBe(true);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-feedback");
    expect(auditCall?.values).toContain("project-1");
  });

  it("rerun requires logs:analyze or admin, creates a new run and job, and keeps old run history", async () => {
    const { db, txCalls } = createFakeDb([
      [logRow({ status: "complete", current_run_id: "run-old" })],
      [],
      [{ id: "run-new", log_record_id: "log-1", status: "queued", current_stage: "parse", progress: 0, error_message: null, updated_at: "2026-05-25T03:00:00.000Z" }],
      [{ id: "job-new", kind: "log-analysis", target_id: "run-new", status: "queued", progress: 0, current_stage: "parse", error_message: null, updated_at: "2026-05-25T03:00:00.000Z" }],
      [],
      [logRow({ status: "processing", current_run_id: "run-new" })],
      [],
      [],
      [
        { id: "run-new", log_record_id: "log-1", status: "queued", current_stage: "parse", progress: 0, error_message: null, updated_at: "2026-05-25T03:00:00.000Z" },
        { id: "run-old", log_record_id: "log-1", status: "complete", current_stage: "report", progress: 100, error_message: null, updated_at: "2026-05-25T02:00:00.000Z" }
      ]
    ]);

    await expect(
      rerunLogAnalysis(db, makeAuth({ permissions: ["logs:view"] }), { logId: "log-1" })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:analyze" }));

    const result = await rerunLogAnalysis(db, adminAuth(), { logId: "log-1", analysisQuestion: "Try again" });

    expect(result.log.status).toBe("processing");
    expect(result.job).toMatchObject({ id: "job-new", status: "queued" });
    expect(result.job.runId).toMatch(/[0-9a-f-]{36}/);
    expect(result.runs.map((run) => run.id)).toEqual(["run-new", "run-old"]);
    expect(txCalls.some((call) => call.text.includes("insert into log_analysis_runs"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into jobs"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("log-rerun");
  });
});
