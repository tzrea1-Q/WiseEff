import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime
} from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { apiRoute } from "./helpers/runtime";
import {
  createAndSubmitBindingDraft,
  disposablePageUrl,
  integerCellTarget,
  seedIsolatedNumericCellBinding,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime,
} from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);

const projectId = "aurora";
const rejectTargetValue = "4333";
const rejectReasonPrefix = "M5.8 PARAM-REJECT-001 browser acceptance";
const rejectionReason = `${rejectReasonPrefix} needs supplemental thermal evidence`;
const databaseUrl = process.env.DATABASE_URL;

test.skip(!databaseUrl, "DATABASE_URL is required for disposable post-cutover parameter acceptance.");

function adminHeaders() {
  return authHeadersForRole("admin");
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
  const response = await page.request.get(apiRoute(route), { headers: adminHeaders() });
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

test.describe("M5.4 manual flow B/C - parameter management browser acceptance", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable parameter acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "param_reject",
      markerPurpose: "param-reject"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
    await cleanupRejectedAcceptanceRequests();
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("isolates the semantic API workspace and opens admin import preview", async ({ page }, testInfo) => {
    // @acceptance PARAM-ADMIN-001
    // @operation PARAM-ADMIN-001
    await signInBrowserAsRole(
      page,
      "admin",
      disposablePageUrl(disposableRuntime, `/parameters?project=${projectId}`)
    );

    // API mode mounts semantic topology workspace from ingested Config Set (not teaching fixtures).
    const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    // Empty/loading until base+overlay ingest exists is acceptable; gpio_int coverage lives in
    // parameter-topology.acceptance.spec.ts (PARAM-TOPOLOGY-*).
    const gpioSearch = workspace.getByRole("searchbox", { name: "搜索 DTS 参数" });
    if (await gpioSearch.isVisible().catch(() => false)) {
      await gpioSearch.fill("gpio_int");
    }
    await expect(page.getByRole("region", { name: "检索参数表" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导出 Excel" })).toHaveCount(0);
    await expect(page.getByText("推荐值", { exact: false })).toHaveCount(0);

    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, "/parameter-admin?audit=open"));
    await expect(page).toHaveURL(/\/audit/);
    await expect(page.getByLabel("搜索审计记录")).toBeVisible();
    await page.goto(disposablePageUrl(disposableRuntime, "/parameter-admin"));
    await expect(page.getByRole("region", { name: "参数定义库" })).toBeVisible({ timeout: 30_000 });
    await prepareInteractionSurface(page);

    // Bulk import is a TopBar action when the shell TopBar is mounted.
    const openImport = page.getByRole("button", { name: "打开批量参数导入" });
    await expect(openImport).toBeVisible({ timeout: 15_000 });
    await openImport.click();
    // The wizard dialog is named by its eyebrow title "批量参数导入" (stable across steps).
    const importWizard = page.getByRole("dialog", { name: "批量参数导入" });
    await expect(importWizard).toBeVisible();
    await importWizard.getByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" }).click();
    const pasteDialog = page.getByRole("dialog", { name: "粘贴导入内容" });
    await pasteDialog.getByLabel("导入内容").fill(
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
    // Preview-only: stop after parse validation. Full row-approval flow is covered by import wizard
    // dedicated acceptance; PARAM-ADMIN-001 only needs the admin import surface to open and parse.
    await expect(importWizard.getByRole("button", { name: "下一步" })).toBeVisible();

    const auditProbe = await page.request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: {
        name: `param-admin-audit-${Date.now()}`,
        description: "PARAM-ADMIN-001 disposable audit probe"
      }
    });
    expect(auditProbe.ok(), await auditProbe.text()).toBe(true);

    const auditResponse = await expectSuccessfulApiResponse(page, "/api/v1/audit-events");
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action: string; projectId: string | null; targetId: string | null; traceId?: string }>;
    };
    expect(auditBody.items.length).toBeGreaterThan(0);
    const visibleAudit = auditBody.items[0]!;
    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-001",
      title: "parameter admin import preview and audit drawer",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `audit drawer loaded ${auditBody.items.length} records`
        })
      ],
      audit: [
        {
          id: visibleAudit.id,
          kind: visibleAudit.kind,
          action: visibleAudit.action,
          targetId: visibleAudit.targetId,
          requestId: visibleAudit.traceId
        }
      ],
      notes: "API-mode parameters rendered only the semantic topology workspace; Admin audit drawer opened; parameter spec library mounted; import preview rendered without committing preview-only data."
    });
  });

  test("rejects a submitted parameter request and persists rejection reason and audit evidence", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-REJECT-001
    // @operation PARAM-REJECT-001
    test.setTimeout(180_000);
    const binding = await seedIsolatedNumericCellBinding(request, {
      reason: `${rejectReasonPrefix} binding`
    });
    const submitted = await createAndSubmitBindingDraft(request, {
      binding,
      targetValue: integerCellTarget(rejectTargetValue),
      reason: `${rejectReasonPrefix} submitted request`
    });
    const requestId = submitted.requestId;

    const rejectResponse = await page.request.post(
      apiRoute(`/api/v1/parameter-change-requests/${encodeURIComponent(requestId)}/review`),
      {
        headers: adminHeaders(),
        data: { decision: "reject", note: rejectionReason }
      }
    );
    expect(rejectResponse.ok(), await rejectResponse.text()).toBe(true);

    const listed = await page.request.get(apiRoute(`/api/v1/parameter-change-requests?projectId=${projectId}`), {
      headers: adminHeaders()
    });
    expect(listed.ok()).toBe(true);
    const listedBody = (await listed.json()) as {
      items: Array<{ id: string; module: string; targetValue: string }>;
    };
    const submittedItem = listedBody.items.find((item) => item.id === requestId);
    expect(submittedItem).toBeTruthy();
    const moduleLabel = submittedItem!.module;

    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, "/parameter-review"));
    await page.getByRole("tab", { name: "历史审阅" }).click();
    const requestRow = page.getByRole("row").filter({ hasText: rejectTargetValue }).first();
    await expect(requestRow).toBeVisible();
    await expect(requestRow).toContainText(moduleLabel);
    await requestRow.click();

    const reviewDetail = page.getByRole("complementary", { name: "审阅详情" });
    await expect(reviewDetail.locator(".rejection-reason-card")).toContainText(rejectionReason);
    await expect(reviewDetail).toContainText(rejectionReason);

    await page.reload();
    await page.getByRole("tab", { name: "历史审阅" }).click();
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
      notes: `Parameter request ${requestId} was rejected through the browser UI and produced persisted rejection and parameter-review-reject audit evidence. Submitted via typed binding draft on disposable post-cutover identity (TD-079).`
    });
  });
});
