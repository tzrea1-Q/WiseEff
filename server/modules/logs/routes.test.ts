import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { ApiError } from "../../shared/http/errors";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import * as service from "./service";
import type { LogRecordDto } from "./types";

vi.mock("./service", () => ({
  archiveLogRecord: vi.fn(),
  createLogFromFile: vi.fn(),
  getLogRecord: vi.fn(),
  listLogRecords: vi.fn(),
  listLogRuns: vi.fn(),
  rerunLogAnalysis: vi.fn(),
  submitLogFeedback: vi.fn(),
  unarchiveLogRecord: vi.fn(),
  uploadLogFile: vi.fn()
}));

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
    roles: [{ projectId: "aurora", roleId: "software-user" }],
    permissions: ["logs:view", "logs:upload", "logs:feedback", "logs:archive", "logs:analyze"],
    ...overrides
  };
}

function fileObjectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    organization_id: "org-1",
    project_id: "aurora",
    storage_key: "org-1/checksum-charging-foldback.log",
    file_name: "charging-foldback.log",
    content_type: "text/plain",
    file_size_bytes: 32,
    checksum_sha256: "checksum",
    uploaded_by_user_id: "user-1",
    created_at: "2026-05-25T02:00:00.000Z",
    ...overrides
  };
}

function makeDb(rows: unknown[] = [fileObjectRow()]): Database {
  const query: Database["query"] = async <Row,>() => ({ rows: rows as Row[], rowCount: rows.length });
  return {
    query: vi.fn(query) as Database["query"],
    transaction: vi.fn()
  };
}

function makeObjectStore(): ObjectStore {
  return {
    put: vi.fn(),
    get: vi.fn()
  };
}

function logRecord(overrides: Partial<LogRecordDto> = {}): LogRecordDto {
  return {
    id: "log-1",
    reportId: "",
    fileName: "charging-foldback.log",
    projectId: "aurora",
    source: "upload",
    fileSizeBytes: 32,
    status: "processing" as const,
    archiveState: "active" as const,
    stage: "parse" as const,
    confidence: 0,
    conclusion: "Log analysis is queued or processing.",
    impact: "Analysis results will be available after processing completes.",
    evidence: [],
    suggestedActions: [],
    severity: "Info" as const,
    rawLines: [],
    capturedAt: "2026-05-25T02:00:00.000Z",
    updatedAt: "2026-05-25T02:00:00.000Z",
    submittedBy: "Riley Chen",
    ...overrides
  };
}

function jobRecord() {
  return {
    id: "job-1",
    kind: "log-analysis" as const,
    logId: "log-1",
    runId: "run-1",
    status: "queued" as const,
    progress: 0,
    currentStage: "parse" as const,
    error: null,
    updatedAt: "2026-05-25T02:00:00.000Z"
  };
}

function fileObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    organizationId: "org-1",
    projectId: "aurora",
    storageKey: "org-1/checksum-charging-foldback.log",
    fileName: "charging-foldback.log",
    contentType: "text/plain",
    fileSizeBytes: 32,
    checksumSha256: "checksum",
    uploadedByUserId: "user-1",
    createdAt: "2026-05-25T02:00:00.000Z",
    ...overrides
  };
}

function makeServer(options: { db?: Database; objectStore?: ObjectStore; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerLogRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

describe("log routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v1/log-files accepts JSON base64 and returns fileObject, log, and job", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const log = logRecord();
    const job = jobRecord();
    const file = fileObject();
    vi.mocked(service.uploadLogFile).mockResolvedValue({ fileObject: file, log, job });

    const response = await requestJson<{ fileObject: typeof file; log: typeof log; job: typeof job }>(
      makeServer({ db, objectStore }),
      "/api/v1/log-files",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "aurora",
          fileName: "charging-foldback.log",
          contentType: "text/plain",
          contentBase64: Buffer.from("WARN foldback").toString("base64"),
          analysisQuestion: "Why did fast charging fold back?"
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ fileObject: file, log, job });
    expect(db.query).not.toHaveBeenCalled();
    expect(service.uploadLogFile).toHaveBeenCalledWith(db, objectStore, makeAuth(), {
      projectId: "aurora",
      fileName: "charging-foldback.log",
      contentType: "text/plain",
      bytes: Buffer.from("WARN foldback"),
      analysisQuestion: "Why did fast charging fold back?"
    });
  });

  it("POST /api/v1/log-files returns the created file object without looking up older matching rows", async () => {
    const priorFile = fileObject({ id: "file-prior", storageKey: "org-1/old-charging-foldback.log" });
    const createdFile = fileObject({ id: "file-created", storageKey: "org-1/new-charging-foldback.log" });
    const db = makeDb([fileObjectRow({ id: priorFile.id, storage_key: priorFile.storageKey })]);
    const objectStore = makeObjectStore();
    const log = logRecord();
    const job = jobRecord();
    vi.mocked(service.uploadLogFile).mockResolvedValue({ fileObject: createdFile, log, job });

    const response = await requestJson<{ fileObject: typeof createdFile; log: typeof log; job: typeof job }>(
      makeServer({ db, objectStore }),
      "/api/v1/log-files",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "aurora",
          fileName: "charging-foldback.log",
          contentType: "text/plain",
          contentBase64: Buffer.from("WARN foldback").toString("base64")
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.fileObject).toEqual(createdFile);
    expect(response.body.fileObject).not.toEqual(priorFile);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("unsupported file returns 201 with failed log and null job", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const log = logRecord({ fileName: "dump.bin", status: "failed", failureReason: "Unsupported log format." });
    const file = fileObject({ fileName: "dump.bin", contentType: "application/octet-stream" });
    vi.mocked(service.uploadLogFile).mockResolvedValue({ fileObject: file, log, job: null });

    const response = await requestJson<{ fileObject: typeof file; log: typeof log; job: null }>(
      makeServer({ db, objectStore }),
      "/api/v1/log-files",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "aurora",
          fileName: "dump.bin",
          contentType: "application/octet-stream",
          contentBase64: Buffer.from([1, 2, 3]).toString("base64")
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.log).toMatchObject({ status: "failed", failureReason: "Unsupported log format." });
    expect(response.body.job).toBeNull();
    expect(response.body.fileObject).toEqual(file);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("GET /api/v1/logs passes filters", async () => {
    const db = makeDb();
    vi.mocked(service.listLogRecords).mockResolvedValue({ items: [] });

    const response = await requestJson(makeServer({ db, objectStore: makeObjectStore() }), "/api/v1/logs?projectId=aurora&includeArchived=true");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
    expect(service.listLogRecords).toHaveBeenCalledWith(db, makeAuth(), {
      projectId: "aurora",
      includeArchived: true
    });
  });

  it("GET /api/v1/logs/:logId uses route params", async () => {
    const db = makeDb();
    const log = logRecord({ id: "log-route" });
    vi.mocked(service.getLogRecord).mockResolvedValue(log);

    const response = await requestJson<{ item: typeof log }>(makeServer({ db, objectStore: makeObjectStore() }), "/api/v1/logs/log-route");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: log });
    expect(service.getLogRecord).toHaveBeenCalledWith(db, makeAuth(), "log-route");
  });

  it("validation failure returns VALIDATION_FAILED", async () => {
    const db = makeDb();

    const response = await requestJson<{ error: { code: string; details: { issues?: unknown[] } } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/log-files",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "aurora",
          fileName: "charging-foldback.log",
          contentType: "text/plain",
          contentBase64: "not-base64"
        })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.issues).toEqual(expect.any(Array));
    expect(service.uploadLogFile).not.toHaveBeenCalled();
  });

  it("forbidden archive returns FORBIDDEN", async () => {
    const db = makeDb();
    vi.mocked(service.archiveLogRecord).mockRejectedValue(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "logs:archive" }));

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/logs/log-1/archive",
      { method: "POST", body: "{}" }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("feedback route writes through service", async () => {
    const db = makeDb();
    vi.mocked(service.submitLogFeedback).mockResolvedValue(undefined);

    const response = await requestJson(makeServer({ db, objectStore: makeObjectStore() }), "/api/v1/logs/log-1/feedback", {
      method: "POST",
      body: JSON.stringify({ rating: "helpful", note: "Matched the incident." })
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(service.submitLogFeedback).toHaveBeenCalledWith(db, makeAuth(), {
      logId: "log-1",
      rating: "helpful",
      note: "Matched the incident."
    });
  });
});
