import { expect, test, type Page } from "playwright/test";
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

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 }
] as const;

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
  { path: "/parameter-admin", heading: "项目参数管理后台" },
  { path: "/logs", heading: "日志智能分析" },
  { path: "/debugging", heading: "页面暂时不可用" },
  { path: "/node-debugging", heading: "节点调试平台" },
  { path: "/organization", heading: "组织管理", headingScope: ".topbar-title" },
  { path: "/organization/members", heading: "组织管理", headingScope: ".topbar-title" },
  // FA-25 expansion routes.
  { path: "/parameter-home", heading: "我的工作台", headingScope: ".topbar-title" },
  { path: "/parameter-admin/projects/aurora/configuration", heading: "项目参数管理后台" },
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
  { path: "/parameter-admin", heading: "项目参数管理后台" },
  { path: "/parameter-admin/specs", heading: "项目参数管理后台" },
  { path: "/parameter-admin/modules", heading: "项目参数管理后台" },
  { path: "/parameter-admin/specs/identity-mapping", heading: "项目参数管理后台" },
  // FA-25 expansion routes.
  { path: "/parameter-home", heading: "我的工作台", headingScope: ".topbar-title" },
  { path: "/parameter-admin/projects/aurora/configuration", heading: "项目参数管理后台" },
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

  for (const viewport of viewports) {
    for (const route of routes) {
      test(`${route.path} remains usable at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route.path);
        await expectUsablePage(page);
        await settleQualityRoute(page, route.path);

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
        await page.goto(route.path);
        await expectUsablePage(page);
        await prepareInteractionSurface(page);
        await settleQualityRoute(page, route.path);

        await expect(headingLocator(page, route)).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectBoundedMainScroll(page);
        await expectBoundedInteractiveControls(page, route.controlsBudget);
        await expectVisibleFormControlAffordances(page);
      });
    }
  }

  test("mobile dialogs remain visible and contained", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/logs");
    await expectUsablePage(page);
    await prepareInteractionSurface(page);
    await page.getByRole("button", { name: /上传新日志/ }).click();

    const uploadDialog = page.getByRole("dialog", { name: "上传日志" });
    await expect(uploadDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/organization/members");
    await expectUsablePage(page);
    await prepareInteractionSurface(page);
    await page.getByRole("button", { name: "添加用户" }).click();

    const userDialog = page.getByRole("dialog", { name: "添加用户" });
    await expect(userDialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  for (const viewport of viewports) {
    test(`Xiaoze popup uses the expected ${viewport.name} presentation`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/parameters?project=aurora");
      await expectUsablePage(page);
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
