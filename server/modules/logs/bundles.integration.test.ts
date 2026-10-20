import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolveRouteBodyLimit } from "../../app";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { uploadLogFile, getLogRecord, createLogFromFile, rerunLogAnalysis } from "./service";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer } from "./analyzer";
import { parseLogText } from "./parser";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { createLogAnalyzerFromEnv } from "./analyzer/analyzerFromEnv";

const available = await isTestDatabaseAvailable();
const auth = (organizationId = "bundle-org") => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze"] });

describe.skipIf(!available)("bundle upload and analysis over PostgreSQL", () => {
  it("completes the acceptance gzip fixture with the legacy model calls when no skill budget is set", async () => {
    const ephemeral = await createEphemeralTestDatabase("factorygz");
    const db = createPostgresDatabase(ephemeral.url);
    const objectStore = createMemoryObjectStore();
    try {
      const organizationId = "factory-gzip-org";
      await seedCoreGraph(db, { organization: { id: organizationId, name: organizationId },
        users: [{ id: `${organizationId}-admin`, name: "Admin" }] });
      const calls: string[] = [];
      const analyzer = createLogAnalyzerFromEnv({ LOG_ANALYSIS_DETERMINISTIC: true, LOG_ANALYSIS_KERNEL: "loop",
        LOG_ANALYSIS_API_TIMEOUT_MS: 1000, LOG_ANALYSIS_TOKEN_BUDGET: 8000, LOG_ANALYSIS_MAX_STEPS: 6 },
      { telemetry: { recordLlmCall: (call) => { calls.push(call.outcome); } } });
      const content = await readFile(new URL("../../../test-fixtures/logs/charging-foldback.log", import.meta.url));
      const uploaded = await uploadLogFile(db, objectStore, auth(organizationId), { fileName: "charging-foldback.log.gz",
        contentType: "application/gzip", bytes: gzipSync(content), skillSelection: "generic", analysisQuestion: "Why did fast charging fold back?" });
      expect(await processLogAnalysisJobById({ db, objectStore, analyzer, jobId: uploaded.job!.id })).toEqual({ status: "processed" });
      expect(await getLogRecord(db, auth(organizationId), uploaded.log.id)).toMatchObject({ status: "complete",
        skillRevision: null, analysisSource: "agent", conclusion: expect.stringMatching(/过热|降额/) });
      expect(calls).toEqual(["ok", "ok", "ok"]);
    } finally { await db.close(); await ephemeral.drop(); }
  });
  it("bounds collection before parsing a log upload body", () => {
    for (const path of ["/api/v1/log-files", "/api//v1/log-files/"]) {
      expect(resolveRouteBodyLimit({ method: "POST", path })).toBe(Math.ceil(100 * 1024 * 1024 * 4 / 3) + 4 * 1024 * 1024);
    }
    expect(resolveRouteBodyLimit({ method: "GET", path: "/api/v1/log-files" })).toBe(Infinity);
  });
  it("persists inventory atomically, grounds both files, isolates tenants, and audits rejected uploads without storing bytes", async () => {
    const ephemeral = await createEphemeralTestDatabase("logbundles");
    const db = createPostgresDatabase(ephemeral.url);
    const objectStore = createMemoryObjectStore();
    try {
      for (const id of ["bundle-org", "other-org"]) await seedCoreGraph(db, { organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }] });
      const zip = new JSZip();
      zip.file("device/a.log", "INFO boot\nERROR code=E_FIRST\n");
      zip.file("device/b.log", "ERROR code=E_SECOND\nINFO done\n");
      zip.file("snapshot.bin", Buffer.from([0, 1, 2])); zip.file("readme.pdf", "unsupported");
      const originalBytes = await zip.generateAsync({ type: "nodebuffer" });
      const created = await uploadLogFile(db, objectStore, auth(), { fileName: "device.zip", contentType: "application/zip", bytes: originalBytes });
      expect(created.log.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "snapshot.bin", status: "skipped", skipReason: "二进制文件" }),
        expect.objectContaining({ path: "readme.pdf", status: "skipped", skipReason: "不支持的文件扩展名" })
      ]));
      expect(objectStore.entries.size).toBe(3);
      const original = (await db.query<{ object_key: string }>("select object_key from log_original_uploads where record_id=$1", [created.log.id])).rows;
      expect(original).toHaveLength(1);
      expect(await objectStore.get(original[0].object_key)).toEqual(originalBytes);
      expect((await db.query(`select path, skip_reason from log_files where record_id=$1 and status='skipped' order by path`, [created.log.id])).rows)
        .toEqual([{ path: "readme.pdf", skip_reason: "不支持的文件扩展名" }, { path: "snapshot.bin", skip_reason: "二进制文件" }]);
      const analyzer = createAgentLoopLogAnalyzer({ model: createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "search_lines", args: { pattern: "ERROR", neighborhood: 0 } } },
        { content: { action: "final", conclusion: "Both devices failed", impact: "device", severity: "Warning", confidence: 0.8,
          suggestedActions: ["Inspect both"], evidence: [
            { filePath: "device/a.log", lineNumbers: [2], inference: "first", suggestedAction: "inspect" },
            { filePath: "device/b.log", lineNumbers: [1], inference: "second", suggestedAction: "inspect" }
          ] } }
      ]), modelLabel: "scripted", tokenBudget: 8000, maxSteps: 4 });
      await expect(processLogAnalysisJobById({ db, objectStore, jobId: created.job!.id, analyzer })).resolves.toMatchObject({ status: "processed" });
      const report = await getLogRecord(db, auth(), created.log.id);
      expect(report).toMatchObject({ status: "complete", analysisSource: "agent", evidence: [
        { filePath: "device/a.log", lineNumbers: [2] }, { filePath: "device/b.log", lineNumbers: [1] }
      ] });
      expect((await db.query(`select file_path from log_evidence where log_record_id=$1 order by file_path`, [created.log.id])).rows)
        .toEqual([{ file_path: "device/a.log" }, { file_path: "device/b.log" }]);
      const copied = await createLogFromFile(db, auth(), { fileObjectId: created.fileObject.id, fileName: created.fileObject.fileName });
      expect(copied.log.files).toHaveLength(4);
      await processLogAnalysisJobById({ db, objectStore, jobId: copied.job!.id });
      expect((await getLogRecord(db, auth(), copied.log.id)).evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ filePath: "device/a.log" }), expect.objectContaining({ filePath: "device/b.log" })
      ]));
      await expect(getLogRecord(db, auth("other-org"), created.log.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Composite FK rejects an inventory whose tenant differs from its record.
      await expect(db.query(`insert into log_files (id, organization_id, record_id, path, size_bytes, sha256, encoding, line_count, status, skip_reason)
        values ('wrong-org','other-org',$1,'bad.bin',0,'hash','utf-8',0,'skipped','binary')`, [created.log.id])).rejects.toMatchObject({ code: "23503" });
      const count = async () => (await db.query<{ records: string; objects: string; files: string; jobs: string }>(`select (select count(*) from log_records) as records,
        (select count(*) from log_file_objects) as objects, (select count(*) from log_files) as files,
        (select count(*) from jobs) as jobs`)).rows[0];
      const before = await count(), objects = objectStore.entries.size;
      const malicious = new JSZip(); malicious.file("../escape.log", "ERROR");
      const rejected = await uploadLogFile(db, objectStore, auth(), { fileName: "bad.zip", contentType: "application/zip", bytes: await malicious.generateAsync({ type: "nodebuffer" }) });
      expect(rejected.log).toMatchObject({ status: "failed", failureReason: expect.stringContaining("路径") });
      expect(rejected.fileObject.storageKey).toMatch(/^inline\//);
      expect(rejected.job).toBeNull();
      expect(await count()).toEqual({ ...before, records: String(Number(before.records) + 1), objects: String(Number(before.objects) + 1) });
      expect(objectStore.entries.size).toBe(objects);
      expect((await db.query("select kind, metadata from audit_events where target_id=$1", [rejected.log.id])).rows)
        .toEqual([{ kind: "log-upload-failed", metadata: { fileName: "bad.zip", failureReason: rejected.log.failureReason, initiator: "user" } }]);
      const text = "INFO boot\nERROR code=E_FIRST\n";
      const single = await uploadLogFile(db, objectStore, auth(), { fileName: "single.log", contentType: "text/plain", bytes: Buffer.from(text), skillSelection: "generic" });
      await processLogAnalysisJobById({ db, objectStore, jobId: single.job!.id });
      const singleReport = await getLogRecord(db, auth(), single.log.id);
      const parsed = parseLogText({ fileName: "single.log", content: text });
      if (!parsed.ok) throw new Error(parsed.reason);
      const previous = await createRuleBasedLogAnalyzer().analyze({ parsed, filePath: "single.log" });
      expect(singleReport.conclusion).toBe(previous.conclusion);
      expect(singleReport.rawLines).toEqual(parsed.rawLines);
      expect(singleReport.evidence.map(({ id: _id, ...item }) => item)).toEqual(previous.evidence);
      expect(singleReport.evidence).toMatchObject([{ ruleHit: "error-code", filePath: "single.log", lineNumbers: [2] }, { ruleHit: "generic:first-error", filePath: "single.log", lineNumbers: [2] }]);
      expect(singleReport.files).toMatchObject([{ path: "single.log", status: "analyzed" }]);
      const utf16Text = `INFO ${"a".repeat(90)}${"\0".repeat(7)}\n`;
      const utf16 = await uploadLogFile(db, objectStore, auth(), { fileName: "utf16.log", contentType: "text/plain",
        bytes: Buffer.concat([Buffer.from([255, 254]), Buffer.from(utf16Text, "utf16le")]) });
      expect(utf16.log.files).toMatchObject([{ encoding: "utf-16le", status: "skipped", skipReason: "二进制文件" }]);
      expect(utf16.job).toBeNull();
      // Legacy records with no inventory still use their original object.
      await db.query("delete from log_files where record_id=$1", [single.log.id]);
      const legacyRun = await rerunLogAnalysis(db, auth(), { logId: single.log.id });
      await processLogAnalysisJobById({ db, objectStore, jobId: legacyRun.job.id });
      expect((await getLogRecord(db, auth(), single.log.id)).conclusion).toBe(previous.conclusion);
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth() });
      const boundary = "bundle-test-boundary";
      const multipart = Buffer.from(["设备一.log", "two.log"].map((name) => `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\nINFO ${name}\r\n`).join("") + `--${boundary}--\r\n`);
      const response = await requestJson<{ log: { files: Array<{ path: string }> } }>(createHttpServer(router), "/api/v1/log-files", {
        method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: multipart
      });
      expect(response.status).toBe(201); expect(response.body.log.files.map((file) => file.path)).toEqual(["设备一.log", "two.log"]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
