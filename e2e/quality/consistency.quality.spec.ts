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
import type { DebugRuntimeNodeDto } from "../../src/infrastructure/http/debuggingDtos";
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

{
  const fixtureId = "aligns parameter toolbar actions across DTS and JSON views";
  if (shouldRegisterConsistencyFixture(qualityLane, fixtureId)) test(fixtureId, async ({ context, page }, testInfo) => {
    testInfo.annotations.push({ type: "setup", description: "A read-only JSON Binding fixture extends the real API response to expose both format tabs. Identity, DTS topology and source reads use the real API; no project data is changed." });
    const blockedRequests = await installConsistencyReadGuard(context);
    await context.route("**/api/v2/projects/aurora/parameter-bindings", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json() as { items: Array<Record<string, unknown>> };
      expect(body.items.length).toBeGreaterThan(0);
      await route.fulfill({ response, json: { ...body, items: [...body.items, {
        ...body.items[0], id: "pbind_quality_toolbar_json", propertyKey: "toolbar_layout_preview",
        rawValue: '{"limit":1}', effectiveValue: { kind: "json", value: { limit: 1 } }
      }] } });
    });
    await page.goto("/parameters?project=aurora");
    await expectUsablePage(page);
    await settleQualityRoute(page, "/parameters", { readOnly: true });
    await settleXiaozePopupClosed(page);
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      for (const format of ["DTS", "JSON"] as const) {
        await page.getByRole("tab", { name: format === "DTS" ? /^DTS 设备树参数/ : /^JSON 参数/ }).click();
        await page.getByRole("tab", { name: "参数列表", exact: true }).click();
        for (const source of [false, true]) {
          if (source) await page.getByRole("tab", { name: `${format} 源码`, exact: true }).click();
          const toolbar = page.getByRole("group", { name: "工作台操作", exact: true });
          const controls = [
            toolbar.getByRole("tablist", { name: "结果模式" }),
            toolbar.getByRole("tablist", { name: "参数配置格式" }),
            toolbar.getByRole("button", { name: source ? `下载 ${format}` : "导出当前结果", exact: true })
          ];
          const boxes = await Promise.all(controls.map(async (control) => {
            await expect(control).toBeVisible();
            return (await control.boundingBox())!;
          }));
          const centers = boxes.map((box) => box.y + box.height / 2);
          expect(Math.max(...centers) - Math.min(...centers), "result mode, format switch and export must share one horizontal centerline").toBeLessThanOrEqual(1);
          for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.x).toBeGreaterThanOrEqual(boxes[index - 1]!.x + boxes[index - 1]!.width);
          await expectNoHorizontalOverflow(page);
          if (!source) await testInfo.attach(`parameter-toolbar-${format.toLowerCase()}-${width}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
        }
      }
    }
    expect(blockedRequests).toEqual([]);
  });
}

for (const path of ["/node-debugging", "/dts-reload"]) {
  for (const theme of ["light", "dark"] as const) {
  for (const readiness of ["returning", "first-time", "pairing", "connected"] as const) {
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
        if (readiness === "pairing") return request.fulfill({ json: {
          ok: true, paired: false, connected: false, clientVersion: "999.0.0", updatedAt: "2026-10-11T00:00:00Z"
        } });
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
      const bridgeUpToDate = readiness === "pairing" || readiness === "connected";
      const guideTrigger = panel.getByRole("button", { name: bridgeUpToDate ? "设备连接与排查" : "安装指南", exact: true });
      await expect(guideTrigger).toBeVisible();
      await expect(panel.getByRole("button", { name: bridgeUpToDate ? "安装指南" : "设备连接与排查", exact: true })).toHaveCount(0);
      if (readiness === "connected") {
        await expect(panel.getByText("已连接 · 质量检查工作站", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toHaveCount(0);
      } else {
        await expect(panel.getByText(readiness === "pairing" ? "Bridge 等待配对" : readiness === "returning" ? "本地 Bridge 未运行" : "未检测到本地 Bridge", { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(1);
        if (readiness === "returning") {
          await expect(panel.getByRole("list", { name: "Bridge 连接步骤" })).toHaveCount(0);
          const bar = await panel.locator(".local-device-bridge-panel__readiness").boundingBox();
          expect(bar).not.toBeNull();
          expect(bar!.height).toBeLessThanOrEqual(40);
        } else {
          await expect(panel.getByRole("button", { name: "连接本机", exact: true })).toBeVisible();
          if (readiness === "pairing") await expect(panel.getByText("连接本机后自动完成配对，无需手动输入配对码。", { exact: true })).toBeVisible();
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
      if (readiness !== "first-time") {
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
      if (readiness !== "first-time") {
        const checkConnectionLayout = async () => {
          const actions = await panel.getByRole("group", { name: "本地连接操作" }).getByRole("button").all();
          const boxes = await Promise.all(actions.map((action) => action.boundingBox()));
          expect(boxes.every((box) => box && box.height === 32 && Math.abs(box.y - boxes[0]!.y) < 1)).toBe(true);
          const toolbar = await page.getByRole("group", { name: "工作台操作", exact: true }).boundingBox();
          const connection = await panel.boundingBox();
          expect(connection!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height);
          await expectNoHorizontalOverflow(page);
        };
        await checkConnectionLayout();
        const before = await panel.boundingBox();
        const trigger = panel.getByRole("button", { name: "管理设备代理", exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "管理设备代理", exact: true });
        await expect(dialog.getByRole("textbox", { name: "设备名" })).toHaveValue("质量检查工作站");
        await testInfo.attach(`bridge-management-${readiness}-${theme}${path.replaceAll("/", "-")}`, {
          contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(await panel.boundingBox()).toEqual(before);
        if (readiness === "pairing" && theme === "light") {
          await page.setViewportSize({ width: 1280, height: 800 });
          await checkConnectionLayout();
          await testInfo.attach(`bridge-pairing-compact${path.replaceAll("/", "-")}`, {
            contentType: "image/png", body: await page.screenshot({ animations: "disabled" })
          });
          await page.setViewportSize({ width: 1440, height: 900 });
        }
      }
      {
        const trigger = guideTrigger;
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: "安装与连接本地 Bridge" });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole("list", { name: "Bridge 连接步骤" })).toBeVisible();
        await expect(page.getByRole("button", { name: "连接本机", exact: true })).toHaveCount(readiness === "connected" ? 0 : 1);
        if (!bridgeUpToDate) {
          await drawer.getByRole("button", { name: "查看插入 USB 设备步骤", exact: true }).click();
        }
        await expect(drawer.getByRole("region", { name: "USB 设备连接指引", exact: true })).toBeVisible();
        await expect(drawer.getByRole("button", { name: "查看安装 Bridge步骤", exact: true })).toBeVisible();
        if (readiness !== "connected") {
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

{
  const fixtureId = "keeps multiline node read details complete and locally scrollable (UI fixture, no hardware proof)";
  if (shouldRegisterConsistencyFixture(qualityLane, fixtureId)) test(fixtureId, async ({ context, page }, testInfo) => {
    testInfo.annotations.push({ type: "setup", description: "Identity and node identities come from the real API. Two existing RW nodes are exposed as scalar/complex in a read-only response fixture; discovery, session and reads are synthetic. No server data or device is changed, and this does not prove real hardware reads or writes." });
    const blockedRequests = await installConsistencyReadGuard(context);
    const consoleErrors: string[] = [];
    const readGuardDiagnostics: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // The read guard intentionally closes every socket, including Vite HMR.
      const expectedSocketClose = message.location().url.includes("/@vite/client")
        && message.text().startsWith("[vite] failed to connect to websocket.");
      (expectedSocketClose ? readGuardDiagnostics : consoleErrors).push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const rawValue = Array.from({ length: 40 }, (_, index) => `line-${String(index + 1).padStart(2, "0")} ${"0123456789abcdef".repeat(24)} ${index === 39 ? "MULTILINE-END-MARKER" : "row-end"}`).join("\n");
    let nodes: DebugRuntimeNodeDto[] = [];
    await context.route("**/api/v1/debugging/nodes?*", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const body = await response.json() as { items: DebugRuntimeNodeDto[] };
      if (new URL(route.request().url()).searchParams.get("protocol") !== "hdc") return route.fulfill({ response, json: body });
      nodes = body.items.filter((node) => node.enabled && node.accessMode === "RW").slice(0, 2)
        .map((node, index) => ({ ...node, valueKind: index === 0 ? "scalar" : "complex", valueFormat: "raw", normalizationMode: "exact" }));
      expect(nodes).toHaveLength(2);
      await route.fulfill({ response, json: { ...body, items: nodes } });
    });
    await context.route("**/api/v1/device-bridges/mine", (route) => route.fulfill({ json: { items: [] } }));
    await context.route("**/local-bridge/health", (route) => route.fulfill({ json: {
      ok: true, paired: true, connected: true, bridgeId: "quality-multiline-bridge", clientVersion: "999.0.0",
      updatedAt: "2026-10-19T00:00:00Z", tools: { hdc: { available: true }, adb: { available: false } }
    } }));
    const target = { id: "bridge:quality-multiline-target", deviceId: "bridge:quality-multiline-bridge", bridgeId: "quality-multiline-bridge",
      bridgeMachineLabel: "多行布局检查工作站", protocol: "hdc", label: "多行布局检查设备", targetRef: "quality-multiline-target", status: "detected" };
    await context.route("**/api/v1/debugging/targets/detect", (route) => {
      expect(route.request().postDataJSON()).not.toHaveProperty("protocol");
      return route.fulfill({ json: { items: [target] } });
    });
    await context.route("**/api/v1/debugging/sessions", (route) => route.fulfill({ json: { item: {
      id: "quality-multiline-session", deviceId: target.deviceId, targetId: target.id, protocol: "hdc", status: "active",
      startedAt: "2026-10-19T00:00:00Z", endedAt: null
    } } }));
    await context.route("**/api/v1/debugging/sessions/quality-multiline-session/events", (route) => route.fulfill({ json: { items: [] } }));
    await context.route("**/api/v1/debugging/nodes/read", (route) => {
      const node = nodes.find((entry) => entry.id === route.request().postDataJSON().nodeId);
      expect(node).toBeDefined();
      return route.fulfill({ json: { operation: {
        id: `quality-multiline-read-${node!.id}`, sessionId: "quality-multiline-session", parameterId: node!.id,
        nodeId: node!.id, protocol: "hdc", nodePath: node!.nodePath, operationType: "read", status: "succeeded",
        requestedValue: null, previousValue: null, readValue: rawValue, readbackValue: null, verified: null,
        failureReason: null, durationMs: 1, snapshotId: null, createdAt: "2026-10-19T00:00:00Z"
      } } });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const [identity] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/me"),
      test.step("quality:navigation", () => page.goto("/node-debugging"))
    ]);
    expect(identity.ok()).toBe(true);
    await expectUsablePage(page);
    await settleQualityRoute(page, "/node-debugging", { readOnly: true });
    await settleXiaozePopupClosed(page);
    await settleAppToasts(page);
    expect(nodes).toHaveLength(2);
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      for (const node of nodes) {
        const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: `查看/修改 ${node.name}`, exact: true }) });
        await expect(row.getByText("读取成功", { exact: true })).toBeVisible();
        await row.getByRole("button", { name: `查看/修改 ${node.name}`, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: node.name, exact: true });
        const value = dialog.locator('pre[aria-label="当前值"]');
        await expect(value).toBeVisible();
        expect(await value.locator("code").textContent(), "full raw value, all newlines and final marker must survive presentation").toBe(rawValue);
        const geometry = await value.evaluate((element) => ({
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
          overflowY: getComputedStyle(element).overflowY
        }));
        expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
        expect(["auto", "scroll"]).toContain(geometry.overflowY);
        if (node.valueKind === "complex") expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
        else expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
        await value.focus();
        await page.keyboard.press("PageDown");
        await expect.poll(() => value.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await value.evaluate((element) => element.scrollTo({ top: element.scrollHeight, left: element.scrollWidth }));
        if (node.valueKind === "complex") await expect.poll(() => value.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        const bounds = await dialog.evaluate((element) => {
          const card = element.querySelector(".node-detail-card")!.getBoundingClientRect();
          const sheet = element.getBoundingClientRect();
          const body = element.querySelector(".workbench-sheet-body")!;
          return { cardRight: card.right, sheetRight: sheet.right, sheetWidth: sheet.width,
            bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth };
        });
        expect(bounds.cardRight).toBeLessThanOrEqual(bounds.sheetRight);
        expect(bounds.sheetWidth).toBeLessThanOrEqual(width);
        expect(bounds.bodyScrollWidth).toBeLessThanOrEqual(bounds.bodyWidth + 1);
        await expectNoHorizontalOverflow(page);
        await expect(dialog.getByRole("button", { name: "暂存", exact: true })).toBeInViewport();
        await expect(dialog.getByRole("button", { name: "写入并回读", exact: true })).toBeInViewport();
        await testInfo.attach(`node-multiline-${node.valueKind}-${width}`, { contentType: "image/png", body: await page.screenshot({ animations: "disabled" }) });
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
    }
    await testInfo.attach("node-multiline-console-errors", { contentType: "application/json", body: JSON.stringify({ errors: consoleErrors, readGuardDiagnostics }) });
    expect(consoleErrors).toEqual([]);
    expect(blockedRequests).toEqual([]);
  });
}

{
  const fixtureId = "keeps long DTS string details and unchanged previews bounded (read-only response fixture)";
  if (shouldRegisterConsistencyFixture(qualityLane, fixtureId)) test(fixtureId, async ({ context, page }, testInfo) => {
    testInfo.annotations.push({ type: "setup", description: "A real project Binding retains its identity and pins while only rawValue/effectiveValue are replaced in a GET response to exercise long DTS strings. Identity, topology and definition reads use the real API. Draft edits remain local; no save, device write or server mutation is performed." });
    const blockedRequests = await installConsistencyReadGuard(context);
    const consoleErrors: string[] = [];
    const readGuardDiagnostics: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const expectedSocketClose = message.location().url.includes("/@vite/client")
        && message.text().startsWith("[vite] failed to connect to websocket.");
      (expectedSocketClose ? readGuardDiagnostics : consoleErrors).push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const stringValue = Array.from({ length: 40 }, (_, index) => `line-${index + 1} ${"0123456789abcdef".repeat(24)} ${index === 39 ? "PARAMETER-END-MARKER" : "row-end"}`).join("\n");
    const rawValue = JSON.stringify(stringValue);
    let bindingId = "";
    await context.route(/\/api\/v2\/projects\/aurora\/parameter-bindings(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const body = await response.json() as { items: Array<Record<string, unknown>> };
      const binding = body.items.find((item) => typeof item.rawValue === "string" && item.rawValue.startsWith("<"));
      expect(binding, "a real DTS Binding must be available before replacing its value response").toBeDefined();
      bindingId = binding!.id as string;
      await route.fulfill({ response, json: { ...body, items: body.items.map((item) => item.id === bindingId
        ? { ...item, rawValue, effectiveValue: { kind: "strings", values: [stringValue] } } : item) } });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const [identity] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/me"),
      test.step("quality:navigation", () => page.goto("/parameters?project=aurora"))
    ]);
    expect(identity.ok()).toBe(true);
    await expectUsablePage(page);
    await settleQualityRoute(page, "/parameters", { readOnly: true });
    await settleXiaozePopupClosed(page);
    await settleAppToasts(page);
    await expect.poll(() => bindingId).not.toBe("");
    await page.locator(`[data-binding-id="${bindingId}"]`).getByRole("button", { name: /^参数详情 / }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /· 参数详情$/ }) });
    const target = dialog.getByRole("textbox", { name: "目标值", exact: true });
    const unchanged = dialog.getByRole("list", { name: "值未改变", exact: true });
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      const listPreview = page.locator(`[data-binding-id="${bindingId}"] [data-label="当前值"] code`);
      expect(await listPreview.textContent()).toBe(rawValue);
      const previewSize = await listPreview.evaluate((element) => ({
        height: element.getBoundingClientRect().height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight)
      }));
      expect(previewSize.height, "the table must keep a four-line preview while details retain the full value")
        .toBeLessThanOrEqual(previewSize.lineHeight * 4 + 1);
      await expect(target).toHaveValue(rawValue);
      expect(await target.evaluate((element) => element.tagName)).toBe("TEXTAREA");
      const editor = await target.evaluate((element) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight }));
      expect(editor.height, "long string editing must stay in a bounded local scrollport").toBeLessThanOrEqual(320);
      expect(editor.scrollHeight).toBeGreaterThan(editor.height);
      await expect(unchanged).toBeVisible();
      expect(await unchanged.locator("code").textContent(), "unchanged preview must retain the complete escaped multiline DTS string").toBe(rawValue);
      const current = dialog.getByRole("region", { name: "当前生效值", exact: true });
      expect(await current.textContent()).toBe(rawValue);
      expect(await current.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(320);
      await current.focus();
      await page.keyboard.press("PageDown");
      await expect.poll(() => current.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const geometry = await dialog.evaluate((element) => {
        const content = element.querySelector(".parameter-inspector__content")!;
        const preview = element.querySelector('.submission-preview-diff[data-kind="equal"]')!;
        const box = element.getBoundingClientRect();
        return { right: box.right, left: box.left, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth,
          previewWidth: preview.clientWidth, previewScrollWidth: preview.scrollWidth };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.contentScrollWidth).toBeLessThanOrEqual(geometry.contentWidth + 1);
      expect(geometry.previewScrollWidth).toBeLessThanOrEqual(geometry.previewWidth + 1);
      await testInfo.attach(`parameter-value-editor-${width}`, { contentType: "image/png", body: await page.screenshot({ animations: "disabled" }) });
      await unchanged.scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "保存草稿", exact: true })).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      await testInfo.attach(`parameter-long-string-${width}`, { contentType: "image/png", body: await page.screenshot({ animations: "disabled" }) });
      await target.fill('"short"');
      await expect(target).toHaveValue('"short"');
      expect(await target.evaluate((element) => element.tagName), "shortening a string draft must preserve the multiline editor").toBe("TEXTAREA");
      await target.fill(rawValue);
    }
    await dialog.getByRole("button", { name: "关闭参数详情", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await testInfo.attach("parameter-long-string-console-errors", { contentType: "application/json", body: JSON.stringify({ errors: consoleErrors, readGuardDiagnostics }) });
    expect(consoleErrors).toEqual([]);
    expect(blockedRequests).toEqual([]);
  });
}

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
        if (routePath === "/node-debugging" || routePath === "/dts-reload") {
          await expect(page.getByRole("tablist", { name: "连接协议", exact: true })).toHaveCount(0);
          await expect(page.getByRole("tab", { name: /^(HDC|ADB)$/ })).toHaveCount(0);
        }
        if (/^\/parameter-admin\/modules(?:\/(?:queue|registry))?\/?$/.test(routePath)
          && parseParameterAdminModulesSubView(routePath, new URL(page.url()).search) === "queue") {
          const panel = page.locator(".parameter-module-mapping-panel");
          const list = panel.getByRole("region", { name: "来源识别", exact: true });
          const discovery = list.getByRole("region", { name: "来源识别结果", exact: true });
          await expect(list).toHaveClass(/admin-list-page/);
          await expect(list.getByRole("tabpanel")).toBeVisible();
          const records = discovery.locator(".canonical-driver-discovery__list");
          await expect(records).toHaveCount(1);
          const rows = discovery.locator(".canonical-driver-discovery__item");
          const scope = discovery.getByRole("combobox", { name: "发现项目范围", exact: true });
          const search = discovery.getByRole("searchbox", { name: "搜索发现记录", exact: true });
          const sourceFilter = discovery.getByRole("combobox", { name: "筛选来源状态", exact: true });
          const nextPage = discovery.getByRole("button", { name: "加载下一页", exact: true });
          const summary = discovery.getByText(/^已加载 \d+ 条，匹配 \d+ 条/);
          const counts = /^已加载 (\d+) 条，匹配 (\d+) 条/.exec(await summary.innerText());
          expect(counts).not.toBeNull();
          const loadedCount = Number(counts![1]);
          const matchedCount = Number(counts![2]);
          expect(matchedCount).toBeLessThanOrEqual(loadedCount);
          await expect(rows).toHaveCount(matchedCount);
          await expect(scope).toBeVisible();
          await expect(discovery.getByRole("link", { name: "打开待审核事项", exact: true }))
            .toHaveAttribute("href", "/parameter-admin/specs?review=open");
          await expect(panel.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
          await expect(panel.getByRole("tree", { name: "模块归属树", exact: true })).toHaveCount(0);
          await expect(panel.locator(".navigator-workbench")).toHaveCount(0);
          const empty = discovery.locator(".canonical-discovery-empty");
          const filteredEmpty = discovery.getByRole("status").filter({ hasText: /^已加载记录中没有匹配结果，请调整筛选/ });
          if (loadedCount === 0 && await nextPage.count() === 0) {
            await expect(empty).toBeVisible();
            await expect(empty.getByRole("heading", { name: "暂无发现记录", exact: true })).toBeVisible();
            await expect(empty.getByRole("status")).toHaveText(/^(当前范围没有来源观察记录。|当前范围没有兼容发现。)$/);
            const projectId = await scope.getAttribute("data-value");
            await expect(empty.getByRole("link", { name: "前往项目配置", exact: true }))
              .toHaveAttribute("href", projectId ? `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration` : "/parameter-admin/projects");
            await expect(search).toHaveCount(0);
            await expect(sourceFilter).toHaveCount(0);
            await expect(filteredEmpty).toHaveCount(0);
          } else {
            await expect(empty).toHaveCount(0);
            await expect(search).toBeVisible();
            await expect(sourceFilter).toBeVisible();
            if (loadedCount > 0 && matchedCount === 0) await expect(filteredEmpty).toBeVisible();
            else if (loadedCount === 0) await expect(nextPage).toBeEnabled();
            else await expect(filteredEmpty).toHaveCount(0);
          }
          if (matchedCount > 0) {
            await expect(records).toBeVisible();
            await expect(rows.first()).toBeVisible();
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
            const originalSearch = await search.inputValue();
            await search.fill(`quality-no-discovery-match-${Date.now()}`);
            await expect(rows).toHaveCount(0);
            await expect(summary).toContainText(`已加载 ${loadedCount} 条，匹配 0 条`);
            await expect(filteredEmpty).toBeVisible();
            await expect(empty).toHaveCount(0);
            await search.fill(originalSearch);
            await expect(rows).toHaveCount(matchedCount);
            await expect(filteredEmpty).toHaveCount(0);
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
          const files = page.getByRole("dialog", { name: "文件管理", exact: true });
          const requestedInspector = new URLSearchParams(route.path.split("?")[1]).get("inspector")
            ?? (routePath.endsWith("/config-sets") ? "config-set" : routePath.endsWith("/files") ? "file" : null);
          if (requestedInspector === "config-set") {
            await expect(files).toBeVisible();
            await expect(files).toBeInViewport({ ratio: 1 });
          } else if (requestedInspector === "file") {
            await expect(page.getByRole("complementary", { name: "配置检查器", exact: true })).toBeVisible();
            const initialMeasurements = await page.evaluate(collectConsistencyMeasurements);
            requireNavigatorWorkbenchGeometry(initialMeasurements.navigatorWorkbenches, route.path);
          }
          if (await files.isVisible()) {
            await expect(files.getByRole("table", { name: "配置文件", exact: true })).toBeVisible();
            await files.getByRole("button", { name: "关闭文件管理", exact: true }).click();
          }
          const configurationVersions = page.getByRole("dialog", { name: "配置版本", exact: true });
          if (await configurationVersions.isVisible()) await configurationVersions.getByRole("button", { name: "关闭配置版本", exact: true }).click();
          await expect(workbench.getByRole("button", { name: "项目清单", exact: true })).toBeVisible();
          const versionsEntry = workbench.getByRole("button", { name: /^配置版本/ });
          await expect(versionsEntry).toHaveAttribute("data-variant", "outline");
          await versionsEntry.click();
          await expect(configurationVersions).toBeVisible();
          await expect(configurationVersions).toBeInViewport({ ratio: 1 });
          await expect(configurationVersions.getByRole("region", { name: "配置版本列表与详情", exact: true })).toBeVisible();
          await expect(configurationVersions.getByText("正在加载配置版本…", { exact: true })).toHaveCount(0);
          const versionHistory = configurationVersions.getByRole("list", { name: "配置版本历史", exact: true });
          await expect(versionHistory).toHaveCount(1);
          if (await versionHistory.getByRole("button").count()) {
            await expect(configurationVersions.getByLabel("配置版本详情", { exact: true }).getByRole("heading")).toBeVisible();
            await expect(configurationVersions.getByText("正在读取快照文件…", { exact: true })).toHaveCount(0);
            await expect(configurationVersions.getByRole("alert")).toHaveCount(0);
            const snapshotFiles = configurationVersions.getByRole("table", { name: "快照中的文件版本", exact: true });
            if (await snapshotFiles.count()) await expect(snapshotFiles).toBeVisible();
            else await expect(configurationVersions.getByText("此快照未记录文件。", { exact: true })).toBeVisible();
          } else {
            await expect(configurationVersions.getByText("尚未保存版本快照。", { exact: true })).toBeVisible();
          }
          const versionBounds = await configurationVersions.evaluate((dialog) => ({ clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth }));
          expect(versionBounds.scrollWidth).toBeLessThanOrEqual(versionBounds.clientWidth + 1);
          await configurationVersions.getByRole("button", { name: "关闭配置版本", exact: true }).click();
          await expect(versionsEntry).toBeFocused();
          const more = workbench.getByRole("group", { name: "配置工作台操作", exact: true }).getByRole("button", { name: "更多", exact: true });
          await more.click();
          await expect(page.getByRole("menuitem", { name: "冲突处理", exact: true })).toHaveCount(0);
          await page.keyboard.press("Escape");
          const legacyConflictsUrl = new URL(page.url());
          legacyConflictsUrl.searchParams.set("tab", "conflicts");
          await page.goto(legacyConflictsUrl.toString());
          await settleQualityRoute(page, legacyConflictsUrl.pathname, { readOnly: true });
          await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
          await waitForFontsAndNextPaint(page);
          const contentTabs = workbench.getByRole("tablist", { name: "项目配置内容", exact: true });
          await expect(contentTabs.getByRole("tab")).toHaveCount(2);
          await expect(contentTabs.getByRole("tab", { name: "结构", exact: true })).toHaveCount(0);
          const conflictTab = contentTabs.getByRole("tab", { name: /^冲突/ });
          await expect(conflictTab).toHaveAttribute("aria-selected", "true");
          const conflictsPanelId = await conflictTab.getAttribute("aria-controls");
          expect(conflictsPanelId).toBeTruthy();
          const conflictsPanel = page.locator(`[id="${conflictsPanelId}"]`);
          await expect(conflictsPanel).toHaveAttribute("role", "tabpanel");
          await expect(conflictsPanel).toHaveAttribute("aria-labelledby", (await conflictTab.getAttribute("id"))!);
          await expect(conflictsPanel).toBeVisible();
          await expect(conflictsPanel.getByRole("heading", { name: "冲突处理", exact: true })).toBeVisible();
          await expect(workbench.getByText("正在加载冲突…", { exact: true })).toHaveCount(0);
          await expect(workbench.getByText("冲突加载失败，请重试。", { exact: true })).toHaveCount(0);
          const conflictCount = Number((await conflictTab.textContent())?.match(/\d+/)?.[0] ?? 0);
          const conflictMeasurements = await page.evaluate(collectConsistencyMeasurements);
          requireViewSwitchStyles(conflictMeasurements, "/parameter-admin/projects/aurora/configuration?tab=conflicts");
          await contentTabs.getByRole("tab", { name: "源码", exact: true }).click();
          await expect(workbench.getByRole("region", { name: "配置内容", exact: true })).toBeVisible();
          await expect(workbench.getByRole("heading", { name: "冲突处理", exact: true })).toHaveCount(0);
          if (conflictCount === 0) {
            await expect(contentTabs).toHaveCount(0);
            await expect(workbench.getByRole("tabpanel")).toHaveCount(0);
          } else {
            await expect(contentTabs.getByRole("tab")).toHaveCount(2);
            const sourceTab = contentTabs.getByRole("tab", { name: "源码", exact: true });
            await expect(sourceTab).toHaveAttribute("aria-selected", "true");
            const sourcePanelId = await sourceTab.getAttribute("aria-controls");
            expect(sourcePanelId).toBeTruthy();
            const sourcePanel = page.locator(`[id="${sourcePanelId}"]`);
            await expect(sourcePanel).toHaveAttribute("role", "tabpanel");
            await expect(sourcePanel).toHaveAttribute("aria-labelledby", (await sourceTab.getAttribute("id"))!);
            await expect(sourcePanel).toBeVisible();
          }
          await expect(workbench.getByRole("button", { name: /^更新来源/ })).toHaveCount(0);
          await workbench.getByRole("button", { name: "配置", exact: true }).click();
          await page.getByRole("menuitem", { name: /^(文件管理|查看文件)$/ }).click();
          await files.getByRole("button", { name: /^(更新文件|更新记录|上传来源文件)$/ }).first().click();
          const inspector = page.getByRole("complementary", { name: "配置检查器", exact: true });
          await expect(inspector.getByRole("region", { name: "候选记录", exact: true })).toBeVisible();
          await inspector.getByRole("button", { name: "关闭检查器", exact: true }).click();
          await workbench.getByRole("button", { name: "配置", exact: true }).click();
          await page.getByRole("menuitem", { name: /^(文件管理|查看文件)$/ }).click();
          await expect(files.getByRole("table", { name: "配置文件", exact: true })).toBeVisible();
          await expect(files).toBeInViewport({ ratio: 1 });
          await files.getByRole("button", { name: "关闭文件管理", exact: true }).click();
          await expect(page.getByRole("navigation", { name: "参数管理后台配置范围", exact: true })).toHaveCount(0);
          if (new URLSearchParams(route.path.split("?")[1]).get("tab") === "conflicts") {
            await page.goto(legacyConflictsUrl.toString());
            await settleQualityRoute(page, legacyConflictsUrl.pathname, { readOnly: true });
            await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
            await expect(contentTabs.getByRole("tab", { name: /^冲突/ })).toHaveAttribute("aria-selected", "true");
            await waitForFontsAndNextPaint(page);
          }
          expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(theme === "dark");
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
        const reviewRoute = ["/parameter-review", "/parameter-submissions"].includes(routePath);
        const requiresHint = !reviewRoute && shouldRequireXiaozeHint(pageState);
        if (reviewRoute) await expect(page.getByTestId("xiaoze-toggle-hint")).toHaveCount(0);
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
        const measuredUrl = new URL(page.url());
        const geometryPath = routePath.startsWith("/parameter-admin/projects/aurora/")
          ? `${measuredUrl.pathname}${measuredUrl.search}` : route.path;
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
            requireNavigatorWorkbenchGeometry(measurements.navigatorWorkbenches, geometryPath);
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
          const navigatorLabel = routePath.startsWith("/parameter-admin/projects/aurora") ? "配置导航" : routePath === "/logs" ? "日志记录" : "模块导航";
          await page.getByRole("button", { name: `收起${navigatorLabel}`, exact: true }).click();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
          const collapsed = await test.step("quality:capture", () => page.evaluate(collectConsistencyMeasurements));
          requireNavigatorWorkbenchGeometry(collapsed.navigatorWorkbenches, geometryPath);
          if (routePath.startsWith("/parameter-admin/projects/aurora")) {
            expect(collapsed.rowActions, "file navigation must not duplicate toolbar actions").toHaveLength(0);
            await expect(page.locator(".navigator-workbench__navigation .row-action-menu")).toHaveCount(0);
            const toolbar = page.locator(".configuration-workbench__command");
            await expect(toolbar.locator(".row-action-menu")).toHaveCount(1);
            const more = toolbar.getByRole("button", { name: "更多", exact: true });
            await expect(more).toBeEnabled();
            await expect(more).toBeInViewport({ ratio: 1 });
            expect(await more.evaluate((button) => button.scrollWidth - button.clientWidth), "toolbar menu label must not be clipped").toBeLessThanOrEqual(1);
            await more.focus();
            await page.keyboard.press("Enter");
            const menu = page.getByRole("menu");
            await expect(menu.getByRole("menuitem", { name: "版本历史与下载", exact: true })).toHaveCount(0);
            await expect(menu.getByRole("menuitem", { name: "冲突处理", exact: true })).toHaveCount(0);
            await expect(menu.getByRole("menuitem", { name: "项目活动", exact: true })).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(menu).toBeHidden();
            await expect(more).toBeFocused();
            const scheme = toolbar.getByRole("button", { name: "配置", exact: true });
            await expect(scheme).toBeEnabled();
            await expect(scheme).toBeInViewport({ ratio: 1 });
            const selectedSchemeId = await scheme.getAttribute("data-value");
            expect(selectedSchemeId).toBeTruthy();
            await scheme.focus();
            await page.keyboard.press("Enter");
            const schemeMenu = page.getByRole("menu");
            await expect(schemeMenu.getByRole("menuitemradio", { checked: true })).toHaveAttribute("data-value", selectedSchemeId!);
            await expect(schemeMenu.getByRole("menuitem", { name: /^(文件管理|查看文件)$/ })).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(schemeMenu).toBeHidden();
            await expect(scheme).toBeFocused();
          } else if (route.required.includes("rowActions")) {
            requireRowActionVisibility(collapsed.rowActions, route.path);
          }
          await testInfo.attach(`navigator-workbench-collapsed-${theme}`, {
            contentType: "image/png", body: await test.step("quality:capture", () => page.screenshot({ animations: "disabled" }))
          });
          await page.getByRole("button", { name: `展开${navigatorLabel}`, exact: true }).click();
          await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
        }
        if (route.required.includes("rowActions") || routePath.startsWith("/parameter-admin/projects/aurora")) {
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
