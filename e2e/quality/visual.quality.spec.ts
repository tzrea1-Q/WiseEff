import { expect, test, type Page } from "playwright/test";
import {
  expectUsablePage,
  focusViaKeyboard,
  openXiaozePopup,
  prepareInteractionSurface,
  seedQualityRuntime,
  settleAppToasts,
  settleQualityRoute,
  stableMasks
} from "./helpers";

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

test.describe("M5.11 visual quality gate", () => {
  test.beforeAll(() => {
    seedQualityRuntime();
  });

  for (const route of stableRoutes) {
    test(`keeps stable visual baseline for ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await expectUsablePage(page);
      await settleQualityRoute(page, route.path);
      await settleAppToasts(page);

      await expect(page.locator("main, .main-content").first()).toHaveScreenshot(`${route.name}.png`, {
        mask: stableMasks(page, route.path)
      });
    });
  }

  test("keeps stable visual baseline for the Xiaoze popup", async ({ page }) => {
    const popup = await openXiaozePopup(page);
    await settleAppToasts(page);

    await expect(popup).toHaveScreenshot("xiaoze-popup-open.png", {
      mask: stableMasks(page)
    });
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

  test("captures the primary button hover state", async ({ page }) => {
    await openUserPermissions(page);

    const addUser = page.getByRole("button", { name: "添加用户" });
    await addUser.hover();

    await expect(page.locator(".user-permissions-toolbar")).toHaveScreenshot("state-button-primary-hover.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the primary button keyboard focus-visible state", async ({ page }) => {
    await openUserPermissions(page);

    const addUser = page.getByRole("button", { name: "添加用户" });
    await focusViaKeyboard(page, addUser);

    await expect(page.locator(".user-permissions-toolbar")).toHaveScreenshot("state-button-primary-focus-visible.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the ModalDialog open state with backdrop", async ({ page }) => {
    await openUserPermissions(page);

    await page.getByRole("button", { name: "添加用户" }).click();
    await expect(page.getByRole("dialog", { name: "添加用户" })).toBeVisible();
    await settleAppToasts(page);

    await expect(page).toHaveScreenshot("state-dialog-modal-open.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the data-table row hover state", async ({ page }) => {
    await openUserPermissions(page);

    const firstRow = page.getByRole("table", { name: "平台用户" }).locator("tbody tr").first();
    // Hover the first (user) cell: the row background still activates via
    // `tbody tr:hover`, while the role-select cell's capability tooltip
    // (mouseenter on the role control) stays closed.
    await firstRow.locator("td").first().hover();

    await expect(firstRow).toHaveScreenshot("state-table-row-hover.png", {
      mask: stableMasks(page)
    });
  });

  test("captures the data-table sort header keyboard focus state", async ({ page }) => {
    await openUserPermissions(page);

    const table = page.getByRole("table", { name: "平台用户" });
    const sortButton = table.getByRole("button", { name: "用户", exact: true });
    await focusViaKeyboard(page, sortButton);
    await expect(table.locator("thead th").first()).toHaveAttribute("aria-sort", "none");

    await expect(table.locator("thead tr")).toHaveScreenshot("state-table-sort-header-focus.png", {
      mask: stableMasks(page)
    });
  });
});
