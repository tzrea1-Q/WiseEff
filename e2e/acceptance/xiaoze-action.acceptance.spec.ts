import "dotenv/config";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
const parameterId = "aurora-fast-charge-current";
const actorUserId = "u-xu-yun";
const threadId = "xiaoze-action-thread";

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
    throw new Error(`npm run ${script} failed with exit code ${result.status}.`);
  }
}

function bearerTokenFor(input: {
  userId: string;
  roleId: string;
  projectId: string | null;
  permissions: string[];
}) {
  const issuer = process.env.AUTH_TOKEN_ISSUER?.trim();
  const secret = process.env.AUTH_TOKEN_HMAC_SECRET?.trim();
  if (!issuer || !secret) {
    return null;
  }

  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      sub: input.userId,
      org: "org-chargelab",
      name: "Acceptance Xiaoze User",
      email: `${input.userId}@chargelab.cn`,
      title: "Acceptance User",
      orgName: "ChargeLab",
      roles: [{ roleId: input.roleId, projectId: input.projectId }],
      permissions: input.permissions,
      isActive: true,
      nbf: 0,
      exp: 9999999999
    })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

function adminHeaders() {
  const authorization =
    process.env.VITE_WISEEFF_API_AUTHORIZATION?.trim() ||
    process.env.M5_SMOKE_AUTHORIZATION?.trim() ||
    process.env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
  if (process.env.AUTH_PROVIDER === "local" || !authorization) {
    return { ...smokeHeaders(), Accept: "text/event-stream", "x-wiseeff-user": actorUserId };
  }
  return { "Content-Type": "application/json", Authorization: authorization, Accept: "text/event-stream" };
}

function readOnlyHeaders() {
  const authorization = bearerTokenFor({
    userId: "acceptance-xiaoze-readonly",
    roleId: "guest",
    projectId,
    permissions: ["parameter:view", "logs:view"]
  });
  if (authorization) {
    return { "Content-Type": "application/json", Authorization: authorization, Accept: "text/event-stream" };
  }
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "x-wiseeff-user": "acceptance-xiaoze-readonly"
  };
}

function parseSseEvents(responseBody: string) {
  const events: Array<Record<string, unknown>> = [];
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) {
      continue;
    }
    events.push(JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>);
  }
  return events;
}

function readInterruptValue(events: Array<Record<string, unknown>>) {
  const custom = events.find((event) => event.type === "CUSTOM" && event.name === "on_interrupt");
  if (custom?.value && typeof custom.value === "object") {
    return custom.value as Record<string, unknown>;
  }
  const finished = events.find((event) => event.type === "RUN_FINISHED");
  const outcome = finished?.outcome as { type?: string; interrupts?: Array<{ metadata?: Record<string, unknown> }> } | undefined;
  return outcome?.interrupts?.[0]?.metadata;
}

async function postXiaoze(
  request: { post: (url: string, options?: object) => Promise<{ status: () => number; text: () => Promise<string>; headers: () => Record<string, string> }> },
  headers: Record<string, string>,
  payload: Record<string, unknown>
) {
  const response = await request.post(apiRoute("/api/v1/agent/xiaoze"), {
    headers,
    data: payload
  });
  const responseBody = await response.text();
  return {
    response,
    status: response.status(),
    body: responseBody,
    events: parseSseEvents(responseBody)
  };
}

async function resetOpenChangeRequestsForParameter() {
  await withPgClient(async (client) => {
    await client.query(
      `
      update parameter_change_requests
      set status = 'rejected', reject_reason = 'xiaoze acceptance reset', updated_at = now()
      where organization_id = 'org-chargelab'
        and project_id = $1
        and project_parameter_value_id = $2
        and status not in ('merged', 'rejected')
      `,
      [projectId, parameterId]
    );
  });
}

async function countOpenChangeRequests() {
  return withPgClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_change_requests
      where organization_id = 'org-chargelab'
        and project_id = $1
        and project_parameter_value_id = $2
        and status not in ('merged', 'rejected')
      `,
      [projectId, parameterId]
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function latestAgentAuditForSession(sessionId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      id: string;
      kind: string;
      action: string;
      actor_type: string;
      target_id: string | null;
      trace_id: string | null;
    }>(
      `
      select id, kind, action, actor_type, target_id, trace_id
      from audit_events
      where metadata->>'sessionId' = $1
      order by created_at desc
      limit 5
      `,
      [sessionId]
    );
    return result.rows;
  });
}

test.skip(!databaseUrl, "DATABASE_URL is required for Xiaoze action acceptance evidence.");

test.beforeAll(async () => {
  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
  await withPgClient(async (client) => {
    await client.query(`update users set is_active = true where id = $1`, [actorUserId]);
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, 'org-chargelab', 'Acceptance Xiaoze Readonly', 'acceptance-xiaoze-readonly@chargelab.cn', 'Guest', true)
      on conflict (id) do update set is_active = true
      `,
      ["acceptance-xiaoze-readonly"]
    );
    await client.query(`delete from user_role_bindings where user_id = $1 and organization_id = 'org-chargelab'`, [
      "acceptance-xiaoze-readonly"
    ]);
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ('urb-xiaoze-readonly', 'acceptance-xiaoze-readonly', 'org-chargelab', $1, 'guest')
      on conflict (id) do update set project_id = excluded.project_id, role_id = excluded.role_id
      `,
      [projectId]
    );
    await client.query(
      `
      update parameter_change_requests
      set status = 'rejected', reject_reason = 'xiaoze acceptance reset', updated_at = now()
      where organization_id = 'org-chargelab'
        and project_id = $1
        and project_parameter_value_id = $2
        and status not in ('merged', 'rejected')
      `,
      [projectId, parameterId]
    );
  });
});

test.beforeEach(async () => {
  await resetOpenChangeRequestsForParameter();
});

test.describe("Xiaoze P1 action", () => {
  test("approves a parameter change through the approval chain", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-ACTION-APPROVE-001
    // @operation XIAOZE-ACTION-APPROVE-001
    const openBefore = await countOpenChangeRequests();
    const actionPrompt = `set ${parameterId} to 18A`;
    const started = await postXiaoze(request, adminHeaders(), {
      threadId,
      runId: `run-action-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: actionPrompt }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });

    expect(started.status).toBe(200);
    const interruptValue = readInterruptValue(started.events);
    expect(interruptValue?.approvalId).toBeTruthy();

    const resumed = await postXiaoze(request, adminHeaders(), {
      threadId,
      runId: `run-resume-approve-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      forwardedProps: {
        command: {
          resume: { decision: "approve" },
          interruptEvent: interruptValue
        }
      }
    });

    expect(resumed.status).toBe(200);
    expect(parseSseEvents(resumed.body).some((event) => event.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
    const openAfterApprove = await countOpenChangeRequests();
    expect(openAfterApprove).toBeGreaterThan(openBefore);

    const followUp = await postXiaoze(request, adminHeaders(), {
      threadId,
      runId: `run-follow-up-${Date.now()}`,
      messages: [{ id: "m-follow-up", role: "user", content: "summarize project aurora" }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });
    expect(followUp.status).toBe(200);
    expect(followUp.events.some((event) => event.type === "RUN_ERROR")).toBe(false);

    const auditRows = await latestAgentAuditForSession(threadId);
    const approvalAudit = auditRows.find((row) => row.action === "approval-executed" && row.actor_type === "agent");
    expect(approvalAudit).toBeTruthy();
    const approveArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-action-approve.json", {
      approvalId: interruptValue?.approvalId,
      startedStatus: started.status,
      resumedStatus: resumed.status,
      followUpStatus: followUp.status,
      openBefore,
      openAfterApprove,
      audit: approvalAudit
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-ACTION-APPROVE-001",
      title: "xiaoze approve parameter change",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [approveArtifact],
      api: [
        summarizeApiResponse(started.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: String(interruptValue?.approvalId ?? "interrupt")
        }),
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: "approved"
        })
      ],
      audit: [
        {
          id: approvalAudit?.id,
          kind: approvalAudit!.kind,
          action: approvalAudit!.action,
          targetId: approvalAudit?.target_id,
          requestId: approvalAudit?.trace_id ?? undefined,
          metadataSummary: `actorType=${approvalAudit?.actor_type}; sessionId=${threadId}`
        }
      ],
      notes: "Xiaoze action approval executed a parameter change request with agent audit evidence."
    });
  });

  test("resumes with AG-UI native resume entries after interrupt", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-ACTION-RESUME-001
    // @operation XIAOZE-ACTION-RESUME-001
    const openBefore = await countOpenChangeRequests();
    const thread = `${threadId}-native-resume`;
    const started = await postXiaoze(request, adminHeaders(), {
      threadId: thread,
      runId: `run-action-native-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: `set ${parameterId} to 19A` }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });

    expect(started.status).toBe(200);
    const interruptValue = readInterruptValue(started.events);
    const approvalId = String(interruptValue?.approvalId ?? "");
    expect(approvalId).toBeTruthy();

    const finished = started.events.find((event) => event.type === "RUN_FINISHED");
    const outcome = finished?.outcome as { interrupts?: Array<{ id?: string }> } | undefined;
    expect(outcome?.interrupts?.[0]?.id).toBe(approvalId);

    const resumed = await postXiaoze(request, adminHeaders(), {
      threadId: thread,
      runId: `run-resume-native-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      resume: [
        {
          interruptId: approvalId,
          status: "resolved",
          payload: {
            approvalId,
            decision: "approve"
          }
        }
      ]
    });

    expect(resumed.status).toBe(200);
    expect(parseSseEvents(resumed.body).some((event) => event.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
    const openAfterNativeApprove = await countOpenChangeRequests();
    expect(openAfterNativeApprove).toBeGreaterThan(openBefore);

    const rejectStarted = await postXiaoze(request, adminHeaders(), {
      threadId: `${thread}-reject`,
      runId: `run-action-native-reject-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: `set ${parameterId} to 15A` }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });
    const rejectInterrupt = readInterruptValue(rejectStarted.events);
    const rejectApprovalId = String(rejectInterrupt?.approvalId ?? "");
    const openBeforeNativeReject = await countOpenChangeRequests();
    const rejected = await postXiaoze(request, adminHeaders(), {
      threadId: `${thread}-reject`,
      runId: `run-resume-native-reject-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "reject" }],
      resume: [
        {
          interruptId: rejectApprovalId,
          status: "cancelled",
          payload: {
            approvalId: rejectApprovalId,
            decision: "reject",
            reason: "Not now"
          }
        }
      ]
    });

    expect(rejected.status).toBe(200);
    const openAfterNativeReject = await countOpenChangeRequests();
    expect(openAfterNativeReject).toBe(openBeforeNativeReject);
    const resumeArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-action-native-resume.json", {
      approvalId,
      rejectApprovalId,
      approveStatus: resumed.status,
      rejectStatus: rejected.status,
      openBefore,
      openAfterNativeApprove,
      openBeforeNativeReject,
      openAfterNativeReject
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-ACTION-RESUME-001",
      title: "xiaoze AG-UI native resume",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [resumeArtifact],
      api: [
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: "native-resume-approved"
        }),
        summarizeApiResponse(rejected.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: "native-resume-rejected"
        })
      ],
      notes: "AG-UI native resume entries clear the interrupt path and preserve approve/reject semantics."
    });
  });

  test("rejects a parameter change without mutation", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-ACTION-REJECT-001
    // @operation XIAOZE-ACTION-REJECT-001
    const openBefore = await countOpenChangeRequests();
    const started = await postXiaoze(request, adminHeaders(), {
      threadId: `${threadId}-reject`,
      runId: `run-action-reject-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: `set ${parameterId} to 17A` }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });
    const interruptValue = readInterruptValue(started.events);
    expect(interruptValue?.approvalId).toBeTruthy();

    const resumed = await postXiaoze(request, adminHeaders(), {
      threadId: `${threadId}-reject`,
      runId: `run-resume-reject-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "reject" }],
      forwardedProps: {
        command: {
          resume: { decision: "reject", reason: "Not now" },
          interruptEvent: interruptValue
        }
      }
    });

    expect(resumed.status).toBe(200);
    const openAfter = await countOpenChangeRequests();
    expect(openAfter).toBe(openBefore);
    const rejectArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-action-reject.json", {
      approvalId: interruptValue?.approvalId,
      resumedStatus: resumed.status,
      openBefore,
      openAfter
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-ACTION-REJECT-001",
      title: "xiaoze reject parameter change",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [rejectArtifact],
      api: [
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: "rejected"
        })
      ],
      notes: "Rejecting the Xiaoze approval card did not create a parameter change request."
    });
  });

  test("denies out-of-permission approval execution with a safe message", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-ACTION-AUTHZ-001
    // @operation XIAOZE-ACTION-AUTHZ-001
    const openBefore = await countOpenChangeRequests();
    const started = await postXiaoze(request, adminHeaders(), {
      threadId: `${threadId}-authz`,
      runId: `run-action-authz-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: `set ${parameterId} to 16A` }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });
    const interruptValue = readInterruptValue(started.events);
    expect(interruptValue?.approvalId).toBeTruthy();

    const resumed = await postXiaoze(request, readOnlyHeaders(), {
      threadId: `${threadId}-authz`,
      runId: `run-resume-authz-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      forwardedProps: {
        command: {
          resume: { decision: "approve" },
          interruptEvent: interruptValue
        }
      }
    });

    expect(resumed.status).toBe(200);
    const answer = parseSseEvents(resumed.body)
      .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
      .map((event) => String(event.delta ?? ""))
      .join("");
    expect(answer.toLowerCase()).toMatch(/not permitted|forbidden|无权限/);
    const openAfter = await countOpenChangeRequests();
    expect(openAfter).toBe(openBefore);
    const authzArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-action-authz-denied.json", {
      approvalId: interruptValue?.approvalId,
      resumedStatus: resumed.status,
      answer,
      openBefore,
      openAfter
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-ACTION-AUTHZ-001",
      title: "xiaoze authz denied action",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [authzArtifact],
      api: [
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: answer.slice(0, 240)
        })
      ],
      notes: "A read-only user could not approve Xiaoze mutating actions beyond their permissions."
    });
  });
});
