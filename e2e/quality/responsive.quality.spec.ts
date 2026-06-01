import { expect, test } from "playwright/test";
import { expectNoHorizontalOverflow, expectUsablePage, seedQualityRuntime } from "./helpers";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 }
] as const;

const routes = [
  { path: "/parameters", heading: "项目参数用户工作台" },
  { path: "/parameter-review", heading: "参数管理员工作台" },
  { path: "/parameter-admin", heading: "项目参数管理后台" },
  { path: "/logs", heading: "日志智能分析" },
  { path: "/debugging", heading: "参数调试平台" },
  { path: "/node-debugging", heading: "节点调试平台" },
  { path: "/user-permissions", heading: "用户权限管理" }
] as const;

test.describe("M5.11 responsive quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  for (const viewport of viewports) {
    for (const route of routes) {
      test(`${route.path} remains usable at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route.path);
        await expectUsablePage(page);

        await expect(page.getByText(route.heading, { exact: true }).first()).toBeVisible();
        await expect(page.locator("main, .main-content").first().locator("button").first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  }

  test("mobile dialogs remain visible and contained", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/logs");
    await expectUsablePage(page);
    await page.getByRole("button", { name: /上传新日志/ }).click();

    const uploadDialog = page.getByRole("dialog", { name: "上传日志" });
    await expect(uploadDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/user-permissions");
    await expectUsablePage(page);
    await page.getByRole("button", { name: "Add user" }).click();

    const userDialog = page.getByRole("dialog", { name: "Add user" });
    await expect(userDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
