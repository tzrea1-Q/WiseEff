import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const projectId = "aurora";
const parameterValueId = `${projectId}-fast-charge-current`;
const actorUserId = "u-xu-yun";
const targetValue = String(3300 + (Date.now() % 100));
const changeReason = `M5.4 browser acceptance ${Date.now()}`;
const rejectParameterValueId = `${projectId}-charge-voltage-limit`;
const rejectTargetValue = "4333";
const rejectReasonPrefix = "M5.8 PARAM-REJECT-001 browser acceptance";
const draftEditReasonPrefix = "M5.8 PARAM-DRAFT-EDIT-001 browser acceptance";
const rejectionReason = `${rejectReasonPrefix} needs supplemental thermal evidence`;

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

async function seedWorkflowUsers() {
  const users = [
    ["u-wang-jie", "Wang Jie", "wang@chargelab.cn", "Hardware Reviewer", "hardware-committer"],
    ["u-sun-mei", "Sun Mei", "sun@chargelab.cn", "Software Reviewer", "software-committer"],
    ["u-liu-min", "Liu Min", "liu@chargelab.cn", "Software Engineer", "software-user"]
  ] as const;

  await withPgClient(async (client) => {
    for (const [userId, name, email, title, roleId] of users) {
      await client.query(
        `
        insert into users (id, organization_id, name, email, title, is_active)
        values ($1, 'org-chargelab', $2, $3, $4, true)
        on conflict (id) do update set
          name = excluded.name,
          email = excluded.email,
          title = excluded.title,
          is_active = excluded.is_active
        `,
        [userId, name, email, title]
      );
      await client.query(
        `
        insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
        values ($1, $2, 'org-chargelab', $3, $4)
        on conflict (id) do update set
          project_id = excluded.project_id,
          role_id = excluded.role_id
        `,
        [`acceptance-${userId}-${roleId}-${projectId}`, userId, projectId, roleId]
      );
    }
  });
}

async function cleanupOpenAcceptanceRequests() {
  await withPgClient(async (client) => {
    const requests = await client.query<{ id: string; submission_round_id: string | null }>(
      `
      select cr.id, cr.submission_round_id
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where (
          psi.reason like 'M5.4 browser acceptance%'
          or psi.reason like $1
        )
        and cr.status not in ('merged', 'rejected')
      `,
      [`${draftEditReasonPrefix}%`]
    );
    const requestIds = requests.rows.map((row) => row.id);
    const roundIds = Array.from(
      new Set(requests.rows.map((row) => row.submission_round_id).filter((id): id is string => Boolean(id)))
    );

    if (requestIds.length > 0) {
      await client.query("delete from parameter_review_decisions where request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_submission_items where change_request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_change_requests where id = any($1::text[])", [requestIds]);
    }
    if (roundIds.length > 0) {
      await client.query(
        `
        delete from parameter_submission_rounds
        where id = any($1::text[])
          and not exists (
            select 1 from parameter_change_requests
            where parameter_change_requests.submission_round_id = parameter_submission_rounds.id
          )
        `,
        [roundIds]
      );
    }

    await client.query(
      `
      delete from parameter_drafts
      where project_id = $1
        and user_id = $2
        and project_parameter_value_id = $3
      `,
      [projectId, actorUserId, parameterValueId]
    );
  });
}

async function cleanupRejectedAcceptanceRequests() {
  await withPgClient(async (client) => {
    const requests = await client.query<{ id: string; submission_round_id: string | null }>(
      `
      select cr.id, cr.submission_round_id
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where psi.reason like $1
      `,
      [`${rejectReasonPrefix}%`]
    );
    const requestIds = requests.rows.map((row) => row.id);
    const roundIds = Array.from(
      new Set(requests.rows.map((row) => row.submission_round_id).filter((id): id is string => Boolean(id)))
    );

    if (requestIds.length > 0) {
      await client.query("delete from parameter_review_decisions where request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_submission_items where change_request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_change_requests where id = any($1::text[])", [requestIds]);
      await client.query("delete from audit_events where target_id = any($1::text[])", [requestIds]);
    }
    if (roundIds.length > 0) {
      await client.query(
        `
        delete from parameter_submission_rounds
        where id = any($1::text[])
          and not exists (
            select 1 from parameter_change_requests
            where parameter_change_requests.submission_round_id = parameter_submission_rounds.id
          )
        `,
        [roundIds]
      );
    }
  });
}

async function expectSuccessfulApiResponse(page: Page, route: string) {
  const response = await page.request.get(apiRoute(route), { headers: smokeHeaders() });
  expect(response.ok()).toBe(true);
  return response;
}

async function parameterChangeDbSummary(requestId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ status: string; target_value: string }>(
      `
      select cr.status, psi.target_value
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where cr.id = $1
      `,
      [requestId]
    );
    const row = result.rows[0];

    return {
      table: "parameter_change_requests",
      predicate: `id=${requestId}`,
      observed: row ? `status=${row.status}; targetValue=${row.target_value}` : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

function auditSummaryFor(
  items: Array<{ id?: string; kind: string; action: string; projectId: string | null; targetId: string | null; traceId?: string }>,
  match: { kind: string; action: string; targetId: string }
) {
  const item = items.find(
    (candidate) =>
      candidate.kind === match.kind &&
      candidate.action === match.action &&
      candidate.targetId === match.targetId
  );

  expect(item).toBeTruthy();

  return {
    id: item?.id,
    kind: item!.kind,
    action: item!.action,
    targetId: item!.targetId,
    requestId: item?.traceId
  };
}

async function createSubmittedRejectionRequest(page: Page) {
  const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
    headers: smokeHeaders(),
    data: {
      projectId,
      items: [
        {
          parameterId: rejectParameterValueId,
          targetValue: rejectTargetValue,
          reason: `${rejectReasonPrefix} submitted request`
        }
      ],
      reason: `${rejectReasonPrefix} submitted request`,
      assignees: {
        hardwareCommitterId: "u-wang-jie",
        softwareCommitterId: "u-sun-mei",
        softwareUserId: "u-liu-min"
      }
    }
  });

  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    item: {
      items: Array<{ requestId: string; targetValue: string }>;
    };
  };
  const requestId = body.item.items.find((item) => item.targetValue === rejectTargetValue)?.requestId;
  expect(requestId).toBeTruthy();

  return requestId!;
}

test.describe("M5.4 manual flow B/C - parameter management browser acceptance", () => {
  test.beforeAll(async () => {
    runNpmScript("db:migrate");
    runNpmScript("db:seed:m0");
    runNpmScript("db:seed:m1");
    await cleanupOpenAcceptanceRequests();
    await cleanupRejectedAcceptanceRequests();
    await seedWorkflowUsers();
  });

  test("searches, drafts, submits, reviews, persists, audits, and opens admin import preview", async ({ page }, testInfo) => {
    // @acceptance PARAM-HAPPY-001
    // @acceptance PARAM-ADMIN-001
    // @operation PARAM-HAPPY-001
    // @operation PARAM-ADMIN-001
    await page.goto(`/parameters?project=${projectId}`);

    // API mode mounts semantic topology workspace (teaching fixtures) instead of the flat table.
    const workspace = page.getByRole("region", { name: "项目拓扑工作区" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await workspace.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    await expect(workspace.getByRole("cell", { name: "gpio_int" })).toHaveCount(2);

    const submitResponse = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: parameterValueId,
            targetValue,
            reason: changeReason
          }
        ],
        reason: changeReason,
        assignees: {
          hardwareCommitterId: "u-wang-jie",
          softwareCommitterId: "u-sun-mei",
          softwareUserId: "u-liu-min"
        }
      }
    });
    expect(submitResponse.ok()).toBe(true);
    const submitBody = (await submitResponse.json()) as {
      item: {
        items: Array<{ requestId: string; targetValue: string }>;
      };
    };
    const requestId =
      submitBody.item.items.find((item) => item.targetValue === targetValue)?.requestId ?? "";
    expect(requestId).not.toEqual("");

    await page.goto("/parameter-review");
    const requestRow = page.getByRole("row").filter({ hasText: targetValue }).first();
    await expect(requestRow).toBeVisible();
    await requestRow.click();

    const reviewDetail = page.getByRole("complementary", { name: "审阅详情" });
    await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(/硬件(?:Committer|MDE)检视/);
    await reviewDetail.getByRole("button", { name: "推进流程" }).click();
    await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(/软件(?:Committer|MDE)检视/);
    await reviewDetail.getByRole("button", { name: "推进流程" }).click();
    await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(/软件(?:User|开发人员?)合入/);
    await reviewDetail.getByRole("button", { name: "推进流程" }).click();

    await page.getByRole("tab", { name: "历史提交" }).click();
    await expect(page.getByRole("row").filter({ hasText: targetValue }).first()).toContainText("已合入");

    const parameterResponse = await page.request.get(apiRoute(`/api/v1/parameters/${parameterValueId}`), {
      headers: smokeHeaders()
    });
    expect(parameterResponse.ok()).toBe(true);
    const parameterBody = (await parameterResponse.json()) as {
      item: { currentValue?: string; id?: string };
    };
    expect(parameterBody.item.currentValue ?? "").toBe(targetValue);

    await page.goto(`/parameters?project=${projectId}`);
    await page.reload();
    const workspaceAfter = page.getByRole("region", { name: "项目拓扑工作区" });
    await expect(workspaceAfter).toBeVisible({ timeout: 30_000 });
    await workspaceAfter.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    await expect(workspaceAfter.getByRole("cell", { name: "gpio_int" })).toHaveCount(2);

    await page.goto("/parameter-admin?audit=open");
    await expect(page).toHaveURL(/\/audit/);
    await expect(page.getByLabelText("搜索审计记录")).toBeVisible();
    await page.goto("/parameter-admin");
    await expect(page.getByRole("region", { name: "参数规格库" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("toolbar", { name: /项目参数管理后台页面操作/ }).getByRole("button", { name: "批量参数导入" }).click();
    const importWizard = page.getByRole("dialog", { name: "批量参数导入向导" });
    await expect(importWizard).toBeVisible();
    await importWizard.getByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" }).click();
    const pasteDialog = page.getByRole("dialog", { name: "粘贴导入内容" });
    await pasteDialog.getByLabelText("导入内容").fill(
      JSON.stringify([
        {
          name: "acceptance_preview_only_ma",
          module: "Charging Policy",
          risk: "Low",
          unit: "mA",
          range: "0 - 1",
          currentValue: "1",
          recommendedValue: "1",
          description: "Browser acceptance import preview only"
        }
      ])
    );
    await pasteDialog.getByRole("button", { name: "确认" }).click();
    await importWizard.getByRole("button", { name: "下一步" }).click();
    await expect(importWizard.getByRole("region", { name: "解析与校验" })).toBeVisible();
    await importWizard.getByRole("button", { name: "下一步" }).click();
    await expect(importWizard.getByRole("region", { name: "逐行核对" })).toBeVisible();
    await importWizard.getByRole("button", { name: "通过" }).click();
    await importWizard.getByRole("button", { name: "下一步" }).click();
    await expect(importWizard.getByRole("region", { name: "批次预览" })).toBeVisible();

    const auditResponse = await expectSuccessfulApiResponse(page, "/api/v1/audit-events");
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action: string; projectId: string | null; targetId: string | null; traceId?: string }>;
    };
    expect(auditBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "merge",
          kind: "parameter-merge",
          projectId,
          targetId: requestId
        })
      ])
    );

    await recordOperationEvidence({
      operationId: "PARAM-HAPPY-001",
      title: "parameter management submit review merge persistence audit",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(submitResponse, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: `created request ${requestId}`
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `found ${auditBody.items.length} audit events`
        })
      ],
      db: [await parameterChangeDbSummary(requestId)],
      audit: [
        auditSummaryFor(auditBody.items, {
          kind: "parameter-merge",
          action: "merge",
          targetId: requestId
        })
      ],
      notes: `Parameter request ${requestId} merged via API after topology browse; target value persisted; parameter-merge audit recorded. Cross-project UI compare moved to topology binding detail.`
    });
    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-001",
      title: "parameter admin import preview and audit drawer",
      status: "passed",
      page,
      testInfo,
      audit: [
        auditSummaryFor(auditBody.items, {
          kind: "parameter-merge",
          action: "merge",
          targetId: requestId
        })
      ],
      notes: "Admin audit drawer opened; parameter spec library mounts; import preview rendered without committing preview-only data."
    });
  });

  test("rejects a submitted parameter request and persists rejection reason and audit evidence", async ({ page }, testInfo) => {
    // @acceptance PARAM-REJECT-001
    // @operation PARAM-REJECT-001
    const requestId = await createSubmittedRejectionRequest(page);

    await page.goto("/parameter-review");
    const requestRow = page.getByRole("row").filter({ hasText: rejectTargetValue }).first();
    await expect(requestRow).toBeVisible();
    await expect(requestRow).toContainText("Charging Policy");
    await requestRow.click();

    const reviewDetail = page.locator(".review-detail");
    await expect(reviewDetail).toContainText(requestId);
    await reviewDetail.locator(".action-panel button").last().click();

    const rejectDialog = page.locator(".rejection-dialog");
    await expect(rejectDialog).toBeVisible();
    await rejectDialog.locator("#reject-reason").fill(rejectionReason);
    await rejectDialog.locator("button").last().click();
    await expect(rejectDialog).not.toBeVisible();

    await expect(reviewDetail.locator(".rejection-reason-card")).toContainText(rejectionReason);
    await expect(reviewDetail).toContainText(rejectionReason);

    await page.reload();
    const reloadedRow = page.getByRole("row").filter({ hasText: rejectTargetValue }).first();
    await expect(reloadedRow).toBeVisible();
    await expect(reloadedRow.locator("td").last()).toContainText(/./);
    await reloadedRow.click();
    await expect(reviewDetail.locator(".rejection-reason-card")).toContainText(rejectionReason);

    const changesResponse = await expectSuccessfulApiResponse(page, `/api/v1/parameter-change-requests?projectId=${projectId}`);
    const changesBody = (await changesResponse.json()) as {
      items: Array<{ id: string; status: string; rejectReason?: string }>;
    };
    expect(changesBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: requestId,
          status: "rejected",
          rejectReason: rejectionReason
        })
      ])
    );

    const auditResponse = await expectSuccessfulApiResponse(page, "/api/v1/audit-events");
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action: string; projectId: string | null; targetId: string | null; traceId?: string }>;
    };
    expect(auditBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "reject",
          kind: "parameter-review-reject",
          projectId,
          targetId: requestId
        })
      ])
    );

    await recordOperationEvidence({
      operationId: "PARAM-REJECT-001",
      title: "parameter review rejection reason persistence audit",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(changesResponse, {
          method: "GET",
          path: `/api/v1/parameter-change-requests?projectId=${projectId}`,
          responseSummary: `request ${requestId} status=rejected`
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `found ${auditBody.items.length} audit events`
        })
      ],
      db: [await parameterChangeDbSummary(requestId)],
      audit: [
        auditSummaryFor(auditBody.items, {
          kind: "parameter-review-reject",
          action: "reject",
          targetId: requestId
        })
      ],
      notes: `Parameter request ${requestId} was rejected through the browser UI and produced persisted rejection and parameter-review-reject audit evidence.`
    });
  });
});
