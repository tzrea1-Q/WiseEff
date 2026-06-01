import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

useBrowserDiagnostics(test);

const databaseUrl = process.env.DATABASE_URL;
const apiAuthorization =
  process.env.VITE_WISEEFF_API_AUTHORIZATION?.trim() ||
  process.env.M5_SMOKE_AUTHORIZATION?.trim() ||
  process.env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
const actorUserId = "u-xu-yun";
const projectId = "aurora";
const agentDraftReasonPrefix = "WiseAgent action request%";

type AgentEvidence = {
  toolCalls: Array<{ name: string; status: string; requires_approval: boolean }>;
  approvals: Array<{ status: string; title: string }>;
  traces: Array<{
    provider: string;
    model: string;
    prompt_version: string;
    tool_call_ids: string[];
    safety_status: string | null;
  }>;
  auditEvents: Array<{ action: string; kind: string; metadata: Record<string, unknown> }>;
};

test.skip(!databaseUrl, "DATABASE_URL is required for Agent API/audit/trace acceptance evidence.");

function runNpmScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorDetails = result.error
      ? `child_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd()
      : "";

    throw new Error(
      [
        `npm run ${script} failed with exit code ${result.status}.`,
        stdout,
        stderr,
        errorDetails
      ].filter(Boolean).join("\n")
    );
  }
}

async function prepareAgentAcceptanceState() {
  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");

  await withPgClient(async (client) => {
    await client.query(
      `
      update users
      set is_active = true
      where id = $1
      `,
      [actorUserId]
    );
    await client.query(
      `
      delete from parameter_drafts
      where user_id = $1
        and project_id = $2
        and reason like $3
      `,
      [actorUserId, projectId, agentDraftReasonPrefix]
    );
  });
}

async function openParameterAgent(page: Page) {
  await page.goto(`/parameters?project=${projectId}`);
  await expect(page.getByRole("region", { name: "项目参数用户工作台" })).toBeVisible();

  await page.getByRole("button", { name: "打开 WiseAgent" }).click();
  const panel = page.locator(".agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("项目参数巡检 Agent");
  await expect(panel).toContainText("正在关注快充电流");
  await expect(panel).toContainText("读取当前项目与角色上下文");

  return panel;
}

async function agentSessionId(panel: Locator) {
  await expect
    .poll(async () => (await panel.getAttribute("data-session-id")) ?? "", {
      message: "WiseAgent API session id should be attached to the panel"
    })
    .not.toBe("");

  return (await panel.getAttribute("data-session-id")) ?? "";
}

async function countAgentDrafts() {
  return withPgClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_drafts
      where user_id = $1
        and project_id = $2
        and reason like $3
      `,
      [actorUserId, projectId, agentDraftReasonPrefix]
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function readAgentEvidence(sessionId: string): Promise<AgentEvidence> {
  return withPgClient(async (client) => {
    const toolCalls = await client.query<AgentEvidence["toolCalls"][number]>(
      `
        select name, status, requires_approval
        from agent_tool_calls
        where session_id = $1
        order by created_at asc
        `,
      [sessionId]
    );
    const approvals = await client.query<AgentEvidence["approvals"][number]>(
      `
        select status, title
        from agent_approvals
        where session_id = $1
        order by requested_at asc
        `,
      [sessionId]
    );
    const traces = await client.query<AgentEvidence["traces"][number]>(
      `
        select provider, model, prompt_version, tool_call_ids, safety_status
        from agent_run_traces
        where session_id = $1
        order by created_at asc
        `,
      [sessionId]
    );
    const auditEvents = await client.query<AgentEvidence["auditEvents"][number]>(
      `
        select action, kind, metadata
        from audit_events
        where metadata->>'sessionId' = $1
        order by created_at asc
        `,
      [sessionId]
    );

    return {
      toolCalls: toolCalls.rows,
      approvals: approvals.rows,
      traces: traces.rows,
      auditEvents: auditEvents.rows
    };
  });
}

async function agentToolCallStatuses(sessionId: string) {
  return (await readAgentEvidence(sessionId)).toolCalls.map((toolCall) => `${toolCall.name}:${toolCall.status}`);
}

async function apiAuditActionsForSession(page: Page, sessionId: string) {
  const response = await page.request.get(apiRoute("/api/v1/audit-events"), {
    headers: apiAuthorization ? { Authorization: apiAuthorization } : undefined
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: Array<{ action: string; kind: string; metadata?: Record<string, unknown> }>;
  };

  return body.items
    .filter((item) => item.metadata?.sessionId === sessionId)
    .map((item) => `${item.kind}:${item.action}`);
}

test.describe("M5.4 manual flow G - Agent collaboration loop", () => {
  test.beforeAll(async () => {
    await prepareAgentAcceptanceState();
  });

  test("requires approval for draft actions and records API, audit, and trace evidence", async ({ page }) => {
    // @acceptance AGENT-APPROVAL-001
    const panel = await openParameterAgent(page);
    const sessionId = await agentSessionId(panel);

    await panel.getByRole("button", { name: "筛出高风险参数" }).click();
    await expect.poll(() => agentToolCallStatuses(sessionId)).toContain("parameter.summarizeReviewQueue:succeeded");

    const draftsBeforeReject = await countAgentDrafts();
    await panel.getByRole("button", { name: "生成参数修改草稿" }).click();
    let approvalDialog = page.getByRole("alertdialog", { name: "Create parameter draft" });
    await expect(approvalDialog).toBeVisible({ timeout: 30_000 });
    await expect(approvalDialog).toContainText("Approval is required before running Create parameter draft.");
    await expect(panel.getByText("pending_approval")).toBeVisible();

    await approvalDialog.getByRole("button", { name: "取消" }).click();
    await expect(approvalDialog).not.toBeVisible();
    await expect.poll(countAgentDrafts, { message: "Rejecting the approval must not create a draft" }).toBe(draftsBeforeReject);
    await expect(panel.getByText("rejected", { exact: true })).toBeVisible();

    const draftsBeforeApprove = await countAgentDrafts();
    await panel.getByRole("button", { name: "生成参数修改草稿" }).click();
    approvalDialog = page.getByRole("alertdialog", { name: "Create parameter draft" });
    await expect(approvalDialog).toBeVisible({ timeout: 30_000 });
    await approvalDialog.getByRole("button", { name: "确认执行" }).click();
    await expect(approvalDialog).not.toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("Created one parameter draft for human review.")).toBeVisible();
    await expect.poll(countAgentDrafts, { message: "Approving the draft action should persist an Agent draft" }).toBeGreaterThan(
      draftsBeforeApprove
    );

    const evidence = await readAgentEvidence(sessionId);
    expect(evidence.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "parameter.summarizeReviewQueue", status: "succeeded", requires_approval: false }),
        expect.objectContaining({ name: "parameter.submitChangeDraft", status: "rejected", requires_approval: true }),
        expect.objectContaining({ name: "parameter.submitChangeDraft", status: "succeeded", requires_approval: true })
      ])
    );
    expect(evidence.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Create parameter draft", status: "rejected" }),
        expect.objectContaining({ title: "Create parameter draft", status: "approved" })
      ])
    );
    expect(evidence.traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "deterministic",
          model: "wiseeff-rules-m4",
          prompt_version: "m4-agent-v1"
        })
      ])
    );
    expect(evidence.traces.some((trace) => trace.tool_call_ids.length > 0)).toBe(true);
    expect(evidence.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent-tool", action: "approval-requested" }),
        expect.objectContaining({ kind: "agent-tool", action: "approval-rejected" }),
        expect.objectContaining({ kind: "agent-tool", action: "approval-executed" })
      ])
    );
    await expect.poll(() => apiAuditActionsForSession(page, sessionId)).toEqual(
      expect.arrayContaining(["agent-tool:approval-rejected", "agent-tool:approval-executed"])
    );
  });
});
