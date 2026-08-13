import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import {
  appendAgentMessage,
  createAgentApproval,
  createAgentSession,
  createAgentToolCall,
  getAgentApproval,
  getAgentSession,
  getAgentToolCall,
  listAgentApprovals,
  listAgentMessages,
  listAgentToolCalls,
  markAgentApprovalApproved,
  markAgentApprovalRejected,
  updateAgentToolCall
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_A = "org-agent-a";
const ORG_B = "org-agent-b";
const USER_A = "user-agent-a";
const USER_B = "user-agent-b";
const SESSION = "session-1";

describe.skipIf(!databaseAvailable)("agent repository (behavior)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'Agent Org A'), ($2, 'Agent Org B')`, [
      ORG_A,
      ORG_B
    ]);
    await db.query(
      `insert into users (id, organization_id, name, email, title)
       values
         ($1, $3, 'Agent User A', 'agent-a@example.com', 'Engineer'),
         ($2, $4, 'Agent User B', 'agent-b@example.com', 'Engineer')`,
      [USER_A, USER_B, ORG_A, ORG_B]
    );
    await createAgentSession(db, {
      id: SESSION,
      organizationId: ORG_A,
      actorUserId: USER_A,
      pageKey: "parameters",
      context: { projectId: "aurora", route: "/parameters" },
      title: "Charging tuning"
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("round-trips a session with its JSONB context, invisible to other tenants", async () => {
    const session = await getAgentSession(db, ORG_A, SESSION);
    expect(session).toMatchObject({
      id: SESSION,
      organizationId: ORG_A,
      actorUserId: USER_A,
      pageKey: "parameters",
      status: "active",
      title: "Charging tuning"
    });
    // Context is normalized into the AgentContext projection, not passed through.
    expect(session?.context).toEqual({ path: "", pageKey: "", projectId: "aurora", roleId: undefined });

    expect(await getAgentSession(db, ORG_B, SESSION)).toBeNull();
  });

  it("appends messages and lists them in order with citations round-tripped, scoped by org and session", async () => {
    await appendAgentMessage(db, {
      id: "msg-1",
      sessionId: SESSION,
      organizationId: ORG_A,
      role: "user",
      content: "为什么充电后段降频？"
    });
    await appendAgentMessage(db, {
      id: "msg-2",
      sessionId: SESSION,
      organizationId: ORG_A,
      role: "assistant",
      content: "热回退触发。",
      citations: [{ type: "log", id: "log-1", label: "Pack log", snippet: "temp=74" }],
      confidence: 0.9
    });

    const messages = await listAgentMessages(db, ORG_A, SESSION);
    expect(messages.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
    expect(messages[1]?.citations).toEqual([{ type: "log", id: "log-1", label: "Pack log", snippet: "temp=74" }]);
    expect(messages[1]?.confidence).toBe(0.9);

    expect(await listAgentMessages(db, ORG_B, SESSION)).toEqual([]);
    expect(await listAgentMessages(db, ORG_A, "other-session")).toEqual([]);
  });

  async function seedToolCall(id = "tool-1", status = "running") {
    await createAgentToolCall(db, {
      id,
      sessionId: SESSION,
      organizationId: ORG_A,
      name: "action.submitParameterChange",
      label: "Submit parameter change",
      payload: { parameterId: "param-1", targetValue: "3200" },
      requiresApproval: true,
      status
    });
  }

  it("round-trips a tool call and reports update success by row count", async () => {
    await seedToolCall();

    const created = await getAgentToolCall(db, ORG_A, "tool-1");
    expect(created).toMatchObject({
      id: "tool-1",
      sessionId: SESSION,
      status: "running",
      requiresApproval: true
    });
    expect(created?.approvalId).toBeUndefined();
    expect(created?.payload).toEqual({ parameterId: "param-1", targetValue: "3200" });

    expect(await updateAgentToolCall(db, ORG_A, "missing-tool", { status: "succeeded" })).toBe(false);
    expect(await updateAgentToolCall(db, ORG_B, "tool-1", { status: "succeeded" })).toBe(false);

    expect(
      await updateAgentToolCall(db, ORG_A, "tool-1", {
        status: "succeeded",
        result: { changeRequestId: "cr-1" }
      })
    ).toBe(true);
    const updated = await getAgentToolCall(db, ORG_A, "tool-1");
    expect(updated?.status).toBe("succeeded");
    expect(updated?.result).toEqual({ changeRequestId: "cr-1" });
    // Fields not passed stay untouched (coalesce semantics).
    expect(updated?.payload).toEqual({ parameterId: "param-1", targetValue: "3200" });
  });

  it("guards terminal tool-call statuses while allowing idempotent repeats", async () => {
    await seedToolCall();
    expect(await updateAgentToolCall(db, ORG_A, "tool-1", { status: "succeeded" })).toBe(true);

    // A terminal status cannot move to a different status…
    expect(await updateAgentToolCall(db, ORG_A, "tool-1", { status: "running" })).toBe(false);
    expect(await updateAgentToolCall(db, ORG_A, "tool-1", { status: "failed" })).toBe(false);
    // …but the same terminal status is idempotent.
    expect(await updateAgentToolCall(db, ORG_A, "tool-1", { status: "succeeded" })).toBe(true);
    expect((await getAgentToolCall(db, ORG_A, "tool-1"))?.status).toBe("succeeded");
  });

  it("lists tool calls for the session with the linked approval id", async () => {
    await seedToolCall("tool-1");
    await createAgentApproval(db, {
      id: "approval-1",
      sessionId: SESSION,
      toolCallId: "tool-1",
      organizationId: ORG_A,
      status: "pending",
      title: "Approve parameter change",
      message: "Submit 3200mA for review?",
      requestedByUserId: USER_A
    });

    const calls = await listAgentToolCalls(db, ORG_A, SESSION);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: "tool-1", approvalId: "approval-1" });

    expect(await listAgentToolCalls(db, ORG_B, SESSION)).toEqual([]);
  });

  it("approval decisions are single-shot and pending-guarded", async () => {
    await seedToolCall("tool-1");
    await createAgentApproval(db, {
      id: "approval-1",
      sessionId: SESSION,
      toolCallId: "tool-1",
      organizationId: ORG_A,
      status: "pending",
      title: "Approve parameter change",
      message: "Submit 3200mA for review?",
      requestedByUserId: USER_A
    });

    // Cross-tenant decisions never land.
    expect(await markAgentApprovalApproved(db, ORG_B, "approval-1", USER_B)).toBe(false);

    expect(await markAgentApprovalApproved(db, ORG_A, "approval-1", USER_A)).toBe(true);
    const approved = await getAgentApproval(db, ORG_A, "approval-1");
    expect(approved).toMatchObject({ status: "approved", decidedByUserId: USER_A });
    expect(approved?.reason).toBeUndefined();
    expect(approved?.decidedAt).toBeTruthy();

    // Once decided, neither a second approve nor a reject can overwrite it.
    expect(await markAgentApprovalApproved(db, ORG_A, "approval-1", USER_A)).toBe(false);
    expect(await markAgentApprovalRejected(db, ORG_A, "approval-1", USER_A, "changed my mind")).toBe(false);
    expect((await getAgentApproval(db, ORG_A, "approval-1"))?.status).toBe("approved");
  });

  it("rejection stores the decision reason", async () => {
    await seedToolCall("tool-1");
    await createAgentApproval(db, {
      id: "approval-1",
      sessionId: SESSION,
      toolCallId: "tool-1",
      organizationId: ORG_A,
      status: "pending",
      title: "Approve parameter change",
      message: "Submit 3200mA for review?",
      requestedByUserId: USER_A
    });

    expect(await markAgentApprovalRejected(db, ORG_A, "approval-1", USER_A, "risk too high")).toBe(true);
    expect(await getAgentApproval(db, ORG_A, "approval-1")).toMatchObject({
      status: "rejected",
      reason: "risk too high"
    });

    const listed = await listAgentApprovals(db, ORG_A, SESSION);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "approval-1", status: "rejected" });
    expect(await listAgentApprovals(db, ORG_B, SESSION)).toEqual([]);
  });
});
