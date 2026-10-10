import { expect, test } from "playwright/test";
import { requirePrimaryActionColors } from "./primary-color";
import { requireViewSwitchStyles } from "./view-switch";
import {
  assertXiaozePlacement,
  collectConsistencyMeasurements,
  consistencyRoutes,
  installConsistencyReadGuard,
  requireConsistencyMeasurements,
  requireModuleTreeAlignment,
  requireRowActionVisibility,
  requireCompactControlHeights,
  shouldRequireXiaozeHint,
  type ConsistencyMeasurements
} from "./consistency";
import {
  closeXiaozePopupIfOpen,
  expectUsablePage,
  focusViaKeyboard,
  seedQualityRuntime,
  settleAppToasts,
  settleQualityRoute,
  settleXiaozePopupClosed,
  waitForFontsAndNextPaint
} from "./helpers";

test.beforeAll(() => seedQualityRuntime());

const moduleNavigationPaths = ["/parameters", "/node-debugging", "/dts-reload", "/parameter-admin/specs"];

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
        const routePath = route.path.split("?")[0];
        const [authResponse] = await Promise.all([
          page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/me" && response.request().method() === "GET"),
          page.goto(route.path)
        ]);
        expect(authResponse.ok(), "consistency measurements require the real API runtime").toBe(true);
        await expectUsablePage(page);
        await settleQualityRoute(page, routePath, { readOnly: true });
        await closeXiaozePopupIfOpen(page);
        await settleXiaozePopupClosed(page);
        await settleAppToasts(page);
        await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
        await page.mouse.move(0, 0);
        await waitForFontsAndNextPaint(page);
        const pageState = await page.evaluate(() => ({
          hasDialog: document.body.matches(':has([role="dialog"])'),
          viewportWidth: window.innerWidth
        }));
        const requiresHint = shouldRequireXiaozeHint(pageState);
        if (theme === "light" && requiresHint) {
          await expect(page.getByTestId("xiaoze-toggle-hint")).toBeVisible();
        }
        await expect(async () => {
          measurements = await page.evaluate(collectConsistencyMeasurements);
          requireConsistencyMeasurements(measurements, route.required, route.path);
          if (moduleNavigationPaths.includes(routePath)) {
            requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
          }
          requirePrimaryActionColors(measurements, route.path);
          if (route.required.includes("rowActions")) {
            requireRowActionVisibility(measurements.rowActions, route.path);
          }
          requireViewSwitchStyles(measurements, route.path);
          if (theme === "light") {
            if (requiresHint) {
              requireConsistencyMeasurements(measurements, ["xiaozeHints"], route.path);
            }
            assertXiaozePlacement(measurements, route.path);
          }
        }).toPass({ timeout: 20_000 });
        requireCompactControlHeights(measurements, route.path);
        if (route.required.includes("rowActions")) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
            `${route.path}: the page must not scroll horizontally`).toBeLessThanOrEqual(1);
          await testInfo.attach(`row-actions${route.path.replaceAll("/", "-")}-${theme}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
        }
        // Routes that deep-link into a modal (e.g. identity mapping's pending work) trap focus by design,
        // so the launcher behind the dialog is intentionally unreachable by keyboard.
        if (theme === "light" && !pageState.hasDialog) {
          const launcher = page.getByTestId("copilot-chat-toggle");
          const surface = launcher.locator(".xiaoze-chat-toggle__surface");
          await launcher.focus();
          await page.keyboard.press("Shift+Tab");
          await expect(launcher).not.toBeFocused();
          await waitForFontsAndNextPaint(page);
          const restingShadow = await surface.evaluate((element) => getComputedStyle(element).boxShadow);
          await focusViaKeyboard(page, launcher);
          await expect(launcher).toBeFocused();
          expect(await launcher.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
          await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(restingShadow);
          await page.keyboard.press("Shift+ArrowUp");
          assertXiaozePlacement(await page.evaluate(collectConsistencyMeasurements), route.path);
        }
        if (moduleNavigationPaths.includes(routePath)) {
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
            await settleQualityRoute(page, routePath, { readOnly: true });
            await closeXiaozePopupIfOpen(page);
            await settleXiaozePopupClosed(page);
            await settleAppToasts(page);
            await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
            await page.mouse.move(0, 0);
            await waitForFontsAndNextPaint(page);
            await expect(node).toHaveAttribute(selectedAttribute, "true");
            requireModuleTreeAlignment((await page.evaluate(collectConsistencyMeasurements)).moduleTreeLabels, route.path);
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
          body: JSON.stringify({ path: route.path, theme, viewport: page.viewportSize(), required: route.required, measurements, blockedRequests }, null, 2)
        });
      }
    });
  }
}
