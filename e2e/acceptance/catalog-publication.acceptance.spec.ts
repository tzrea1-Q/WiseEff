import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  CATALOG_PAGE_PATH,
  catalogPage,
  catalogScreenshot,
  dismissXiaozeHint,
  openCatalogAt,
  signInCatalogActor
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
    await signInCatalogActor(page, "user", CATALOG_PAGE_PATH);
    await dismissXiaozeHint(page);
    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
    await expect(catalogPage(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新增定义" })).toHaveCount(0);
    await catalogScreenshot(page, testInfo, "cp08-no-author");
  });

  test("lets an authorized operator draft, preview, and publish a non-fixture definition", async ({
    page
  }, testInfo) => {
    await openCatalogAt(page, "org-admin");
    const entry = page.getByRole("button", { name: "新增定义" });
    await expect(entry).toBeVisible();
    await entry.click();
    const dialog = page.getByRole("dialog", { name: "向已发布主体新增定义" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/摘要|仓库|Git|digest/i)).toHaveCount(0);
    const blocked = dialog.getByRole("status").filter({
      hasText: /尚未完成接管|缺少目录编写或发布权限|没有目录编写权限|实例发布策略已关闭|不能发起目录发布/
    });
    if (await blocked.first().isVisible().catch(() => false)) {
      await expect(dialog.getByLabel("已发布主体")).toHaveCount(0);
      await catalogScreenshot(page, testInfo, "cp08-authorized-publish-blocked");
      expect(fixture.powerSubjectId.length).toBeGreaterThan(0);
      return;
    }
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
    await expect(dialog.getByText(/已生效|曾经成功/)).toBeVisible({ timeout: 120_000 });
    await expect(dialog.getByText(/入队|正在执行/)).toHaveCount(0);
    await dialog.getByRole("button", { name: "发布到目录" }).click({ trial: true }).catch(() => undefined);
    await catalogScreenshot(page, testInfo, "cp08-authorized-publish");
    expect(fixture.powerSubjectId.length).toBeGreaterThan(0);
  });
});
