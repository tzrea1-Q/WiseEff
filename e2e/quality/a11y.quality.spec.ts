import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { openXiaozePopup, prepareInteractionSurface, seedQualityRuntime } from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const coreRoutes = [
  "/parameters",
  "/parameter-review",
  "/parameter-admin",
  "/logs",
  "/debugging",
  "/user-permissions"
] as const;

async function scan(page: Page, testInfo: TestInfo, label: string, excludeSelectors: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(wcagTags);
  for (const selector of excludeSelectors) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();

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
    await scan(page, testInfo, "xiaoze-popup-open", [
      "[data-testid='xiaoze-popup-layer']",
      "[data-testid='copilot-add-menu-button']",
      "[data-testid='copilot-chat-panel']",
      "[data-copilotkit]"
    ]);

    await prepareInteractionSurface(page);

    // Tablet layout opens binding detail as a dialog drawer (desktop keeps it inline).
    await page.setViewportSize({ width: 900, height: 1024 });
    await page.goto("/parameters");
    await prepareInteractionSurface(page);
    const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    await workspace.getByRole("button", { name: /查看 gpio_int/ }).first().click();
    await expect(page.getByRole("dialog", { name: /gpio_int 参数详情/ })).toBeVisible();
    await scan(page, testInfo, "parameter-binding-detail-dialog");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/logs");
    await prepareInteractionSurface(page);
    await page.getByRole("toolbar", { name: /日志(?:分析工作台|智能分析)页面操作/ }).getByRole("button", { name: "上传新日志" }).click();
    await expect(page.getByRole("dialog", { name: "上传日志" })).toBeVisible();
    await scan(page, testInfo, "log-upload-dialog");

    await page.goto("/node-debugging");
    await prepareInteractionSurface(page);
    const editableRow = page.getByRole("row").filter({ hasText: "Fast charge current" }).first();
    await expect(editableRow).toBeVisible();
    await editableRow.locator("button.parameter-row-edit").click();
    await expect(page.locator(".workbench-sheet")).toBeVisible();
    await scan(page, testInfo, "debugging-node-sheet");

    await page.goto("/user-permissions");
    await prepareInteractionSurface(page);
    await page.getByRole("button", { name: "添加用户" }).click();
    await expect(page.getByRole("dialog", { name: "添加用户" })).toBeVisible();
    await scan(page, testInfo, "user-add-dialog");
  });
});
