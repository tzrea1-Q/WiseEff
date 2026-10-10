import { expect, test } from "playwright/test";
import { requirePrimaryActionColors } from "./primary-color";
import { requireViewSwitchStyles } from "./view-switch";
import {
  collectConsistencyMeasurements,
  consistencyRoutes,
  installConsistencyReadGuard,
  requireConsistencyMeasurements,
  requireRowActionVisibility,
  requireCompactControlHeights,
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

const parameterRoute = consistencyRoutes.find((route) => route.path === "/parameters")!;
const routes = [
  ...consistencyRoutes,
  ...["atlas", "aurora", "nebula"].map((project) => ({ ...parameterRoute, path: `/parameters?project=${project}` }))
];

for (const route of routes) {
  for (const theme of ["light", "dark"] as const) {
    test(`asserts read-only UI consistency for ${route.path} (${theme})`, async ({ context, page }, testInfo) => {
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
        await settleQualityRoute(page, route.path.split("?")[0], { readOnly: true });
        await closeXiaozePopupIfOpen(page);
        await settleXiaozePopupClosed(page);
        await settleAppToasts(page);
        await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
        await page.mouse.move(0, 0);
        await waitForFontsAndNextPaint(page);
        await expect(async () => {
          measurements = await page.evaluate(collectConsistencyMeasurements);
          requireConsistencyMeasurements(measurements, route.required, route.path);
          requirePrimaryActionColors(measurements, route.path);
          if (route.required.includes("rowActions")) {
            requireRowActionVisibility(measurements.rowActions, route.path);
          }
          requireViewSwitchStyles(measurements, route.path);
        }).toPass({ timeout: 20_000 });
        requireCompactControlHeights(measurements, route.path);
        if (route.required.includes("rowActions")) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
            `${route.path}: the page must not scroll horizontally`).toBeLessThanOrEqual(1);
          await testInfo.attach(`row-actions${route.path.replaceAll("/", "-")}-${theme}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
        }
      } finally {
        await testInfo.attach(`consistency${route.path.replaceAll("/", "-")}`, {
          contentType: "application/json",
          body: JSON.stringify({ path: route.path, theme, viewport: page.viewportSize(), required: route.required, measurements, blockedRequests }, null, 2)
        });
      }
    });
  }
}
