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
import type { LogRecordDto } from "./types";
import type { LogDeletionPreview } from "../../../src/domain/logs/deletionPreview";
import { logDeletionPreviewSchema } from "../../../src/domain/logs/deletionPreview";
import { registerKnowledgeRoutes } from "../knowledge/routes";
import { processLogAnalysisJobById } from "./worker";

const available = await isTestDatabaseAvailable();
const auth = makeTestAuthContext({ organizationId: "purge-preview-org", userId: "purge-preview-admin",
  permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:feedback", "logs:admin-domains", "knowledge:view", "knowledge:edit", "knowledge:manage"] });

describe.skipIf(!available)("log deletion impact over HTTP and PostgreSQL", () => {
  it("previews one real record without deleting it and binds the version to current state", async () => {
    const ephemeral = await createEphemeralTestDatabase("logpreview");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore: createMemoryObjectStore(), getCurrentAuthContext: () => auth });
      const server = createHttpServer(router);
      const upload = await requestJson<{ log: LogRecordDto }>(server, "/api/v1/log-files", { method: "POST",
        body: JSON.stringify({ fileName: "preview.log", contentType: "text/plain", contentBase64: Buffer.from("INFO preview\n").toString("base64") }) });
      expect(upload.status).toBe(201);
      const path = `/api/v1/logs/${upload.body.log.id}/deletion-preview`;
      const preview = await requestJson<{ item: { logId: string; organizationId: string; version: string;
        inventory: Array<{ key: string; count: number }>; objects: { total: number; shared: number; exclusive: number } } }>(server, path);
      expect(preview.status).toBe(200);
      expect(logDeletionPreviewSchema.safeParse(preview.body.item).success).toBe(true);
      expect(preview.body.item).toMatchObject({ logId: upload.body.log.id, organizationId: auth.organization.id,
        version: expect.stringMatching(/^[a-f0-9]{64}$/), objects: { shared: 0 } });
      expect(preview.body.item.inventory).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "records", count: 1 }), expect.objectContaining({ key: "runs", count: 1 }),
        expect.objectContaining({ key: "reports", count: 0 }), expect.objectContaining({ key: "jobs", count: 1 })
      ]));
      expect((await requestJson(server, `/api/v1/logs/${upload.body.log.id}`)).status).toBe(200);
      expect((await requestJson<typeof preview.body>(server, path)).body.item.version).toBe(preview.body.item.version);
      await db.query("update jobs set progress=25 where target_id=(select current_run_id from log_records where id=$1)", [upload.body.log.id]);
      expect((await requestJson<typeof preview.body>(server, path)).body.item.version).not.toBe(preview.body.item.version);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("counts owned history and preserves real shared objects, skills, source snapshots and independent knowledge", async () => {
    const ephemeral = await createEphemeralTestDatabase("logpreviewhistory");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      registerKnowledgeRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const server = createHttpServer(router);
      const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(server, path,
        { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      const skill = await request<{ item: { id: string } }>("/api/v1/log-skills", "POST", { name: "Retained analysis skill" });
      expect(skill.status).toBe(201);
      const upload = await request<{ log: LogRecordDto; fileObject: { id: string; storageKey: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "owned.log", contentType: "text/plain", contentBase64: Buffer.from("2026-10-20 ERROR failure\n").toString("base64"), skillId: skill.body.item.id });
      expect(upload.status).toBe(201);
      const logId = upload.body.log.id, skillId = skill.body.item.id, runId = upload.body.job.runId;
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: upload.body.job.id })).toEqual({ status: "processed" });
      const snapshotKey = (await objectStore.put({ organizationId: auth.organization.id, fileName: "source.zip", contentType: "application/zip", bytes: Buffer.from("retained source") })).storageKey;
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name,status)
        values('preview-source',$1,$2,'preview-v1',$3,'source.zip','ready')`, [auth.organization.id, skillId, snapshotKey]);
      await db.query("update log_analysis_runs set source_snapshot_id='preview-source',source_snapshot_status='ready' where id=$1", [runId]);
      const distill = await request<{ item: { id: string; contentMarkdown: string } }>("/api/v1/knowledge/distill-from-log", "POST", { logId });
      expect(distill.status).toBe(201);
      const knowledgePath = `/api/v1/knowledge/entries/${distill.body.item.id}`;
      const knowledgeBefore = await request(knowledgePath), historyBefore = await request(`${knowledgePath}/revisions`);
      expect(knowledgeBefore.status).toBe(200); expect(historyBefore.status).toBe(200);
      const legacyKnowledge = await request<{ item: { id: string } }>("/api/v1/knowledge/entries", "POST", {
        contentForm: "markdown", title: "Independent historical guidance", contentMarkdown: "Preserved legacy guidance.", tags: [] });
      expect(legacyKnowledge.status).toBe(201);
      await db.query("update log_analysis_runs set legacy_knowledge_entry_ids=$2 where id=$1", [runId, JSON.stringify([legacyKnowledge.body.item.id])]);
      expect((await request(`/api/v1/logs/${logId}/feedback`, "POST", { rating: "helpful", note: "Keep count" })).status).toBe(200);
      await db.query(`insert into log_webhook_outbox(id,organization_id,log_domain_id,log_record_id,run_id,payload,status)
        values('preview-outbox',$1,$2,$3,$4,'{}','retry')`, [auth.organization.id, skillId, logId, runId]);
      await db.query(`insert into log_webhook_deliveries(id,organization_id,log_domain_id,log_record_id,run_id,attempt,status)
        values('preview-delivery',$1,$2,$3,$4,1,'retrying')`, [auth.organization.id, skillId, logId, runId]);
      const path = `/api/v1/logs/${logId}/deletion-preview`;
      const before = await request<{ item: LogDeletionPreview }>(path);
      expect(before.status).toBe(200);
      expect(before.body.item.inventory).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "reports", count: 1 }), expect.objectContaining({ key: "feedback", count: 1 }),
        expect.objectContaining({ key: "deliveries", count: 1 }), expect.objectContaining({ key: "outbox", count: 1 }),
        expect.objectContaining({ key: "skills", count: 1, disposition: "retain" }),
        expect.objectContaining({ key: "source-snapshots", count: 1, disposition: "retain" }),
        expect.objectContaining({ key: "knowledge", count: 2, disposition: "retain" }),
        expect.objectContaining({ key: "knowledge-revisions", count: 2, disposition: "retain" })
      ]));
      expect(before.body.item.conditions.find((item) => item.code === "webhook-events")?.count).toBe(1);
      expect(before.body.item.conditions.find((item) => item.code === "analysis-jobs")?.count).toBe(0);
      // Saved cases can hold identical physical object keys even when not linked to a record.
      const original = (await db.query<{ object_key: string }>("select object_key from log_original_uploads where record_id=$1 limit 1", [logId])).rows[0]!;
      const savedCase = await request<{ item: { id: string } }>(`/api/v1/log-skills/${skillId}/analysis-cases`, "POST", {
        name: "Retained case", sourceRecordId: logId,
        expectations: { domain: "generic", summary: "Failure evidence", realLog: false, rootCauseCategory: "software-fault",
          rootCausePoints: ["failure"], keyEvidenceLines: [1], expectedActions: ["Review evidence"], expectRefusal: false } });
      expect(savedCase.status).toBe(201);
      await db.query("update log_skill_analysis_cases set uploads=$2 where id=$1", [savedCase.body.item.id,
        JSON.stringify([{ fileName: "owned.log", objectKey: original.object_key, sizeBytes: 25 }])]);
      const caseOnly = await request<{ item: LogDeletionPreview }>(path);
      expect(caseOnly.body.item.objects.shared).toBe(1);
      expect(caseOnly.body.item.version).not.toBe(before.body.item.version);
      expect(caseOnly.body.item.inventory.find((item) => item.key === "analysis-cases")?.count).toBe(1);
      const shared = await request<{ log: LogRecordDto }>("/api/v1/logs", "POST", { fileObjectId: upload.body.fileObject.id, fileName: "owned.log", skillId });
      expect(shared.status).toBe(201);
      const after = await request<{ item: LogDeletionPreview }>(path);
      expect(after.status).toBe(200);
      expect(after.body.item.version).not.toBe(before.body.item.version);
      expect(after.body.item.objects.shared).toBeGreaterThan(before.body.item.objects.shared);
      expect(after.body.item.inventory.find((item) => item.key === "file-objects")?.count).toBe(0);
      expect(after.body.item.objects.total).toBe(after.body.item.objects.shared + after.body.item.objects.exclusive);
      expect((await request(knowledgePath)).body).toEqual(knowledgeBefore.body);
      expect((await request(`${knowledgePath}/revisions`)).body).toEqual(historyBefore.body);
      expect((await request(`/api/v1/logs/${shared.body.log.id}`)).status).toBe(200);
      expect((await request(`/api/v1/log-skills/${skillId}/analysis-cases`)).body).toMatchObject({ items: [expect.objectContaining({ id: savedCase.body.item.id, name: "Retained case" })] });
      expect((await request(`/api/v1/log-skills/${skillId}/source-snapshots`)).body).toMatchObject({ items: [expect.objectContaining({ id: "preview-source", status: "ready" })] });
      expect(await objectStore.get(snapshotKey)).toEqual(Buffer.from("retained source"));
      expect(await objectStore.get(original.object_key)).toEqual(Buffer.from("2026-10-20 ERROR failure\n"));
      expect(after.body.item.notes.join(" ")).toContain("独立知识正文、已保存的引用内容及历史修订保留");
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("rejects non-governors, inactive users, integration credentials and cross-organization access", async () => {
    const ephemeral = await createEphemeralTestDatabase("logpreviewauth");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      const other = makeTestAuthContext({ organizationId: "preview-other", userId: "preview-other-admin", permissions: ["logs:admin-domains"] });
      for (const identity of [auth, other]) await seedCoreGraph(db, { organization: { id: identity.organization.id }, users: [{ id: identity.user.id }] });
      let current = auth;
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore: createMemoryObjectStore(), getCurrentAuthContext: () => current });
      const server = createHttpServer(router);
      const upload = await requestJson<{ log: LogRecordDto }>(server, "/api/v1/log-files", { method: "POST", body: JSON.stringify({
        fileName: "access.log", contentType: "text/plain", contentBase64: Buffer.from("INFO access").toString("base64") }) });
      expect(upload.status).toBe(201);
      const path = `/api/v1/logs/${upload.body.log.id}/deletion-preview`;
      current = { ...auth, permissions: ["logs:view"] };
      expect((await requestJson(server, path)).status).toBe(403);
      current = { ...auth, user: { ...auth.user, isActive: false } };
      expect((await requestJson(server, path)).status).toBe(403);
      current = other;
      expect((await requestJson(server, path)).status).toBe(404);
      current = { ...other, user: auth.user };
      expect((await requestJson(server, path)).status).toBe(403);
      current = auth;
      expect((await requestJson(server, path, { headers: { Authorization: "Bearer wie_log_test" } })).status).toBe(401);
      expect((await requestJson(server, "/api/v1/logs/nonexistent/deletion-preview")).status).toBe(404);
      expect((await requestJson(server, `/api/v1/logs/${upload.body.log.id}`, { method: "DELETE" })).status).toBe(404);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
