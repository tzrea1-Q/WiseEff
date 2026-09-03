import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
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

useBrowserDiagnostics(test);

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
    await expect(page.getByRole("region", { name: "参数定义目录" })).toBeVisible({ timeout: 30_000 });
    await dismissXiaozeHint(page);
    await prepareInteractionSurface(page);

    const openImport = page.getByRole("button", { name: "打开批量参数导入" });
    await expect(openImport).toBeVisible({ timeout: 30_000 });
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

    const confirmApply = wizard.getByRole("region", { name: "确认应用" });
    await expect(confirmApply).toBeVisible();
    await expect(confirmApply).toContainText("AURORA");
    await expect(confirmApply).toContainText("更新");
    await confirmApply.getByRole("button", { name: "确认应用" }).click();
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
        inner join audit_events a
          on a.organization_id = b.organization_id
         and a.kind = 'batch-import'
         and a.action = 'apply'
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
        history: history.rows[0] ?? null
      };
    });
    expect(applied.batch).toMatchObject({ status: "applied" });
    expect(applied.audit).toBeTruthy();
    expect(applied.rawValue).toBe(importedCurrentValue);
    expect(applied.history).toMatchObject({ value: importedCurrentValue });

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
      audit: [
        {
          id: applied.audit?.id,
          kind: applied.audit!.kind,
          action: applied.audit!.action,
          targetId: applied.audit?.target_id,
          requestId: applied.audit?.trace_id ?? undefined,
          metadataSummary: `batchId=${applied.batch?.id}; status=${applied.batch?.status}; bindingId=${binding.bindingId}`
        }
      ],
      notes: `Wizard applied an update for ${seeded!.name} onto disposable post-cutover binding ${binding.bindingId}; shared CI pre-cutover PPV fixtures are not used here.`
    });
  });
});
