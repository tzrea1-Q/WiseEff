import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  createAgentKnowledgeDraft,
  distillKnowledgeFromLog,
  getKnowledgeEntry,
  listKnowledgeEntries,
  publishKnowledgeEntry,
  rejectAgentKnowledgeDraft,
  searchKnowledge
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-distill";
const OTHER_ORG_ID = "org-kb-distill-other";
const EDITOR_A = "user-distill-editor-a";
const EDITOR_B = "user-distill-editor-b";
const VIEWER = "user-distill-viewer";
const MANAGER = "user-distill-manager";
const OTHER_ORG_EDITOR = "user-distill-foreign";

const logsAndKnowledgeEdit: BackendPermission[] = ["knowledge:view", "knowledge:edit", "logs:view"];
const knowledgeEditOnly: BackendPermission[] = ["knowledge:view", "knowledge:edit"];
const viewOnly: BackendPermission[] = ["knowledge:view", "logs:view"];
const manageAll: BackendPermission[] = ["knowledge:view", "knowledge:edit", "knowledge:manage", "logs:view"];

function makeAuth(userId: string, permissions: BackendPermission[], organizationId = ORG_ID): AuthContext {
  return {
    user: { id: userId, organizationId, name: userId, title: "Engineer", isActive: true },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

async function seedUsers(db: InMemoryTestDatabase) {
  for (const [orgId, name] of [
    [ORG_ID, "KB Distill Org"],
    [OTHER_ORG_ID, "KB Distill Other Org"]
  ] as const) {
    await db.query(`insert into organizations (id, name) values ($1, $2) on conflict (id) do nothing`, [orgId, name]);
  }
  for (const [userId, orgId] of [
    [EDITOR_A, ORG_ID],
    [EDITOR_B, ORG_ID],
    [VIEWER, ORG_ID],
    [MANAGER, ORG_ID],
    [OTHER_ORG_EDITOR, OTHER_ORG_ID]
  ] as const) {
    await db.query(
      `
      insert into users (id, organization_id, name, title, is_active)
      values ($1, $2, $1, 'Engineer', true)
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [userId, orgId]
    );
  }
}

type SeededLog = { logId: string; conclusion: string; keyword: string };

async function seedCompletedLog(
  db: InMemoryTestDatabase,
  input: { organizationId?: string; submittedBy?: string; status?: "complete" | "processing" } = {}
): Promise<SeededLog> {
  const organizationId = input.organizationId ?? ORG_ID;
  const submittedBy = input.submittedBy ?? EDITOR_A;
  const status = input.status ?? "complete";
  const logId = randomUUID();
  const runId = randomUUID();
  const fileObjectId = randomUUID();
  const keyword = `温控降流阈值${logId.slice(0, 8)}`;
  const conclusion = `快充后段降频源于电池温度超过 45 度触发降流保护(${keyword})`;

  await db.query(
    `
    insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256, uploaded_by_user_id)
    values ($1, $2, $3, 'charging-timeout.log', 'text/plain', 2048, 'checksum', $4)
    `,
    [fileObjectId, organizationId, `objects/${fileObjectId}`, submittedBy]
  );
  await db.query(
    `
    insert into log_records (id, organization_id, file_object_id, file_name, source, status, analysis_question, submitted_by_user_id)
    values ($1, $2, $3, 'charging-timeout.log', 'upload', $4, '为什么充电后段降频?', $5)
    `,
    [logId, organizationId, fileObjectId, status, submittedBy]
  );
  await db.query(
    `
    insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, progress)
    values ($1, $2, $3, $4, 'report', 100)
    `,
    [runId, organizationId, logId, status === "complete" ? "succeeded" : "running"]
  );
  await db.query(`update log_records set current_run_id = $3 where organization_id = $1 and id = $2`, [
    organizationId,
    logId,
    runId
  ]);

  if (status === "complete") {
    await db.query(
      `
      insert into log_analysis_reports (id, organization_id, log_record_id, run_id, confidence, conclusion, impact, severity, suggested_actions, raw_lines)
      values ($1, $2, $3, $4, 87, $5, '夜间快充整体时长增加约 25 分钟。', 'Critical', $6, $7)
      `,
      [
        `report-${runId}`,
        organizationId,
        logId,
        runId,
        conclusion,
        JSON.stringify(["下调快充电流", "复核 NTC 采样间隔"]),
        JSON.stringify(["boot ok", "temp=45.2C stage up", "current step down 0.5A"])
      ]
    );
    await db.query(
      `
      insert into log_evidence (id, organization_id, log_record_id, run_id, stage, line_numbers, inference, suggested_action, rule_hit)
      values ($1, $2, $3, $4, 'rootcause', $5, 'NTC 采样显示温度台阶式上升。', '按 0.5A 步长下调快充电流。', 'RULE-THERMAL-042')
      `,
      [`evidence-${runId}-0`, organizationId, logId, runId, [2, 3]]
    );
  }

  return { logId, conclusion, keyword };
}

async function listAuditEvents(db: InMemoryTestDatabase, entryId: string, organizationId = ORG_ID) {
  const result = await db.query<{
    kind: string;
    action: string;
    actor_type: string;
    trace_id: string;
    metadata: Record<string, unknown>;
  }>(
    `select kind, action, actor_type, trace_id, metadata from audit_events where organization_id = $1 and target_id = $2 order by created_at asc`,
    [organizationId, entryId]
  );
  return result.rows;
}

describe.skipIf(!databaseAvailable)("knowledge distillation service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedUsers(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  describe("distillKnowledgeFromLog", () => {
    it("creates a pre-filled draft with revision 1, source linkage, tags, and audit via the seam", async () => {
      const log = await seedCompletedLog(db);
      const auth = makeAuth(EDITOR_A, logsAndKnowledgeEdit);

      const entry = await distillKnowledgeFromLog(db, auth, { logId: log.logId }, { requestId: "req-distill-1" });

      expect(entry.status).toBe("draft");
      expect(entry.contentForm).toBe("markdown");
      expect(entry.title).toBe(log.conclusion);
      expect(entry.tags).toEqual(["日志分析", "严重"]);
      expect(entry.sourceType).toBe("human");
      expect(entry.sourceLogId).toBe(log.logId);
      expect(entry.headRevisionNumber).toBe(1);
      expect(entry.createdByUserId).toBe(EDITOR_A);
      expect(entry.contentMarkdown).toContain("## 结论");
      expect(entry.contentMarkdown).toContain("温度台阶式上升");
      expect(entry.contentMarkdown).not.toContain("RULE-THERMAL-042");

      const audit = await listAuditEvents(db, entry.id);
      expect(audit).toEqual([
        expect.objectContaining({
          kind: "knowledge-entry-distill",
          action: "distill",
          actor_type: "user",
          trace_id: "req-distill-1",
          metadata: expect.objectContaining({ logId: log.logId, severity: "Critical" })
        })
      ]);
    });

    it("keeps the distilled draft out of retrieval until published", async () => {
      const log = await seedCompletedLog(db);
      const auth = makeAuth(EDITOR_A, logsAndKnowledgeEdit);

      const entry = await distillKnowledgeFromLog(db, auth, { logId: log.logId });
      const before = await searchKnowledge(db, auth, { q: log.keyword });
      expect(before.items).toHaveLength(0);

      await publishKnowledgeEntry(db, auth, entry.id);
      const after = await searchKnowledge(db, auth, { q: log.keyword });
      expect(after.items.map((item) => item.entryId)).toContain(entry.id);
    });

    it("requires knowledge:edit to create the draft", async () => {
      const log = await seedCompletedLog(db);

      await expect(distillKnowledgeFromLog(db, makeAuth(VIEWER, viewOnly), { logId: log.logId })).rejects.toMatchObject({
        code: "FORBIDDEN",
        details: { permission: "knowledge:edit" }
      });
    });

    it("requires logs:view on the source record", async () => {
      const log = await seedCompletedLog(db);

      await expect(
        distillKnowledgeFromLog(db, makeAuth(EDITOR_A, knowledgeEditOnly), { logId: log.logId })
      ).rejects.toMatchObject({ code: "FORBIDDEN", details: { permission: "logs:view" } });
    });

    it("enforces organization scope on the source record", async () => {
      const log = await seedCompletedLog(db);

      await expect(
        distillKnowledgeFromLog(db, makeAuth(OTHER_ORG_EDITOR, logsAndKnowledgeEdit, OTHER_ORG_ID), { logId: log.logId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses to distil an analysis that has not completed", async () => {
      const log = await seedCompletedLog(db, { status: "processing" });

      await expect(
        distillKnowledgeFromLog(db, makeAuth(EDITOR_A, logsAndKnowledgeEdit), { logId: log.logId })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  describe("createAgentKnowledgeDraft", () => {
    it("creates an agent-sourced draft recording the session, user, and optional source analysis", async () => {
      const log = await seedCompletedLog(db);
      const auth = makeAuth(EDITOR_A, logsAndKnowledgeEdit);

      const entry = await createAgentKnowledgeDraft(
        db,
        auth,
        {
          title: "快充温控排查经验",
          tags: ["快充"],
          contentMarkdown: "## 结论\n\n温度超过 45 度时降流。",
          sessionId: "xiaoze-session-1",
          sourceLogId: log.logId
        },
        { requestId: "req-agent-draft-1" }
      );

      expect(entry.status).toBe("draft");
      expect(entry.sourceType).toBe("agent");
      expect(entry.sourceSessionId).toBe("xiaoze-session-1");
      expect(entry.sourceLogId).toBe(log.logId);
      expect(entry.createdByUserId).toBe(EDITOR_A);

      const audit = await listAuditEvents(db, entry.id);
      expect(audit).toEqual([
        expect.objectContaining({
          kind: "knowledge-entry-agent-draft",
          action: "agent-draft-create",
          actor_type: "agent",
          trace_id: "req-agent-draft-1",
          metadata: expect.objectContaining({ sessionId: "xiaoze-session-1", sourceLogId: log.logId })
        })
      ]);
    });

    it("validates the optional source analysis id against logs:view and org scope", async () => {
      const foreignLog = await seedCompletedLog(db, { organizationId: OTHER_ORG_ID, submittedBy: OTHER_ORG_EDITOR });

      await expect(
        createAgentKnowledgeDraft(db, makeAuth(EDITOR_A, logsAndKnowledgeEdit), {
          title: "越权来源",
          tags: [],
          contentMarkdown: "body",
          sessionId: "s-1",
          sourceLogId: foreignLog.logId
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("requires knowledge:edit under the calling user's auth context", async () => {
      await expect(
        createAgentKnowledgeDraft(db, makeAuth(VIEWER, viewOnly), {
          title: "无权限草稿",
          tags: [],
          contentMarkdown: "body",
          sessionId: "s-2"
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN", details: { permission: "knowledge:edit" } });
    });

    it("keeps agent drafts out of retrieval and out of other editors' lists until published", async () => {
      const owner = makeAuth(EDITOR_A, logsAndKnowledgeEdit);
      const entry = await createAgentKnowledgeDraft(db, owner, {
        title: "会话沉淀草稿",
        tags: [],
        contentMarkdown: "检索关键词 agent-draft-invisible",
        sessionId: "s-3"
      });

      const search = await searchKnowledge(db, owner, { q: "agent-draft-invisible" });
      expect(search.items).toHaveLength(0);

      const otherEditorList = await listKnowledgeEntries(db, makeAuth(EDITOR_B, knowledgeEditOnly), {
        status: "draft",
        sourceType: "agent"
      });
      expect(otherEditorList.map((item) => item.id)).not.toContain(entry.id);

      const managerList = await listKnowledgeEntries(db, makeAuth(MANAGER, manageAll), {
        status: "draft",
        sourceType: "agent"
      });
      expect(managerList.map((item) => item.id)).toContain(entry.id);
    });

    it("lets the session owner publish their own agent draft, blocks other editors, allows manage", async () => {
      const owner = makeAuth(EDITOR_A, logsAndKnowledgeEdit);
      const first = await createAgentKnowledgeDraft(db, owner, {
        title: "本人会话草稿",
        tags: [],
        contentMarkdown: "body",
        sessionId: "s-own"
      });
      const second = await createAgentKnowledgeDraft(db, owner, {
        title: "他人不可发布的草稿",
        tags: [],
        contentMarkdown: "body",
        sessionId: "s-own"
      });

      // Publisher accountability: the distilling session's user holds edit rights on it.
      const published = await publishKnowledgeEntry(db, owner, first.id);
      expect(published.status).toBe("published");

      await expect(publishKnowledgeEntry(db, makeAuth(EDITOR_B, knowledgeEditOnly), second.id)).rejects.toMatchObject({
        code: "NOT_FOUND"
      });

      const byManager = await publishKnowledgeEntry(db, makeAuth(MANAGER, manageAll), second.id);
      expect(byManager.status).toBe("published");
    });
  });

  describe("rejectAgentKnowledgeDraft", () => {
    async function seedAgentDraft(sessionId = "s-reject") {
      return createAgentKnowledgeDraft(db, makeAuth(EDITOR_A, logsAndKnowledgeEdit), {
        title: "待拒绝草稿",
        tags: [],
        contentMarkdown: "body",
        sessionId
      });
    }

    it("archive-rejects an agent draft with audit evidence", async () => {
      const entry = await seedAgentDraft();
      const manager = makeAuth(MANAGER, manageAll);

      const rejected = await rejectAgentKnowledgeDraft(db, manager, entry.id, { requestId: "req-reject-1" });
      expect(rejected.status).toBe("archived");

      const audit = await listAuditEvents(db, entry.id);
      expect(audit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "knowledge-entry-reject",
            action: "reject",
            trace_id: "req-reject-1",
            metadata: expect.objectContaining({ sourceSessionId: "s-reject" })
          })
        ])
      );
    });

    it("lets the owning editor reject their own agent draft", async () => {
      const entry = await seedAgentDraft();

      const rejected = await rejectAgentKnowledgeDraft(db, makeAuth(EDITOR_A, knowledgeEditOnly), entry.id);
      expect(rejected.status).toBe("archived");
    });

    it("blocks other editors from rejecting someone else's agent draft", async () => {
      const entry = await seedAgentDraft();

      await expect(rejectAgentKnowledgeDraft(db, makeAuth(EDITOR_B, knowledgeEditOnly), entry.id)).rejects.toMatchObject({
        code: "NOT_FOUND"
      });
    });

    it("refuses to reject human drafts or non-draft entries", async () => {
      const owner = makeAuth(EDITOR_A, logsAndKnowledgeEdit);
      const log = await seedCompletedLog(db);
      const humanDraft = await distillKnowledgeFromLog(db, owner, { logId: log.logId });

      await expect(rejectAgentKnowledgeDraft(db, owner, humanDraft.id)).rejects.toMatchObject({
        code: "VALIDATION_FAILED"
      });

      const agentDraft = await seedAgentDraft();
      await publishKnowledgeEntry(db, owner, agentDraft.id);
      await expect(rejectAgentKnowledgeDraft(db, owner, agentDraft.id)).rejects.toMatchObject({
        code: "VALIDATION_FAILED"
      });
    });

    it("throws NOT_FOUND for missing entries", async () => {
      await expect(
        rejectAgentKnowledgeDraft(db, makeAuth(MANAGER, manageAll), randomUUID())
      ).rejects.toBeInstanceOf(ApiError);
    });
  });
});
