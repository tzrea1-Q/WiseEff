import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  archiveKnowledgeEntry,
  distillKnowledgeFromLog,
  findRelatedKnowledgeForLog,
  publishKnowledgeEntry
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-related";
const OTHER_ORG_ID = "org-kb-related-other";
const EDITOR = "user-related-editor";
const VIEWER = "user-related-viewer";
const OTHER_ORG_VIEWER = "user-related-foreign";

const editorPermissions: BackendPermission[] = ["knowledge:view", "knowledge:edit", "logs:view"];
const readerPermissions: BackendPermission[] = ["knowledge:view", "logs:view"];
const knowledgeOnly: BackendPermission[] = ["knowledge:view"];
const logsOnly: BackendPermission[] = ["logs:view"];

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
    [ORG_ID, "KB Related Org"],
    [OTHER_ORG_ID, "KB Related Other Org"]
  ] as const) {
    await db.query(`insert into organizations (id, name) values ($1, $2) on conflict (id) do nothing`, [orgId, name]);
  }
  for (const [userId, orgId] of [
    [EDITOR, ORG_ID],
    [VIEWER, ORG_ID],
    [OTHER_ORG_VIEWER, OTHER_ORG_ID]
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

type SeededLog = { logId: string; conclusion: string };

async function seedCompletedLog(
  db: InMemoryTestDatabase,
  input: { status?: "complete" | "processing"; conclusion?: string; impact?: string } = {}
): Promise<SeededLog> {
  const status = input.status ?? "complete";
  const logId = randomUUID();
  const runId = randomUUID();
  const fileObjectId = randomUUID();
  const conclusion = input.conclusion ?? "快充后段降频源于电池温度超过 45 度触发降流保护";
  const impact = input.impact ?? "夜间快充整体时长增加约 25 分钟。";

  await db.query(
    `
    insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256, uploaded_by_user_id)
    values ($1, $2, $3, 'charging-timeout.log', 'text/plain', 2048, 'checksum', $4)
    `,
    [fileObjectId, ORG_ID, `objects/${fileObjectId}`, EDITOR]
  );
  await db.query(
    `
    insert into log_records (id, organization_id, file_object_id, file_name, source, status, submitted_by_user_id)
    values ($1, $2, $3, 'charging-timeout.log', 'upload', $4, $5)
    `,
    [logId, ORG_ID, fileObjectId, status, EDITOR]
  );
  await db.query(
    `
    insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, progress)
    values ($1, $2, $3, $4, 'report', 100)
    `,
    [runId, ORG_ID, logId, status === "complete" ? "succeeded" : "running"]
  );
  await db.query(`update log_records set current_run_id = $3 where organization_id = $1 and id = $2`, [ORG_ID, logId, runId]);

  if (status === "complete") {
    await db.query(
      `
      insert into log_analysis_reports (id, organization_id, log_record_id, run_id, confidence, conclusion, impact, severity, suggested_actions, raw_lines)
      values ($1, $2, $3, $4, 87, $5, $6, 'Critical', $7, $8)
      `,
      [
        `report-${runId}`,
        ORG_ID,
        logId,
        runId,
        conclusion,
        impact,
        JSON.stringify(["下调快充电流"]),
        JSON.stringify(["boot ok", "temp=45.2C stage up"])
      ]
    );
  }

  return { logId, conclusion };
}

/** Distil the log into a draft as the editor — the archetypal related entry. */
async function distilDraft(db: InMemoryTestDatabase, logId: string) {
  return distillKnowledgeFromLog(db, makeAuth(EDITOR, editorPermissions), { logId });
}

describe.skipIf(!databaseAvailable)("findRelatedKnowledgeForLog", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedUsers(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("returns related published entries with citation fields and cuts off unrelated ones (FTS-only honesty)", async () => {
    const log = await seedCompletedLog(db);
    const editor = makeAuth(EDITOR, editorPermissions);

    const related = await distilDraft(db, log.logId);
    await publishKnowledgeEntry(db, editor, related.id);

    // Same organization, published, but a different topic entirely: the cutoff
    // must drop it instead of padding the recommendation list.
    const otherLog = await seedCompletedLog(db, {
      conclusion: "设备桥 WebSocket 握手在代理环境下被拦截导致连接建立失败",
      impact: "调试会话无法建立。"
    });
    const unrelated = await distillKnowledgeFromLog(db, editor, { logId: otherLog.logId });
    await publishKnowledgeEntry(db, editor, unrelated.id);

    const result = await findRelatedKnowledgeForLog(db, makeAuth(VIEWER, readerPermissions), { logId: log.logId });

    expect(result.retrieval).toEqual({ mode: "fts_only", vectorAvailable: false, embeddingConfigured: false });
    const ids = result.items.map((item) => item.entryId);
    expect(ids).toContain(related.id);
    expect(ids).not.toContain(unrelated.id);

    const citation = result.items.find((item) => item.entryId === related.id);
    expect(citation).toMatchObject({
      title: related.title,
      contentForm: "markdown",
      revisionId: expect.any(String)
    });
    expect(citation?.excerpt.length).toBeGreaterThan(0);
  });

  it("never recommends drafts or archived entries (published-only invariant)", async () => {
    const log = await seedCompletedLog(db);
    const editor = makeAuth(EDITOR, editorPermissions);

    const draft = await distilDraft(db, log.logId);

    const archived = await distilDraft(db, log.logId);
    await publishKnowledgeEntry(db, editor, archived.id);
    await archiveKnowledgeEntry(db, editor, archived.id);

    const published = await distilDraft(db, log.logId);
    await publishKnowledgeEntry(db, editor, published.id);

    const result = await findRelatedKnowledgeForLog(db, makeAuth(VIEWER, readerPermissions), { logId: log.logId });

    const ids = result.items.map((item) => item.entryId);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(archived.id);
  });

  it("respects the limit", async () => {
    const log = await seedCompletedLog(db);
    const editor = makeAuth(EDITOR, editorPermissions);
    for (let index = 0; index < 2; index += 1) {
      const entry = await distilDraft(db, log.logId);
      await publishKnowledgeEntry(db, editor, entry.id);
    }

    const result = await findRelatedKnowledgeForLog(db, makeAuth(VIEWER, readerPermissions), { logId: log.logId, limit: 1 });
    expect(result.items).toHaveLength(1);
  });

  it("requires knowledge:view", async () => {
    const log = await seedCompletedLog(db);

    await expect(findRelatedKnowledgeForLog(db, makeAuth(VIEWER, logsOnly), { logId: log.logId })).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "knowledge:view" }
    });
  });

  it("requires logs:view on the source record", async () => {
    const log = await seedCompletedLog(db);

    await expect(findRelatedKnowledgeForLog(db, makeAuth(VIEWER, knowledgeOnly), { logId: log.logId })).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "logs:view" }
    });
  });

  it("enforces organization scope on the source record", async () => {
    const log = await seedCompletedLog(db);

    await expect(
      findRelatedKnowledgeForLog(db, makeAuth(OTHER_ORG_VIEWER, readerPermissions, OTHER_ORG_ID), { logId: log.logId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses analyses that have not completed", async () => {
    const log = await seedCompletedLog(db, { status: "processing" });

    await expect(
      findRelatedKnowledgeForLog(db, makeAuth(VIEWER, readerPermissions), { logId: log.logId })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
