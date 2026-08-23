import { expect, test, type Page } from "playwright/test";
import {
  cleanupQualityVisualReviewFixture,
  closeXiaozePopupIfOpen,
  dismissCopilotDevOverlays,
  dismissXiaozeToggleHintIfPresent,
  expectUsablePage,
  focusViaKeyboard,
  openXiaozePopup,
  prepareInteractionSurface,
  seedQualityRuntime,
  seedQualityVisualReviewFixture,
  settleAppToasts,
  settleQualityRoute,
  settleXiaozePopupClosed,
  stableMasks,
  stabilizeOrganizationVisualClock,
  visualReviewFixtureAllowed,
  waitForFontsAndNextPaint
} from "./helpers";
import {
  annotateFailureRoute,
  VISUAL_INTERACTION_FAILURE_ROUTE,
  VISUAL_XIAOZE_FAILURE_ROUTE
} from "../shared/failureRouteMetadata";

const allowVisualReviewFixture = visualReviewFixtureAllowed();

const stableRoutes = [
  { path: "/", name: "home-shell" },
  { path: "/parameters", name: "parameters-workbench" },
  { path: "/parameter-review", name: "parameter-review-workbench" },
  { path: "/parameter-admin", name: "parameter-admin-workbench" },
  { path: "/logs", name: "logs-workbench" },
  { path: "/debugging", name: "debugging-simulator" },
  { path: "/organization", name: "organization" },
  { path: "/organization/members", name: "organization-members" },
  // FA-25 expansion: dashboard, config workbench deep link, API-mode reload
  // workbench, feedback triage, and node debugging join the visual gate.
  { path: "/parameter-home", name: "parameter-home-workbench" },
  { path: "/parameter-admin/projects/aurora/configuration", name: "project-configuration-workbench" },
  { path: "/dts-reload", name: "dts-reload-workbench" },
  { path: "/feedback-admin", name: "feedback-admin-workbench" },
  { path: "/node-debugging", name: "node-debugging-workbench" }
] as const;

async function expectLocalizedVisualReviewFixture(page: Page) {
  const detail = page.getByRole("complementary", { name: "审阅详情" });
  await expect(detail).toContainText("cccv_0");
  await expect(detail).toContainText("恒流恒压（CCCV）相关参数「cccv_0」。");

  const impact = detail.getByLabel("影响面");
  await expect(impact).toContainText("参数");
  await expect(impact).toContainText("低风险");
  await expect(impact).toContainText("将 battery0 模块的参数值从 <4500 0> 调整为 <4600 0>。");
  await expect(impact).toContainText("建议对低风险模块变更进行审阅。");

  await expect(detail).not.toContainText(/Provisional surface spec|Changes .* parameter|Low risk/);
}

test.describe("M5.11 visual quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
    if (allowVisualReviewFixture) {
      seedQualityVisualReviewFixture();
    }
  });

  test.afterAll(() => {
    if (allowVisualReviewFixture) {
      cleanupQualityVisualReviewFixture();
    }
  });

  for (const route of stableRoutes) {
    test(`keeps stable visual baseline for ${route.path}`, async ({ page }) => {
      test.skip(
        route.path === "/parameter-review" && !allowVisualReviewFixture,
        "planned target-synthetic skip: populated review visual requires an explicitly isolated fixture database"
      );
      if (route.path === "/organization") {
        await stabilizeOrganizationVisualClock(page);
      }
      await page.goto(route.path);
      await expectUsablePage(page);
      await settleQualityRoute(page, route.path);
      await closeXiaozePopupIfOpen(page);
      await settleXiaozePopupClosed(page);
      await dismissXiaozeToggleHintIfPresent(page);
      if (route.path === "/") {
        await dismissCopilotDevOverlays(page);
      }
      await settleAppToasts(page);
      if (route.path === "/parameter-review") {
        await expectLocalizedVisualReviewFixture(page);
      }

      await expect(page.locator("main, .main-content").first()).toHaveScreenshot(`${route.name}.png`, {
        mask: stableMasks(page, route.path)
      });
    });
  }

  test("keeps stable visual baseline for the Xiaoze popup", async ({ page }, testInfo) => {
    annotateFailureRoute(testInfo, VISUAL_XIAOZE_FAILURE_ROUTE);
    const popup = await openXiaozePopup(page);
    await settleAppToasts(page);

    await expect(popup).toHaveScreenshot("xiaoze-popup-open.png");
  });
});

/**
 * FA-25 interaction-state snapshots: hover / focus-visible states of the
 * shared Button, ModalDialog, and DataTable primitives. All states are staged
 * on /organization/members because that route hosts every primitive on seeded,
 * deterministic data (it already carries an unmasked full-page baseline).
 * Element-level shots target stable containers (toolbar strip, header row)
 * rather than the control itself so the 2px/2px-offset `--ring` outline is
 * not clipped by the element's own bounding box.
 */
test.describe("M5.11 interaction-state visual gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  async function openUserPermissions(page: Page) {
    await page.goto("/organization/members");
    await expectUsablePage(page);
    await prepareInteractionSurface(page);
    await expect(page.getByRole("table", { name: "平台用户" })).toBeVisible({ timeout: 20_000 });
    await settleAppToasts(page);
  }

  async function expectProductionFirstUser(page: Page) {
    const firstRow = page.getByRole("table", { name: "平台用户" }).locator("tbody tr").first();
    await expect(firstRow).toContainText("Chen Na");
    await expect(firstRow).toContainText("chen.na");
    await expect(firstRow).not.toContainText("chen@chargelab.cn");
    return firstRow;
  }

  test("captures the primary button hover state", async ({ page }, testInfo) => {
    annotateFailureRoute(testInfo, VISUAL_INTERACTION_FAILURE_ROUTE);
    await openUserPermissions(page);

    const addUser = page.getByRole("button", { name: "添加用户" });
    await addUser.hover();

    await expect(page.locator(".user-permissions-toolbar")).toHaveScreenshot("state-button-primary-hover.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the primary button keyboard focus-visible state", async ({ page }, testInfo) => {
    annotateFailureRoute(testInfo, VISUAL_INTERACTION_FAILURE_ROUTE);
    await openUserPermissions(page);

    const addUser = page.getByRole("button", { name: "添加用户" });
    await focusViaKeyboard(page, addUser);

    await expect(page.locator(".user-permissions-toolbar")).toHaveScreenshot("state-button-primary-focus-visible.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the ModalDialog open state with backdrop", async ({ page }, testInfo) => {
    annotateFailureRoute(testInfo, VISUAL_INTERACTION_FAILURE_ROUTE);
    await openUserPermissions(page);

    await page.getByRole("button", { name: "添加用户" }).click();
    await expect(page.getByRole("dialog", { name: "添加用户" })).toBeVisible();
    await expect(page.locator(".modal-backdrop")).toBeVisible();
    // Full-page shot includes sidebar/title chrome; wait out the API sync banner
    // (not aria-live, so stableMasks will not cover it) and CJK font swap.
    await expect(page.locator(".api-runtime-sync-banner")).toHaveCount(0, { timeout: 20_000 });
    await settleAppToasts(page);
    await waitForFontsAndNextPaint(page);

    await expect(page).toHaveScreenshot("state-dialog-modal-open.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the data-table row hover state", async ({ page }, testInfo) => {
    annotateFailureRoute(testInfo, VISUAL_INTERACTION_FAILURE_ROUTE);
    await openUserPermissions(page);

    const firstRow = await expectProductionFirstUser(page);
    // Hover the first (user) cell: the row background still activates via
    // `tbody tr:hover`, while the role-select cell's capability tooltip
    // (mouseenter on the role control) stays closed.
    await firstRow.locator("td").first().hover();

    await expect(firstRow).toHaveScreenshot("state-table-row-hover.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the data-table sort header keyboard focus state", async ({ page }, testInfo) => {
    annotateFailureRoute(testInfo, VISUAL_INTERACTION_FAILURE_ROUTE);
    await openUserPermissions(page);

    const table = page.getByRole("table", { name: "平台用户" });
    await expectProductionFirstUser(page);
    const sortButton = table.getByRole("button", { name: "用户", exact: true });
    await focusViaKeyboard(page, sortButton);
    await expect(table.locator("thead th").first()).toHaveAttribute("aria-sort", "none");

    await expect(table.locator("thead tr")).toHaveScreenshot("state-table-sort-header-focus.png", {
      mask: stableMasks(page)
    });
  });
});
