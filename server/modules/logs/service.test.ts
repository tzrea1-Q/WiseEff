import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import { resolveIntegrationCredential } from "../auth/integrationCredentialResolver";
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
import { issueIntegrationCredential } from "./integrationCredentials";
import { createUserInvocation } from "../auth/trustedInvocation";
import { insertLogDomain } from "./domainsRepository";
import { insertSkillRevision } from "./skillsRepository";
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

  async function integration(skillId?: string) {
    const auth = makeAuth({ permissions: ["logs:admin-domains"] });
    const issued = await issueIntegrationCredential(db, auth,
      { name: "Build upload", skillId }, createUserInvocation(auth), { requestId: "test-integration-service" });
    return resolveIntegrationCredential(db, `Bearer ${issued.token}`);
  }

  it("integration file reuse requires the creating credential and never accepts a shared null uploading user", async () => {
    const owner = await integration();
    const other = await integration();
    const result = await uploadLogFile(db, createMemoryObjectStore(), owner, {
      fileName: "machine.log", contentType: "text/plain", bytes: Buffer.from("machine log")
    });
    expect(result.fileObject).toMatchObject({ uploadedByUserId: null, createdByCredentialId: owner.credentialId });
    expect(result.log).toMatchObject({ createdByCredentialId: owner.credentialId, createdByCredentialName: owner.name });
    const input = { fileObjectId: result.fileObject.id, fileName: "machine.log" };
    await expect(createLogFromFile(db, other, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createLogFromFile(db, makeAuth(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reused = await createLogFromFile(db, owner, input);
    expect(reused.log.createdByCredentialId).toBe(owner.credentialId);
    await expect(getLogRecord(db, other, reused.log.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLogRecord(db, owner, reused.log.id)).resolves.toMatchObject({ id: reused.log.id });
    await expect(getLogRecord(db, makeAuth(), reused.log.id)).resolves.toMatchObject({ id: reused.log.id });
    const rows = await db.query<{ submitted_by_user_id: string | null }>("select submitted_by_user_id from log_records where id=$1", [reused.log.id]);
    expect(rows.rows[0].submitted_by_user_id).toBeNull();
    const audits = await db.query<{ actor_type: string; actor_user_id: string | null; metadata: unknown }>("select actor_type, actor_user_id, metadata from audit_events where target_id=$1", [reused.log.id]);
    expect(audits.rows).toEqual([expect.objectContaining({ actor_type: "integration", actor_user_id: null,
      metadata: expect.objectContaining({ credentialId: owner.credentialId }) })]);
  });

  it("bound integration credentials require matching skill selectors before storing any files", async () => {
    const skill = await insertLogDomain(db, { id: "bound-skill", organizationId: "org-1", name: "Bound skill" });
    await insertSkillRevision(db, { organizationId: "org-1", skillId: skill.id,
      userId: "user-1", spec: { schemaVersion: "skill/v1" }, published: true });
    const principal = await integration(skill.id);
    const store = createMemoryObjectStore();
    const input = { fileName: "machine.log", contentType: "text/plain", bytes: Buffer.from("machine log") };
    for (const selectors of [{}, { skillId: "another-skill" }, { skillKey: "unknown" },
      { skillId: skill.id, logDomainId: "another-skill" }, { skillId: skill.id, skillKey: "unknown" }]) {
      await expect(uploadLogFile(db, store, principal, { ...input, ...selectors })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(store.entries.size).toBe(0);
    await expect(uploadLogFile(db, store, principal, { ...input, skillKey: skill.skillKey })).resolves.toMatchObject({ log: { logDomainId: skill.id } });
  });

  it("integration credentials cannot gain parameter access through upload selectors", async () => {
    const principal = await integration();
    const store = createMemoryObjectStore();
    await expect(uploadLogFile(db, store, principal, { fileName: "machine.log", contentType: "text/plain",
      bytes: Buffer.from("machine log"), relatedParameterId: "parameter-binding" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.entries.size).toBe(0);
  });

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
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", { permission: "logs:upload" }));
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
    await db.query(`insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
      values ($1, 'org-1', $2, 1, 'published', '{"schemaVersion":"skill/v1"}', 'fixture')`, [`revision:${input.id}`, input.id]);
  }

  it("keeps an earlier record's shared object when an identical upload's transaction fails", async () => {
    const objectStore = createMemoryObjectStore();
    const bytes = Buffer.from("INFO original record");
    const input = { fileName: "a.log", contentType: "text/plain", bytes };
    const first = await uploadLogFile(db, objectStore, makeAuth(), input);
    const put = vi.spyOn(objectStore, "put");
    const remove = vi.spyOn(objectStore, "delete");
    const failure = new Error("injected transaction failure");
    vi.spyOn(db, "transaction").mockRejectedValueOnce(failure);

    await expect(uploadLogFile(db, objectStore, makeAuth(), input)).rejects.toBe(failure);

    expect(put).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(await objectStore.get(first.fileObject.storageKey)).toEqual(bytes);
    expect(await getLogRecord(db, makeAuth(), first.log.id)).toMatchObject({ id: first.log.id, status: "processing" });
  });

  it("keeps shared bundle objects when a later object-store put fails", async () => {
    const objectStore = createMemoryObjectStore();
    const bytes = Buffer.from("INFO original record");
    const archive = await new JSZip().file("a.log", bytes).generateAsync({ type: "nodebuffer" });
    const first = await uploadLogFile(db, objectStore, makeAuth(), { fileName: "original.zip", contentType: "application/zip", bytes: archive });
    const put = objectStore.put.bind(objectStore);
    vi.spyOn(objectStore, "put").mockImplementationOnce(put).mockRejectedValueOnce(new Error("injected put failure"));
    const remove = vi.spyOn(objectStore, "delete");
    await expect(uploadLogFile(db, objectStore, makeAuth(), { fileName: "new bundle", contentType: "text/plain", bytes,
      files: [{ fileName: "a.log", bytes }, { fileName: "b.log", bytes: Buffer.from("INFO new") }] })).rejects.toThrow("injected put failure");
    expect(remove).not.toHaveBeenCalled();
    expect(await objectStore.get(first.fileObject.storageKey)).toEqual(bytes);
  });

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
    const put = vi.spyOn(objectStore, "put");

    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "pack-controller.bin",
      contentType: "application/octet-stream",
      bytes: Buffer.from([1, 2, 3, 4])
    });

    expect(objectStore.entries.size).toBe(0);
    expect(put).not.toHaveBeenCalled();
    expect(result.fileObject).toMatchObject({ fileName: "pack-controller.bin" });
    expect(result.fileObject.storageKey).toMatch(/^inline\//);
    expect(result.log.status).toBe("failed");
    expect(result.log.failureReason).toBe("Unsupported log format. Supported extensions: .log, .txt, .csv, .json (archives: .gz, .zip).");
    expect(result.log.files).toMatchObject([{ path: "pack-controller.bin", status: "skipped", skipReason: "二进制文件" }]);
    expect(result.job).toBeNull();

    const jobs = await db.query<{ count: string }>(
      "select count(*)::text as count from jobs where organization_id = $1",
      ["org-1"]
    );
    expect(jobs.rows[0].count).toBe("0");

    const events = await auditEvents();
    expect(events.map((row) => row.kind)).toContain("log-upload-failed");
    expect((await db.query("select metadata from audit_events where target_id=$1", [result.log.id])).rows)
      .toEqual([{ metadata: { fileName: "pack-controller.bin", failureReason: result.log.failureReason, initiator: "user" } }]);
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

  it("stores encoding variants per file with unchanged UTF-8 bytes and BOM semantics", async () => {
    const plain = Buffer.from("INFO plain\r\n");
    const le = Buffer.concat([Buffer.from([255, 254]), Buffer.from("INFO 你好\n", "utf16le")]);
    const files = [
      { fileName: "plain.log", bytes: plain },
      { fileName: "bom.log", bytes: Buffer.from("\ufeffINFO bom\n") },
      { fileName: "le.log", bytes: le },
      { fileName: "be.log", bytes: Buffer.from(le).swap16() },
      { fileName: "lossy.log", bytes: Buffer.from([0xff, 0x61]) }
    ];
    const objectStore = createMemoryObjectStore();
    const put = vi.spyOn(objectStore, "put");
    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "encodings", contentType: "text/plain", bytes: plain, files
    });
    const stored = put.mock.calls.filter(([input]) => input.contentType.startsWith("text/plain")).map(([input]) => input.bytes);
    expect(stored[0]).toBe(plain);
    expect(stored[1].buffer).toBe(files[1].bytes.buffer);
    expect(stored[1].byteOffset).toBe(files[1].bytes.byteOffset + 3);
    expect(stored.map((bytes) => bytes.toString("utf8"))).toEqual(["INFO plain\r\n", "INFO bom\n", "INFO 你好\n", "INFO 你好\n", "�a"]);
    const normalized = await db.query<{ object_key: string }>("select object_key from log_files where record_id=$1 order by path", [result.log.id]);
    expect(await Promise.all(normalized.rows.map(async ({ object_key }) => (await objectStore.get(object_key)).toString("utf8")))).toEqual(["INFO 你好\n", "INFO bom\n", "INFO 你好\n", "�a", "INFO plain\r\n"]);
    const originals = await db.query<{ file_name: string; object_key: string }>("select file_name, object_key from log_original_uploads where record_id=$1 order by position", [result.log.id]);
    expect(originals.rows.map((row) => row.file_name)).toEqual(files.map((file) => file.fileName));
    expect(await Promise.all(originals.rows.map((row) => objectStore.get(row.object_key)))).toEqual(files.map((file) => file.bytes));
    expect(result.log.files?.map(({ encoding, lossy }) => ({ encoding, lossy }))).toEqual([
      { encoding: "utf-8", lossy: false }, { encoding: "utf-8", lossy: false }, { encoding: "utf-16le", lossy: false },
      { encoding: "utf-16be", lossy: false }, { encoding: "utf-8", lossy: true }
    ]);
    for (const file of result.log.files ?? []) { expect(file).not.toHaveProperty("bytes"); expect(file).not.toHaveProperty("text"); }
  });

  it("accepts a multi-entry zip with one job and inventory for each file", async () => {
    const archive = new JSZip().file("a.log", "INFO a").file("b.log", "INFO b");
    const objectStore = createMemoryObjectStore();
    const { queue, enqueued } = makeQueue();
    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "bundle.zip", contentType: "application/zip", bytes: await archive.generateAsync({ type: "nodebuffer" })
    }, { logAnalysisQueue: queue });
    expect(result.log.status).toBe("processing");
    expect(result.log.files).toMatchObject([{ path: "a.log", status: "analyzed" }, { path: "b.log", status: "analyzed" }]);
    expect(result.job).toMatchObject({ status: "queued" });
    expect(enqueued).toHaveLength(1);
    expect(objectStore.entries.size).toBe(3);
    expect((await auditEvents()).map((event) => event.kind)).toEqual(["log-upload"]);
  });

  it.each([
    ["bundle.zip", Buffer.from("not a zip archive"), "完整性"],
    ["bomb.log.gz", gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61)), "解压大小"]
  ])("records rejected %s with an inline key, failure audit and no job", async (fileName, bytes, rule) => {
    const objectStore = createMemoryObjectStore();
    const put = vi.spyOn(objectStore, "put");
    const { queue, enqueued } = makeQueue();
    const result = await uploadLogFile(db, objectStore, makeAuth(), { fileName, contentType: "application/octet-stream", bytes }, { logAnalysisQueue: queue });
    expect(result.log.status).toBe("failed");
    expect(result.log.failureReason).toContain(rule);
    expect(result.fileObject.storageKey).toMatch(/^inline\//);
    expect(result.job).toBeNull();
    expect(objectStore.entries.size).toBe(0); expect(enqueued).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();
    expect((await db.query("select status, failure_reason from log_records where id=$1", [result.log.id])).rows)
      .toEqual([{ status: "failed", failure_reason: result.log.failureReason }]);
    expect((await db.query("select id from jobs where organization_id='org-1'")).rows).toHaveLength(0);
    expect((await db.query("select kind, metadata from audit_events where target_id=$1", [result.log.id])).rows)
      .toEqual([{ kind: "log-upload-failed", metadata: { fileName, failureReason: result.log.failureReason, initiator: "user" } }]);
  });

  it("audits a skipped-only bundle in Chinese and retains its inventory without storing objects", async () => {
    const archive = new JSZip().file("snapshot.bin", Buffer.from([0, 1])).file("readme.pdf", "text");
    const objectStore = createMemoryObjectStore();
    const put = vi.spyOn(objectStore, "put");
    const { queue, enqueued } = makeQueue();
    const result = await uploadLogFile(db, objectStore, makeAuth(), {
      fileName: "skipped.zip", contentType: "application/zip", bytes: await archive.generateAsync({ type: "nodebuffer" })
    }, { logAnalysisQueue: queue });
    expect(result.log).toMatchObject({ status: "failed", failureReason: "日志包中没有可分析的文本文件", files: [
      { path: "snapshot.bin", status: "skipped", skipReason: "二进制文件" },
      { path: "readme.pdf", status: "skipped", skipReason: "不支持的文件扩展名" }
    ] });
    expect(result.fileObject.storageKey).toMatch(/^inline\//);
    expect(put).not.toHaveBeenCalled();
    expect(result.job).toBeNull();
    expect(enqueued).toEqual([]);
    expect((await db.query("select kind, metadata from audit_events where target_id=$1", [result.log.id])).rows)
      .toEqual([{ kind: "log-upload-failed", metadata: { fileName: "skipped.zip", failureReason: result.log.failureReason, initiator: "user" } }]);
    expect((await db.query("select object_key from log_files where record_id=$1", [result.log.id])).rows)
      .toEqual([{ object_key: null }, { object_key: null }]);
  });

  it("createLogFromFile refuses to reanalyze a rejected (never stored) archive on repeated replay", async () => {
    const rejected = await uploadLogFile(db, createMemoryObjectStore(), makeAuth(), {
      fileName: "bomb.log.gz", contentType: "application/gzip", bytes: gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61))
    });
    expect(rejected.log.status).toBe("failed");
    expect(rejected.fileObject.storageKey).toMatch(/^inline\//);
    const { queue, enqueued } = makeQueue();
    for (let attempt = 0; attempt < 2; attempt++) {
      const replay = await createLogFromFile(db, makeAuth(), { fileObjectId: rejected.fileObject.id, fileName: "bomb.log.gz" }, { logAnalysisQueue: queue });
      expect(replay.log.status).toBe("failed");
      expect(replay.job).toBeNull();
    }
    expect(enqueued).toEqual([]);
    expect((await db.query("select id from jobs where organization_id='org-1'")).rows).toHaveLength(0);
    expect((await auditEvents()).map((event) => event.kind)).toEqual(["log-upload-failed", "log-upload-failed", "log-upload-failed"]);
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
      new ApiError("VALIDATION_FAILED", "File name does not match the stored file object.")
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
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "File object ownership is required."));

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
      new ApiError("FORBIDDEN", "Forbidden.", { permission: "logs:archive" })
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
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", { permission: "logs:feedback" }));

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
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", { permission: "logs:view" }));

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
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", { permission: "logs:analyze" }));

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
