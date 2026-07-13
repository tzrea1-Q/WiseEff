import { expect, test } from "playwright/test";
import { expectUsablePage, openXiaozePopup, seedQualityRuntime, stableMasks } from "./helpers";

const stableRoutes = [
  { path: "/", name: "home-shell" },
  { path: "/parameters", name: "parameters-workbench" },
  { path: "/parameter-review", name: "parameter-review-workbench" },
  { path: "/parameter-admin", name: "parameter-admin-workbench" },
  { path: "/logs", name: "logs-workbench" },
  { path: "/debugging", name: "debugging-simulator" },
  { path: "/user-permissions", name: "user-permissions" }
] as const;

test.describe("M5.11 visual quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  for (const route of stableRoutes) {
    test(`keeps stable visual baseline for ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await expectUsablePage(page);

      await expect(page.locator("main, .main-content").first()).toHaveScreenshot(`${route.name}.png`, {
        mask: stableMasks(page, route.path)
      });
    });
  }

  test("keeps stable visual baseline for the Xiaoze popup", async ({ page }) => {
    const popup = await openXiaozePopup(page);

    await expect(popup).toHaveScreenshot("xiaoze-popup-open.png", {
      mask: stableMasks(page)
    });
  });
});
