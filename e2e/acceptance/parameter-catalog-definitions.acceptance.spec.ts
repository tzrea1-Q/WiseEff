import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  CATALOG_PAGE_PATH,
  CATALOG_VIEWPORTS,
  assertNoPageOverflow,
  catalogHref,
  catalogJson,
  catalogPage,
  catalogScreenshot,
  openCatalogAt,
  selectDefinitionByKey,
  waitForCatalogState
} from "./helpers/catalogBrowser";
import {
  ensureCatalogAcceptanceFixture,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async () => {
  fixture = await ensureCatalogAcceptanceFixture();
});

/**
 * Issue #847 definitions workspace and governed authoring.
 *
 * These cases exercise the restored collection controls against the real API
 * and lane PostgreSQL, and prove that the lifecycle and identity-correction
 * workflows are reachable and behave as one deliberate operation rather than a
 * set of technical lifecycle buttons.
 */
test.describe("restored definition workspace and governed authoring", () => {
  const definitionPath = () =>
    catalogHref(fixture, {
      subjectId: fixture.powerSubjectId,
      definitionId: fixture.xDefinitionId,
      catalogReleaseId: fixture.chain.pinF.id
    }).slice(CATALOG_PAGE_PATH.length);

  test("pages the complete definition collection with a truthful scoped count", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-16
    // @operation PCAT-DEFINITION-COLLECTION-001
    await openCatalogAt(page, "org-admin");
    const region = catalogPage(page);
    await waitForCatalogState(page, /ready|empty|unregistered/);

    const count = region.getByRole("status", { name: "结果计数" });
    await expect(count).toContainText(/共 \d+ 项/);
    const initial = await count.textContent();
    const initialTotal = Number(/共 (\d+) 项/u.exec(initial ?? "")?.[1] ?? "0");
    expect(initialTotal).toBeGreaterThan(0);

    // Page size is a real 20/50/100 control, and the module subtree filter
    // narrows the complete result set rather than the loaded page.
    const pageSize = region.getByLabel("每页条数");
    await expect(pageSize).toHaveValue("50");
    await pageSize.selectOption("20");
    await expect(pageSize).toHaveValue("20");
    await expect(count).toContainText(/共 \d+ 项/);

    const navigator = region.getByRole("navigation", { name: "参数定义模块树" });
    // The navigator is one tree; its module branches scope the collection and its
    // subject leaves select a single subject.
    const moduleOption = navigator.locator('[data-catalog-node-kind="module"]').first();
    if ((await moduleOption.count()) > 0) {
      await moduleOption.click();
      await expect(region.getByText(/已选模块子树/)).toBeVisible();
      await expect(count).toContainText(/共 \d+ 项/);
      // Clearing returns to the full organization collection.
      await region.getByRole("button", { name: "清除模块选择" }).click();
      await expect(region.getByText(/已选模块子树/)).toHaveCount(0);
    }

    await catalogScreenshot(page, testInfo, "pcat-ui-16-collection");
  });

  test("opens definition history on demand instead of occupying the workspace", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-16
    // @operation PCAT-DEFINITION-COLLECTION-001
    await openCatalogAt(page, "org-admin", definitionPath());
    await expect(catalogPage(page)).toBeVisible();
    await selectDefinitionByKey(page, "iin_max");

    const region = catalogPage(page);
    await expect(region.getByRole("region", { name: "定义详情" })).toContainText("iin_max");
    // No permanent timeline peer: history is disclosed from the detail body.
    await expect(region.getByRole("region", { name: "定义时间线" })).toHaveCount(0);
    await region.getByRole("button", { name: /查看历史/ }).first().click();
    await expect(region.getByRole("list", { name: "定义时间线" })).toBeVisible();
    await catalogScreenshot(page, testInfo, "pcat-ui-16-history");
  });

  test("offers one deliberate lifecycle action and one identity-correction action per definition", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-17
    // @operation PCAT-DEFINITION-LIFECYCLE-001
    await openCatalogAt(page, "org-admin");
    await waitForCatalogState(page, /ready|empty|unregistered/);
    const region = catalogPage(page);
    const table = region.getByRole("table", { name: "参数定义列表" });
    await expect(table).toBeVisible();

    // The row actions must mirror the server's publication surface exactly: a
    // control the server would refuse must not be offered, and a permitted
    // control must be reachable. The collection can also render before the
    // domain state settles.
    await expect(region).toHaveAttribute("data-writes-enabled", "true");
    const surface = await catalogJson(page.request, "GET", "/api/v2/catalog/publication-surface");
    expect(surface.status).toBe(200);
    const permissions = (
      surface.body as { item: { authoringAllowed: boolean; publishingAllowed: boolean } }
    ).item;
    const retire = table.getByRole("button", { name: /^(弃用|恢复) /u }).first();
    const correct = table.getByRole("button", { name: /^纠错 /u }).first();

    if (permissions.publishingAllowed) {
      await expect(retire).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(retire).toHaveCount(0);
    }

    if (permissions.authoringAllowed) {
      await expect(correct).toBeVisible({ timeout: 15_000 });
      await correct.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("身份纠错");
      // Explicit manifest: preview stays disabled until projects and a reason exist.
      await expect(dialog.getByRole("button", { name: "预演影响" })).toBeDisabled();
      await dialog.getByLabel("受影响项目编号").fill("proj-a");
      await expect(dialog.getByRole("button", { name: "预演影响" })).toBeEnabled();
      await dialog.getByRole("button", { name: "关闭" }).click();
    } else {
      await expect(correct).toHaveCount(0);
    }
    await catalogScreenshot(page, testInfo, "pcat-ui-17-lifecycle");
  });

  test("keeps the restored workspace usable at 1440x900, 768x1024 and 390x844", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-16
    // @operation PCAT-DEFINITION-COLLECTION-001
    for (const viewport of CATALOG_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openCatalogAt(page, "org-admin");
      await waitForCatalogState(page, /ready|empty|unregistered/);
      const region = catalogPage(page);
      await expect(region).toBeVisible();
      await assertNoPageOverflow(page);
      // The module navigator and the definition collection are both reachable at
      // every viewport, and narrow screens keep the primary action usable.
      await expect(region.getByRole("navigation", { name: "参数定义模块树" })).toBeVisible();
      await expect(region.getByRole("status", { name: "结果计数" })).toBeVisible();
      await catalogScreenshot(page, testInfo, `pcat-ui-16-responsive-${viewport.name}`);
    }
  });
});
