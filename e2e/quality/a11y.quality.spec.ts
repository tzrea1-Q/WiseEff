import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { openXiaozePopup, seedQualityRuntime } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const coreRoutes = [
  "/parameters",
  "/parameter-review",
  "/parameter-admin",
  "/logs",
  "/debugging",
  "/user-permissions"
] as const;

async function scan(page: Page, testInfo: TestInfo, label: string) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();

  await testInfo.attach(`${label}-axe-summary`, {
    body: JSON.stringify(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        help: violation.help
      })),
      null,
      2
    ),
    contentType: "application/json"
  });

  expect(results.violations).toEqual([]);
}

test.describe("M5.11 accessibility quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  for (const route of coreRoutes) {
    test(`has no WCAG A/AA violations on ${route}`, async ({ page }, testInfo) => {
      await page.goto(route);
      await expect(page.locator("main, .main-content").first()).toBeVisible();

      await scan(page, testInfo, route.replace(/[/?=]+/g, "-") || "home");
    });
  }

  test("scans key modal, drawer, and Xiaoze interaction states", async ({ page }, testInfo) => {
    await openXiaozePopup(page);
    await scan(page, testInfo, "xiaoze-popup-open");

    await page.goto("/parameters");
    const firstDetailButton = page.getByRole("button", { name: /^查看 / }).first();
    await expect(firstDetailButton).toBeVisible();
    await firstDetailButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, testInfo, "parameter-detail-dialog");

    await page.goto("/logs");
    await page.getByRole("toolbar", { name: /日志(?:分析工作台|智能分析)页面操作/ }).getByRole("button", { name: "上传新日志" }).click();
    await expect(page.getByRole("dialog", { name: "上传日志" })).toBeVisible();
    await scan(page, testInfo, "log-upload-dialog");

    await page.goto("/node-debugging");
    const editableRow = page.getByRole("row").filter({ hasText: "Fast charge current" }).first();
    await expect(editableRow).toBeVisible();
    await editableRow.locator("button.parameter-row-edit").click();
    await expect(page.locator(".workbench-sheet")).toBeVisible();
    await scan(page, testInfo, "debugging-node-sheet");

    await page.goto("/user-permissions");
    await page.getByRole("button", { name: "Add user" }).click();
    await expect(page.getByRole("dialog", { name: "Add user" })).toBeVisible();
    await scan(page, testInfo, "user-add-dialog");
  });
});
