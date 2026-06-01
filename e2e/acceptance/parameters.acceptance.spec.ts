import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const projectId = "aurora";
const targetProjectId = "atlas";
const parameterName = "fast_charge_current_limit_ma";
const parameterValueId = `${projectId}-fast-charge-current`;
const actorUserId = "u-xu-yun";
const targetValue = String(3300 + (Date.now() % 100));
const changeReason = `M5.4 browser acceptance ${Date.now()}`;
const rejectParameterValueId = `${projectId}-charge-voltage-limit`;
const rejectTargetValue = "4333";
const rejectReasonPrefix = "M5.8 PARAM-REJECT-001 browser acceptance";
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
      where psi.reason like 'M5.4 browser acceptance%'
        and cr.status not in ('merged', 'rejected')
      `
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

function searchTable(page: Page) {
  return page.getByRole("region", { name: "检索参数表" });
}

function rowByParameterName(scope: Page | Locator) {
  return scope.getByRole("row").filter({ hasText: parameterName }).first();
}

async function expectSuccessfulApiResponse(page: Page, route: string) {
  const response = await page.request.get(apiRoute(route), { headers: smokeHeaders() });
  expect(response.ok()).toBe(true);
  return response;
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

    await expect(searchTable(page)).toContainText(parameterName);
    await page.getByRole("searchbox", { name: "按名称 / 描述 / 模块搜索" }).fill(parameterName);
    await expect(rowByParameterName(searchTable(page))).toBeVisible();

    await searchTable(page).getByRole("button", { name: /^筛选重要性$/ }).click();
    await page.getByRole("checkbox", { name: /^(High|高)(\s+\d+)?$/ }).check();
    await expect(rowByParameterName(searchTable(page))).toBeVisible();

    await searchTable(page).getByRole("button", { name: /^筛选模块$/ }).click();
    await page.getByRole("checkbox", { name: "Charging Policy" }).check();
    await expect(rowByParameterName(searchTable(page))).toBeVisible();

    await searchTable(page).getByRole("button", { name: `查看 ${parameterName}` }).click();
    const detailDialog = page.getByRole("dialog", { name: parameterName });
    await expect(detailDialog.getByText("近期历史")).toBeVisible();
    await expect(detailDialog.getByRole("region", { name: "跨项目对比" })).toContainText("跨项目对比");
    await expect(detailDialog.getByLabel("项目配置概览")).toContainText("ATL-Intl");
    await detailDialog.getByLabel("对比目标项目").selectOption(targetProjectId);
    await expect(detailDialog.getByRole("region", { name: "跨项目对比" })).toContainText("AUR-Prod");
    await expect(detailDialog.getByRole("region", { name: "跨项目对比" })).toContainText("ATL-Intl");
    await detailDialog.getByRole("button", { name: "加入修改草稿" }).click();

    const draftDialog = page.getByRole("dialog", { name: "修改草稿" });
    await draftDialog.getByLabel("目标值").fill(targetValue);
    await draftDialog.getByLabel("修改原因").fill(changeReason);
    await draftDialog.getByRole("button", { name: "提交参数" }).click();

    const modifiedSection = page.getByRole("region", { name: "本轮已修改参数区" });
    await expect(modifiedSection).toContainText(targetValue);
    await modifiedSection.getByRole("button", { name: "提交本轮 (1 项)" }).click();

    const submitDialog = page.getByRole("dialog", { name: "提交本轮参数" });
    await submitDialog.getByLabel("硬件 MDE").selectOption({ label: "Wang Jie" });
    await submitDialog.getByLabel("软件 MDE").selectOption({ label: "Sun Mei" });
    await submitDialog.getByLabel("软件开发").selectOption({ label: "Liu Min" });
    await submitDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(submitDialog).not.toBeVisible();

    await page.goto("/parameter-review");
    const requestRow = page.getByRole("row").filter({ hasText: targetValue }).first();
    await expect(requestRow).toBeVisible();
    const requestId = ((await requestRow.locator("td").first().textContent()) ?? "").trim();
    expect(requestId).not.toEqual("");
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

    await page.goto(`/parameters?project=${projectId}`);
    await page.reload();
    await page.getByRole("searchbox", { name: "按名称 / 描述 / 模块搜索" }).fill(parameterName);
    await expect(rowByParameterName(searchTable(page)).locator(".parameter-value-diff > span").first()).toHaveText(targetValue);

    await page.goto("/parameter-admin?audit=open");
    await expect(page.getByRole("complementary", { name: "审计抽屉" })).toBeVisible();
    await page.getByRole("searchbox", { name: "搜索参数" }).fill(parameterName);
    await expect(page.getByRole("listbox", { name: "项目共享参数库" })).toContainText(parameterName);

    await page.getByRole("toolbar", { name: /项目参数管理后台页面操作/ }).getByRole("button", { name: "批量参数导入" }).click();
    const importDialog = page.getByRole("dialog", { name: "参数导入" });
    await expect(importDialog).toBeVisible();
    await importDialog.locator("textarea").fill(
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
    await importDialog.getByRole("button", { name: "生成预览" }).click();
    await expect(importDialog.getByRole("region", { name: "导入预览" })).toBeVisible();

    const auditResponse = await expectSuccessfulApiResponse(page, "/api/v1/audit-events");
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ kind: string; action: string; projectId: string | null; targetId: string | null }>;
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
      notes: `Parameter request ${requestId} merged, persisted target value, and produced parameter-merge audit evidence.`
    });
    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-001",
      title: "parameter admin import preview and audit drawer",
      status: "passed",
      page,
      testInfo,
      notes: "Admin audit drawer opened and parameter import preview rendered without committing preview-only data."
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
      items: Array<{ kind: string; action: string; projectId: string | null; targetId: string | null }>;
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
      notes: `Parameter request ${requestId} was rejected through the browser UI and produced persisted rejection and parameter-review-reject audit evidence.`
    });
  });
});
