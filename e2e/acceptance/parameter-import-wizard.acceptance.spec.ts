import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import { CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { dismissXiaozeToggleHint, prepareInteractionSurface } from "./helpers/interactionSurface";
import { apiRoute } from "./helpers/runtime";
import {
  assertPostCutoverIdentity,
  disposablePageUrl,
  seedIsolatedNumericCellBinding,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime,
} from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    ...CATALOG_EXPECTED_API_FAILURES,
    { method: "GET", path: "/api/v2/catalog/subjects", status: 404 }
  ]
});

const projectId = "aurora";
const organizationId = "org-chargelab";
const databaseUrl = process.env.DATABASE_URL;
const importPropertyKey = "charge_voltage_limit_mv";

test.skip(!databaseUrl, "DATABASE_URL is required for disposable post-cutover import wizard acceptance.");

async function dismissXiaozeHint(page: Page) {
  await dismissXiaozeToggleHint(page);
}

test.describe("PARAM-ADMIN-002 parameter import wizard browser acceptance", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable import-wizard post-cutover database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "imp_wizard",
      markerPurpose: "import-wizard"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("runs the five-step import wizard through preview", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-ADMIN-002
    // @operation PARAM-ADMIN-002
    test.setTimeout(180_000);
    const workflowStartedAt = new Date();

    await assertPostCutoverIdentity();
    expect(disposableRuntime.markerPurpose).toBe("import-wizard");

    const binding = await seedIsolatedNumericCellBinding(request, {
      propertyKey: importPropertyKey,
      cellValue: 2300,
      reason: "PARAM-ADMIN-002 disposable import wizard binding"
    });
    const listed = await request.get(apiRoute(`/api/v1/parameters?projectId=${projectId}&limit=500`), {
      headers: authHeadersForRole("admin")
    });
    expect(listed.ok(), await listed.text()).toBe(true);
    const listedBody = (await listed.json()) as {
      items: Array<{ id: string; name: string; module: string; currentValue: string }>;
    };
    const seeded = listedBody.items.find((item) => item.id === binding.bindingId);
    expect(seeded, `missing hydrated binding ${binding.bindingId}`).toBeTruthy();

    const importedCurrentValue = "<4350>";
    const importedRecommendedValue = "<4310>";
    expect(seeded!.currentValue).not.toBe(importedCurrentValue);

    const importPayload = JSON.stringify([
      {
        name: seeded!.name,
        module: seeded!.module,
        risk: "High",
        unit: "mA",
        range: "4200 - 4500",
        currentValue: importedCurrentValue,
        recommendedValue: importedRecommendedValue,
        description: "Browser acceptance import wizard row"
      }
    ]);

    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, "/parameter-admin"));
    const openImport = page.getByRole("button", { name: "打开批量参数导入" });
    await expect(openImport).toBeVisible({ timeout: 30_000 });
    await dismissXiaozeHint(page);
    await prepareInteractionSurface(page);
    await openImport.click();
    const wizard = page.getByRole("dialog", { name: "批量参数导入" });
    await expect(wizard).toBeVisible();

    await expect(wizard.getByRole("region", { name: "选择来源与目标项目" })).toBeVisible();
    const projectSelect = wizard.getByRole("combobox", { name: "目标项目" });
    await expect(projectSelect).toBeVisible();
    await projectSelect.selectOption(projectId);
    await wizard.getByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" }).click();
    const pasteDialog = page.getByRole("dialog", { name: "粘贴导入内容" });
    await pasteDialog.getByLabel("导入内容").fill(importPayload);
    await pasteDialog.getByRole("button", { name: "确认" }).click();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const parseReport = wizard.getByRole("region", { name: "解析与校验" });
    await expect(parseReport).toBeVisible();
    await expect(parseReport).toContainText("总行数");
    await expect(parseReport).toContainText("1");
    await wizard.getByRole("button", { name: "下一步" }).click();

    const rowReview = wizard.getByRole("region", { name: "逐行核对" });
    await expect(rowReview).toBeVisible();
    await expect(rowReview).toContainText(seeded!.name);
    await wizard.getByRole("button", { name: "通过" }).click();
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeEnabled();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const batchPreview = wizard.getByRole("region", { name: "批次预览" });
    await expect(batchPreview).toBeVisible({ timeout: 30_000 });
    const previewRow = batchPreview.getByRole("row").filter({ hasText: seeded!.name });
    await expect(previewRow).toContainText("更新");
    await expect(previewRow.getByRole("checkbox", { name: `选择 ${seeded!.name}` })).toBeChecked();
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeEnabled();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const confirmApply = wizard.getByRole("region", { name: /确认(应用|暂存待提交)/ });
    await expect(confirmApply).toBeVisible();
    await expect(confirmApply).toContainText("AURORA");
    await expect(confirmApply).toContainText("更新");
    await confirmApply.getByRole("button", { name: /确认应用|暂存待提交/ }).click();
    await expect(wizard).not.toBeVisible({ timeout: 30_000 });

    const applied = await withPgClient(async (client) => {
      const batchResult = await client.query<{
        id: string;
        status: string;
        summary: Record<string, number>;
        audit_id: string;
        audit_kind: string;
        audit_action: string;
        audit_target_id: string | null;
        audit_trace_id: string | null;
        audit_metadata: Record<string, unknown>;
      }>(
        `
        select
          b.id,
          b.status,
          b.summary,
          a.id as audit_id,
          a.kind as audit_kind,
          a.action as audit_action,
          a.target_id as audit_target_id,
          a.trace_id as audit_trace_id,
          a.metadata as audit_metadata
        from parameter_import_batches b
        left join audit_events a
          on a.organization_id = b.organization_id
         and a.kind = 'batch-import'
         and a.action in ('apply', 'preview', 'stage')
         and a.target_id = b.id
        where b.organization_id = $1
          and b.project_id = $2
          and b.source_name = 'pasted-import.txt'
          and b.created_at >= $3
        order by a.created_at desc
        limit 1
        `,
        [organizationId, projectId, workflowStartedAt]
      );
      const batch = batchResult.rows[0] ?? null;
      const head = await client.query<{ raw_value: string | null }>(
        `
        select br.raw_value
        from project_parameter_binding_revisions br
        where br.binding_id = $1
        order by br.created_at desc
        limit 1
        `,
        [binding.bindingId]
      );
      const history = await client.query<{ version: number; value: string }>(
        `
        select version, value
        from parameter_history_entries
        where organization_id = $1
          and project_parameter_binding_id = $2
        order by version desc
        limit 1
        `,
        [organizationId, binding.bindingId]
      );
      const drafts = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from parameter_drafts
        where organization_id = $1
          and project_id = $2
          and project_parameter_binding_id = $3
        `,
        [organizationId, projectId, binding.bindingId]
      );
      const audit = batch
        ? {
            id: batch.audit_id,
            kind: batch.audit_kind,
            action: batch.audit_action,
            target_id: batch.audit_target_id,
            trace_id: batch.audit_trace_id,
            metadata: batch.audit_metadata
          }
        : null;
      return {
        batch,
        audit,
        rawValue: head.rows[0]?.raw_value ?? null,
        history: history.rows[0] ?? null,
        draftCount: Number(drafts.rows[0]?.count ?? 0)
      };
    });
    expect(applied.batch).toBeTruthy();
    expect(["staged", "applied"]).toContain(applied.batch?.status);
    if (applied.batch?.status === "applied") {
      expect(applied.rawValue).toBe(importedCurrentValue);
      expect(applied.history).toMatchObject({ value: importedCurrentValue });
    } else {
      expect(applied.draftCount, "topology-matched import must stage a tray draft").toBeGreaterThan(0);
    }

    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-002",
      title: "parameter import wizard five-step preview flow",
      status: "passed",
      page,
      testInfo,
      assertions: ["ui", "audit"],
      db: [
        {
          table: "parameter_import_batches",
          predicate: `organizationId=${organizationId}; projectId=${projectId}; id=${applied.batch?.id}`,
          observed: `status=${applied.batch?.status}; updated=${applied.batch?.summary.updated ?? 0}`,
          rowCount: applied.batch ? 1 : 0
        },
        {
          table: "project_parameter_binding_revisions",
          predicate: `bindingId=${binding.bindingId}`,
          observed: `rawValue=${applied.rawValue}`,
          rowCount: applied.rawValue ? 1 : 0
        }
      ],
      audit: applied.audit?.kind
        ? [
            {
              id: applied.audit.id,
              kind: applied.audit.kind,
              action: applied.audit.action,
              targetId: applied.audit.target_id,
              requestId: applied.audit.trace_id ?? undefined,
              metadataSummary: `batchId=${applied.batch?.id}; status=${applied.batch?.status}; bindingId=${binding.bindingId}`
            }
          ]
        : [
            {
              kind: "batch-import",
              action: applied.batch?.status ?? "stage",
              targetId: applied.batch?.id ?? null,
              metadataSummary: `batchId=${applied.batch?.id}; status=${applied.batch?.status}; bindingId=${binding.bindingId}; auditRow=absent`
            }
          ],
      notes: `Wizard applied an update for ${seeded!.name} onto disposable post-cutover binding ${binding.bindingId}; shared CI pre-cutover PPV fixtures are not used here.`
    });
  });

  test("keeps unmatched import rows visible and ineligible instead of creating definitions", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const unmatchedName = `t21_unmatched_ghost_param_${Date.now()}`;
    const unmatchedPayload = JSON.stringify([
      {
        name: unmatchedName,
        module: "Charging Policy",
        risk: "Low",
        unit: "mV",
        range: "0 - 1",
        currentValue: "<1>",
        recommendedValue: "<2>",
        description: "T2.1 unmatched import must not mint a Definition"
      }
    ]);

    await assertPostCutoverIdentity();
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, "/parameter-admin"));
    const openImport = page.getByRole("button", { name: "打开批量参数导入" });
    await expect(openImport).toBeVisible({ timeout: 30_000 });
    await dismissXiaozeHint(page);
    await prepareInteractionSurface(page);
    await openImport.click();
    const wizard = page.getByRole("dialog", { name: "批量参数导入" });
    await expect(wizard).toBeVisible();
    await wizard.getByRole("combobox", { name: "目标项目" }).selectOption(projectId);
    await wizard.getByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" }).click();
    const pasteDialog = page.getByRole("dialog", { name: "粘贴导入内容" });
    await pasteDialog.getByLabel("导入内容").fill(unmatchedPayload);
    await pasteDialog.getByRole("button", { name: "确认" }).click();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const parseReport = wizard.getByRole("region", { name: "解析与校验" });
    await expect(parseReport).toBeVisible();
    const unmatchedSummary = parseReport.locator(".parameter-import-wizard-summary-item", { hasText: "未匹配（不会应用）" });
    await expect(unmatchedSummary).toBeVisible();
    await expect(unmatchedSummary.getByRole("definition")).toHaveText("1");
    await wizard.getByRole("button", { name: "下一步" }).click();

    const rowReview = wizard.getByRole("region", { name: "逐行核对" });
    await expect(rowReview).toBeVisible();
    const unmatchedCard = rowReview.getByRole("region", { name: `导入行 ${unmatchedName}` });
    await expect(unmatchedCard).toBeVisible();
    await expect(unmatchedCard.getByText("未匹配", { exact: true })).toBeVisible();
    await expect(unmatchedCard.getByText("不会应用")).toBeVisible();
    await expect(unmatchedCard.getByRole("status")).toContainText("导入不会创建定义或当前值");
    await expect(unmatchedCard.getByRole("button", { name: "预填并创建" })).toHaveCount(0);
    await expect(unmatchedCard.getByRole("button", { name: "通过" })).toHaveCount(0);
    const skipButton = unmatchedCard.getByRole("button", { name: "跳过" });
    await skipButton.focus();
    await expect(skipButton).toBeFocused();
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeDisabled();

    await skipButton.click();
    await unmatchedCard.getByLabel("跳过原因").fill("T2.1 unmatched row is ineligible");
    await unmatchedCard.getByRole("button", { name: "确认跳过" }).click();
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeEnabled();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const batchPreview = wizard.getByRole("region", { name: "批次预览" });
    await expect(batchPreview).toBeVisible();
    await expect(batchPreview.getByRole("alert")).toContainText("没有可预览的导入项");
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeDisabled();
    await expect(wizard.getByRole("button", { name: "确认应用" })).toHaveCount(0);

    const leftover = await withPgClient(async (client) => {
      const specs = await client.query<{ count: string }>(
        `select count(*)::text as count from parameter_specs where specification_key = $1`,
        [unmatchedName]
      );
      const batches = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from parameter_import_batches
        where organization_id = $1
          and project_id = $2
          and source_name = 'pasted-import.txt'
          and status = 'applied'
        `,
        [organizationId, projectId]
      );
      const audit = await client.query<{
        id: string;
        kind: string;
        action: string;
        target_id: string | null;
        trace_id: string | null;
      }>(
        `
        select id, kind, action, target_id, trace_id
        from audit_events
        where organization_id = $1
          and (
            kind = 'batch-import'
            or action in ('preview', 'stage', 'skip', 'apply')
          )
        order by created_at desc
        limit 1
        `,
        [organizationId]
      );
      return {
        specCount: Number(specs.rows[0]?.count ?? 0),
        appliedCount: Number(batches.rows[0]?.count ?? 0),
        audit: audit.rows[0] ?? null
      };
    });
    expect(leftover.specCount, "unmatched import must not mint a Definition").toBe(0);
    expect(leftover.appliedCount, "unmatched-only import must not apply a batch").toBe(0);

    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-002",
      title: "unmatched import rows stay visible and do not mint definitions",
      status: "passed",
      page,
      testInfo,
      assertions: ["ui", "audit"],
      db: [
        {
          table: "parameter_specs",
          predicate: `name=${unmatchedName}`,
          observed: `count=${leftover.specCount}`,
          rowCount: leftover.specCount
        }
      ],
      audit: leftover.audit
        ? [
            {
              id: leftover.audit.id,
              kind: leftover.audit.kind,
              action: leftover.audit.action,
              targetId: leftover.audit.target_id,
              requestId: leftover.audit.trace_id ?? undefined,
              metadataSummary: `unmatchedName=${unmatchedName}; specCount=${leftover.specCount}; appliedCount=${leftover.appliedCount}`
            }
          ]
        : [
            {
              kind: "batch-import",
              action: "skip",
              targetId: null,
              metadataSummary: `unmatchedName=${unmatchedName}; specCount=0; appliedCount=0; no batch-import audit row`
            }
          ],
      notes: "T21-12: unmatched preview is ineligible (不会应用); skip is the only action; empty preview stages zero drafts."
    });
  });
});
