import "dotenv/config";
import { expect, test, type Page } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { withPgClient } from "./helpers/database";

useBrowserDiagnostics(test);

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

const importParameterName = "charge_voltage_limit_mv";
const organizationId = "org-chargelab";
const projectId = "aurora";

type ImportTargetSnapshot = {
  definition_id: string;
  value_id: string;
  description: string;
  explanation: string;
  config_format: string;
  module: string;
  default_range: string;
  unit: string;
  risk: string;
  current_value: string;
  recommended_value: string;
  value_version: number;
  updated_by_user_id: string | null;
};

let importTargetSnapshot: ImportTargetSnapshot | null = null;

async function loadImportTargetSnapshot() {
  return withPgClient(async (client) => {
    const result = await client.query<ImportTargetSnapshot>(
      `
      select
        pd.id as definition_id,
        ppv.id as value_id,
        pd.description,
        pd.explanation,
        pd.config_format,
        pd.module,
        pd.default_range,
        pd.unit,
        pd.risk,
        ppv.current_value,
        ppv.recommended_value,
        ppv.value_version,
        ppv.updated_by_user_id
      from parameter_definitions pd
      inner join project_parameter_values ppv on ppv.parameter_definition_id = pd.id
      where pd.organization_id = $1
        and ppv.project_id = $2
        and pd.name = $3
      `,
      [organizationId, projectId, importParameterName]
    );
    return result.rows[0] ?? null;
  });
}

async function restoreImportTargetSnapshot(snapshot: ImportTargetSnapshot) {
  await withPgClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `
        delete from parameter_history_entries
        where project_parameter_value_id = $1
          and version > $2
          and request_id is null
          and changed_by_user_id = 'u-xu-yun'
        `,
        [snapshot.value_id, snapshot.value_version]
      );
      await client.query(
        `
        update parameter_definitions
        set description = $2,
            explanation = $3,
            config_format = $4,
            module = $5,
            default_range = $6,
            unit = $7,
            risk = $8
        where id = $1
          and organization_id = $9
        `,
        [
          snapshot.definition_id,
          snapshot.description,
          snapshot.explanation,
          snapshot.config_format,
          snapshot.module,
          snapshot.default_range,
          snapshot.unit,
          snapshot.risk,
          organizationId
        ]
      );
      await client.query(
        `
        update project_parameter_values
        set current_value = $2,
            recommended_value = $3,
            value_version = $4,
            updated_by_user_id = $5
        where id = $1
          and organization_id = $6
          and project_id = $7
        `,
        [
          snapshot.value_id,
          snapshot.current_value,
          snapshot.recommended_value,
          snapshot.value_version,
          snapshot.updated_by_user_id,
          organizationId,
          projectId
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

const importPayload = JSON.stringify([
  {
    name: importParameterName,
    module: "Charging Policy",
    risk: "High",
    unit: "mA",
    range: "4200 - 4500",
    currentValue: "4350",
    recommendedValue: "4310",
    description: "Browser acceptance import wizard row"
  }
]);

test.describe("PARAM-ADMIN-002 parameter import wizard browser acceptance", () => {
  test.beforeEach(async () => {
    importTargetSnapshot = await loadImportTargetSnapshot();
    expect(importTargetSnapshot).toBeTruthy();
    await restoreImportTargetSnapshot(importTargetSnapshot!);
  });

  test.afterEach(async () => {
    if (importTargetSnapshot) {
      await restoreImportTargetSnapshot(importTargetSnapshot);
      importTargetSnapshot = null;
    }
  });

  test("runs the five-step import wizard through preview", async ({ page }, testInfo) => {
    // @acceptance PARAM-ADMIN-002
    // @operation PARAM-ADMIN-002
    const workflowStartedAt = new Date();
    await page.goto("/parameter-admin");
    await dismissXiaozeHint(page);

    await expect(page.getByRole("toolbar", { name: /项目参数管理后台页面操作/ })).toBeVisible();

    await page.getByRole("toolbar", { name: /项目参数管理后台页面操作/ }).getByRole("button", { name: "批量参数导入" }).click();
    const wizard = page.getByRole("dialog", { name: "批量参数导入向导" });
    await expect(wizard).toBeVisible();

    await expect(wizard.getByRole("region", { name: "选择来源与目标项目" })).toBeVisible();
    await expect(wizard.getByRole("combobox", { name: "目标项目" })).toBeVisible();
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
    await expect(rowReview).toContainText(importParameterName);
    await wizard.getByRole("button", { name: "通过" }).click();
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeEnabled();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const batchPreview = wizard.getByRole("region", { name: "批次预览" });
    await expect(batchPreview).toBeVisible({ timeout: 30_000 });
    const previewRow = batchPreview.getByRole("row").filter({ hasText: importParameterName });
    await expect(previewRow).toContainText("更新");
    await expect(previewRow.getByRole("checkbox", { name: `选择 ${importParameterName}` })).toBeChecked();
    await expect(wizard.getByRole("button", { name: "下一步" })).toBeEnabled();
    await wizard.getByRole("button", { name: "下一步" }).click();

    const confirmApply = wizard.getByRole("region", { name: "确认应用" });
    await expect(confirmApply).toBeVisible();
    await expect(confirmApply).toContainText("AUR-Prod");
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
      return { batch, audit };
    });
    expect(applied.batch).toMatchObject({ status: "applied" });
    expect(applied.audit).toBeTruthy();

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
        }
      ],
      audit: [
        {
          id: applied.audit?.id,
          kind: applied.audit!.kind,
          action: applied.audit!.action,
          targetId: applied.audit?.target_id,
          requestId: applied.audit?.trace_id ?? undefined,
          metadataSummary: `batchId=${applied.batch?.id}; status=${applied.batch?.status}`
        }
      ],
      notes: `Wizard applied an update for ${importParameterName}; the acceptance fixture restores the original definition and project value after evidence capture.`
    });
  });
});
