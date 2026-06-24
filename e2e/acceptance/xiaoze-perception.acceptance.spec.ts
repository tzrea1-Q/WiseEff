import "dotenv/config";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
const actorUserId = "u-xu-yun";

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

function limitedProjectHeaders() {
  if (process.env.AUTH_PROVIDER === "local" || !process.env.AUTH_TOKEN_HMAC_SECRET?.trim()) {
    return {
      ...smokeHeaders(),
      Accept: "text/event-stream",
      "x-wiseeff-user": "acceptance-xiaoze-limited"
    };
  }
  const authorization = bearerTokenFor({
    userId: "acceptance-xiaoze-limited",
    roleId: "guest",
    projectId: "other-project",
    permissions: ["parameter:view", "logs:view"]
  });
  if (authorization) {
    return { "Content-Type": "application/json", Authorization: authorization, Accept: "text/event-stream" };
  }
  return { ...smokeHeaders(), Accept: "text/event-stream", "x-wiseeff-user": "acceptance-xiaoze-limited" };
}

function readSseText(responseBody: string) {
  const chunks: string[] = [];
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) {
      continue;
    }
    const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: string; delta?: string; message?: string };
    if (payload.type === "TEXT_MESSAGE_CONTENT" && payload.delta) {
      chunks.push(payload.delta);
    }
    if (payload.type === "RUN_ERROR" && payload.message) {
      chunks.push(payload.message);
    }
  }
  return chunks.join("");
}

async function postXiaozeQuestion(
  request: { post: (url: string, options?: object) => Promise<{ status: () => number; text: () => Promise<string> }> },
  headers: Record<string, string>,
  message: string,
  projectIdValue = projectId
) {
  const response = await request.post(apiRoute("/api/v1/agent/xiaoze"), {
    headers,
    data: {
      threadId: "xiaoze-thread-acceptance",
      runId: `run-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: message }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId: projectIdValue, path: `/parameters?project=${projectIdValue}` }
        }
      ]
    }
  });

  return {
    status: response.status(),
    body: await response.text()
  };
}

test.skip(!databaseUrl, "DATABASE_URL is required for Xiaoze perception acceptance evidence.");

test.beforeAll(async () => {
  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
  await withPgClient(async (client) => {
    await client.query(`update users set is_active = true where id = $1`, [actorUserId]);
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, 'org-chargelab', 'Acceptance Xiaoze Limited', 'acceptance-xiaoze-limited@chargelab.cn', 'Guest', true)
      on conflict (id) do update set is_active = true
      `,
      ["acceptance-xiaoze-limited"]
    );
    await client.query(
      `
      delete from user_role_bindings where user_id = $1 and organization_id = 'org-chargelab'
      `,
      ["acceptance-xiaoze-limited"]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ('urb-xiaoze-limited', 'acceptance-xiaoze-limited', 'org-chargelab', 'other-project', 'guest')
      on conflict (id) do update set project_id = excluded.project_id, role_id = excluded.role_id
      `
    );
  });
});

test.describe("Xiaoze P0 perception", () => {
  test("returns a grounded answer for an in-scope project question", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-PERCEPTION-001
    // @operation XIAOZE-PERCEPTION-001
    const result = await postXiaozeQuestion(request, adminHeaders(), `summarize project ${projectId}`);
    expect(result.status).toBe(200);
    const answer = readSseText(result.body);
    expect(answer.toLowerCase()).toMatch(/project|parameter|parameters/);

    recordOperationEvidence(testInfo, {
      operationId: "XIAOZE-PERCEPTION-001",
      route: "/parameters",
      action: "ask grounded xiaoze question",
      apiSummary: summarizeApiResponse({ status: result.status, body: answer.slice(0, 240) })
    });
  });

  test("does not leak data for an out-of-scope project question", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-PERCEPTION-AUTHZ-001
    // @operation XIAOZE-PERCEPTION-AUTHZ-001
    const result = await postXiaozeQuestion(
      request,
      limitedProjectHeaders(),
      "summarize forbidden secret-project details",
      "secret-project"
    );
    expect(result.status).toBe(200);
    const answer = readSseText(result.body);
    expect(answer.toLowerCase()).toMatch(/not permitted|cannot|无权限|forbidden/);
    expect(answer.toLowerCase()).not.toMatch(/secret-project: \d+ parameters/);

    recordOperationEvidence(testInfo, {
      operationId: "XIAOZE-PERCEPTION-AUTHZ-001",
      route: "/parameters",
      action: "ask out-of-scope xiaoze question",
      apiSummary: summarizeApiResponse({ status: result.status, body: answer.slice(0, 240) })
    });
  });

  test("rejects unauthenticated xiaoze requests", async ({ request }) => {
    const result = await postXiaozeQuestion(request, { "Content-Type": "application/json", Accept: "text/event-stream" }, "hello");
    expect(result.status).toBe(401);
  });
});
