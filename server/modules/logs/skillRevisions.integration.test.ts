import { mkdtemp, rm, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer, type AnalyzeLogInput } from "./analyzer";
import type { LogRecordDto } from "./types";
import { currentSkillRevisionId, type LogSkillRevisionDto } from "./skillsRepository";
import type { getLogSkill } from "./skillsService";
import { createLogSkill, publishLogSkill, saveLogSkillDraft } from "./skillsService";
import type { LogSkillSpec } from "./skillSpec";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { createLocalObjectStore } from "./objectStore";

const available = await isTestDatabaseAvailable();
const auth = (organizationId = "org-skills") => makeTestAuthContext({ organizationId,
  userId: `${organizationId}-admin`, roles: [{ roleId: "admin", projectId: null }],
  permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:feedback", "logs:admin-domains"] });
type Skill = Awaited<ReturnType<typeof getLogSkill>>;

describe.skipIf(!available)("analysis skill revisions over PostgreSQL", () => {
  it("cascades identity deletion after run cleanup without allowing direct immutable revision writes", async () => {
    const ephemeral = await createEphemeralTestDatabase("skilldelete");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
      const context = { requestId: "skill-delete" };
      const skill = await createLogSkill(db, auth(), { name: "待删除技能" }, context);
      const published = await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1", modelOverride: "next-model" }, context);
      await publishLogSkill(db, auth(), skill.id, published.id, context);
      await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1" }, context);
      await db.query(`insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
        values ('delete-file', 'org-skills', 'delete-file', 'delete.log', 'text/plain', 1, 'hash');`);
      await db.query(`insert into log_records (id, organization_id, file_object_id, file_name, source, status, log_domain_id)
        values ('delete-record', 'org-skills', 'delete-file', 'delete.log', 'upload', 'processing', $1)`, [skill.id]);
      await db.query(`insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, skill_revision_id)
        values ('delete-run', 'org-skills', 'delete-record', 'queued', 'parse', $1)`, [published.id]);
      await db.query("delete from log_analysis_runs where id = 'delete-run'; delete from log_records where id = 'delete-record'");
      for (const revisionId of [skill.currentRevision.id, published.id]) {
        await expect(db.query("delete from log_skill_revisions where id = $1", [revisionId])).rejects.toThrow(/immutable/);
        await expect(db.query("update log_skill_revisions set content_hash = 'changed' where id = $1", [revisionId])).rejects.toThrow(/immutable/);
      }
      expect((await db.query("select status from log_skill_revisions where skill_id = $1 order by revision_number", [skill.id])).rows)
        .toEqual([{ status: "superseded" }, { status: "published" }, { status: "draft" }]);
      expect((await db.query("delete from log_domains where id = $1 returning id", [skill.id])).rows).toEqual([{ id: skill.id }]);
      expect((await db.query("select id from log_skill_revisions where skill_id = $1", [skill.id])).rows).toEqual([]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("shares pinning locks while publication serializes against pinning", async () => {
    const ephemeral = await createEphemeralTestDatabase("skilllocks");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
      const context = { requestId: "skill-locks" };
      const skill = await createLogSkill(db, auth(), { name: "并发钉住" }, context);
      const draft = await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1", modelOverride: "next-model" }, context);
      await db.transaction(async (firstPin) => {
        expect(await currentSkillRevisionId(firstPin, "org-skills", skill.id)).toBe(skill.currentRevision.id);
        // Separate sessions overlap their pinning transactions. An exclusive
        // pinning lock would time out here instead of admitting the second pin.
        await db.transaction(async (secondPin) => {
          await secondPin.query("set local lock_timeout = '150ms'");
          expect(await currentSkillRevisionId(secondPin, "org-skills", skill.id)).toBe(skill.currentRevision.id);
        });
        await expect(db.transaction(async (publisher) => {
          await publisher.query("set local lock_timeout = '150ms'");
          return publishLogSkill(publisher, auth(), skill.id, draft.id, context);
        })).rejects.toMatchObject({ code: "55P03" });
      });
      // Once the pins release, publish succeeds. While its transaction remains
      // open, a new pin must wait rather than reading the preceding revision.
      await db.transaction(async (publisher) => {
        expect((await publishLogSkill(publisher, auth(), skill.id, draft.id, context)).currentRevision.id).toBe(draft.id);
        await expect(db.transaction(async (pin) => {
          await pin.query("set local lock_timeout = '150ms'");
          return currentSkillRevisionId(pin, "org-skills", skill.id);
        })).rejects.toMatchObject({ code: "55P03" });
      });
      await db.transaction(async (pin) => {
        expect(await currentSkillRevisionId(pin, "org-skills", skill.id)).toBe(draft.id);
      });
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("pins immutable revisions through upload, publication, worker, report and both rerun policies", async () => {
    const ephemeral = await createEphemeralTestDatabase("logskills");
    const db = createPostgresDatabase(ephemeral.url);
    const objectRoot = await mkdtemp("/private/tmp/log-skills-");
    try {
      for (const organizationId of ["org-skills", "org-other"]) await seedCoreGraph(db, {
        organization: { id: organizationId, name: organizationId }, users: [{ id: `${organizationId}-admin`, name: "技能管理员" }]
      });
      let currentAuth = auth();
      const objectStore = createLocalObjectStore(objectRoot);
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
      async function request<T>(url: string, method = "GET", body?: unknown) {
        return requestJson<T>(createHttpServer(router), url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      }
      const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", {
        name: "设备诊断", formatProfile: { severityMap: { error: ["ALERT"] } }
      });
      expect(created.status).toBe(201);
      const skill = created.body.item;
      const base = `/api/v1/log-skills/${skill.id}`;
      expect((await request<{ items: Array<{ helpfulRate7d: number | null }> }>("/api/v1/log-skills")).body.items[0].helpfulRate7d).toBeNull();
      // Enable the identity's webhook without invoking an external sender.
      await db.query(`update log_domains set webhook_enabled = true, webhook_url = 'https://example.com/results',
        webhook_secret = 'fixture-signing-secret' where id = $1`, [skill.id]);
      expect(skill.currentRevision).toMatchObject({ number: 1, status: "published", spec: { schemaVersion: "skill/v1" } });
      const upload = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>("/api/v1/log-files", "POST", {
        fileName: "device.log", contentType: "text/plain", skillId: skill.id,
        contentBase64: Buffer.from("INFO ordinary message\nALERT code=E_CUSTOM\n").toString("base64")
      });
      expect(upload.status).toBe(201);
      expect(upload.body.log.skillRevision).toEqual({ id: skill.currentRevision.id, number: 1 });
      const logId = upload.body.log.id;
      const spec: LogSkillSpec = { schemaVersion: "skill/v1", formatProfile: { severityMap: { info: ["ALERT"] } },
        modelOverride: "revision-two-model", signalRules: { rules: [], noHit: { ...defaultChargingRuleSet.noHit,
          conclusion: "版本二规则", severity: "Info" }, hitDefaults: defaultChargingRuleSet.hitDefaults } };
      const draft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec });
      expect(draft.status).toBe(200);
      expect((await request<{ item: Skill }>(base)).body.item.currentRevision.id).toBe(skill.currentRevision.id);
      await expect(processLogAnalysisJobById({ db, objectStore, jobId: upload.body.job.id })).resolves.toMatchObject({ status: "processed" });
      const first = (await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`)).body.item;
      expect(first.status).toBe("complete");
      expect(first.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ ruleHit: "error-code", lineNumbers: [2] })]));
      expect(first.conclusion).not.toBe("版本二规则");
      expect((await request(`/api/v1/logs/${logId}/feedback`, "POST", { rating: "helpful" })).status).toBe(200);
      const reportBefore = await db.query(`select * from log_analysis_reports where run_id = $1`, [upload.body.job.runId]);
      expect((await db.query<{ payload: unknown }>(`select payload from log_webhook_outbox where run_id = $1`, [upload.body.job.runId])).rows[0].payload)
        .toMatchObject({ skillRevisionId: skill.currentRevision.id, skillRevisionNumber: 1 });

      expect((await request(`${base}/publish`, "POST", { draftRevisionId: draft.body.item.id })).status).toBe(200);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: draft.body.item.id })).status).toBe(409);
      expect((await db.query(`select kind from audit_events where target_id = $1 and kind = 'log-skill-publish'`, [skill.id])).rows).toHaveLength(1);
      expect((await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`)).body.item).toEqual(first);
      await expect(db.query(`update log_skill_revisions set spec = '{}' where id = $1`, [skill.currentRevision.id])).rejects.toThrow(/immutable/);
      await expect(db.query(`delete from log_skill_revisions where id = $1`, [draft.body.item.id])).rejects.toThrow(/immutable/);
      await expect(db.query(`update log_skill_revisions set created_by_user_id = null where id = $1`, [draft.body.item.id])).rejects.toThrow(/immutable/);

      const pinned = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>(`/api/v1/logs/${logId}/rerun`, "POST", { revisionPolicy: "pinned" });
      expect(pinned.status).toBe(200);
      expect(pinned.body.log.skillRevision).toEqual(first.skillRevision);
      await processLogAnalysisJobById({ db, objectStore, jobId: pinned.body.job.id });
      const replay = (await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`)).body.item;
      expect(replay.conclusion).toBe(first.conclusion);
      expect(replay.evidence.map(({ id: _id, ...evidence }) => evidence)).toEqual(first.evidence.map(({ id: _id, ...evidence }) => evidence));
      const current = await request<{ log: LogRecordDto; job: { id: string; runId: string } }>(`/api/v1/logs/${logId}/rerun`, "POST", {});
      expect(current.body.log.skillRevision).toEqual({ id: draft.body.item.id, number: 2 });
      let observed: AnalyzeLogInput | undefined;
      await processLogAnalysisJobById({ db, objectStore, jobId: current.body.job.id, analyzer: {
        async analyze(input) { observed = input; return createRuleBasedLogAnalyzer().analyze(input); }
      } });
      expect(observed?.parsed.entries[1].severity).toBe("info");
      expect(observed?.logDomain?.modelOverride).toBe("revision-two-model");
      expect(observed?.signalRules).toEqual(spec.signalRules);
      expect((await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`)).body.item).toMatchObject({
        conclusion: "版本二规则", evidence: [], skillRevision: { id: draft.body.item.id, number: 2 }
      });
      expect((await request(`/api/v1/logs/${logId}/feedback`, "POST", { rating: "not_helpful" })).status).toBe(200);
      expect((await db.query(`select * from log_analysis_reports where run_id = $1`, [upload.body.job.runId])).rows).toEqual(reportBefore.rows);
      const runs = await request<{ items: Array<{ skillRevision: { id: string; number: number } }> }>(`/api/v1/logs/${logId}/runs`);
      expect(runs.body.items.map((r) => r.skillRevision.number).sort()).toEqual([1, 1, 2]);

      // Legacy upload and PATCH remain immediate while preserving custom rules.
      const legacyUpload = await request<{ log: LogRecordDto }>("/api/v1/log-files", "POST", { fileName: "alias.log", contentType: "text/plain",
        logDomainId: skill.id, contentBase64: Buffer.from("INFO alias\n").toString("base64") });
      expect(legacyUpload.status).toBe(201);
      expect(legacyUpload.body.log.skillRevision?.number).toBe(2);
      expect((await request(`/api/v1/log-domains/${skill.id}`, "PATCH", { modelOverride: "legacy-model" })).status).toBe(200);
      const legacy = (await request<{ item: Skill }>(base)).body.item;
      expect(legacy.currentRevision).toMatchObject({ number: 3, spec: { ...spec, modelOverride: "legacy-model" } });
      expect((await request<{ items: Array<{ currentRevision: { number: number }; analyses7d: number }> }>("/api/v1/log-skills")).body.items[0])
        .toMatchObject({ currentRevision: { number: 3 }, analyses7d: 4, helpfulRate7d: 0.5 });

      // Stale-save id, schema and permission checks use the actual route stack.
      const saved = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec });
      await request(`${base}/draft`, "PUT", { spec: { schemaVersion: "skill/v1" } });
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(409);
      for (const invalid of [{ schemaVersion: "skill/v2" }, { schemaVersion: "skill/v1", formatProfile: { timestampPattern: "[" } },
        { schemaVersion: "skill/v1", signalRules: { rules: [] } }]) {
        expect((await request(`${base}/draft`, "PUT", { spec: invalid })).status).toBe(400);
      }
      expect((await request(`/api/v1/logs/${logId}/rerun`, "POST", { revisionPolicy: "unknown" })).status).toBe(400);
      const unsupported = await request<{ log: LogRecordDto }>("/api/v1/log-files", "POST", {
        fileName: "unsupported.bin", contentType: "application/octet-stream", skillId: skill.id,
        contentBase64: Buffer.from([0, 1, 2]).toString("base64")
      });
      expect(unsupported.status).toBe(201);
      expect(unsupported.body.log.skillRevision).toBeNull();
      expect((await request(`/api/v1/logs/${unsupported.body.log.id}/rerun`, "POST", { revisionPolicy: "pinned" })).status).toBe(409);
      currentAuth = { ...auth(), permissions: ["logs:view"] };
      expect((await request(`${base}/draft`, "PUT", { spec })).status).toBe(403);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(403);
      currentAuth = auth("org-other");
      for (const path of [base, `${base}/revisions`, `${base}/revisions/${skill.currentRevision.id}`]) expect((await request(path)).status).toBe(404);
      expect((await request(`${base}/draft`, "PUT", { spec })).status).toBe(404);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(404);
      expect((await request(`/api/v1/log-domains/${skill.id}`, "PATCH", { formatProfile: {} })).status).toBe(404);
      expect((await request<{ items: unknown[] }>("/api/v1/log-skills")).body.items).toEqual([]);
      const other = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "另一个组织技能" });
      expect((await request(`/api/v1/log-skills/${other.body.item.id}/revisions/${skill.currentRevision.id}`)).status).toBe(404);
      await expect(db.query(`insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
        values ('foreign-skill-revision', 'org-other', $1, 99, 'superseded', '{"schemaVersion":"skill/v1"}', 'hash')`, [skill.id]))
        .rejects.toMatchObject({ code: "23503" });
      const otherRevision = other.body.item.currentRevision;
      await db.query(`delete from users where id = 'org-other-admin'`);
      expect((await db.query(`select spec, content_hash, created_by_user_id, published_by_user_id
        from log_skill_revisions where id = $1`, [otherRevision.id])).rows).toEqual([{
        spec: otherRevision.spec, content_hash: otherRevision.contentHash, created_by_user_id: null, published_by_user_id: null
      }]);
    } finally { await db.close(); await ephemeral.drop(); await rm(objectRoot, { recursive: true, force: true }); }
  }, 120_000);

  it("backfills published v1 and run pins without changing existing identities or references", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      const ephemeral = await createEphemeralTestDatabase("skillbackfill");
      const db = createPostgresDatabase(ephemeral.url);
      const writer = `logskills_writer_${randomUUID().replaceAll("-", "")}`;
      try {
        // Rewind this migration's DDL on a disposable clone, then upgrade real data.
        await db.query(`drop trigger log_skill_requires_publication on log_domains;
          alter table log_analysis_runs drop column skill_revision_id;
          drop table log_skill_revisions;
          drop function protect_log_skill_revision(); drop function require_log_skill_published_revision();`);
        await db.query(`create role ${writer} nologin; grant usage on schema public to ${writer};
          grant select, insert, update, delete on log_domains to ${writer};`);
        await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
        await db.query(`insert into log_domains (id, organization_id, name, format_profile, model_override)
          values ('legacy-skill', 'org-skills', '旧技能', '{"severityMap":{"error":["ALERT"]}}', 'old-model');
          insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
          values ('legacy-file', 'org-skills', 'legacy-file', 'legacy.log', 'text/plain', 1, 'hash');
          insert into log_records (id, organization_id, file_object_id, file_name, source, status, log_domain_id)
          values ('legacy-record', 'org-skills', 'legacy-file', 'legacy.log', 'upload', 'complete', 'legacy-skill'),
            ('generic-record', 'org-skills', 'legacy-file', 'legacy.log', 'upload', 'complete', null);
          insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, progress)
          values ('legacy-run', 'org-skills', 'legacy-record', 'complete', 'report', 100),
            ('generic-run', 'org-skills', 'generic-record', 'complete', 'report', 100);`);
        await db.query(`insert into knowledge_entries (id, organization_id, title, content_form, status, source_type, created_by_user_id, search_text)
          values ('40000000-0000-4000-8000-000000000001', 'org-skills', '知识', 'markdown', 'published', 'human', 'org-skills-admin', '知识');
          insert into log_domain_knowledge_links (id, organization_id, log_domain_id, knowledge_entry_id, created_by_user_id)
          values ('legacy-link', 'org-skills', 'legacy-skill', '40000000-0000-4000-8000-000000000001', 'org-skills-admin');
          insert into log_feedback (id, organization_id, log_record_id, run_id, user_id, rating)
          values ('legacy-feedback', 'org-skills', 'legacy-record', 'legacy-run', 'org-skills-admin', 'helpful');
          insert into log_webhook_outbox (id, organization_id, log_domain_id, log_record_id, run_id, payload)
          values ('legacy-webhook', 'org-skills', 'legacy-skill', 'legacy-record', 'legacy-run', '{"old":true}');`);
        const preservedTables = ["log_records", "log_domains", "log_feedback", "log_domain_knowledge_links", "log_webhook_outbox"];
        const before = await Promise.all(preservedTables.map(async (table) => (await db.query(`select * from ${table} order by id`)).rows));
        const migration = await readFile(new URL("../../migrations/0187_log_skill_revisions.sql", import.meta.url), "utf8");
        await db.transaction(async (tx) => { await tx.query(migration); });
        expect((await db.query(`select revision_number, status, spec from log_skill_revisions where skill_id = 'legacy-skill'`)).rows).toEqual([{
          revision_number: 1, status: "published", spec: { schemaVersion: "skill/v1", formatProfile: { severityMap: { error: ["ALERT"] } }, modelOverride: "old-model" }
        }]);
        expect((await db.query(`select id, skill_revision_id from log_analysis_runs order by id`)).rows).toEqual([
          { id: "generic-run", skill_revision_id: null }, { id: "legacy-run", skill_revision_id: "skill-revision-1:legacy-skill" }
        ]);
        expect(await Promise.all(preservedTables.map(async (table) => (await db.query(`select * from ${table} order by id`)).rows))).toEqual(before);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect((await db.query<{ allowed: boolean }>(`select has_table_privilege($1, 'log_skill_revisions', $2) as allowed`, [writer, privilege])).rows[0].allowed).toBe(true);
        }
        expect((await db.query(`select confdeltype from pg_constraint
          where conrelid = 'log_skill_revisions'::regclass and confrelid = 'users'::regclass`)).rows)
          .toEqual([{ confdeltype: "n" }, { confdeltype: "n" }]);
        await db.transaction(async (tx) => {
          await tx.query(`set local role ${writer}`);
          expect((await tx.query(`select id from log_skill_revisions`)).rows).toHaveLength(1);
          await tx.query(`insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
            values ('runtime-draft', 'org-skills', 'legacy-skill', 2, 'draft', '{"schemaVersion":"skill/v1"}', 'fixture');
            update log_skill_revisions set content_hash = 'updated' where id = 'runtime-draft';
            delete from log_skill_revisions where id = 'runtime-draft';`);
        });
        await expect(db.query(`insert into log_domains (id, organization_id, name) values ('no-revision', 'org-skills', '没有版本')`)).rejects.toThrow(/requires one published/);
      } finally {
        await db.query(`drop owned by ${writer}; drop role if exists ${writer}`);
        await db.close(); await ephemeral.drop();
      }
    });
  }, 120_000);
});
