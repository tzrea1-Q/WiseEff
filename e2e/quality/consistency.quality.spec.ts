import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { requirePrimaryActionColors } from "./primary-color";
import { requireViewSwitchStyles } from "./view-switch";
import { assertXiaozePlacement, requireMeasuredCategories, requireModuleTreeAlignment, requireRowActionVisibility, requireCompactControlHeights, requireNavigatorWorkbenchGeometry, requireReviewInboxStructure, shouldRequireXiaozeHint, requireTypographyScale, requirePageGutter, requireWorkbenchPresentation, requireAdminListGeometry, requireOverviewGeometry, requireRetiredNotice, requireSettingsFormPresentation } from "./consistency-assertions";
import { collectConsistencyMeasurements, type ConsistencyMeasurements } from "./consistency-collector";
import { collectionPaths, selectConsistencyRoutes } from "./consistency-routes";
import { compactQualityRoutes } from "./compact-routes";
import { parseQualityLane } from "./quality-partition";
import { installConsistencyReadGuard } from "./consistency";
import {
  closeXiaozePopupIfOpen,
  expectBoundedMainScroll,
  expectNoHorizontalOverflow,
  expectUsablePage,
  focusViaKeyboard,
  seedQualityRuntime,
  settleAppToasts,
  settleQualityRoute,
  settleXiaozePopupClosed,
  waitForFontsAndNextPaint
} from "./helpers";

test.beforeAll(() => seedQualityRuntime());

const qualityLane = parseQualityLane(process.env.WISEEFF_QUALITY_LANE);

async function assertAccessibilitySemantics(page: Page, testInfo: TestInfo, label: string) {
  const result = await test.step("quality:axe", () => new AxeBuilder({ page })
    .withRules(["label", "aria-roles", "aria-allowed-attr", "aria-required-attr", "button-name", "link-name"])
    .analyze());
  await testInfo.attach(`accessibility-semantics-${label}`, {
    contentType: "application/json", body: JSON.stringify(result.violations, null, 2)
  });
  expect(result.violations, `${label}: labels, roles and control names must remain accessible`).toEqual([]);
}

for (const theme of qualityLane === undefined || qualityLane === "consistency-2" ? ["light", "dark"] as const : []) {
  test(`asserts public home accessibility semantics (${theme})`, async ({ context, page }, testInfo) => {
    const blockedRequests = await installConsistencyReadGuard(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    await test.step("quality:navigation", () => page.goto("/"));
    await test.step("quality:readiness", () => expectUsablePage(page));
    await expect(page.getByRole("main", { name: "雷泽首页" })).toBeVisible();
    await test.step("quality:readiness", () => settleXiaozePopupClosed(page));
    await test.step("quality:readiness", () => settleAppToasts(page));
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
    await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
    await assertAccessibilitySemantics(page, testInfo, `home-${theme}`);
    await testInfo.attach(`accessibility-home-${theme}`, { contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" })) });
    expect(blockedRequests).toEqual([]);
  });
}

for (const path of qualityLane === undefined || qualityLane === "consistency-1" ? ["/node-debugging", "/dts-reload"] : []) {
  for (const theme of ["light", "dark"] as const) {
  for (const readiness of ["returning", "first-time", "connected"] as const) {
    test(`Bridge readiness on ${path}: ${readiness} (${theme})`, async ({ context, page }, testInfo) => {
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
        test.step("quality:navigation", () => page.goto(path))
      ]);
      expect(identity.ok()).toBe(true);
      await test.step("quality:readiness", () => expectUsablePage(page));
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      await test.step("quality:readiness", () => settleQualityRoute(page, path, { readOnly: true }));
      await test.step("quality:readiness", () => settleAppToasts(page));
      await test.step("quality:readiness", () => settleXiaozePopupClosed(page));
      const panel = page.getByRole("region", { name: "本地设备连接", exact: true });
      await expect(page.locator(".navigator-workbench__context").getByRole("region", { name: "本地设备连接", exact: true })).toBeVisible();
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
        } else {
          await expect(panel.getByRole("button", { name: "连接本机", exact: true })).toBeVisible();
          await expect(panel.getByRole("button", { name: "安装指南", exact: true })).toBeVisible();
          await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toHaveCount(0);
          const bar = await panel.locator(".local-device-bridge-panel__readiness").boundingBox();
          expect(bar).not.toBeNull();
          expect(bar!.height).toBeLessThanOrEqual(40);
          const firstRow = page.locator(path === "/node-debugging"
            ? '.navigator-workbench__task tbody tr:has(td[data-label="参数名称"])'
            : ".navigator-workbench__task tbody tr:has(.dts-reload-candidate-table__param)").first();
          await expect(firstRow).toBeVisible();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
          const measurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
          requireNavigatorWorkbenchGeometry(measurements.navigatorWorkbenches, path);
        }
      }
      if (readiness === "returning" || readiness === "connected") {
        const firstRow = page.locator(path === "/node-debugging"
          ? '.navigator-workbench__task tbody tr:has(td[data-label="参数名称"])'
          : ".navigator-workbench__task tbody tr:has(.dts-reload-candidate-table__param)").first();
        await expect(firstRow).toBeVisible();
        await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
        const measurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
        requireNavigatorWorkbenchGeometry(measurements.navigatorWorkbenches, path);
      }
      await testInfo.attach(`bridge-${readiness}-${theme}${path.replaceAll("/", "-")}`, {
        contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
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
}

const moduleNavigationPaths = ["/parameters", "/node-debugging", "/dts-reload", "/parameter-admin/specs"];

for (const route of selectConsistencyRoutes(qualityLane)) {
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
          test.step("quality:navigation", () => page.goto(route.path))
        ]);
        expect(authResponse.ok(), "consistency measurements require the real API runtime").toBe(true);
        await test.step("quality:readiness", () => expectUsablePage(page));
        await test.step("quality:readiness", () => settleQualityRoute(page, routePath, { readOnly: true }));
        await test.step("quality:readiness", () => closeXiaozePopupIfOpen(page));
        await test.step("quality:readiness", () => settleXiaozePopupClosed(page));
        await test.step("quality:readiness", () => settleAppToasts(page));
        await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
        await page.mouse.move(0, 0);
        await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
        if (route.required.includes("settingsForms")) {
          const form = page.locator(".settings-form-page");
          await expect(form).toHaveAttribute("data-settings-dirty", "false");
          requireSettingsFormPresentation((await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements))).settingsForms, route.path);
          await testInfo.attach(`settings-clean-${theme}`, { contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" })) });
          if (routePath.endsWith("/review-roles")) {
            const checkbox = form.locator('input[type="checkbox"]:enabled').first();
            await expect(checkbox).toBeVisible();
            await checkbox.click();
          } else {
            const input = form.getByRole("textbox").first();
            await input.fill(`${await input.inputValue()}质量检查`);
          }
          await expect(form).toHaveAttribute("data-settings-dirty", "true");
          await form.getByRole("group", { name: "未保存的更改" }).scrollIntoViewIfNeeded();
          const dirtyMeasurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
          requireSettingsFormPresentation(dirtyMeasurements.settingsForms, route.path);
          requirePrimaryActionColors(dirtyMeasurements, route.path);
          assertXiaozePlacement(dirtyMeasurements, route.path);
          await testInfo.attach(`settings-dirty-${theme}`, { contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" })) });
          await form.getByRole("button", { name: "放弃", exact: true }).click();
          await expect(form).toHaveAttribute("data-settings-dirty", "false");
          await expect(form.getByRole("group", { name: "未保存的更改" })).toHaveCount(0);
          await form.getByRole("heading").first().scrollIntoViewIfNeeded();
        }
        const pendingWork = page.getByRole("dialog", { name: "待处理工作", exact: true });
        if (route.path.includes("?review=open") || await pendingWork.isVisible()) {
          await expect(pendingWork).toBeVisible();
          await expect(pendingWork.locator(".section-skeleton")).toHaveCount(0);
          await expect(pendingWork.getByRole("alert")).toHaveCount(0);
          expect(shouldRequireXiaozeHint(await page.evaluate(() => ({
            hasDialog: document.body.matches(':has([role="dialog"])'), viewportWidth: window.innerWidth
          })))).toBe(false);
          await expect(page.getByTestId("xiaoze-toggle-hint")).toBeHidden();
          const modalMeasurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
          assertXiaozePlacement(modalMeasurements, route.path);
          await assertAccessibilitySemantics(page, testInfo, `${route.path}-pending-work-${theme}`);
          await testInfo.attach(`pending-work-${theme}`, {
            contentType: "application/json", body: JSON.stringify(modalMeasurements, null, 2)
          });
          await testInfo.attach(`pending-work-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          await pendingWork.getByRole("button", { name: "关闭", exact: true }).click();
          await expect(pendingWork).toBeHidden();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
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
          if (compactQualityRoutes.some((compactRoute) => compactRoute.path === routePath)) {
            await expectNoHorizontalOverflow(page);
            await expectBoundedMainScroll(page);
          }
          measurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
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
          if (route.required.includes("moduleTreeLabels") || moduleNavigationPaths.includes(routePath)) {
            requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
          }
          requirePrimaryActionColors(measurements, route.path);
          if (route.required.includes("adminLists")) {
            const needsOverflow = !collectionPaths.includes(routePath)
              || (routePath === "/knowledge-admin" && new URL(page.url()).searchParams.get("tab") !== "index");
            requireAdminListGeometry(measurements.adminLists, route.path, needsOverflow);
            if (collectionPaths.includes(routePath)) {
              expect(measurements.adminLists).toHaveLength(1);
              expect(measurements.visibleTableCount).toBe(1);
              await expect(page.getByRole("tabpanel")).toHaveCount(1);
              await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
            }
          }
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
        await assertAccessibilitySemantics(page, testInfo, `${route.path}-${theme}`);
        if (["/parameters", "/parameter-admin/projects"].includes(routePath) && theme === "dark") {
          const contrast = await test.step("quality:axe", () => new AxeBuilder({ page }).withRules(["color-contrast"]).analyze());
          await testInfo.attach(`${routePath.replaceAll("/", "-")}-dark-color-contrast`, {
            contentType: "application/json", body: Buffer.from(JSON.stringify(contrast.violations, null, 2))
          });
          expect(contrast.violations, `${routePath}: dark text must meet WCAG AA contrast`).toEqual([]);
        }
        if (route.required.includes("navigatorWorkbenches")) {
          await testInfo.attach(`navigator-workbench-expanded-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          if (routePath === "/logs") {
            await page.getByRole("complementary", { name: "历史日志记录" })
              .getByRole("button", { name: /charging-foldback\.log/ }).click();
            await expect(page.getByRole("region", { name: "分析结果" })).toBeVisible();
            await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
            const completed = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
            requireMeasuredCategories(completed, required, route.path);
            requireNavigatorWorkbenchGeometry(completed.navigatorWorkbenches, route.path);
            requireTypographyScale(completed, route.path);
            requirePrimaryActionColors(completed, route.path);
            requireViewSwitchStyles(completed, route.path);
            await testInfo.attach(`logs-complete-${theme}`, {
              contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
            });
          }
          const navigatorLabel = routePath.startsWith("/parameter-admin/projects/aurora") ? "文件与配置集" : "模块导航";
          await page.getByRole("button", { name: `收起${navigatorLabel}`, exact: true }).click();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
          const collapsed = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
          requireNavigatorWorkbenchGeometry(collapsed.navigatorWorkbenches, route.path);
          if (route.required.includes("rowActions")) requireRowActionVisibility(collapsed.rowActions, route.path);
          await testInfo.attach(`navigator-workbench-collapsed-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          await page.getByRole("button", { name: `展开${navigatorLabel}`, exact: true }).click();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
        }
        if (route.required.includes("rowActions")) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
            `${route.path}: the page must not scroll horizontally`).toBeLessThanOrEqual(1);
          await testInfo.attach(`row-actions${route.path.replaceAll("/", "-")}-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
        }
        if (collectionPaths.includes(routePath)) {
          await testInfo.attach(`collection-${route.path.replaceAll("/", "-")}-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          const selectedUrl = page.url();
          const selectedTab = page.getByRole("tab", { selected: true });
          const selectedName = await selectedTab.textContent();
          const otherTab = page.getByRole("tab", { selected: false }).first();
          const otherName = await otherTab.textContent();
          await otherTab.click();
          await expect(page.getByRole("tab", { name: otherName!, exact: true })).toHaveAttribute("aria-selected", "true");
          await page.goBack();
          await expect(page).toHaveURL(selectedUrl);
          await expect(page.getByRole("tab", { name: selectedName!, exact: true })).toHaveAttribute("aria-selected", "true");
          await page.goForward();
          await expect(page.getByRole("tab", { name: otherName!, exact: true })).toHaveAttribute("aria-selected", "true");
          await page.goBack();
          await test.step("quality:readiness", () => settleQualityRoute(page, routePath, { readOnly: true }));
          const overflow = page.getByRole("tabpanel").getByRole("button", { name: /：更多$/ }).first();
          if (await overflow.count()) {
            await overflow.click();
            const destructive = page.getByRole("menuitem").filter({ hasText: /^(拒绝归档|彻底删除|归档)$/ }).first();
            if (await destructive.count()) {
              await destructive.click();
              await expect(page.getByRole("dialog")).toBeVisible();
              await page.keyboard.press("Escape");
              await expect(page.getByRole("dialog")).toHaveCount(0);
            } else {
              await page.keyboard.press("Escape");
            }
            await expect(overflow).toBeFocused();
          }
        }
        if (routePath === "/parameter-admin/projects" && route.required.includes("adminLists")) {
          const listUrl = page.url();
          const trigger = page.getByRole("table", { name: "项目管理列表" }).getByRole("button", { name: /：更多$/ }).first();
          await trigger.click();
          const deleteItem = page.getByRole("menuitem", { name: /^删除 / });
          if (await deleteItem.isDisabled()) {
            await expect(deleteItem).toHaveAccessibleDescription("项目需保留规范历史，不能删除；归档或处置功能尚未开放。");
            await page.keyboard.press("Escape");
          } else {
            await deleteItem.click();
            const confirmation = page.getByRole("dialog", { name: /^删除项目 / });
            await expect(confirmation).toBeVisible();
            await expect(confirmation).toContainText("此操作不可撤销");
            await expect(confirmation).toContainText("共享参数库中的参数定义会保留。");
            await page.keyboard.press("Escape");
            await expect(confirmation).toHaveCount(0);
          }
          await expect(trigger).toBeFocused();
          await expect(page).toHaveURL(listUrl);
        }
        if (route.required.includes("adminLists") && routePath !== "/parameter-admin/projects") {
          const listUrl = page.url();
          const triggers = page.locator(".admin-list-page").getByRole("button", { name: /：更多$/ });
          for (let index = 0; index < await triggers.count(); index++) {
            const trigger = triggers.nth(index);
            await trigger.click();
            const destructive = page.getByRole("menuitem", { name: /^(注销|删除) / });
            const destructiveCount = await destructive.count();
            expect(destructiveCount, `${routePath}: destructive actions must remain in overflow`)
              .toBe(["/organization/members", "/user-permissions", "/debugging-admin/nodes"].includes(routePath) ? 1 : 0);
            if (destructiveCount && !await destructive.first().isDisabled()) {
              await expect(destructive.first()).toHaveAttribute("data-destructive", "true");
              await destructive.first().click();
              const confirmation = page.getByRole("dialog");
              await expect(confirmation).toBeVisible();
              await expect(confirmation).toContainText(/永久删除|不可恢复|不可撤销/);
              await page.keyboard.press("Escape");
              await expect(confirmation).toHaveCount(0);
              await expect(trigger).toBeFocused();
              break;
            }
            await page.keyboard.press("Escape");
            await expect(trigger).toBeFocused();
            if (!destructiveCount) break;
          }
          await expect(page).toHaveURL(listUrl);
        }
        // Routes that deep-link into a modal (e.g. identity mapping's pending work) trap focus by design,
        // so the launcher behind the dialog is intentionally unreachable by keyboard.
        if (theme === "light" && !pageState.hasDialog) {
          const launcher = page.getByTestId("copilot-chat-toggle");
          const surface = launcher.locator(".xiaoze-chat-toggle__surface");
          await launcher.focus();
          await page.keyboard.press("Shift+Tab");
          await expect(launcher).not.toBeFocused();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
          const restingShadow = await surface.evaluate((element) => getComputedStyle(element).boxShadow);
          await focusViaKeyboard(page, launcher);
          await expect(launcher).toBeFocused();
          expect(await launcher.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
          await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(restingShadow);
          await page.keyboard.press("Shift+ArrowUp");
          assertXiaozePlacement(await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements)), route.path);
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
            await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
            requireModuleTreeAlignment((await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements))).moduleTreeLabels, route.path);
            await test.step("quality:navigation", () => page.reload());
            await test.step("quality:readiness", () => expectUsablePage(page));
            await test.step("quality:readiness", () => settleQualityRoute(page, routePath, { readOnly: true }));
            await test.step("quality:readiness", () => closeXiaozePopupIfOpen(page));
            await test.step("quality:readiness", () => settleXiaozePopupClosed(page));
            await test.step("quality:readiness", () => settleAppToasts(page));
            await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
            if (await pendingWork.isVisible()) {
              await pendingWork.getByRole("button", { name: "关闭", exact: true }).click();
              await expect(pendingWork).toBeHidden();
            }
            await page.mouse.move(0, 0);
            await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
            await expect(node).toHaveAttribute(selectedAttribute, "true");
            requireModuleTreeAlignment((await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements))).moduleTreeLabels, route.path);
            expect(new URL(page.url()).searchParams.get(queryKey)).toBe(selectedId);
            if (routePath === "/parameters") {
              const url = page.url();
              await page.getByRole("button", { name: "收起模块导航", exact: true }).click();
              await expect(node).toBeHidden();
              expect(page.url()).toBe(url);
              await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
              await test.step("quality:navigation", () => page.reload());
              await test.step("quality:readiness", () => expectUsablePage(page));
              await test.step("quality:readiness", () => settleQualityRoute(page, routePath, { readOnly: true }));
              await test.step("quality:readiness", () => closeXiaozePopupIfOpen(page));
              await test.step("quality:readiness", () => settleXiaozePopupClosed(page));
              await test.step("quality:readiness", () => settleAppToasts(page));
              await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
              await expect(page.getByRole("button", { name: "展开模块导航", exact: true })).toBeVisible();
              expect(new URL(page.url()).searchParams.get(queryKey)).toBe(selectedId);
              await page.getByRole("button", { name: "展开模块导航", exact: true }).click();
              await expect(node).toHaveAttribute(selectedAttribute, "true");
              await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
            }
            await node.click();
            await expect(node).toHaveAttribute(selectedAttribute, "false");
            await expect.poll(() => new URL(page.url()).searchParams.get(queryKey)).toBeNull();
            if (routePath === "/node-debugging") {
              const table = page.getByRole("region", { name: "节点调试参数", exact: true }).getByRole("table");
              await expect(table.getByText("Fast charge current", { exact: true })).toHaveCount(1);
            }
            await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
            measurements = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
            requireModuleTreeAlignment(measurements.moduleTreeLabels, route.path);
          });
        }
        if (route.required.includes("overviewPages") || route.required.includes("retiredNotices")) {
          await testInfo.attach(`overview${route.path.replaceAll("/", "-")}-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
        }
        if (route.required.includes("retiredNotices")) {
          const replacement = routePath === "/debugging" ? "/node-debugging" : "/parameters";
          await page.locator(".retired-notice").getByRole("link").click();
          await expect(page).toHaveURL((url) => url.pathname === replacement);
          await test.step("quality:readiness", () => expectUsablePage(page));
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
