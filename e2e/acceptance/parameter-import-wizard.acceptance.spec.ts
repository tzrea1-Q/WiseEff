import "dotenv/config";
import { expect, test, type Page } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

const importParameterName = "charge_voltage_limit_mv";

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
  test("runs the five-step import wizard through preview", async ({ page }, testInfo) => {
    // @acceptance PARAM-ADMIN-002
    // @operation PARAM-ADMIN-002
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

    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-002",
      title: "parameter import wizard five-step preview flow",
      status: "passed",
      page,
      testInfo,
      assertions: ["ui"],
      notes: `Wizard reached confirm step for existing parameter ${importParameterName}; apply intentionally not committed in this smoke to avoid mutating shared DB values.`
    });
  });
});
