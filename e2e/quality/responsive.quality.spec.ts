import { expect, test, type Page } from "playwright/test";
import { qualityViewports } from "../../scripts/quality-viewport-profile";
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

// PC-first by default; compatibility sweeps require an explicit profile.
const viewports = qualityViewports(process.env.WISEEFF_QUALITY_VIEWPORT_PROFILE);
const dialogViewport = viewports.find((viewport) => viewport.name === "mobile") ?? viewports[0];

type QualityRoute = {
  path: string;
  heading: string;
  /**
   * Selector to scope the heading lookup. Needed when the page title reuses
   * the sidebar nav label verbatim: at tablet/mobile the collapsed sidebar
   * keeps the (hidden) nav text in the DOM, so an unscoped first() match
   * would assert against the hidden nav item instead of the visible title.
   */
  headingScope?: string;
};

const routes: QualityRoute[] = [
  { path: "/parameters", heading: "项目参数用户工作台" },
  { path: "/parameter-review", heading: "参数管理员工作台" },
  { path: "/parameter-admin", heading: "参数管理后台" },
  { path: "/logs", heading: "日志智能分析" },
  { path: "/debugging", heading: "页面暂时不可用" },
  { path: "/node-debugging", heading: "节点调试平台" },
  { path: "/organization", heading: "组织管理", headingScope: ".topbar-title" },
  { path: "/organization/members", heading: "组织管理", headingScope: ".topbar-title" },
  // FA-25 expansion routes.
  { path: "/parameter-home", heading: "我的工作台", headingScope: ".topbar-title" },
  { path: "/parameter-admin/projects/aurora/configuration", heading: "参数管理后台" },
  { path: "/dts-reload", heading: "参数调试", headingScope: ".topbar-title" },
  { path: "/feedback-admin", heading: "产品反馈管理" }
];

type LayoutBudgetRoute = QualityRoute & {
  /**
   * Route-scoped control budget override. The helper defaults stay the global
   * gate; a dense seeded workbench may declare its own deterministic ceiling
   * here instead of loosening the shared assertion.
   */
  controlsBudget?: { maxControls?: number; maxOptions?: number };
};

const layoutBudgetRoutes: LayoutBudgetRoute[] = [
  { path: "/parameter-admin", heading: "参数管理后台" },
  { path: "/parameter-admin/specs", heading: "参数管理后台" },
  { path: "/parameter-admin/modules", heading: "参数管理后台" },
  { path: "/parameter-admin/specs/identity-mapping", heading: "参数管理后台" },
  // FA-25 expansion routes.
  { path: "/parameter-home", heading: "我的工作台", headingScope: ".topbar-title" },
  { path: "/parameter-admin/projects/aurora/configuration", heading: "参数管理后台" },
  {
    path: "/dts-reload",
    heading: "参数调试",
    headingScope: ".topbar-title",
    // The seeded DTS parameter tree plus the reload workbench table render
    // ~260 controls at every viewport; that count is seed-fixed, so this route
    // carries its own ceiling while the 200-control default keeps guarding the
    // rest of the app.
    controlsBudget: { maxControls: 320 }
  },
  { path: "/feedback-admin", heading: "产品反馈管理" },
  { path: "/node-debugging", heading: "节点调试平台" }
];

function headingLocator(page: Page, route: QualityRoute) {
  const scope = route.headingScope ? page.locator(route.headingScope) : page;
  return scope.getByText(route.heading, { exact: true }).first();
}

test.describe("M5.11 responsive quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  test("/log-dashboard has empty quantitative marks and readable trend dates at desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date("2099-10-10T12:00:00"));
    const logsLoaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/logs" && response.request().method() === "GET" && response.ok()
    );
    await test.step("quality:navigation", () => page.goto("/log-dashboard"));
    await logsLoaded;
    await test.step("quality:readiness", () => expectUsablePage(page));
    await test.step("quality:readiness", () => settleQualityRoute(page, "/log-dashboard"));
    await expect(page.locator(".api-runtime-sync-banner")).toHaveCount(0);

    const dashboard = page.getByRole("region", { name: "日志分析核心指标", exact: true });
    // Four panel verdicts plus the failure-record card.
    await expect(dashboard.getByText("暂无样本，无法判断", { exact: true })).toHaveCount(5);
    await expect(dashboard.getByText("今日覆盖 0 份日志。", { exact: true })).toBeVisible();
    await expect(dashboard.getByText(/处理队列稳定|质量表现稳定|无需人工介入|所有日志均进入正常分析流程|当前队列正常/)).toHaveCount(0);

    const marks = dashboard.locator(".topic-line-chart__bar i, .topic-stack-bar i, .topic-quality-bands i, .topic-score-meter > span, .topic-capacity-structure > i > span, .topic-capacity-rank i");
    expect(await marks.evaluateAll((elements) => elements.every((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width === 0 || bounds.height === 0;
    }))).toBe(true);

    const dates = dashboard.locator(".topic-line-chart__time");
    await expect(dates).toHaveCount(7);
    expect(await dates.evaluateAll((elements) => elements.every((element) =>
      element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
    ))).toBe(true);
  });

  for (const viewport of viewports) {
    for (const route of routes) {
      test(`${route.path} remains usable at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await test.step("quality:navigation", () => page.goto(route.path));
        await test.step("quality:readiness", () => expectUsablePage(page));
        await test.step("quality:readiness", () => settleQualityRoute(page, route.path));

        await expect(headingLocator(page, route)).toBeVisible();
        await expect(page.locator("main, .main-content").first().locator("button").first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  }

  for (const viewport of viewports) {
    for (const route of layoutBudgetRoutes) {
      test(`${route.path} stays within layout budget at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await test.step("quality:navigation", () => page.goto(route.path));
        await test.step("quality:readiness", () => expectUsablePage(page));
        await test.step("quality:readiness", () => prepareInteractionSurface(page));
        await test.step("quality:readiness", () => settleQualityRoute(page, route.path));

        await expect(headingLocator(page, route)).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectBoundedMainScroll(page);
        await expectBoundedInteractiveControls(page, route.controlsBudget);
        await expectVisibleFormControlAffordances(page);
      });
    }
  }

  test(`${dialogViewport.name} dialogs remain visible and contained`, async ({ page }) => {
    await page.setViewportSize({ width: dialogViewport.width, height: dialogViewport.height });
    await test.step("quality:navigation", () => page.goto("/logs"));
    await test.step("quality:readiness", () => expectUsablePage(page));
    await test.step("quality:readiness", () => prepareInteractionSurface(page));
    await page.getByRole("button", { name: /上传新日志/ }).click();

    const uploadDialog = page.getByRole("dialog", { name: "上传日志" });
    await expect(uploadDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await test.step("quality:navigation", () => page.goto("/organization/members"));
    await test.step("quality:readiness", () => expectUsablePage(page));
    await test.step("quality:readiness", () => prepareInteractionSurface(page));
    await page.getByRole("button", { name: "添加用户" }).click();

    const userDialog = page.getByRole("dialog", { name: "添加用户" });
    await expect(userDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await userDialog.getByRole("button", { name: "取消", exact: true }).click();

    await page.getByRole("button", { name: /^查看 .+ 的成员资料$/ }).first().click();
    const memberDialog = page.getByRole("dialog", { name: / · 成员资料$/ });
    const roleSelector = memberDialog.getByRole("combobox", { name: /调整 .+ 的角色/ });
    await expect(roleSelector).toBeVisible();
    const { roleBounds, containerBounds } = await roleSelector.evaluate((element) => {
      const container = element.closest('section[aria-label="组织角色与权限"]');
      return {
        roleBounds: { width: element.getBoundingClientRect().width },
        containerBounds: container ? { width: container.getBoundingClientRect().width } : null
      };
    });
    expect(roleBounds).not.toBeNull();
    expect(containerBounds).not.toBeNull();
    expect(Math.abs(roleBounds!.width - containerBounds!.width)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
  });

  for (const viewport of viewports) {
    test(`Xiaoze popup uses the expected ${viewport.name} presentation`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await test.step("quality:navigation", () => page.goto("/parameters?project=aurora"));
      await test.step("quality:readiness", () => expectUsablePage(page));
      const toggle = page.getByTestId("copilot-chat-toggle");
      if ((await toggle.getAttribute("data-state")) !== "open") {
        const hintDismiss = page.locator(".xiaoze-toggle-hint__dismiss");
        if (await hintDismiss.isVisible().catch(() => false)) {
          await hintDismiss.click();
        }
        await toggle.click();
      }

      const layer = page.getByTestId("xiaoze-popup-layer");
      const popup = page.getByTestId("copilot-popup");
      await expect(popup).toBeVisible();
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => {
          const iterations = animation.effect?.getComputedTiming().iterations;
          return iterations === Infinity || animation.playState === "finished" || animation.playState === "idle";
        })
      );
      const box = await popup.boundingBox();
      if (!box) {
        throw new Error("Xiaoze popup has no responsive bounding box.");
      }

      if (viewport.name === "mobile") {
        await expect(layer).toHaveAttribute("data-presentation", "modal");
        await expect(popup).toHaveAttribute("aria-modal", "true");
        expect(box.x).toBeCloseTo(0, 3);
        expect(box.y).toBeCloseTo(0, 3);
        expect(box.width).toBeCloseTo(viewport.width, 3);
        expect(box.height).toBeCloseTo(viewport.height, 3);
        await expect(page.getByRole("button", { name: "拖动小泽窗口" })).toHaveCount(0);
        await expect(page.locator("[data-xiaoze-mobile-brand]")).toContainText("小泽");
        await expect(page.getByRole("button", { name: "调整小泽窗口大小" })).toBeHidden();
      } else {
        await expect(layer).toHaveAttribute("data-presentation", "modeless");
        await expect(popup).not.toHaveAttribute("aria-modal");
        expect(box.x).toBeGreaterThanOrEqual(16);
        expect(box.y).toBeGreaterThanOrEqual(16);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 16);
        await expect(page.getByRole("button", { name: "拖动小泽窗口" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "调整小泽窗口大小" })).toBeVisible();
      }
    });
  }
});
