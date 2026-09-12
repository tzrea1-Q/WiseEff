import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  catalogPage,
  catalogScreenshot,
  openCatalogAt
} from "./helpers/catalogBrowser";
import { ensureCatalogAcceptanceFixture, type CatalogAcceptanceFixture } from "./helpers/catalogEvidence";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    ...CATALOG_EXPECTED_API_FAILURES,
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 403 },
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 409 },
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 422 }
  ]
});

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async () => {
  fixture = await ensureCatalogAcceptanceFixture();
});

test.describe("catalog M1 publication operator loop", () => {
  test("hides the add-definition entry without catalog:author", async ({ page }, testInfo) => {
    await openCatalogAt(page, "user");
    await expect(catalogPage(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "新增定义" })).toHaveCount(0);
    await catalogScreenshot(page, testInfo, "cp08-no-author");
  });

  test("lets an authorized operator draft, preview, and publish a non-fixture definition", async ({
    page
  }, testInfo) => {
    test.skip(
      !process.env.WISEEFF_CATALOG_TEST_CAPABILITIES?.includes("catalog:author"),
      "Isolated publication overlay is required; CP-11 owns the full Hosted lane."
    );
    await openCatalogAt(page, "org-admin");
    const entry = page.getByRole("button", { name: "新增定义" });
    await expect(entry).toBeVisible();
    await entry.click();
    const dialog = page.getByRole("dialog", { name: "向已发布主体新增定义" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/摘要|仓库|Git|digest/i)).toHaveCount(0);
    const subjects = dialog.getByLabel("已发布主体");
    await expect(subjects).toBeVisible();
    const options = await subjects.locator("option").allTextContents();
    const published = options.find((label) => label.trim() && label !== "选择主体");
    expect(published).toBeTruthy();
    await subjects.selectOption({ label: published!.trim() });
    const propertyKey = `cp08_iin_${Date.now().toString(36).slice(-6)}`;
    await dialog.getByLabel("属性键").fill(propertyKey);
    await dialog.getByLabel("显示名称").fill("CP08 保持电流");
    await dialog.getByLabel("说明").fill("隔离验收新增的保持电流定义。");
    await dialog.getByLabel("草稿原因").fill("CP-08 隔离运营闭环");
    await dialog.getByRole("button", { name: "保存草稿" }).click();
    await expect(dialog.getByText("草稿已保存")).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "预览发布" }).click();
    const previewConfirm = page.getByRole("dialog", { name: "确认预览发布候选" });
    await previewConfirm.getByRole("checkbox").check();
    await previewConfirm.getByRole("button", { name: "确认预览" }).click();
    await expect(dialog.getByLabel("发布预览")).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "发布到目录" }).click();
    const publishConfirm = page.getByRole("dialog", { name: "确认发布到目录" });
    await publishConfirm.getByRole("checkbox").check();
    await publishConfirm.getByRole("button", { name: "确认发布" }).click();
    await expect(dialog.getByText(/入队|正在执行|已生效|曾经成功/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "发布到目录" }).click({ trial: true }).catch(() => undefined);
    await catalogScreenshot(page, testInfo, "cp08-authorized-publish");
    expect(fixture.powerSubjectId.length).toBeGreaterThan(0);
  });
});
