import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../../auth/types";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { createAgentOrchestrator } from "../orchestrator";
import { createAgentToolRegistry } from "../toolRegistry";
import { createActionTools } from "./actionTools";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-agent-kb-draft";
const EDITOR = "user-agent-kb-editor";
const VIEWER = "user-agent-kb-viewer";

function makeAuth(userId: string, permissions: BackendPermission[]): AuthContext {
  return {
    user: { id: userId, organizationId: ORG_ID, name: userId, title: "Engineer", isActive: true },
    organization: { id: ORG_ID, name: "Agent KB Org" },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

const editorAuth = makeAuth(EDITOR, ["knowledge:view", "knowledge:edit"]);
const viewerAuth = makeAuth(VIEWER, ["knowledge:view"]);

function draftPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "快充温控排查经验",
    contentMarkdown: "## 结论\n\n温度超过 45 度时按 0.5A 步长下调快充电流。",
    tags: ["日志分析", "快充"],
    ...overrides
  };
}

describe("action.createKnowledgeDraft definition", () => {
  const fakeDb = { query: () => Promise.resolve({ rows: [] }), transaction: () => Promise.resolve() } as never;
  const tool = createActionTools({ db: fakeDb }).find((item) => item.name === "action.createKnowledgeDraft")!;

  it("is a mutating, approval-gated, organization-scoped tool bound to knowledge:edit", () => {
    expect(tool).toBeTruthy();
    expect(tool.kind).toBe("mutating");
    expect(tool.requiresApproval).toBe(true);
    expect(tool.permission).toBe("knowledge:edit");
    expect(tool.scope).toBe("organization");
  });

  it("rejects payloads without a title or markdown content before touching the database", async () => {
    const context = { auth: editorAuth, requestId: "req-1", sessionId: "session-1" };

    await expect(tool.run(context, draftPayload({ title: "   " }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED"
    });
    await expect(tool.run(context, draftPayload({ contentMarkdown: "  " }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED"
    });
  });
});

describe.skipIf(!databaseAvailable)("action.createKnowledgeDraft approval chain (DB-backed)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'Agent KB Org') on conflict (id) do nothing`, [ORG_ID]);
    for (const userId of [EDITOR, VIEWER]) {
      await db.query(
        `
        insert into users (id, organization_id, name, title, is_active)
        values ($1, $2, $1, 'Engineer', true)
        on conflict (id) do update set organization_id = excluded.organization_id
        `,
        [userId, ORG_ID]
      );
    }
  });

  afterEach(async () => {
    await db.rollback();
  });

  function makeOrchestrator() {
    const registry = createAgentToolRegistry({ db });
    return createAgentOrchestrator({ db, toolRegistry: registry });
  }

  async function countAgentDrafts() {
    const result = await db.query<{ n: string }>(
      `select count(*)::text as n from knowledge_entries where organization_id = $1 and source_type = 'agent'`,
      [ORG_ID]
    );
    return Number(result.rows[0].n);
  }

  it("interrupts for approval without creating any draft, then lands the draft on approve", async () => {
    const orchestrator = makeOrchestrator();

    const begun = await orchestrator.beginApproval({
      auth: editorAuth,
      requestId: "req-begin",
      sessionId: "xiaoze-kb-thread",
      toolName: "action.createKnowledgeDraft",
      payload: draftPayload(),
      citations: [],
      pageKey: "logs"
    });

    expect(begun.approvalId).toBeTruthy();
    expect(await countAgentDrafts()).toBe(0);

    const resolved = await orchestrator.resolveApproval({
      auth: editorAuth,
      requestId: "req-approve",
      approvalId: begun.approvalId,
      decision: "approve"
    });
    expect(resolved.text).toContain("快充温控排查经验");

    const drafts = await db.query<{
      title: string;
      status: string;
      source_type: string;
      source_session_id: string;
      created_by_user_id: string;
      tags: string[];
    }>(
      `select title, status, source_type, source_session_id, created_by_user_id, tags from knowledge_entries where organization_id = $1`,
      [ORG_ID]
    );
    expect(drafts.rows).toHaveLength(1);
    expect(drafts.rows[0]).toMatchObject({
      title: "快充温控排查经验",
      status: "draft",
      source_type: "agent",
      source_session_id: "xiaoze-kb-thread",
      created_by_user_id: EDITOR
    });

    const audits = await db.query<{ kind: string; action: string; actor_type: string }>(
      `select kind, action, actor_type from audit_events where organization_id = $1 order by created_at asc`,
      [ORG_ID]
    );
    const kinds = audits.rows.map((row) => `${row.kind}:${row.action}`);
    expect(kinds).toContain("agent-tool:approval-requested");
    expect(kinds).toContain("knowledge-entry-agent-draft:agent-draft-create");
    expect(kinds).toContain("agent-tool:approval-executed");
    for (const row of audits.rows) {
      expect(row.actor_type).toBe("agent");
    }
  });

  it("rejecting the approval never creates a draft", async () => {
    const orchestrator = makeOrchestrator();
    const begun = await orchestrator.beginApproval({
      auth: editorAuth,
      requestId: "req-begin-reject",
      sessionId: "xiaoze-kb-thread-reject",
      toolName: "action.createKnowledgeDraft",
      payload: draftPayload(),
      citations: [],
      pageKey: "logs"
    });

    const resolved = await orchestrator.resolveApproval({
      auth: editorAuth,
      requestId: "req-reject",
      approvalId: begun.approvalId,
      decision: "reject",
      reason: "内容不完整"
    });

    expect(resolved.text).toContain("内容不完整");
    expect(await countAgentDrafts()).toBe(0);
  });

  it("denies approval execution when the requester lacks knowledge:edit", async () => {
    const orchestrator = makeOrchestrator();
    const begun = await orchestrator.beginApproval({
      auth: viewerAuth,
      requestId: "req-begin-authz",
      sessionId: "xiaoze-kb-thread-authz",
      toolName: "action.createKnowledgeDraft",
      payload: draftPayload(),
      citations: [],
      pageKey: "logs"
    });

    await expect(
      orchestrator.resolveApproval({
        auth: viewerAuth,
        requestId: "req-approve-authz",
        approvalId: begun.approvalId,
        decision: "approve"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await countAgentDrafts()).toBe(0);
  });
});
