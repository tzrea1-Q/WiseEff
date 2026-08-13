import { expect, test } from "playwright/test";
import {
  expectUsablePage,
  openXiaozePopup,
  seedQualityRuntime,
  settleAppToasts,
  settleQualityRoute,
  stableMasks
} from "./helpers";

const stableRoutes = [
  { path: "/", name: "home-shell" },
  { path: "/parameters", name: "parameters-workbench" },
  { path: "/parameter-review", name: "parameter-review-workbench" },
  { path: "/parameter-admin", name: "parameter-admin-workbench" },
  { path: "/logs", name: "logs-workbench" },
  { path: "/debugging", name: "debugging-simulator" },
  { path: "/user-permissions", name: "user-permissions" },
  // FA-25 expansion: dashboard, config workbench deep link, API-mode reload
  // workbench, feedback triage, and node debugging join the visual gate.
  { path: "/parameter-home", name: "parameter-home-workbench" },
  { path: "/parameter-admin/projects/aurora/configuration", name: "project-configuration-workbench" },
  { path: "/dts-reload", name: "dts-reload-workbench" },
  { path: "/feedback-admin", name: "feedback-admin-workbench" },
  { path: "/node-debugging", name: "node-debugging-workbench" }
] as const;

test.describe("M5.11 visual quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  for (const route of stableRoutes) {
    test(`keeps stable visual baseline for ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await expectUsablePage(page);
      await settleQualityRoute(page, route.path);
      await settleAppToasts(page);

      await expect(page.locator("main, .main-content").first()).toHaveScreenshot(`${route.name}.png`, {
        mask: stableMasks(page, route.path)
      });
    });
  }

  test("keeps stable visual baseline for the Xiaoze popup", async ({ page }) => {
    const popup = await openXiaozePopup(page);
    await settleAppToasts(page);

    await expect(popup).toHaveScreenshot("xiaoze-popup-open.png", {
      mask: stableMasks(page)
    });
  });
});
