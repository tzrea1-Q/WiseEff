import { describe, expect, it } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { Database, Queryable } from "../../shared/database/client";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import type { BackendRoleId } from "../auth/types";

type MemoryRow = Record<string, unknown>;

function createTraceRecorder() {
  const spans: Parameters<TraceExporter>[0][] = [];
  return {
    spans,
    tracing: createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    })
  };
}

function isoNow() {
  return "2026-05-28T00:00:00.000Z";
}

function createMemoryDb() {
  const authRowsByUserId: Record<
    string,
    {
      isActive: boolean;
      roleId: BackendRoleId;
      projectId: string | null;
    }
  > = {
    "u-xu-yun": { isActive: true, roleId: "admin", projectId: null },
    "dev-user": { isActive: true, roleId: "admin", projectId: null },
    "inactive-user": { isActive: false, roleId: "admin", projectId: null },
    "guest-user": { isActive: true, roleId: "guest", projectId: "aurora" },
    "hardware-user": { isActive: true, roleId: "hardware-user", projectId: "aurora" }
  };
  const tables = {
    sessions: [] as MemoryRow[],
    messages: [] as MemoryRow[],
    toolCalls: [] as MemoryRow[],
    approvals: [] as MemoryRow[],
    traces: [] as MemoryRow[],
    audits: [] as MemoryRow[],
    parameterDrafts: [] as MemoryRow[]
  };

  const queryable: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []) => {
      const sql = text.replace(/\s+/g, " ").trim();

      if (sql.includes("from users") && sql.includes("join organizations")) {
        const userId = String(values[0]);
        const authRow = authRowsByUserId[userId];
        if (!authRow) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        return {
          rows: [
            {
              user_id: userId,
              organization_id: "org-dev",
              organization_name: "Development Org",
              name: "Test User",
              email: `${userId}@example.com`,
              title: "Tester",
              is_active: authRow.isActive,
              project_id: authRow.projectId,
              role_id: authRow.roleId
            }
          ] as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("select 1 as ok")) {
        return { rows: [{ ok: 1 } as Row], rowCount: 1 };
      }
      if (sql.includes("from jobs")) {
        return {
          rows: [
            {
              queued: "0",
              processing: "0",
              dead_lettered: "0",
              oldest_queued_at: null
            }
          ] as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into agent_sessions")) {
        tables.sessions.push({
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          actor_user_id: values[3],
          page_key: values[4],
          role_id: values[5],
          context: values[6],
          title: values[7],
          status: "active",
          created_at: isoNow(),
          updated_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_sessions")) {
        const rows = tables.sessions.filter((row) => row.organization_id === values[0] && row.id === values[1]);
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (sql.includes("insert into agent_messages")) {
        tables.messages.push({
          id: values[0],
          session_id: values[1],
          organization_id: values[2],
          role: values[3],
          content: values[4],
          citations: values[5],
          confidence: values[6],
          created_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_messages")) {
        const rows = tables.messages.filter((row) => row.organization_id === values[0] && row.session_id === values[1]);
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (sql.includes("insert into agent_tool_calls")) {
        tables.toolCalls.push({
          id: values[0],
          session_id: values[1],
          organization_id: values[2],
          project_id: values[3],
          name: values[4],
          label: values[5],
          payload: values[6],
          requires_approval: values[7],
          status: values[8],
          result: null,
          error_message: null,
          audit_event_id: null,
          created_at: isoNow(),
          updated_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("update agent_tool_calls")) {
        const row = tables.toolCalls.find((item) => item.organization_id === values[0] && item.id === values[1]);
        if (!row) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        row.status = values[2] ?? row.status;
        row.result = values[3] ?? row.result;
        row.error_message = values[4] ?? row.error_message;
        row.audit_event_id = values[5] ?? row.audit_event_id;
        row.updated_at = isoNow();
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_tool_calls")) {
        const rows = tables.toolCalls
          .filter((row) =>
            sql.includes("session_id = $2")
              ? row.organization_id === values[0] && row.session_id === values[1]
              : row.organization_id === values[0] && row.id === values[1]
          )
          .map((row) => ({
            ...row,
            approval_id: tables.approvals.find((approval) => approval.tool_call_id === row.id)?.id ?? null
          }));
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (sql.includes("insert into agent_approvals")) {
        tables.approvals.push({
          id: values[0],
          session_id: values[1],
          tool_call_id: values[2],
          organization_id: values[3],
          project_id: values[4],
          status: values[5],
          title: values[6],
          message: values[7],
          requested_by_user_id: values[8],
          requested_at: isoNow(),
          decided_at: null,
          decided_by_user_id: null,
          decision_reason: null
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("update agent_approvals")) {
        const row = tables.approvals.find(
          (item) => item.organization_id === values[0] && item.id === values[1] && item.status === "pending"
        );
        if (!row) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        row.status = sql.includes("status = 'approved'") ? "approved" : "rejected";
        row.decided_by_user_id = values[2];
        row.decision_reason = values[3] ?? null;
        row.decided_at = isoNow();
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from agent_approvals")) {
        const rows = tables.approvals.filter((row) =>
          sql.includes("session_id = $2")
            ? row.organization_id === values[0] && row.session_id === values[1]
            : row.organization_id === values[0] && row.id === values[1]
        );
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (sql.includes("insert into agent_run_traces")) {
        tables.traces.push({
          id: values[0],
          session_id: values[1],
          message_id: values[2],
          organization_id: values[3],
          provider: values[4],
          model: values[5],
          prompt_version: values[6],
          input_summary: values[7],
          output_summary: values[8],
          tool_call_ids: values[9],
          trace_id: values[10],
          latency_ms: values[11],
          input_tokens: values[12],
          output_tokens: values[13],
          estimated_cost_usd: values[14],
          safety_status: values[15],
          safety_reasons: values[16],
          fallback_reason: values[17],
          created_at: isoNow()
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("insert into audit_events")) {
        tables.audits.push({
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          actor_user_id: values[3],
          actor_type: values[4],
          app: values[5],
          kind: values[6],
          action: values[7],
          severity: values[8],
          target_type: values[9],
          target_id: values[10],
          metadata: values[11],
          trace_id: values[12]
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes("from parameter_change_requests cr")) {
        return { rows: [] as Row[], rowCount: 0 };
      }
      if (sql.includes("from project_parameter_values ppv") && sql.includes("limit 1")) {
        return {
          rows: [
            {
              id: "project-parameter-1",
              project_id: values[1],
              parameter_definition_id: "parameter-definition-1",
              current_value: "3100"
            }
          ] as Row[],
          rowCount: 1
        };
      }
      if (sql.includes("insert into parameter_drafts")) {
        tables.parameterDrafts.push({
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          project_parameter_value_id: values[3],
          user_id: values[4],
          target_value: values[5],
          reason: values[6]
        });
        return { rows: [{ id: values[0] }] as Row[], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL in test DB: ${sql}`);
    }
  };

  const db: Database = {
    ...queryable,
    transaction: async (fn) => fn(queryable)
  };

  return { db, tables };
}

async function createRouteSession(db: Database) {
  return requestJson<{ turn: { session: { id: string }; toolCalls: { id: string; approvalId?: string }[] } }>(
    createWiseEffServer({ db }),
    "/api/v1/agent/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
      })
    }
  );
}

async function createApprovalRequiredToolCall(db: Database) {
  const sessionResponse = await createRouteSession(db);
  const sessionId = sessionResponse.body.turn.session.id;
  const messageResponse = await requestJson<{
    turn: { toolCalls: { id: string; status: string; approvalId?: string }[]; approvals: { id: string }[] };
  }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "Prepare a parameter draft because the value needs review." })
  });
  const toolCall = messageResponse.body.turn.toolCalls.find((item) => item.status === "pending_approval");

  if (!toolCall?.approvalId) {
    throw new Error("Test setup did not create an approval-required tool call.");
  }

  return { sessionId, toolCallId: toolCall.id, approvalId: toolCall.approvalId };
}

async function createApprovalRequiredToolCallWithTables(db: Database, tables: ReturnType<typeof createMemoryDb>["tables"]) {
  const ids = await createApprovalRequiredToolCall(db);
  const toolCall = tables.toolCalls.find((item) => item.id === ids.toolCallId);
  if (!toolCall) {
    throw new Error("Test setup did not retain the approval-required tool call.");
  }

  return { ...ids, toolCall };
}

async function createCrossSessionApprovalScenario(db: Database) {
  const sessionAResponse = await createRouteSession(db);
  const sessionB = await createApprovalRequiredToolCall(db);

  return {
    wrongSessionId: sessionAResponse.body.turn.session.id,
    toolCallId: sessionB.toolCallId,
    approvalId: sessionB.approvalId
  };
}

describe("agent routes", () => {
  it("rejects session creation without a database adapter", async () => {
    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer(),
      "/api/v1/agent/sessions",
      {
        method: "POST",
        body: JSON.stringify({
          context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
        })
      }
    );

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("validates blank messages", async () => {
    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer(),
      "/api/v1/agent/sessions/agent-session-1/messages",
      {
        method: "POST",
        body: JSON.stringify({ message: "   " })
      }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("creates sessions through the app route", async () => {
    const { db } = createMemoryDb();

    const response = await createRouteSession(db);

    expect(response.status).toBe(201);
    expect(response.body.turn.session.id).toEqual(expect.stringMatching(/^agent-session-/));
  });

  it("exposes Agent provider call metrics after route-driven messages", async () => {
    const { db } = createMemoryDb();
    const server = createWiseEffServer({ db });
    const sessionResponse = await requestJson<{ turn: { session: { id: string } } }>(server, "/api/v1/agent/sessions", {
      method: "POST",
      body: JSON.stringify({
        context: { path: "/overview", pageKey: "overview", projectId: "aurora", roleId: "hardware-user" }
      })
    });

    await requestJson(server, `/api/v1/agent/sessions/${sessionResponse.body.turn.session.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Hello." })
    });
    const metricsResponse = await requestJson(server, "/metrics");

    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.bodyText).toContain('wiseeff_agent_provider_calls_total{provider="deterministic",status="succeeded"} 1');
  });

  it("exports HTTP and Agent provider spans after route-driven messages", async () => {
    const { db } = createMemoryDb();
    const { spans, tracing } = createTraceRecorder();
    const server = createWiseEffServer({ db, tracing });
    const sessionResponse = await requestJson<{ turn: { session: { id: string } } }>(server, "/api/v1/agent/sessions", {
      method: "POST",
      body: JSON.stringify({
        context: { path: "/overview", pageKey: "overview", projectId: "aurora", roleId: "hardware-user" }
      })
    });

    await requestJson(server, `/api/v1/agent/sessions/${sessionResponse.body.turn.session.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Hello." })
    });

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "api.request",
          attributes: expect.objectContaining({
            service: "wiseeff-api",
            method: "POST",
            route: "/api/v1/agent/sessions",
            status: 201,
            requestId: "test-request"
          })
        }),
        expect.objectContaining({
          name: "agent.provider.plan_turn",
          attributes: expect.objectContaining({
            service: "wiseeff-api",
            provider: "deterministic",
            model: "wiseeff-rules-m4",
            promptVersion: "m4-agent-v1",
            status: "succeeded"
          })
        })
      ])
    );
    expect(JSON.stringify(spans)).not.toContain("Hello.");
    expect(JSON.stringify(spans)).not.toContain(sessionResponse.body.turn.session.id);
  });

  it("returns not found for unknown sessions", async () => {
    const { db } = createMemoryDb();

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db }),
      "/api/v1/agent/sessions/missing-session/messages",
      {
        method: "POST",
        body: JSON.stringify({ message: "Summarize the current page." })
      }
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns approval required when running a pending approval tool", async () => {
    const { db } = createMemoryDb();
    const { sessionId, toolCallId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${sessionId}/tool-calls/${toolCallId}/run`,
      {
        method: "POST",
        body: JSON.stringify({ payload: {} })
      }
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("APPROVAL_REQUIRED");
  });

  it("rejects run requests when the tool call belongs to a different session", async () => {
    const { db } = createMemoryDb();
    const { wrongSessionId, toolCallId } = await createCrossSessionApprovalScenario(db);

    const response = await requestJson<{ error?: { code: string }; turn?: { session: { id: string } } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${wrongSessionId}/tool-calls/${toolCallId}/run`,
      {
        method: "POST",
        body: JSON.stringify({ payload: {} })
      }
    );

    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe("NOT_FOUND");
    expect(response.body.turn).toBeUndefined();
  });

  it("rejects approvals without inserting parameter drafts", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{
      turn: { approvals: { id: string; status: string; reason?: string }[]; toolCalls: { status: string }[] };
    }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "Needs clearer evidence." })
    });

    expect(response.status).toBe(200);
    expect(response.body.turn.approvals[0]).toMatchObject({ id: approvalId, status: "rejected" });
    expect(response.body.turn.toolCalls).toEqual(expect.arrayContaining([expect.objectContaining({ status: "rejected" })]));
    expect(tables.parameterDrafts).toHaveLength(0);
  });

  it("accepts bodyless approval rejections", async () => {
    const { db } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{
      turn: { approvals: { id: string; status: string; reason?: string }[]; toolCalls: { status: string; error?: string }[] };
    }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/reject`, {
      method: "POST"
    });

    expect(response.status).toBe(200);
    expect(response.body.turn.approvals[0]).toMatchObject({ id: approvalId, status: "rejected", reason: "Rejected" });
    expect(response.body.turn.toolCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "rejected", error: "Rejected" })])
    );
  });

  it("rejects approval rejections when the approval belongs to a different session", async () => {
    const { db, tables } = createMemoryDb();
    const { wrongSessionId, approvalId } = await createCrossSessionApprovalScenario(db);

    const response = await requestJson<{ error?: { code: string }; turn?: { session: { id: string } } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${wrongSessionId}/approvals/${approvalId}/reject`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "Wrong session path." })
      }
    );

    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe("NOT_FOUND");
    expect(response.body.turn).toBeUndefined();
    const approval = tables.approvals.find((item) => item.id === approvalId);
    expect(approval?.status).toBe("pending");
    expect(tables.toolCalls.find((toolCall) => toolCall.id === approval?.tool_call_id)?.status).toBe("pending_approval");
  });

  it("approves approvals and returns a succeeded tool call", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{
      turn: { toolCalls: { status: string; result?: { summary: string } }[] };
    }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    expect(response.body.turn.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({ summary: "Created one parameter draft for human review." })
        })
      ])
    );
    expect(tables.parameterDrafts).toHaveLength(1);
  });

  it("rejects approvals from inactive users", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`,
      {
        method: "POST",
        headers: { "x-wiseeff-user": "inactive-user" },
        body: JSON.stringify({})
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    const approval = tables.approvals.find((item) => item.id === approvalId);
    expect(approval?.status).toBe("pending");
    expect(tables.toolCalls.find((toolCall) => toolCall.id === approval?.tool_call_id)?.status).toBe("pending_approval");
    expect(tables.parameterDrafts).toHaveLength(0);
  });

  it("rejects approval of parameter.submitChangeDraft without parameter edit permission", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`,
      {
        method: "POST",
        headers: { "x-wiseeff-user": "guest-user" },
        body: JSON.stringify({})
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    const approval = tables.approvals.find((item) => item.id === approvalId);
    expect(approval?.status).toBe("pending");
    expect(tables.toolCalls.find((toolCall) => toolCall.id === approval?.tool_call_id)?.status).toBe("pending_approval");
    expect(tables.parameterDrafts).toHaveLength(0);
  });

  it("rejects audit.summarizeRecentEvents without admin access", async () => {
    const { db } = createMemoryDb();
    const sessionResponse = await requestJson<{ turn: { session: { id: string } } }>(
      createWiseEffServer({ db }),
      "/api/v1/agent/sessions",
      {
        method: "POST",
        headers: { "x-wiseeff-user": "hardware-user" },
        body: JSON.stringify({
          context: { path: "/audit", pageKey: "audit", projectId: "aurora", roleId: "hardware-user" }
        })
      }
    );

    const response = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${sessionResponse.body.turn.session.id}/messages`,
      {
        method: "POST",
        headers: { "x-wiseeff-user": "hardware-user" },
        body: JSON.stringify({ message: "Summarize recent audit events." })
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects approval that has already been approved", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);
    const server = createWiseEffServer({ db });

    const firstResponse = await requestJson<{ turn: { approvals: { id: string; status: string }[] } }>(
      server,
      `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );
    const secondResponse = await requestJson<{ error: { code: string } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.turn.approvals[0]).toMatchObject({ id: approvalId, status: "approved" });
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe("INVALID_APPROVAL_STATE");
    expect(tables.parameterDrafts).toHaveLength(1);
  });

  it("approves when expected tool call status still matches", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{
      turn: { toolCalls: { status: string; result?: { summary: string } }[] };
    }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`, {
      method: "POST",
      body: JSON.stringify({ expectedToolCallStatus: "pending_approval" })
    });

    expect(response.status).toBe(200);
    expect(response.body.turn.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({ summary: "Created one parameter draft for human review." })
        })
      ])
    );
    expect(tables.parameterDrafts).toHaveLength(1);
  });

  it("rejects approvals when the expected tool call status is stale", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId, toolCall } = await createApprovalRequiredToolCallWithTables(db, tables);
    toolCall.status = "running";

    const response = await requestJson<{
      error: { code: string; details: { expectedToolCallStatus?: string; actualToolCallStatus?: string } };
    }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`, {
      method: "POST",
      body: JSON.stringify({ expectedToolCallStatus: "pending_approval" })
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(response.body.error.details).toMatchObject({
      expectedToolCallStatus: "pending_approval",
      actualToolCallStatus: "running"
    });
    expect(tables.approvals.find((approval) => approval.id === approvalId)?.status).toBe("pending");
    expect(tables.parameterDrafts).toHaveLength(0);
  });

  it("accepts bodyless approval approvals", async () => {
    const { db, tables } = createMemoryDb();
    const { sessionId, approvalId } = await createApprovalRequiredToolCall(db);

    const response = await requestJson<{
      turn: { toolCalls: { status: string; result?: { summary: string } }[] };
    }>(createWiseEffServer({ db }), `/api/v1/agent/sessions/${sessionId}/approvals/${approvalId}/approve`, {
      method: "POST"
    });

    expect(response.status).toBe(200);
    expect(response.body.turn.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({ summary: "Created one parameter draft for human review." })
        })
      ])
    );
    expect(tables.parameterDrafts).toHaveLength(1);
  });

  it("rejects approval approvals when the approval belongs to a different session", async () => {
    const { db, tables } = createMemoryDb();
    const { wrongSessionId, approvalId } = await createCrossSessionApprovalScenario(db);

    const response = await requestJson<{ error?: { code: string }; turn?: { session: { id: string } } }>(
      createWiseEffServer({ db }),
      `/api/v1/agent/sessions/${wrongSessionId}/approvals/${approvalId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );

    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe("NOT_FOUND");
    expect(response.body.turn).toBeUndefined();
    expect(tables.approvals.find((approval) => approval.id === approvalId)?.status).toBe("pending");
    expect(tables.parameterDrafts).toHaveLength(0);
  });
});
