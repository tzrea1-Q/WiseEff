import { expect, test } from "playwright/test";
import {
  collectConsistencyMeasurements,
  consistencyRoutes,
  installConsistencyReadGuard,
  requireConsistencyMeasurements,
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
      }).toPass({ timeout: 20_000 });
    } finally {
      await testInfo.attach(`consistency${route.path.replaceAll("/", "-")}`, {
        contentType: "application/json",
        body: JSON.stringify({ path: route.path, viewport: page.viewportSize(), required: route.required, measurements, blockedRequests }, null, 2)
      });
    }
  });
}
