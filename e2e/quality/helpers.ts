import { expect, test, type Locator, type Page } from "playwright/test";
import { runNpmScript } from "../acceptance/helpers/database";
import { resolveVisualMasks } from "../../scripts/quality-visual-mask-resolution";
import { parseParameterAdminModulesSubView } from "../../src/application/parameters/parameterAdminOrganizationPath";
import {
  assertVisualReviewFixtureConfigured,
  visualReviewFixtureConfigured
} from "../../scripts/quality-visual-review-authorization";

const runtimeCrashPattern =
  /Application error|Cannot read properties|ReferenceError|TypeError|Unhandled Runtime Error|vite\/client|failed to fetch/i;

let qualitySeeded = false;

export function visualReviewFixtureAllowed() {
  return visualReviewFixtureConfigured();
}

function assertVisualReviewFixtureAllowed() {
  assertVisualReviewFixtureConfigured();
}

export function seedQualityRuntime(runScript: (script: string) => void = runNpmScript) {
  if (qualitySeeded || process.env.WISEEFF_QUALITY_SKIP_SEED === "true") {
    return;
  }

  runScript("seed:browser");
  qualitySeeded = true;
}

export function seedQualityVisualReviewFixture() {
  assertVisualReviewFixtureAllowed();
  runNpmScript("seed:quality:visual-review");
}

export function cleanupQualityVisualReviewFixture() {
  assertVisualReviewFixtureAllowed();
  runNpmScript("cleanup:quality:visual-review");
}

export async function expectUsablePage(page: Page) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".auth-screen")).toHaveCount(0);
  await expect(page.locator("main, .main-content").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(runtimeCrashPattern);
}

/**
 * Deterministically clear the global toast layer before a screenshot.
 * Runtime-connect notifications are timing-dependent (they auto-dismiss after
 * ~4s), so a visual baseline must never race them: dismiss whatever is showing
 * and wait for the queue to drain.
 */
export async function settleAppToasts(page: Page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  const toast = page.locator(".toast");
  while (Date.now() < deadline) {
    if ((await toast.count()) === 0) {
      return;
    }
    const close = page.locator(".toast__close").first();
    if ((await close.count()) > 0) {
      await close.click({ timeout: 1_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(150);
  }
  await expect(toast).toHaveCount(0);
}

export async function dismissCopilotDevOverlays(page: Page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("cpk-web-inspector")) {
      element.remove();
    }
  });
}

export async function closeXiaozePopupIfOpen(page: Page) {
  const popup = page.getByTestId("xiaoze-popup-layer");
  if (!(await popup.isVisible().catch(() => false))) {
    return;
  }

  // The initial-open policy can concurrently detach this control while setup
  // is closing the popup. Dispatch on whichever owned close control currently
  // exists instead of letting locator actionability retries consume the test
  // timeout; a concurrent policy close is also a successful outcome.
  const deadline = Date.now() + 10_000;
  while ((await popup.isVisible().catch(() => false)) && Date.now() < deadline) {
    await page.evaluate(() => {
      const layer = document.querySelector('[data-testid="xiaoze-popup-layer"]');
      const button = layer?.querySelector('[data-testid="copilot-close-button"]');
      if (button instanceof HTMLElement) {
        button.click();
      }
    });
    await page.waitForTimeout(100);
  }
  await expect(popup).toBeHidden({ timeout: 10_000 });
}

export async function settleXiaozePopupClosed(page: Page, timeoutMs = 15_000) {
  await expect(page.getByTestId("xiaoze-popup-readiness")).toHaveAttribute("data-state", "closed", { timeout: timeoutMs });
  await expect(page.getByTestId("xiaoze-popup-layer")).toBeHidden();
}

export async function dismissXiaozeToggleHintIfPresent(page: Page, timeoutMs = 15_000) {
  const hint = page.getByTestId("xiaoze-toggle-hint");
  const readiness = page.getByTestId("xiaoze-toggle-hint-readiness");
  if (await readiness.count() === 0) {
    await expect(hint).toBeHidden();
    return;
  }
  await expect(readiness).toHaveAttribute("data-state", /^(revealed|suppressed)$/, { timeout: timeoutMs });

  if (await hint.isVisible()) {
    await test.step("quality:readiness", () => settleAppToasts(page));
    await hint.getByRole("button", { name: "不再提示" }).click();
    await expect(readiness).toHaveAttribute("data-state", "suppressed");
  }
  await expect(hint).toBeHidden();
}

export async function prepareInteractionSurface(page: Page) {
  await dismissCopilotDevOverlays(page);
  await test.step("quality:readiness", () => closeXiaozePopupIfOpen(page));
  await test.step("quality:readiness", () => settleXiaozePopupClosed(page));
  await test.step("quality:readiness", () => dismissXiaozeToggleHintIfPresent(page));
  await dismissCopilotDevOverlays(page);
}

export async function openXiaozePopup(page: Page, route = "/parameters?project=aurora") {
  await test.step("quality:navigation", () => page.goto(route, { waitUntil: "domcontentloaded" }));
  await test.step("quality:readiness", () => expectUsablePage(page));

  const toggle = page.getByTestId("copilot-chat-toggle");
  await expect(toggle).toBeVisible();

  const popup = page.getByTestId("xiaoze-popup-layer");
  if ((await toggle.getAttribute("data-state")) !== "open") {
    const hintDismiss = page.locator(".xiaoze-toggle-hint__dismiss");
    if (await hintDismiss.isVisible().catch(() => false)) {
      await hintDismiss.click();
    }
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute("data-state", "open", { timeout: 15_000 });
  await expect(popup).toBeVisible({ timeout: 15_000 });
  return popup;
}

/**
 * Move keyboard focus onto the target by pressing Tab until it becomes the
 * active element. Script `locator.focus()` does not reliably match
 * `:focus-visible` (Chromium keys the pseudo-class on keyboard modality), so
 * focus-state snapshots must arrive at the element the way a keyboard user
 * does.
 */
export async function focusViaKeyboard(page: Page, target: Locator, maxTabs = 80) {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error(`Keyboard focus did not reach the target within ${maxTabs} tabs.`);
}

const ORGANIZATION_VISUAL_CREATED_AT = "2026-08-19T03:53:01.000Z";

/**
 * Keep the organization profile's creation clock visible while making the
 * screenshot independent of the fresh database's migration timestamp. Only
 * the read response used by this page is normalized; the database is untouched.
 */
export async function stabilizeOrganizationVisualClock(page: Page) {
  await page.route("**/api/v1/organization", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      organization?: Record<string, unknown>;
    };
    if (!body.organization) {
      throw new Error("Organization visual clock requires the organization API response.");
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        organization: {
          ...body.organization,
          createdAt: ORGANIZATION_VISUAL_CREATED_AT
        }
      }
    });
  });
}

export async function stableMasks(page: Page, routePath = ""): Promise<Locator[]> {
  const optionalMasks = [
    page.locator(".topbar-user-menu"),
    page.locator(".operation-history-list"),
    page.locator(".audit-column"),
    page.locator("[aria-live]")
  ];
  const masks: Locator[] = [];

  if (routePath === "/parameters") {
    masks.push(page.locator(".dts-parameter-workbench-table, .dts-workbench-list"));
  }

  if (routePath === "/parameter-admin/projects") {
    masks.push(page.getByRole("table", { name: "项目管理列表" }).locator('td[data-label="最近更新"]'));
  }

  if (routePath === "/feedback-admin") {
    masks.push(page.getByRole("table", { name: "产品反馈记录" }).locator('td[data-label="最近更新"]'));
  }

  if (routePath === "/parameter-admin") {
    // Only the optional status banner is masked; the populated workbench remains visually compared.
    optionalMasks.push(page.locator(".parameter-catalog__banner"));
  }

  if (routePath === "/parameter-home") {
    // Governance trend chart: the x-axis date labels (and the fallback table
    // inside the same <figure>) are bucketed from "today", so they shift with
    // the calendar day the suite runs on. KPI numbers and hotspot cards come
    // from the freshly seeded window and stay stable, so only the chart moves.
    masks.push(page.locator(".parameter-home__chart-shell"));
  }

  if (routePath === "/parameter-review") {
    masks.push(page.getByRole("table", { name: "审阅队列" }).getByRole("row", { selected: true }).locator("time"));
  }

  if (routePath === "/dts-reload" || routePath === "/node-debugging") {
    // Bridge install guide: the API mints a fresh random 6-digit pairing code
    // on every page load; mask its digits and expiry, not the guide or controls.
    optionalMasks.push(page.locator(".local-device-bridge-panel__pairing-code code, .local-device-bridge-panel__pairing-code time"));
  }

  if (routePath === "/logs") {
    // Raw-log timestamps come from the seed fixture today, but the column is
    // the same surface that would show relative "N 分钟前" / clock-skewed ISO
    // if a later hydrate reformats capturedAt. Metadata's captured-at cell is
    // the other clock-bound label (hidden on the default History tab).
    if (!await page.locator(".log-error-alert").isVisible()) {
      masks.push(page.locator(".rawlog-table__time"));
    }
    optionalMasks.push(page.locator(".logs-metadata-list dd"));
    // Inline width on the fill can still interpolate a frame even with
    // screenshot animations disabled; mask the bar, not the workbench.
    optionalMasks.push(page.locator(".confidence-bar i"));
  }

  return resolveVisualMasks(masks, optionalMasks);
}

/**
 * Wait until webfonts are loaded and two animation frames have committed.
 * Playwright already tries to wait for fonts at screenshot time; an explicit
 * ready + double-rAF still absorbs CJK fallback swaps and late layout.
 */
export async function waitForFontsAndNextPaint(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

/**
 * Route-specific readiness waits for the quality routes added by FA-25. These
 * pages stream API data after first paint (dashboard sections, the bridge
 * install guide with its async pairing code, seeded tables), so screenshots
 * and axe scans must wait for the settled state instead of racing skeletons.
 * Routes without an entry settle through the generic page checks alone.
 */
export async function settleQualityRoute(page: Page, routePath: string, options: { readOnly?: boolean } = {}) {
  const timeout = 20_000;

  if (["/parameter-admin", "/parameter-admin/specs", "/parameter-admin/identity-mapping", "/parameter-admin/specs/identity-mapping"].includes(routePath.split("?")[0])) {
    await expect(page.getByTestId("organization-specs-readiness")).toHaveAttribute("data-state", /^(ready|error)$/, { timeout });
  }

  if (/^\/parameter-admin\/modules(?:\/(?:queue|registry))?\/?$/.test(routePath.split("?")[0])) {
    const location = new URL(page.url());
    const subView = parseParameterAdminModulesSubView(location.pathname, location.search);
    const panel = page.locator(".parameter-module-mapping-panel");
    await expect(panel).toBeVisible({ timeout });
    if (subView === "queue") {
      // The loaded count is rendered only after the authorized discovery response, including an empty page.
      await expect(panel.getByRole("region", { name: "来源识别结果" }).getByText(/^已加载 \d+ 条，匹配 \d+ 条/)).toBeVisible({ timeout });
    } else if (subView === "registry") {
      await expect(panel.getByRole("region", { name: "历史驱动注册表" })).toHaveAttribute("aria-busy", "false", { timeout });
      await expect(panel.getByRole("table", { name: "历史驱动注册表" })).toBeVisible({ timeout });
    } else {
      await expect(panel.getByRole("tree", { name: "模块归属树" })).toBeVisible({ timeout });
      // This count appears only after every subject and registration page has loaded successfully.
      await expect(panel.getByRole("region", { name: "规范主体归属" }).getByText(/^\d+ 个有效主体。/)).toBeVisible({ timeout });
    }
    for (const label of ["正在加载规范主体…", "正在读取发现结果…", "正在加载历史驱动注册表…"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0, { timeout });
    }
    await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
    return;
  }

  if (routePath === "/parameter-home") {
    // The trend panel swaps its loading skeleton for the chart once the
    // dashboard summary API answers.
    await expect(page.locator(".parameter-home__chart-shell")).toBeVisible({ timeout });
    return;
  }

  if (routePath === "/parameter-admin/projects/aurora/review-roles") {
    const form = page.getByRole("form", { name: "项目审核角色设置", exact: true });
    await expect(form).toHaveAttribute("aria-busy", "false", { timeout });
    await expect(form.getByRole("heading", { name: / 项目审核角色配置$/ })).toBeVisible({ timeout });
    await expect(form.getByRole("group", { name: "审核职责候选池", exact: true }).getByRole("article")).toHaveCount(3, { timeout });
    await expect(form.getByRole("heading", { name: "组织成员职责授权", exact: true })).toBeVisible({ timeout });
    await expect(form.getByRole("table", { name: "组织成员职责授权", exact: true })).toBeVisible({ timeout });
    return;
  }

  if (routePath === "/parameter-admin/projects/aurora" || routePath.startsWith("/parameter-admin/projects/aurora/")) {
    // The deep link resolves the seeded config set + file, then renders the
    // source canvas with the seeded aurora DTS baseline.
    await expect(page.getByText("aurora-board.dts").first()).toBeVisible({ timeout });
    return;
  }

  if (routePath === "/log-admin" || routePath === "/debugging-admin/nodes") {
    await expect(page.locator(".api-runtime-sync-banner")).toHaveCount(0, { timeout });
    await expect(page.locator(".api-runtime-error-banner")).toHaveCount(0, { timeout });
    if (routePath === "/log-admin") {
      const collection = new URL(page.url()).searchParams.get("tab");
      if (!collection || collection === "overview") {
        await expect(page.getByTestId("log-admin-overview")).toHaveAttribute("aria-busy", "false", { timeout });
        await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
        return;
      }
      if (collection === "skills" || collection === "quality") {
        await expect(page.getByTestId(collection === "skills" ? "log-domain-governance" : "feedback-quality-insights")).toHaveAttribute("aria-busy", "false", { timeout });
        await expect(page.getByRole("table", { name: collection === "skills" ? "分析技能列表" : "分析质量反馈聚合" })).toBeVisible({ timeout });
        await expect(page.getByText("正在加载反馈数据…", { exact: true })).toHaveCount(0, { timeout });
        await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
        return;
      }
      // The default time window may exclude the seeded logs, so settle on either a seeded row or the loaded empty row.
      const records = page.getByRole("table", { name: "日志分析记录" });
      await expect(records.getByText("charging-foldback.log").or(records.getByText("当前时间窗口内暂无日志")).first()).toBeVisible({ timeout });
    } else if (routePath === "/debugging-admin/nodes") {
      await expect(page.locator(".debug-admin-library-table")).toHaveAttribute("aria-busy", "false", { timeout });
      await expect(page.getByRole("table", { name: "可调节点目录" }).getByText("Cycle count", { exact: true })).toBeVisible({ timeout });
    }
    await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
    return;
  }

  if (routePath === "/knowledge-admin") {
    await expect(page.getByRole("tabpanel").getByRole("table")).toBeVisible({ timeout });
    await expect(page.getByRole("tabpanel").getByText(/^正在加载/)).toHaveCount(0, { timeout });
    await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
    return;
  }

  if (routePath === "/dts-reload" || routePath === "/node-debugging") {
    // Seeded rows can render while runtime hydration still makes the page inert.
    await expect(page.getByRole("main")).toHaveAttribute("data-runtime-state", "ready", { timeout });
    // Wait for readiness to settle without assuming every user needs setup.
    // Returning users and connected users have no inline installer content.
    await expect(page.locator(".local-device-bridge-panel__readiness[aria-busy='false'], .local-device-bridge-panel__connected").first()).toBeVisible({ timeout });
    await expect(page.getByText("正在生成配对码...")).toHaveCount(0, { timeout });
    if (routePath === "/dts-reload") {
      // The seeded reload workbench (tree + table + history) loads below the wizard.
      await expect(page.getByText("运行历史").first()).toBeVisible({ timeout });
    } else {
      const table = page.getByRole("region", { name: "节点调试参数", exact: true }).getByRole("table");
      await expect(table.locator('tbody td[data-label="参数名称"] strong').first()).toBeVisible({ timeout });
    }
    return;
  }

  if (routePath === "/feedback-admin" || routePath === "/knowledge") {
    const name = routePath === "/knowledge" ? "知识条目列表" : "产品反馈记录";
    await expect(page.getByRole("table", { name }).locator("tbody .row-action-menu")
      .getByRole("button", { name: "查看", exact: true }).first()).toBeVisible({ timeout });
    return;
  }

  if (routePath === "/logs") {
    // API mode boots with an empty logs slice; the screenshot used to race
    // HYDRATE_LOG_RUNTIME (empty state vs the seeded workbench). Wait for both
    // M2 seed rows. captured_at desc selects unsupported.bin first, so the
    // primary pane settles on the failure alert rather than the completed
    // foldback analysis.
    //
    // The empty placeholder also renders "日志处理失败", so filename text
    // plus the title is not enough: pin the selected history row, drain the
    // in-main sync banner (not aria-live, so it is not globally masked), then
    // fonts + a paint, then confirm the alert stayed up.
    await expect(page.getByText("charging-foldback.log").first()).toBeVisible({ timeout });
    await expect(page.getByText("unsupported.bin").first()).toBeVisible({ timeout });
    const failureAlert = page.locator(".log-error-alert").filter({ hasText: "日志处理失败" });
    await expect(failureAlert).toBeVisible({ timeout });
    await expect(page.locator(".history-item.active")).toContainText("unsupported.bin", { timeout });
    await expect(page.locator(".api-runtime-sync-banner")).toHaveCount(0, { timeout });
    await test.step("quality:readiness", () => waitForFontsAndNextPaint(page));
    await expect.poll(async () => failureAlert.isVisible(), { timeout: 5_000 }).toBe(true);
    await expect(failureAlert).toContainText("在日志解析阶段失败");
    await expect(failureAlert).toContainText(".log .txt .csv .json");
    await expect(failureAlert.getByText("unsupported.bin", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "分析流程" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "分析结果" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "原始日志" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "日志分析证据链" })).toHaveCount(0);
  }
}

export async function expectNoHorizontalOverflow(page: Page, tolerancePx = 2) {
  const overflow = await page.evaluate(() => {
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0
    );
    return documentWidth - window.innerWidth;
  });

  expect(overflow).toBeLessThanOrEqual(tolerancePx);
}

export async function expectBoundedMainScroll(
  page: Page,
  options: { maxViewportMultiples?: number } = {}
) {
  const maxViewportMultiples = options.maxViewportMultiples ?? 4;
  const metrics = await page.evaluate(() => {
    const main = document.querySelector("main, .main-content");
    const viewportHeight = window.innerHeight;
    if (!main) {
      return { scrollHeight: 0, viewportHeight };
    }
    return { scrollHeight: main.scrollHeight, viewportHeight };
  });

  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight * maxViewportMultiples);
}

export async function expectBoundedInteractiveControls(
  page: Page,
  options: { maxControls?: number; maxOptions?: number } = {}
) {
  const maxControls = options.maxControls ?? 200;
  const maxOptions = options.maxOptions ?? 500;
  const counts = await page.evaluate(() => {
    const main = document.querySelector("main, .main-content");
    if (!main) {
      return { controls: 0, options: 0 };
    }

    const controls = main.querySelectorAll(
      "button, input, select, textarea, [role='button'], [role='combobox']"
    ).length;
    const options = main.querySelectorAll("option").length;
    return { controls, options };
  });

  expect(counts.controls).toBeLessThanOrEqual(maxControls);
  expect(counts.options).toBeLessThanOrEqual(maxOptions);
}

export async function expectVisibleFormControlAffordances(page: Page) {
  const missingAffordances = await page.evaluate(() => {
    const main = document.querySelector("main, .main-content");
    if (!main) {
      return [] as string[];
    }

    const hasOwnAffordance = (element: Element) => {
      const style = window.getComputedStyle(element);
      const borderVisible =
        style.borderTopStyle !== "none" &&
        style.borderRightStyle !== "none" &&
        style.borderBottomStyle !== "none" &&
        style.borderLeftStyle !== "none" &&
        (parseFloat(style.borderTopWidth) > 0 ||
          parseFloat(style.borderRightWidth) > 0 ||
          parseFloat(style.borderBottomWidth) > 0 ||
          parseFloat(style.borderLeftWidth) > 0);
      const background = style.backgroundColor;
      const hasBackground =
        background !== "transparent" &&
        background !== "rgba(0, 0, 0, 0)" &&
        background !== "";
      const hasShadow = style.boxShadow !== "none";
      return borderVisible || hasBackground || hasShadow;
    };

    /** Nested search fields put chrome on the wrapper (e.g. `.search-field`). */
    const hasAncestorAffordance = (element: Element) => {
      let current = element.parentElement;
      let depth = 0;
      while (current && current !== main && depth < 4) {
        if (hasOwnAffordance(current)) return true;
        current = current.parentElement;
        depth += 1;
      }
      return false;
    };

    const failures: string[] = [];
    const controls = main.querySelectorAll("input:not([type='hidden']), select, textarea");

    for (const control of controls) {
      const element = control as HTMLInputElement;
      if (!element.offsetParent) {
        continue;
      }

      const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
      // Native checkbox/radio already have platform chrome; do not require CSS borders.
      if (inputType === "checkbox" || inputType === "radio") {
        continue;
      }

      if (!hasOwnAffordance(element) && !hasAncestorAffordance(element)) {
        failures.push(
          element.getAttribute("aria-label") ??
            element.getAttribute("name") ??
            element.getAttribute("id") ??
            element.tagName.toLowerCase()
        );
      }
    }

    return failures;
  });

  expect(missingAffordances).toEqual([]);
}
