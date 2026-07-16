import "dotenv/config";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
const parameterId = "aurora-fast-charge-current";
const actorUserId = "u-xu-yun";
const threadId = "xiaoze-planning-thread";

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

function jsonAdminHeaders() {
  const streamHeaders = adminHeaders();
  return { ...streamHeaders, Accept: "application/json" };
}

function readOnlyHeaders() {
  const authorization = bearerTokenFor({
    userId: "acceptance-xiaoze-readonly",
    roleId: "guest",
    projectId,
    permissions: ["parameter:view", "logs:view"]
  });
  if (authorization) {
    return { "Content-Type": "application/json", Authorization: authorization, Accept: "application/json" };
  }
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
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

function readAssistantText(events: Array<Record<string, unknown>>) {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => String(event.delta ?? ""))
    .join("");
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
  const body = await response.text();
  return { status: response.status(), body, events: parseSseEvents(body), response };
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
        and status not in ('merged', 'rejected', 'withdrawn')
      `,
      [projectId, parameterId]
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

test.skip(!databaseUrl, "DATABASE_URL is required for Xiaoze planning acceptance evidence.");

test.beforeAll(async () => {
  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
});

test.beforeEach(async () => {
  await resetOpenChangeRequestsForParameter();
});

async function ensureOpenChangeRequestForSuggest() {
  await withPgClient(async (client) => {
    const existing = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_change_requests
      where organization_id = 'org-chargelab'
        and project_id = $1
        and project_parameter_value_id = $2
        and status not in ('merged', 'rejected', 'withdrawn')
      `,
      [projectId, parameterId]
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      return;
    }

    const definition = await client.query<{ parameter_definition_id: string }>(
      `
      select parameter_definition_id
      from project_parameter_values
      where id = $1
      `,
      [parameterId]
    );
    const parameterDefinitionId = definition.rows[0]?.parameter_definition_id;
    if (!parameterDefinitionId) {
      throw new Error(`Missing parameter_definition_id for ${parameterId}`);
    }

    await client.query(
      `
      insert into parameter_change_requests (
        id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
        base_version, current_value, target_value, status, submitter_user_id
      )
      values ($1, 'org-chargelab', $2, $3, $4, 1, '3000', '3100', 'submitted', $5)
      on conflict (id) do update set
        status = 'submitted',
        reject_reason = null,
        updated_at = now()
      `,
      [`acceptance-xiaoze-suggest-${parameterId}`, projectId, parameterId, parameterDefinitionId, actorUserId]
    );
  });
}

test.describe("Xiaoze P2 planning", () => {
  test("completes a multi-step task through approval and observe loop", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-PLAN-MULTISTEP-001
    // @operation XIAOZE-PLAN-MULTISTEP-001
    const openBefore = await countOpenChangeRequests();
    const thread = `${threadId}-multistep-${Date.now()}`;
    const actionPrompt = `project ${projectId} charges slowly; set ${parameterId} to 18A`;
    const started = await postXiaoze(request, adminHeaders(), {
      threadId: thread,
      runId: `run-plan-start-${Date.now()}`,
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
      threadId: thread,
      runId: `run-plan-resume-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      resume: [
        {
          interruptId: String(interruptValue?.approvalId),
          status: "resolved",
          payload: {
            approvalId: interruptValue?.approvalId,
            decision: "approve"
          }
        }
      ]
    });

    expect(resumed.status).toBe(200);
    expect(resumed.events.some((event) => event.type === "RUN_ERROR")).toBe(false);
    expect(resumed.events.some((event) => event.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
    expect(await countOpenChangeRequests()).toBeGreaterThan(openBefore);

    const finalText = readAssistantText(resumed.events).toLowerCase();
    expect(finalText.includes("change") || finalText.includes("request") || finalText.includes("citation")).toBe(true);

    await recordOperationEvidence({
      operationId: "XIAOZE-PLAN-MULTISTEP-001",
      title: "xiaoze multi-step plan resume",
      status: "passed",
      route: "/parameters",
      testInfo,
      api: [
        summarizeApiResponse(started.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: String(interruptValue?.approvalId ?? "interrupt")
        }),
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: finalText.slice(0, 120)
        })
      ],
      notes: "Xiaoze resumes the same planning thread after approval and reports the observed execution result."
    });
  });

  test("returns grounded proactive suggestions when enabled and nothing for unauthorized scope", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-PROACTIVE-001
    await ensureOpenChangeRequestForSuggest();

    const enabledResponse = await request.post(apiRoute("/api/v1/agent/xiaoze/suggest"), {
      headers: jsonAdminHeaders(),
      data: {
        context: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
      }
    });
    expect(enabledResponse.status()).toBe(200);
    const enabledBody = (await enabledResponse.json()) as { suggestions?: Array<{ headline?: string }> };
    expect(enabledBody.suggestions?.length ?? 0).toBeGreaterThan(0);
    expect(enabledBody.suggestions?.[0]?.headline?.length ?? 0).toBeGreaterThan(0);

    const forbiddenResponse = await request.post(apiRoute("/api/v1/agent/xiaoze/suggest"), {
      headers: readOnlyHeaders(),
      data: {
        context: { pageKey: "parameters", projectId: "secret-project", path: "/parameters" }
      }
    });
    expect(forbiddenResponse.status()).toBe(200);
    const forbiddenBody = (await forbiddenResponse.json()) as { suggestions?: unknown[] };
    expect(forbiddenBody.suggestions ?? []).toEqual([]);

    await recordOperationEvidence({
      operationId: "XIAOZE-PROACTIVE-001",
      title: "xiaoze proactive suggest",
      status: "passed",
      route: "/parameters",
      testInfo,
      api: [
        summarizeApiResponse(enabledResponse, {
          method: "POST",
          path: "/api/v1/agent/xiaoze/suggest",
          responseSummary: String(enabledBody.suggestions?.[0]?.headline ?? "suggestion")
        })
      ],
      notes: "Proactive suggest is read-only, authz-bounded, and gated by XIAOZE_PROACTIVE_ENABLED."
    });
  });
});
