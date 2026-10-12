import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";
import { requirePrimaryActionColors } from "./primary-color";
import { requireViewSwitchStyles } from "./view-switch";
import { assertXiaozePlacement, requireMeasuredCategories, requireModuleTreeAlignment, requireRowActionVisibility, requireCompactControlHeights, requireNavigatorWorkbenchGeometry, requireReviewInboxStructure, shouldRequireXiaozeHint, requireTypographyScale, requirePageGutter, requireWorkbenchPresentation, requireOverviewGeometry, requireRetiredNotice } from "./consistency-assertions";
import { collectConsistencyMeasurements, type ConsistencyMeasurements } from "./consistency-collector";
import { consistencyRoutes } from "./consistency-routes";
import { installConsistencyReadGuard } from "./consistency";
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

for (const path of ["/node-debugging", "/dts-reload"]) {
  for (const readiness of ["returning", "first-time", "connected"] as const) {
    test(`Bridge readiness on ${path}: ${readiness}`, async ({ context, page }, testInfo) => {
      testInfo.annotations.push({ type: "setup", description: "Read-only UI fixtures replace Bridge listing, local health and target detection; the workbench and identity use the real API. This does not prove hardware pairing or device writes." });
      const blockedRequests = await installConsistencyReadGuard(context);
      await context.route("**/api/v1/device-bridges/mine", async (request) => request.fulfill({ json: {
        items: readiness === "first-time" ? [] : [{
          id: "quality-readiness-bridge", machineLabel: "质量检查工作站", platform: "linux", arch: "amd64",
          clientVersion: "999.0.0", capabilities: {}, createdAt: "2026-10-11T00:00:00Z", lastSeenAt: null, revokedAt: null
        }]
      } }));
      await context.route("**/local-bridge/health", async (request) => {
        if (readiness !== "connected") return request.abort("connectionrefused");
        await request.fulfill({ json: {
          ok: true, paired: true, connected: true, bridgeId: "quality-readiness-bridge",
          clientVersion: "999.0.0", updatedAt: "2026-10-11T00:00:00Z",
          tools: { adb: { available: true }, hdc: { available: true } }
        } });
      });
      await context.route("**/api/v1/debugging/targets/detect", async (request) => request.fulfill({ json: { items: [] } }));
      const [identity] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/me"),
        page.goto(path)
      ]);
      expect(identity.ok()).toBe(true);
      await expectUsablePage(page);
      await settleQualityRoute(page, path, { readOnly: true });
      await settleAppToasts(page);
      await settleXiaozePopupClosed(page);
      const panel = page.getByRole("region", { name: "本地设备连接", exact: true });
      if (readiness === "connected") {
        await expect(panel.getByText("已连接 · 质量检查工作站", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toHaveCount(0);
      } else {
        await expect(panel.getByText("本地 Bridge 未运行", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(1);
        if (readiness === "returning") {
          await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toHaveCount(0);
          const bar = await panel.locator(".local-device-bridge-panel__readiness").boundingBox();
          expect(bar).not.toBeNull();
          expect(bar!.height).toBeLessThanOrEqual(40);
          const firstRow = page.locator(path === "/node-debugging"
            ? '.debug-table tbody tr:has(td[data-label="参数名称"])'
            : ".dts-reload-candidate-table tbody tr:has(.dts-reload-candidate-table__param)").first();
          await expect(firstRow).toBeVisible();
          const row = await firstRow.boundingBox();
          expect(row).not.toBeNull();
          expect(row!.y).toBeGreaterThanOrEqual(0);
          expect(row!.y + row!.height).toBeLessThanOrEqual(900);
        } else {
          await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toBeVisible();
        }
      }
      await testInfo.attach(`bridge-${readiness}${path.replaceAll("/", "-")}`, {
        contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
      });
      if (readiness !== "connected") {
        const trigger = panel.getByRole("button", { name: "安装指南", exact: true });
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: "安装与连接本地 Bridge" });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole("list", { name: "Bridge 连接步骤" })).toBeVisible();
        await expect(page.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(1);
        await page.keyboard.press("Shift+Tab");
        await expect(drawer.getByRole("button", { name: "连接本机", exact: true })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(drawer.getByRole("button", { name: "关闭安装指南" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toHaveCount(0);
      }
      expect(blockedRequests).toEqual([]);
    });
  }
}

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
      let required = route.required;
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
        const pendingWork = page.getByRole("dialog", { name: "待处理工作", exact: true });
        if (route.path.includes("?review=open") || await pendingWork.isVisible()) {
          await expect(pendingWork).toBeVisible();
          await expect(pendingWork.locator(".section-skeleton")).toHaveCount(0);
          await expect(pendingWork.getByRole("alert")).toHaveCount(0);
          expect(shouldRequireXiaozeHint(await page.evaluate(() => ({
            hasDialog: document.body.matches(':has([role="dialog"])'), viewportWidth: window.innerWidth
          })))).toBe(false);
          await expect(page.getByTestId("xiaoze-toggle-hint")).toBeHidden();
          const modalMeasurements = await page.evaluate(collectConsistencyMeasurements);
          assertXiaozePlacement(modalMeasurements, route.path);
          await testInfo.attach(`pending-work-${theme}`, {
            contentType: "application/json", body: JSON.stringify(modalMeasurements, null, 2)
          });
          await testInfo.attach(`pending-work-${theme}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
          await pendingWork.getByRole("button", { name: "关闭", exact: true }).click();
          await expect(pendingWork).toBeHidden();
          await waitForFontsAndNextPaint(page);
        }
        const pageState = await page.evaluate(() => ({
          hasDialog: document.body.matches(':has([role="dialog"])'),
          viewportWidth: window.innerWidth
        }));
        const requiresHint = shouldRequireXiaozeHint(pageState);
        const historicalIdentity = page.getByRole("region", { name: "节点对应确认", exact: true });
        const hasHistoricalIdentity = await historicalIdentity.isVisible();
        if (hasHistoricalIdentity) {
          await expect(historicalIdentity.getByRole("link", { name: "打开规范审核队列" }))
            .toHaveAttribute("href", "/parameter-admin/specs?review=open");
          await expect(historicalIdentity.locator("button, input, select, textarea")).toHaveCount(0);
        }
        required = hasHistoricalIdentity
          ? route.required.filter((category) => category !== "rowActions" && category !== "paginationControls")
          : route.required;
        if (theme === "light" && requiresHint) {
          await expect(page.getByTestId("xiaoze-toggle-hint")).toBeVisible();
        }
        await expect(async () => {
          measurements = await page.evaluate(collectConsistencyMeasurements);
          if (routePath === "/parameters" && !hasHistoricalIdentity) {
            requireWorkbenchPresentation(measurements.workbenchTables, route.path);
          }
          requireMeasuredCategories(measurements, required, route.path);
          requireTypographyScale(measurements, route.path);
          requirePageGutter(measurements.pageEdges, route.path, measurements.footerPresent);
          if (route.required.includes("overviewPages")) requireOverviewGeometry(measurements.overviewPages, route.path);
          if (route.required.includes("retiredNotices")) requireRetiredNotice(measurements.retiredNotices, route.path);
          if (["/parameter-review", "/parameter-submissions"].includes(routePath)) {
            requireReviewInboxStructure(measurements, route.path);
          }
          if (route.required.includes("navigatorWorkbenches") || moduleNavigationPaths.includes(routePath)) {
            requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
          }
          requirePrimaryActionColors(measurements, route.path);
          if (route.required.includes("rowActions")) {
            requireRowActionVisibility(measurements.rowActions, route.path);
          }
          requireViewSwitchStyles(measurements, route.path);
          if (route.required.includes("navigatorWorkbenches")) {
            requireNavigatorWorkbenchGeometry(measurements.navigatorWorkbenches, route.path);
          }
          if (theme === "light") {
            if (requiresHint) {
              requireMeasuredCategories(measurements, ["xiaozeHints"], route.path);
            }
            assertXiaozePlacement(measurements, route.path);
          }
        }).toPass({ timeout: 20_000 });
        requireCompactControlHeights(measurements, route.path, required);
        if (routePath === "/parameters" && theme === "dark") {
          const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
          await testInfo.attach("parameters-dark-color-contrast", {
            contentType: "application/json", body: Buffer.from(JSON.stringify(contrast.violations, null, 2))
          });
          expect(contrast.violations, "dark parameter workbench must meet WCAG AA text contrast").toEqual([]);
        }
        if (route.required.includes("navigatorWorkbenches")) {
          await testInfo.attach(`navigator-workbench-expanded-${theme}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
          await page.getByRole("button", { name: "收起模块导航", exact: true }).click();
          await waitForFontsAndNextPaint(page);
          const collapsed = await page.evaluate(collectConsistencyMeasurements);
          requireNavigatorWorkbenchGeometry(collapsed.navigatorWorkbenches, route.path);
          requireRowActionVisibility(collapsed.rowActions, route.path);
          await testInfo.attach(`navigator-workbench-collapsed-${theme}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
          await page.getByRole("button", { name: "展开模块导航", exact: true }).click();
          await waitForFontsAndNextPaint(page);
        }
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
            const catalog = routePath === "/parameter-admin/specs";
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
            if (await pendingWork.isVisible()) {
              await pendingWork.getByRole("button", { name: "关闭", exact: true }).click();
              await expect(pendingWork).toBeHidden();
            }
            await page.mouse.move(0, 0);
            await waitForFontsAndNextPaint(page);
            await expect(node).toHaveAttribute(selectedAttribute, "true");
            requireModuleTreeAlignment((await page.evaluate(collectConsistencyMeasurements)).moduleTreeLabels, route.path);
            expect(new URL(page.url()).searchParams.get(queryKey)).toBe(selectedId);
            if (routePath === "/parameters") {
              const url = page.url();
              await page.getByRole("button", { name: "收起模块导航", exact: true }).click();
              await expect(node).toBeHidden();
              expect(page.url()).toBe(url);
              await waitForFontsAndNextPaint(page);
              await page.reload();
              await expectUsablePage(page);
              await settleQualityRoute(page, routePath, { readOnly: true });
              await closeXiaozePopupIfOpen(page);
              await settleXiaozePopupClosed(page);
              await settleAppToasts(page);
              await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
              await expect(page.getByRole("button", { name: "展开模块导航", exact: true })).toBeVisible();
              expect(new URL(page.url()).searchParams.get(queryKey)).toBe(selectedId);
              await page.getByRole("button", { name: "展开模块导航", exact: true }).click();
              await expect(node).toHaveAttribute(selectedAttribute, "true");
              await waitForFontsAndNextPaint(page);
            }
            await node.click();
            await expect(node).toHaveAttribute(selectedAttribute, "false");
            await expect.poll(() => new URL(page.url()).searchParams.get(queryKey)).toBeNull();
            if (routePath === "/node-debugging") {
              const table = page.getByRole("region", { name: "节点调试参数", exact: true }).getByRole("table");
              await expect(table.getByText("Fast charge current", { exact: true })).toHaveCount(1);
            }
            await waitForFontsAndNextPaint(page);
            measurements = await page.evaluate(collectConsistencyMeasurements);
            requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
          });
        }
        if (route.required.includes("overviewPages") || route.required.includes("retiredNotices")) {
          await testInfo.attach(`overview${route.path.replaceAll("/", "-")}-${theme}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
        }
        if (route.required.includes("retiredNotices")) {
          const replacement = routePath === "/debugging" ? "/node-debugging" : "/parameters";
          await page.locator(".retired-notice").getByRole("link").click();
          await expect(page).toHaveURL((url) => url.pathname === replacement);
          await expectUsablePage(page);
        }
      } finally {
        await testInfo.attach(`consistency${route.path.replaceAll("/", "-")}`, {
          contentType: "application/json",
          body: JSON.stringify({ path: route.path, theme, viewport: page.viewportSize(), required, measurements, blockedRequests }, null, 2)
        });
      }
    });
  }
}
