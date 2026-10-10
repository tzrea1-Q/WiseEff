import { expect, test } from "playwright/test";
import {
  collectConsistencyMeasurements,
  consistencyRoutes,
  installConsistencyReadGuard,
  requireConsistencyMeasurements,
  requireModuleTreeAlignment,
  type ConsistencyMeasurements
} from "./consistency";
import {
  closeXiaozePopupIfOpen,
  expectUsablePage,
  seedQualityRuntime,
  settleAppToasts,
  settleQualityRoute,
  settleXiaozePopupClosed,
  waitForFontsAndNextPaint
} from "./helpers";

test.beforeAll(() => seedQualityRuntime());

const moduleNavigationPaths = ["/parameters", "/node-debugging", "/dts-reload", "/parameter-admin/specs"];

for (const route of consistencyRoutes) {
  test(`collects read-only consistency measurements for ${route.path}`, async ({ context, page }, testInfo) => {
    testInfo.annotations.push({ type: "setup", description: "Bridge pairing-code POSTs use a synthetic response; no server pairing code is issued." });
    const blockedRequests = await installConsistencyReadGuard(context);
    let measurements: ConsistencyMeasurements | null = null;
    try {
      const [authResponse] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/me" && response.request().method() === "GET"),
        page.goto(route.path)
      ]);
      expect(authResponse.ok(), "consistency measurements require the real API runtime").toBe(true);
      await expectUsablePage(page);
      await settleQualityRoute(page, route.path, { readOnly: true });
      await closeXiaozePopupIfOpen(page);
      await settleXiaozePopupClosed(page);
      await settleAppToasts(page);
      await waitForFontsAndNextPaint(page);
      await expect(async () => {
        measurements = await page.evaluate(collectConsistencyMeasurements);
        requireConsistencyMeasurements(measurements, route.required, route.path);
        if (moduleNavigationPaths.includes(route.path)) {
          requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
        }
      }).toPass({ timeout: 20_000 });
      if (moduleNavigationPaths.includes(route.path)) {
        await test.step("module selection survives reload and clears on reselect without label drift", async () => {
          const catalog = route.path === "/parameter-admin/specs";
          const node = page.locator(catalog
            ? '.parameter-catalog__tree-select[data-catalog-node-kind="module"]'
            : '.dts-topology-navigator__item[role="treeitem"]').first();
          const selectedAttribute = catalog ? "aria-pressed" : "aria-selected";
          const queryKey = catalog ? "moduleNodeId" : "moduleNode";
          await expect(node).toHaveAttribute(selectedAttribute, "false");
          await node.click();
          await expect(node).toHaveAttribute(selectedAttribute, "true");
          const selectedId = new URL(page.url()).searchParams.get(queryKey);
          expect(selectedId).toBeTruthy();
          await waitForFontsAndNextPaint(page);
          requireModuleTreeAlignment((await page.evaluate(collectConsistencyMeasurements)).moduleTreeLabels, route.path);
          await page.reload();
          await expectUsablePage(page);
          await settleQualityRoute(page, route.path, { readOnly: true });
          await expect(node).toHaveAttribute(selectedAttribute, "true");
          expect(new URL(page.url()).searchParams.get(queryKey)).toBe(selectedId);
          await node.click();
          await expect(node).toHaveAttribute(selectedAttribute, "false");
          await expect.poll(() => new URL(page.url()).searchParams.get(queryKey)).toBeNull();
          await waitForFontsAndNextPaint(page);
          measurements = await page.evaluate(collectConsistencyMeasurements);
          requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
        });
      }
    } finally {
      await testInfo.attach(`consistency${route.path.replaceAll("/", "-")}`, {
        contentType: "application/json",
        body: JSON.stringify({ path: route.path, viewport: page.viewportSize(), required: route.required, measurements, blockedRequests }, null, 2)
      });
    }
  });
}
