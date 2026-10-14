import { expect, test } from "playwright/test";
import { compactQualityRoutes } from "./compact-routes";
import {
  expectBoundedInteractiveControls,
  expectBoundedMainScroll,
  expectNoHorizontalOverflow,
  expectUsablePage,
  expectVisibleFormControlAffordances,
  prepareInteractionSurface,
  seedQualityRuntime,
  settleQualityRoute
} from "./helpers";
import { collectConsistencyMeasurements } from "./consistency-collector";
import {
  requireAdminListGeometry,
  requireNavigatorWorkbenchGeometry,
  requireOverviewGeometry,
  requireRetiredNotice,
  requireReviewInboxStructure,
  requireSettingsFormPresentation
} from "./consistency-assertions";

test.beforeAll(() => seedQualityRuntime());

for (const route of compactQualityRoutes) {
  for (const theme of ["light", "dark"] as const) {
    test(`${route.template}: ${route.path} stays within layout budget at compact (${theme})`, async ({ page }) => {
      await test.step("quality:navigation", () => page.goto(route.path));
      await test.step("quality:readiness", () => expectUsablePage(page));
      await test.step("quality:readiness", () => prepareInteractionSurface(page));
      await test.step("quality:readiness", () => settleQualityRoute(page, route.path));
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      const headingScope = "headingScope" in route ? page.locator(route.headingScope) : page;
      await expect(headingScope.getByText(route.heading, { exact: true }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectBoundedMainScroll(page);
      await expectBoundedInteractiveControls(page);
      await expectVisibleFormControlAffordances(page);

      const measurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
      switch (route.template) {
        case "NavigatorWorkbench": requireNavigatorWorkbenchGeometry(measurements.navigatorWorkbenches, route.path); break;
        case "AdminListPage": requireAdminListGeometry(measurements.adminLists, route.path); break;
        case "OverviewPage": requireOverviewGeometry(measurements.overviewPages, route.path); break;
        case "SettingsFormPage": requireSettingsFormPresentation(measurements.settingsForms, route.path); break;
        case "ReviewInbox": requireReviewInboxStructure(measurements, route.path); break;
        case "RetiredNotice": requireRetiredNotice(measurements.retiredNotices, route.path); break;
      }
    });
  }
}
