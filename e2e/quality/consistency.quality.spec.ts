import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { requirePrimaryActionColors } from "./primary-color";
import { requireViewSwitchStyles } from "./view-switch";
import { assertXiaozePlacement, requireMeasuredCategories, requireModuleTreeAlignment, requireRowActionVisibility, requireCompactControlHeights, requireNavigatorWorkbenchGeometry, requireReviewInboxStructure, shouldRequireXiaozeHint, requireTypographyScale, requirePageGutter, requireWorkbenchPresentation, requireAdminListGeometry, requireOverviewGeometry, requireRetiredNotice, requireSettingsFormPresentation } from "./consistency-assertions";
import { collectConsistencyMeasurements, type ConsistencyMeasurements } from "./consistency-collector";
import { collectionPaths, consistencyReadOnlyRoutes } from "./consistency-routes";
import { compactQualityRoutes } from "./compact-routes";
import { parseQualityLane, shouldRegisterConsistencyFixture } from "./quality-partition";
import { installConsistencyReadGuard } from "./consistency";
import { AUDIT_KIND_LABELS } from "../../src/domain/audit/auditSlugLabels";
import { detectBrowserBridgeTarget } from "../../src/infrastructure/http/bridgeReleaseSelection";
import { parseParameterAdminModulesSubView } from "../../src/application/parameters/parameterAdminOrganizationPath";
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

for (const theme of ["light", "dark"] as const) {
  const fixtureId = `asserts public home accessibility semantics (${theme})`;
  if (!shouldRegisterConsistencyFixture(qualityLane, fixtureId)) continue;
  test(fixtureId, async ({ context, page }, testInfo) => {
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

for (const path of ["/node-debugging", "/dts-reload"]) {
  for (const theme of ["light", "dark"] as const) {
  for (const readiness of ["returning", "first-time", "connected"] as const) {
    const fixtureId = `Bridge readiness on ${path}: ${readiness} (${theme})`;
    if (!shouldRegisterConsistencyFixture(qualityLane, fixtureId)) continue;
    test(fixtureId, async ({ context, page }, testInfo) => {
      testInfo.annotations.push({ type: "setup", description: "Read-only UI fixtures replace Bridge listing, local health and target detection; the workbench and identity use the real API. This does not prove hardware pairing or device writes." });
      const blockedRequests = await installConsistencyReadGuard(context);
      const hostTarget = detectBrowserBridgeTarget(await page.evaluate(() => navigator.userAgent));
      await context.route("**/api/v1/device-bridges/mine", async (request) => request.fulfill({ json: {
        items: readiness === "first-time" ? [] : [{
          id: "quality-readiness-bridge", machineLabel: "质量检查工作站", platform: hostTarget.platform, arch: hostTarget.arch,
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
        await expect(panel.getByText(readiness === "returning" ? "本地 Bridge 未运行" : "未检测到本地 Bridge", { exact: true })).toBeVisible();
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
      {
        const trigger = panel.getByRole("button", { name: "安装指南", exact: true });
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: "安装与连接本地 Bridge" });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole("list", { name: "Bridge 连接步骤" })).toBeVisible();
        await expect(page.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(readiness === "connected" ? 0 : 1);
        if (readiness !== "connected") {
          await drawer.getByRole("button", { name: "查看插入 USB 设备步骤", exact: true }).click();
          await expect(drawer.getByRole("region", { name: "USB 设备连接指引", exact: true })).toBeVisible();
          await expect(drawer.getByText("请先完成「连接本机」，再检测 USB 设备。", { exact: true })).toBeVisible();
        }
        await drawer.getByRole("button", { name: "查看连接本机步骤", exact: true }).click();
        await expect(drawer.getByRole("region", { name: "本机连接指引", exact: true })).toBeVisible();
        if (readiness !== "connected") await expect(drawer.getByText("使用终端手动连接", { exact: true })).toBeVisible();
        await drawer.focus();
        await page.keyboard.press("Shift+Tab");
        await expect(drawer.getByRole("button", { name: readiness === "connected" ? "继续连接 USB 设备" : "连接本机", exact: true })).toBeFocused();
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

for (const route of consistencyReadOnlyRoutes) {
  for (const theme of ["light", "dark"] as const) {
    const fixtureId = `asserts read-only UI consistency for ${route.path} (${theme})`;
    if (!shouldRegisterConsistencyFixture(qualityLane, fixtureId)) continue;
    test(fixtureId, async ({ context, page }, testInfo) => {
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
        if (/^\/parameter-admin\/modules(?:\/(?:queue|registry))?\/?$/.test(routePath)
          && parseParameterAdminModulesSubView(routePath, new URL(page.url()).search) === "queue") {
          const panel = page.locator(".parameter-module-mapping-panel");
          const list = panel.getByRole("region", { name: "来源识别", exact: true });
          const discovery = list.getByRole("region", { name: "来源识别结果", exact: true });
          await expect(list).toHaveClass(/admin-list-page/);
          await expect(list.getByRole("tabpanel")).toBeVisible();
          const records = discovery.locator(".canonical-driver-discovery__list");
          await expect(records).toHaveCount(1);
          await expect(records).toBeVisible();
          await expect(discovery.locator(".canonical-driver-discovery__item").first()).toBeVisible();
          await expect(discovery.getByRole("combobox", { name: "发现项目范围", exact: true })).toBeVisible();
          await expect(discovery.getByRole("searchbox", { name: "搜索发现记录", exact: true })).toBeVisible();
          await expect(discovery.getByRole("combobox", { name: "筛选来源状态", exact: true })).toBeVisible();
          await expect(discovery.getByRole("link", { name: "打开待审核事项", exact: true }))
            .toHaveAttribute("href", "/parameter-admin/specs?review=open");
          await expect(panel.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
          await expect(panel.getByRole("tree", { name: "模块归属树", exact: true })).toHaveCount(0);
          await expect(panel.locator(".navigator-workbench")).toHaveCount(0);
          const geometry = await records.evaluate((element) => {
            const firstRecord = element.querySelector(".canonical-driver-discovery__item > p")!;
            const rect = firstRecord.getBoundingClientRect();
            const listRect = element.getBoundingClientRect();
            const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
            for (let parent = firstRecord.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              const bounds = parent.getBoundingClientRect();
              if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
                clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
                clip.right = Math.min(clip.right, bounds.left + parent.clientLeft + parent.clientWidth);
              }
              if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
                clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
                clip.bottom = Math.min(clip.bottom, bounds.top + parent.clientTop + parent.clientHeight);
              }
            }
            const range = document.createRange();
            range.selectNodeContents(firstRecord);
            return { row: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
              list: { left: listRect.left, right: listRect.right, width: listRect.width }, viewportWidth: innerWidth,
              clip, listClientWidth: element.clientWidth, listScrollWidth: element.scrollWidth,
              textRects: Array.from(range.getClientRects(), (text) => ({ left: text.left, top: text.top, right: text.right, bottom: text.bottom })) };
          });
          expect(geometry.row.width).toBeGreaterThan(0);
          expect(geometry.row.height).toBeGreaterThan(0);
          expect(geometry.list.width).toBeGreaterThan(0);
          expect(geometry.list.left).toBeGreaterThanOrEqual(-1);
          expect(geometry.list.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
          expect(geometry.listScrollWidth, "discovery records must not create horizontal scrolling")
            .toBeLessThanOrEqual(geometry.listClientWidth + 1);
          expect(geometry.textRects.length).toBeGreaterThan(0);
          for (const rect of [geometry.row, ...geometry.textRects]) {
            expect(rect.left, "first discovery record must remain inside its scroll clip").toBeGreaterThanOrEqual(geometry.clip.left - 1);
            expect(rect.right).toBeLessThanOrEqual(geometry.clip.right + 1);
            expect(rect.top).toBeGreaterThanOrEqual(geometry.clip.top - 1);
            expect(rect.bottom).toBeLessThanOrEqual(geometry.clip.bottom + 1);
          }
        }
        if (/^\/parameter-admin\/modules(?:\/(?:queue|registry))?\/?$/.test(routePath)
          && parseParameterAdminModulesSubView(routePath, new URL(page.url()).search) === "registry") {
          const panel = page.locator(".parameter-module-mapping-panel");
          const list = panel.getByRole("region", { name: "历史注册表", exact: true });
          await expect(list).toHaveClass(/admin-list-page/);
          const history = list.getByRole("table", { name: "历史驱动注册表", exact: true });
          await expect(history).toBeVisible();
          for (const name of ["驱动组", "兼容标识", "业务分类", "观察状态", "实测处"]) {
            await expect(list.getByRole("columnheader", { name, exact: true })).toBeVisible();
          }
          await expect(list.getByRole("searchbox", { name: "搜索历史记录", exact: true })).toBeVisible();
          await expect(list.getByRole("combobox", { name: "筛选历史业务分类", exact: true })).toBeVisible();
          await expect(list.getByRole("combobox", { name: "筛选历史观察状态", exact: true })).toBeVisible();
          await expect(panel.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
          await expect(list.getByRole("group", { name: "历史注册表操作", exact: true })).toHaveCount(0);
          await expect(panel.getByRole("tree", { name: "模块归属树", exact: true })).toHaveCount(0);
          await expect(panel.locator(".navigator-workbench")).toHaveCount(0);
          await expect(panel.getByRole("button", { name: /^(新增|新建|编辑|删除|归档|恢复|登记|发布|保存|处理)/ })).toHaveCount(0);
          const rows = history.locator('tbody tr:has(td[data-label="观察状态"])');
          if (await rows.count()) {
            for (const row of await rows.all()) {
              await expect(row.locator('td[data-label="观察状态"]')).toHaveText(/^(已观察|未观察|尚未观察)$/);
              const actions = row.locator('td[data-label="操作"]');
              await expect(actions.getByRole("button")).toHaveCount(1);
              await expect(actions.getByRole("button", { name: /^查看历史记录 / })).toBeVisible();
            }
          } else {
            await expect(list.getByText("暂无历史驱动注册记录。", { exact: true })).toBeVisible();
          }
        }
        if (routePath === "/parameters/definitions") {
          const catalog = page.getByRole("region", { name: "参数定义目录", exact: true });
          await expect(catalog.getByRole("searchbox", { name: "搜索参数定义", exact: true })).toBeVisible();
          const definitions = catalog.getByRole("table", { name: "参数定义列表", exact: true });
          await expect(definitions).toBeVisible();
          await expect(definitions.getByRole("button", { name: /^查看 / }).first()).toBeVisible();
          await expect(catalog.locator('[data-catalog-row-action]:not([data-catalog-row-action="read"])')).toHaveCount(0);
          await expect(catalog.locator("[data-catalog-action]")).toHaveCount(0);
          await expect(catalog.getByRole("button", { name: /^(新增|新建|编辑|处理审核|待审核事项|发布|保存)/ })).toHaveCount(0);
        }
        if (/^\/parameter-admin\/projects\/[^/]+\/(?:configuration|files|config-sets|structure|conflicts)$/.test(routePath)) {
          const workbench = page.getByRole("region", { name: "项目配置工作台", exact: true });
          await expect(workbench.getByRole("button", { name: "项目清单", exact: true })).toBeVisible();
          const contentTabs = workbench.getByRole("tablist", { name: "项目配置内容", exact: true });
          await expect(contentTabs.getByRole("tab")).toHaveCount(3);
          for (const name of ["源码", "结构", "冲突"]) {
            await expect(contentTabs.getByRole("tab", { name, exact: true })).toBeVisible();
          }
          await expect(page.getByRole("navigation", { name: "参数管理后台配置范围", exact: true })).toHaveCount(0);
        }
        if (routePath === "/audit") {
          await test.step("audit kind filter inventory", async () => {
            const originalUrl = page.url();
            const more = page.getByRole("button", { name: /^更多筛选/ });
            await more.click();
            const kind = page.getByRole("combobox", { name: "事件类型筛选" });
            await kind.click();
            const menu = page.getByRole("listbox");
            const expected = [{ value: "", label: "全部类型" },
              ...Object.entries(AUDIT_KIND_LABELS).map(([value, label]) => ({ value, label }))];
            await expect(menu.getByRole("option")).toHaveCount(expected.length);
            expect(await menu.getByRole("option").evaluateAll((options) => options.map((option) => ({
              value: option.getAttribute("data-value"), label: option.textContent?.trim()
            })))).toEqual(expected);
            await page.keyboard.press("Escape");
            await expect(menu).toBeHidden();
            await expect(kind).toBeFocused();
            await more.click();
            await expect(more).toHaveAttribute("aria-expanded", "false");
            await expect(page).toHaveURL(originalUrl);
          });
          await test.step("audit severity column filter", async () => {
            const trigger = page.getByRole("columnheader", { name: /严重度/ }).getByRole("button", { name: "筛选严重度", exact: true });
            await expect(trigger).toBeVisible();
            await expect(trigger).toHaveAttribute("data-compact-control", "filter");
            await trigger.click();
            const menu = page.getByRole("group", { name: "严重度筛选", exact: true });
            await expect(menu.getByRole("checkbox")).toHaveCount(4);
            for (const label of ["高", "中", "低", "信息"]) {
              await expect(menu.getByRole("checkbox", { name: label, exact: true })).toBeVisible();
            }
            await menu.getByRole("checkbox", { name: "高", exact: true }).check();
            await menu.getByRole("checkbox", { name: "中", exact: true }).check();
            await expect(menu.getByRole("checkbox", { name: "高", exact: true })).toBeChecked();
            await expect(menu.getByRole("checkbox", { name: "中", exact: true })).toBeChecked();
            await expect(page).toHaveURL((url) => url.searchParams.get("severity") === "High,Medium");
            await menu.getByRole("button", { name: "清除", exact: true }).click();
            await expect(page).toHaveURL((url) => !url.searchParams.has("severity"));
            await expect(menu.getByRole("checkbox", { name: "高", exact: true })).not.toBeChecked();
            await expect(menu.getByRole("checkbox", { name: "中", exact: true })).not.toBeChecked();
            await menu.getByRole("checkbox", { name: "高", exact: true }).press("Escape");
            await expect(menu).toBeHidden();
            await expect(trigger).toBeFocused();
            await settleQualityRoute(page, routePath, { readOnly: true });
          });
        }
        for (const trigger of await page.locator('[data-slot="select-trigger"]').all()) {
          if (!await trigger.isVisible()) continue;
          const centers = await trigger.evaluate((element) => [...element.querySelectorAll('[data-slot="select-value"], .select-control__chevron')].map((child) => {
            const rect = child.getBoundingClientRect();
            return rect.top + rect.height / 2;
          }));
          if (centers.length === 2) expect(Math.abs(centers[0]! - centers[1]!), "select text and chevron must stay on one line").toBeLessThanOrEqual(2);
        }
        if (routePath === "/feedback-admin") {
          const tops = await page.locator('main [role="combobox"], main .feedback-admin-search').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
          expect(tops).toHaveLength(4);
          expect(Math.max(...tops) - Math.min(...tops), "feedback filters must share one toolbar row on desktop").toBeLessThanOrEqual(2);
        }
        if (routePath === "/parameters") {
          const centers = await page.locator('.topbar-project-select, .topbar-user-trigger').evaluateAll((elements) => elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top + rect.height / 2;
          }));
          expect(centers).toHaveLength(2);
          expect(Math.abs(centers[0]! - centers[1]!), "project selector must not wrap the desktop header").toBeLessThanOrEqual(2);
        }
        if (routePath === "/debugging-admin/nodes" || routePath === "/node-debugging") {
          const trigger = page.getByRole("button", { name: "筛选模块", exact: true });
          await trigger.click();
          const menu = page.getByRole("group", { name: "所属模块筛选", exact: true });
          const search = menu.getByRole("searchbox", { name: "搜索模块", exact: true });
          await expect(search).toBeVisible();
          const geometry = await search.evaluate((input) => {
            const icon = input.parentElement!.querySelector("svg")!.getBoundingClientRect();
            const field = input.getBoundingClientRect();
            return {
              centerDelta: Math.abs(icon.y + icon.height / 2 - field.y - field.height / 2),
              horizontalGap: field.left - icon.right
            };
          });
          expect(geometry.centerDelta, "filter search icon and text must share one line").toBeLessThanOrEqual(1);
          expect(geometry.horizontalGap, "filter search text must follow its icon").toBeGreaterThanOrEqual(0);
          await testInfo.attach(`module-column-filter-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          await search.press("Escape");
          await expect(menu).toBeHidden();
          await expect(trigger).toBeFocused();
        }
        if (routePath === "/debugging-admin/nodes") {
          const longProjectLabel = "多项目联合验证与电池安全治理平台 ".repeat(8).trim();
          testInfo.annotations.push({ type: "setup", description: "A read-only project-list response supplies one controlled long label for geometry; other API data stays real. This does not prove a persisted project rename." });
          await context.route("**/api/v1/projects", async (intercepted) => {
            if (intercepted.request().method() !== "GET") return intercepted.fallback();
            const response = await intercepted.fetch();
            expect(response.ok()).toBe(true);
            const body = await response.json() as { items: Array<{ id: string; name: string }> };
            expect(body.items.length).toBeGreaterThan(0);
            body.items[0]!.name = longProjectLabel;
            await intercepted.fulfill({ response, json: body });
          });
          await page.getByRole("table", { name: "可调节点目录", exact: true }).getByRole("button", { name: "编辑", exact: true }).first().click();
          const editor = page.getByRole("dialog", { name: "编辑节点", exact: true });
          await expect(editor.getByLabel("HDC 节点路径", { exact: true })).toBeVisible();
          await expect(editor.getByLabel("ADB 节点路径", { exact: true })).toBeVisible();
          await expect(editor.getByRole("button", { name: "保存", exact: true })).toHaveCount(1);
          expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
          const access = editor.getByRole("combobox", { name: "HDC 访问模式", exact: true });
          const initialAccess = await access.getAttribute("data-value");
          await access.click();
          await page.getByRole("option", { name: new RegExp(`^${initialAccess} ·`) }).click();
          await expect(access).toHaveAttribute("data-value", initialAccess!);
          await expect(access).toBeFocused();
          await access.press("ArrowDown");
          await expect(page.getByRole("listbox")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("listbox")).toBeHidden();
          await expect(editor).toBeVisible();
          await expect(access).toBeFocused();
          const association = editor.locator("summary").filter({ hasText: "项目参数关联" });
          await association.click();
          const project = editor.getByRole("combobox", { name: "关联项目", exact: true });
          await expect(project).toBeEnabled();
          await project.click();
          await page.getByRole("option", { name: longProjectLabel, exact: true }).click();
          await expect(project).toBeFocused();
          const longLabelGeometry = await project.evaluate((element) => {
            const text = element.querySelector('[data-slot="select-value"]')!;
            const chevron = element.querySelector(".select-control__chevron")!.getBoundingClientRect();
            const label = text.getBoundingClientRect();
            return { truncated: text.scrollWidth > text.clientWidth, gap: chevron.left - label.right,
              centerDelta: Math.abs(label.top + label.height / 2 - chevron.top - chevron.height / 2) };
          });
          expect(longLabelGeometry.truncated, "long form labels must truncate within their field").toBe(true);
          expect(longLabelGeometry.gap, "long labels must leave the dropdown arrow visible").toBeGreaterThanOrEqual(0);
          expect(longLabelGeometry.centerDelta).toBeLessThanOrEqual(2);
          await project.click();
          await page.getByRole("option", { name: "不关联项目参数", exact: true }).click();
          await association.click();
          await assertAccessibilitySemantics(page, testInfo, `unified-node-editor-${theme}`);
          await testInfo.attach(`unified-node-editor-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          const name = editor.getByRole("textbox", { name: "名称", exact: true });
          await name.fill(`${await name.inputValue()}未保存`);
          await editor.getByRole("button", { name: "取消", exact: true }).click();
          const discard = page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true });
          await expect(discard).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(discard).toBeHidden();
          await expect(editor).toBeVisible();
          await expect(editor.getByRole("button", { name: "取消", exact: true })).toBeFocused();
          await editor.getByRole("button", { name: "取消", exact: true }).click();
          await discard.getByRole("button", { name: "放弃并关闭", exact: true }).click();
          await expect(editor).toBeHidden();
          await page.getByRole("button", { name: "模块管理", exact: true }).click();
          const modules = page.getByRole("dialog", { name: "模块管理", exact: true });
          const more = modules.getByRole("button", { name: "Battery Charging 更多操作", exact: true });
          await more.click();
          await page.getByRole("menuitem", { name: "查看节点", exact: true }).click();
          await expect(modules.getByLabel("Battery Charging 节点列表")).toBeVisible();
          await more.press("ArrowDown");
          await expect(page.getByRole("menu")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("menu")).toBeHidden();
          await expect(modules).toBeVisible();
          await expect(more).toBeFocused();
          await modules.getByRole("button", { name: "完成", exact: true }).click();
        }
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
        const pendingWork = page.getByRole("dialog", { name: "待审核事项", exact: true });
        if (new URL(page.url()).searchParams.get("review") === "open" || await pendingWork.isVisible()) {
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
            const needsOverflow = !["/audit", "/feedback-admin"].includes(routePath) && (!collectionPaths.includes(routePath)
              || (routePath === "/knowledge-admin" && new URL(page.url()).searchParams.get("tab") !== "index"));
            requireAdminListGeometry(measurements.adminLists, route.path, needsOverflow);
            if (routePath === "/audit") {
              for (const list of measurements.adminLists) for (const row of list.rows) {
                expect(row.actions).toHaveLength(1);
                expect(row.actions[0].overflow).toBe(false);
              }
              for (const actionCell of await page.locator('td[data-label="操作"]').all()) {
                await expect(actionCell.getByRole("button", { name: "查看", exact: true })).toHaveCount(1);
              }
            }
            if (routePath === "/feedback-admin") {
              for (const list of measurements.adminLists) for (const row of list.rows) {
                expect(row.actions).toEqual([expect.objectContaining({ overflow: false, destructive: false, height: 28 })]);
              }
              await expect(page.getByRole("button", { name: "刷新", exact: true })).toHaveAttribute("data-variant", "outline");
            }
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
            await expect(deleteItem).toHaveAccessibleDescription("项目需保留规范历史，不能删除；可归档后从默认清单收起。");
            await expect(page.getByRole("menuitem", { name: /^(归档|恢复项目) / })).toBeEnabled();
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
