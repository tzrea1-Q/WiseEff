import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer, type AnalyzeLogInput } from "./analyzer";
import type { LogRecordDto } from "./types";
import { currentSkillRevisionId, type LogSkillRevisionDto } from "./skillsRepository";
import type { getLogSkill } from "./skillsService";
import { createLogSkill, discardLogSkillDraft, publishLogSkill, restoreLogSkillRevision, saveLogSkillDraft } from "./skillsService";
import type { LogSkillSpec } from "./skillSpec";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { createLocalObjectStore } from "./objectStore";
import { logSkillTemplates } from "./skillTemplates";

const available = await isTestDatabaseAvailable();
const auth = (organizationId = "org-skills") => makeTestAuthContext({ organizationId,
  userId: `${organizationId}-admin`, roles: [{ roleId: "admin", projectId: null }],
  permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:feedback", "logs:admin-domains"] });
type Skill = Awaited<ReturnType<typeof getLogSkill>>;

describe.skipIf(!available)("analysis skill revisions over PostgreSQL", () => {
  it("rejects stale discard and saves based on publications replaced by publish or restore", async () => {
    const ephemeral = await createEphemeralTestDatabase("skillconcurrency");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
      const router = createRouter();
      registerLogRoutes(router, { db, getCurrentAuthContext: () => auth() });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const created = await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "并发编辑", description: "版本一" });
      expect(created.status).toBe(201);
      expect(created.body.item.currentRevision.spec).toEqual({ ...logSkillTemplates[0].spec, description: "版本一" });
      const base = `/api/v1/log-skills/${created.body.item.id}`;
      const editorA = (await request<{ item: Skill }>(base)).body.item;
      const editorB = (await request<{ item: Skill }>(base)).body.item;
      const save = (description: string, baseDraftRevisionId: string | null, basePublishedRevisionId: string) =>
        request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
          spec: { schemaVersion: "skill/v1", description }, baseDraftRevisionId, basePublishedRevisionId
        });
      expect((await request(`${base}/draft`, "DELETE")).status).toBe(400);
      expect((await request(`${base}/draft`, "PUT", { spec: editorA.currentRevision.spec, baseDraftRevisionId: null })).status).toBe(400);
      const d1 = await save("草稿一", null, editorB.currentRevision.id);
      expect(d1.status).toBe(200);
      const d2 = await save("草稿二", d1.body.item.id, editorB.currentRevision.id);
      expect(d2.status).toBe(200);
      expect(await request(`${base}/draft?draftRevisionId=${d1.body.item.id}`, "DELETE")).toMatchObject({
        status: 409, body: { error: { code: "LOG_SKILL_DRAFT_CONFLICT" } }
      });
      expect((await request<{ item: Skill }>(base)).body.item.draft).toEqual(d2.body.item);
      expect((await request(`${base}/draft?draftRevisionId=${d2.body.item.id}`, "DELETE")).status).toBe(204);
      expect((await request(`${base}/draft?draftRevisionId=${d1.body.item.id}`, "DELETE")).status).toBe(204);
      expect((await request<{ item: Skill }>(base)).body.item.draft).toBeNull();

      const draft = await save("版本二", null, editorB.currentRevision.id);
      expect(draft.status).toBe(200);
      const published = await request<{ item: Skill }>(`${base}/publish`, "POST", { draftRevisionId: draft.body.item.id });
      expect(published.status).toBe(200);
      expect(published.body.item.currentRevision.number).toBe(2);
      expect(await save("过期编辑", null, editorA.currentRevision.id)).toMatchObject({
        status: 409, body: { error: { code: "LOG_SKILL_DRAFT_CONFLICT" } }
      });
      expect((await request<{ item: Skill }>(base)).body.item).toEqual(published.body.item);

      const beforeRestore = (await request<{ item: Skill }>(base)).body.item;
      const restored = await request<{ item: Skill }>(`${base}/revisions/${editorB.currentRevision.id}/restore`, "POST", {});
      expect(restored.status).toBe(200);
      expect(restored.body.item.currentRevision).toMatchObject({ number: 3, spec: editorB.currentRevision.spec });
      expect(await save("回滚前的编辑", null, beforeRestore.currentRevision.id)).toMatchObject({
        status: 409, body: { error: { code: "LOG_SKILL_DRAFT_CONFLICT" } }
      });
      expect((await request<{ item: Skill }>(base)).body.item).toEqual(restored.body.item);
      expect((await request<{ items: LogSkillRevisionDto[] }>(`${base}/revisions`)).body.items).toHaveLength(3);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("preserves legacy descriptions on publish and restore unless explicitly cleared", async () => {
    const ephemeral = await createEphemeralTestDatabase("skilldescription");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
      const router = createRouter();
      registerLogRoutes(router, { db, getCurrentAuthContext: () => auth() });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const created = await request<{ item: { id: string } }>("/api/v1/log-domains", "POST", { name: "旧技能", description: "保留旧描述" });
      expect(created.status).toBe(201);
      const base = `/api/v1/log-skills/${created.body.item.id}`;
      const initial = (await request<{ item: Skill }>(base)).body.item;
      expect(initial.currentRevision.spec.description).toBeUndefined();
      const draft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", modelOverride: "next-model" }, baseDraftRevisionId: null, basePublishedRevisionId: initial.currentRevision.id
      });
      expect(draft.status).toBe(200);
      const published = await request<{ item: Skill }>(`${base}/publish`, "POST", { draftRevisionId: draft.body.item.id });
      expect(published.status).toBe(200);
      expect(published.body.item.description).toBe("保留旧描述");
      expect((await db.query<{ description: string }>("select description from log_domains where id = $1", [initial.id])).rows[0].description).toBe("保留旧描述");
      const restored = await request<{ item: Skill }>(`${base}/revisions/${initial.currentRevision.id}/restore`, "POST", {});
      expect(restored.status).toBe(200);
      expect(restored.body.item.description).toBe("保留旧描述");
      const cleared = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", description: "" }, baseDraftRevisionId: null, basePublishedRevisionId: restored.body.item.currentRevision.id
      });
      expect(cleared.status).toBe(200);
      const clearPublication = await request<{ item: Skill }>(`${base}/publish`, "POST", { draftRevisionId: cleared.body.item.id });
      expect(clearPublication.status).toBe(200);
      expect(clearPublication.body.item.description).toBe("");
      expect(clearPublication.body.item.currentRevision.spec.description).toBe("");
      expect((await request(`/api/v1/log-domains/${initial.id}`, "PATCH", { description: "兼容接口描述" })).status).toBe(200);
      const legacyDescription = (await request<{ item: Skill }>(base)).body.item;
      expect(legacyDescription.description).toBe("兼容接口描述");
      expect(legacyDescription.currentRevision).toMatchObject({
        number: clearPublication.body.item.currentRevision.number + 1,
        spec: { ...clearPublication.body.item.currentRevision.spec, description: "兼容接口描述" }
      });
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("retains trusted caller provenance for discard and restore and rejects a mismatched principal", async () => {
    const ephemeral = await createEphemeralTestDatabase("skillprovenance");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
      const invocation = createAgentInvocation(auth(), {
        sessionId: "workspace-session", toolCallId: "workspace-call", approval: { required: true, approvalId: "workspace-approval" }
      });
      const context = { requestId: "skill-workspace-provenance" };
      const skill = await createLogSkill(db, auth(), { name: "调用来源" }, invocation, context);
      const draft = await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1" }, null, skill.currentRevision.id, invocation, context);
      const wrongPrincipal = createUserInvocation(auth("org-other"));
      await expect(discardLogSkillDraft(db, auth(), skill.id, draft.id, wrongPrincipal, context)).rejects.toThrow(/principal does not match/);
      await expect(restoreLogSkillRevision(db, auth(), skill.id, skill.currentRevision.id, wrongPrincipal, context)).rejects.toThrow(/principal does not match/);
      await discardLogSkillDraft(db, auth(), skill.id, draft.id, invocation, context);
      await restoreLogSkillRevision(db, auth(), skill.id, skill.currentRevision.id, invocation, context);
      const audits = await db.query(`select kind, actor_type, actor_user_id, metadata from audit_events
        where target_id = $1 and kind in ('log-skill-draft-discard', 'log-skill-restore') order by kind`, [skill.id]);
      expect(audits.rows).toEqual(["log-skill-draft-discard", "log-skill-restore"].map((kind) => ({
        kind, actor_type: "agent", actor_user_id: "org-skills-admin", metadata: expect.objectContaining({
          initiator: "agent", sessionId: "workspace-session", toolCallId: "workspace-call", approvalId: "workspace-approval"
        })
      })));
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("protects drafts, discards idempotently and restores immutable history with transactional audit", async () => {
    const ephemeral = await createEphemeralTestDatabase("skillworkspace");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      for (const organizationId of ["org-skills", "org-other"]) await seedCoreGraph(db, {
        organization: { id: organizationId, name: organizationId }, users: [{ id: `${organizationId}-admin`, name: "管理员" }]
      });
      let currentAuth = auth();
      const router = createRouter();
      registerLogRoutes(router, { db, getCurrentAuthContext: () => currentAuth });
      const request = <T,>(url: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), url,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const skill = (await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "工作区", description: "初版描述" })).body.item;
      const base = `/api/v1/log-skills/${skill.id}`;
      const spec = { schemaVersion: "skill/v1", description: "  发布后的描述  ", modelOverride: "workspace-model" };
      expect((await request(`${base}/draft`, "PUT", { spec })).status).toBe(400);
      for (const description of ["x".repeat(2001), 42]) expect((await request(`${base}/draft`, "PUT", {
        spec: { ...spec, description }, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      })).status).toBe(400);
      const first = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id });
      expect(first.status).toBe(200);
      const conflict = await request<{ error: { code: string } }>(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id });
      expect(conflict).toMatchObject({ status: 409, body: { error: { code: "LOG_SKILL_DRAFT_CONFLICT" } } });
      const next = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: first.body.item.id, basePublishedRevisionId: skill.currentRevision.id });
      expect(next.status).toBe(200); expect(next.body.item.id).not.toBe(first.body.item.id);
      expect((await request(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: first.body.item.id, basePublishedRevisionId: skill.currentRevision.id })).status).toBe(409);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: first.body.item.id })).status).toBe(409);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: next.body.item.id })).status).toBe(200);
      expect((await request<{ item: Skill }>(base)).body.item).toMatchObject({ description: "发布后的描述",
        modelOverride: "workspace-model", currentRevision: { number: 2, spec: { description: "发布后的描述" } } });
      const history = (await request<{ items: LogSkillRevisionDto[] }>(`${base}/revisions`)).body.items;
      const restorePath = `${base}/revisions/${skill.currentRevision.id}/restore`;
      const pendingDraft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: next.body.item.id });
      expect(pendingDraft.status).toBe(200);
      const beforeLegacyPatch = (await request<{ item: Skill }>(base)).body.item;
      const revisionsBeforeLegacyPatch = (await request<{ items: LogSkillRevisionDto[] }>(`${base}/revisions`)).body.items;
      for (const change of [{ formatProfile: { timestampPattern: "^legacy" } }, { modelOverride: "legacy-model" }, { description: "旧接口描述" }]) {
        expect(await request(`/api/v1/log-domains/${skill.id}`, "PATCH", change)).toMatchObject({
          status: 409, body: { error: { code: "LOG_SKILL_DRAFT_EXISTS", message: "Publish or discard the skill draft first." } }
        });
        expect((await request<{ item: Skill }>(base)).body.item).toEqual(beforeLegacyPatch);
      }
      expect((await request(`/api/v1/log-domains/${skill.id}`, "PATCH", { name: "重命名技能" })).status).toBe(200);
      expect((await request<{ item: Skill }>(base)).body.item).toMatchObject({
        name: "重命名技能", currentRevision: beforeLegacyPatch.currentRevision, draft: beforeLegacyPatch.draft
      });
      expect((await request<{ items: LogSkillRevisionDto[] }>(`${base}/revisions`)).body.items).toEqual(revisionsBeforeLegacyPatch);
      const discardPath = `${base}/draft?draftRevisionId=${encodeURIComponent(pendingDraft.body.item.id)}`;
      expect(await request(restorePath, "POST", {})).toMatchObject({ status: 409, body: { error: { code: "LOG_SKILL_DRAFT_EXISTS" } } });
      currentAuth = { ...auth(), permissions: ["logs:view"] };
      expect((await request(discardPath, "DELETE")).status).toBe(403);
      expect((await request(restorePath, "POST", {})).status).toBe(403);
      expect((await request(base)).status).toBe(200);
      currentAuth = auth("org-other");
      expect((await request(discardPath, "DELETE")).status).toBe(404);
      expect((await request(restorePath, "POST", {})).status).toBe(404);
      const other = (await request<{ item: Skill }>("/api/v1/log-skills", "POST", { name: "其他技能" })).body.item;
      currentAuth = auth();
      expect((await request(discardPath, "DELETE")).status).toBe(204);
      expect((await request(discardPath, "DELETE")).status).toBe(204);
      expect((await request(`${base}/revisions/${other.currentRevision.id}/restore`, "POST", {})).status).toBe(404);
      const restored = await request<{ item: Skill }>(restorePath, "POST", {});
      expect(restored.status).toBe(200);
      expect(restored.body.item).toMatchObject({ description: "初版描述", currentRevision: { number: 3, spec: skill.currentRevision.spec } });
      expect(restored.body.item.modelOverride).toBeUndefined();
      const after = (await request<{ items: LogSkillRevisionDto[] }>(`${base}/revisions`)).body.items;
      expect(after.find((r) => r.id === skill.currentRevision.id)).toEqual(history.find((r) => r.id === skill.currentRevision.id));
      expect(after.find((r) => r.id === next.body.item.id)).toEqual({ ...history.find((r) => r.id === next.body.item.id), status: "superseded" });
      expect(after).toHaveLength(3);
      const audits = (await db.query<{ kind: string; metadata: Record<string, unknown> }>(
        `select kind, metadata from audit_events where target_id = $1`, [skill.id])).rows;
      expect(audits.filter((a) => a.kind === "log-skill-draft-save")).toHaveLength(3);
      expect(audits.filter((a) => a.kind === "log-skill-draft-discard")).toHaveLength(2);
      expect(audits.filter((a) => a.kind === "log-skill-restore")).toEqual([expect.objectContaining({ metadata: expect.objectContaining({
        fromRevisionId: skill.currentRevision.id, newRevisionId: restored.body.item.currentRevision.id
      }) })]);
      // Audit failure rolls the publication back in the same transaction (ADR-0027).
      await db.query(`create function reject_workspace_audit() returns trigger language plpgsql as $$ begin
        if new.kind = 'log-skill-restore' then raise exception 'audit unavailable'; end if; return new; end $$;
        create trigger reject_workspace_audit before insert on audit_events for each row execute function reject_workspace_audit();`);
      expect((await request(restorePath, "POST", {})).status).toBe(500);
      expect((await request<{ items: LogSkillRevisionDto[] }>(`${base}/revisions`)).body.items).toEqual(after);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("cascades identity deletion after run cleanup without allowing direct immutable revision writes", async () => {
    const ephemeral = await createEphemeralTestDatabase("skilldelete");
    const db = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(db, { organization: { id: "org-skills", name: "技能" }, users: [{ id: "org-skills-admin", name: "管理员" }] });
      const context = { requestId: "skill-delete" };
      const invocation = createAgentInvocation(auth(), {
        sessionId: "skill-session", toolCallId: "skill-call", approval: { required: true, approvalId: "skill-approval" }
      });
      const wrongPrincipal = createUserInvocation(auth("org-other"));
      await expect(createLogSkill(db, auth(), { name: "待删除技能" }, wrongPrincipal, context)).rejects.toThrow(/principal does not match/);
      const skill = await createLogSkill(db, auth(), { name: "待删除技能" }, invocation, context);
      await expect(saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1" }, null, skill.currentRevision.id, wrongPrincipal, context)).rejects.toThrow(/principal does not match/);
      const published = await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1", modelOverride: "next-model" }, null, skill.currentRevision.id, invocation, context);
      await expect(publishLogSkill(db, auth(), skill.id, published.id, wrongPrincipal, context)).rejects.toThrow(/principal does not match/);
      await publishLogSkill(db, auth(), skill.id, published.id, invocation, context);
      await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1" }, null, published.id, invocation, context);
      const audits = await db.query(`select kind, actor_type, actor_user_id, metadata from audit_events
        where organization_id = 'org-skills' and target_id = $1 order by kind`, [skill.id]);
      expect(audits.rows).toEqual(["log-skill-create", "log-skill-draft-save", "log-skill-draft-save", "log-skill-publish"].map((kind) => ({
        kind, actor_type: "agent", actor_user_id: "org-skills-admin", metadata: expect.objectContaining({
          initiator: "agent", sessionId: "skill-session", toolCallId: "skill-call", approvalId: "skill-approval"
        })
      })));
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
      const invocation = createUserInvocation(auth());
      const skill = await createLogSkill(db, auth(), { name: "并发钉住" }, invocation, context);
      const draft = await saveLogSkillDraft(db, auth(), skill.id, { schemaVersion: "skill/v1", modelOverride: "next-model" }, null, skill.currentRevision.id, invocation, context);
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
          return publishLogSkill(publisher, auth(), skill.id, draft.id, invocation, context);
        })).rejects.toMatchObject({ code: "55P03" });
      });
      // Once the pins release, publish succeeds. While its transaction remains
      // open, a new pin must wait rather than reading the preceding revision.
      await db.transaction(async (publisher) => {
        expect((await publishLogSkill(publisher, auth(), skill.id, draft.id, invocation, context)).currentRevision.id).toBe(draft.id);
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
    const objectRoot = await mkdtemp(join(tmpdir(), "log-skills-"));
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
      expect(skill.currentRevision.spec).toEqual({ schemaVersion: "skill/v1", formatProfile: { severityMap: { error: ["ALERT"] } } });
      expect((await db.query<{ metadata: unknown }>("select metadata from audit_events where target_id=$1 and kind='log-skill-create'", [skill.id])).rows[0].metadata)
        .not.toHaveProperty("templateId");
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
        modelOverride: "revision-two-model", stepBudget: 2, tokenBudget: 4000, signalRules: { rules: [], noHit: { ...defaultChargingRuleSet.noHit,
          conclusion: "版本二规则", severity: "Info" }, hitDefaults: defaultChargingRuleSet.hitDefaults } };
      const draft = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id });
      expect(draft.status).toBe(200);
      expect((await request<{ item: Skill }>(base)).body.item.currentRevision.id).toBe(skill.currentRevision.id);
      await expect(processLogAnalysisJobById({ db, objectStore, jobId: upload.body.job.id })).resolves.toMatchObject({ status: "processed" });
      const first = (await request<{ item: LogRecordDto }>(`/api/v1/logs/${logId}`)).body.item;
      expect(first.status).toBe("complete");
      expect(first.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ ruleHit: "generic:first-error", filePath: "device.log", lineNumbers: [2] })]));
      expect(first.evidence.some((item) => item.ruleHit === "error-code")).toBe(false);
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
      expect(observed?.logDomain).toMatchObject({ stepBudget: 2, tokenBudget: 4000 });
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
      const saved = await request<{ item: LogSkillRevisionDto }>(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: legacy.currentRevision.id });
      expect((await request(`${base}/draft`, "PUT", { spec: { schemaVersion: "skill/v1" }, baseDraftRevisionId: saved.body.item.id, basePublishedRevisionId: legacy.currentRevision.id })).status).toBe(200);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(409);
      for (const invalid of [{ schemaVersion: "skill/v2" }, { schemaVersion: "skill/v1", formatProfile: { timestampPattern: "[" } },
        { schemaVersion: "skill/v1", signalRules: { rules: [] } }]) {
        expect((await request(`${base}/draft`, "PUT", { spec: invalid, baseDraftRevisionId: null, basePublishedRevisionId: legacy.currentRevision.id })).status).toBe(400);
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
      expect((await request(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: legacy.currentRevision.id })).status).toBe(403);
      expect((await request(`${base}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(403);
      currentAuth = auth("org-other");
      for (const path of [base, `${base}/revisions`, `${base}/revisions/${skill.currentRevision.id}`]) expect((await request(path)).status).toBe(404);
      expect((await request(`${base}/draft`, "PUT", { spec, baseDraftRevisionId: null, basePublishedRevisionId: legacy.currentRevision.id })).status).toBe(404);
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
});
