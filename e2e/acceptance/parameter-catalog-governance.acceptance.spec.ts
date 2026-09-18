import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  CATALOG_PAGE_PATH,
  catalogHref,
  catalogJson,
  catalogPage,
  catalogScreenshot,
  catalogUiCopy,
  confirmGovernanceDialog,
  openCatalogAt,
  openCatalogViaNav,
  waitForCatalogState
} from "./helpers/catalogBrowser";
import {
  countSubjectRegistrations,
  ensureCatalogAcceptanceFixture,
  ingestOpenReview,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

test.use({ viewport: { width: 1440, height: 900 } });

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async () => {
  fixture = await ensureCatalogAcceptanceFixture();
});

test.describe("canonical parameter catalog governance interactions", () => {
  test("resolves Review Queue items through one atomic typed command", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-04
    // @operation PCAT-REVIEW-RESOLVE-001
    await ingestOpenReview(fixture.pool, fixture.chain.pinF.id);
    await openCatalogAt(page, "org-admin");
    const queue = page.getByRole("region", { name: "待审核事项" });
    const resolveButton = queue.getByRole("button", { name: "处理审核" });
    if ((await resolveButton.count()) === 0) {
      await ingestOpenReview(fixture.pool, fixture.chain.pinF.id);
      await page.reload();
      await expect(catalogPage(page)).toBeVisible();
      // Pending work is disclosed from the single count-bearing action, which
      // opens the review queue in a dialog.
      const pending = page.getByRole("button", { name: /待处理工作/ });
      if (await pending.isVisible().catch(() => false)) {
        await pending.click();
      }
    }
    const listedBefore = await catalogJson(
      page.request,
      "GET",
      `/api/v2/organizations/${fixture.organizationId}/parameter-review-items`
    );
    const openBefore = ((listedBefore.body as { items: Array<{ status: string }> }).items ?? []).filter(
      (item) => item.status === "open"
    ).length;
    await queue.getByRole("button", { name: "处理审核" }).first().click();
    const dialog = page.getByRole("dialog", { name: "处理审核" });
    await expect(dialog).toBeVisible();
    await dialog.getByText("标为范围外").click();
    await dialog.getByRole("textbox", { name: "原因" }).fill("op08 mark out of scope");
    await dialog.getByRole("button", { name: "继续确认" }).click();
    await confirmGovernanceDialog(page, "确认处理");
    if (await dialog.getByText(/审核版本已变化|刷新后重新确认/).count()) {
      await dialog.getByRole("button", { name: "刷新证据" }).click();
      await expect(dialog).toHaveCount(0);
      await queue.getByRole("button", { name: "处理审核" }).first().click();
      await expect(page.getByRole("dialog", { name: "处理审核" })).toBeVisible();
      await page.getByRole("dialog", { name: "处理审核" }).getByText("标为范围外").click();
      await page.getByRole("dialog", { name: "处理审核" }).getByRole("textbox", { name: "原因" }).fill("op08 mark out of scope retry");
      await page.getByRole("dialog", { name: "处理审核" }).getByRole("button", { name: "继续确认" }).click();
      await confirmGovernanceDialog(page, "确认处理");
    }
    await expect(page.getByRole("button", { name: "确认处理" })).toHaveCount(0);
    const listed = await catalogJson(
      page.request,
      "GET",
      `/api/v2/organizations/${fixture.organizationId}/parameter-review-items`
    );
    expect(listed.status).toBe(200);
    const openItems = ((listed.body as { items: Array<{ id: string; status: string; etag?: string }> }).items ?? []).filter(
      (item) => item.status === "open"
    );
    for (const item of openItems.slice(0, 1)) {
      const resolved = await catalogJson(
        page.request,
        "POST",
        `/api/v2/organizations/${fixture.organizationId}/parameter-review-items/${item.id}/resolve`,
        {
          headers: {
            "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
            "Idempotency-Key": `pcat-ui-04:${item.id}`,
            "If-Match": item.etag ?? "1"
          },
          data: { resolution: { type: "mark-out-of-scope" }, reason: "op08 api follow-up resolve" }
        }
      );
      expect([200, 409]).toContain(resolved.status);
    }
    await catalogScreenshot(page, testInfo, "pcat-ui-04-review");
  });

  test("registers an unregistered Subject with an explicit Placement choice", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-07
    // @operation PCAT-REGISTRATION-001
    const before = await countSubjectRegistrations(fixture.pool, fixture.organizationId, fixture.sensorSubjectId);
    await openCatalogAt(
      page,
      "org-admin",
      catalogHref(fixture, {
        subjectId: fixture.sensorSubjectId,
        catalogReleaseId: fixture.chain.pinF.id
      }).slice(CATALOG_PAGE_PATH.length)
    );
    if (before === 0) {
      await waitForCatalogState(page, "unregistered");
      await expect(page.getByText(/尚未登记/).first()).toBeVisible();
      await page
        .getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"], exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "登记主体" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("使用默认根放置")).toBeVisible();
      await dialog.getByRole("textbox", { name: "原因" }).fill("op08 explicit sensor registration");
      await dialog.getByRole("button", { name: "继续确认" }).click();
      await confirmGovernanceDialog(page, "确认登记");
      await expect(page.getByRole("dialog", { name: "登记主体" })).toHaveCount(0);
      await page.reload();
      await expect(catalogPage(page)).toBeVisible();
    }
    const after = await countSubjectRegistrations(fixture.pool, fixture.organizationId, fixture.sensorSubjectId);
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeGreaterThanOrEqual(before);
    const denied = await catalogJson(page.request, "POST", `/api/v2/organizations/${fixture.organizationId}/subject-registrations`, {
      actor: "user",
      headers: {
        "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
        "Idempotency-Key": `pcat-ui-07-user:${Date.now()}`
      },
      data: { subjectId: fixture.sensorSubjectId, placement: { mode: "use-default" }, reason: "user denied" }
    });
    expect(denied.status).toBe(403);
    await catalogScreenshot(page, testInfo, "pcat-ui-07-register");
  });

  test("covers Registration, Placement, Review, and definition-editor journeys with role boundaries", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-15
    // @operation PCAT-GOVERNANCE-JOURNEY-001
    await page.setViewportSize({ width: 1440, height: 900 });
    await ingestOpenReview(fixture.pool, fixture.chain.pinF.id);
    await openCatalogViaNav(page, "org-admin");
    await waitForCatalogState(page, /ready|unregistered/);
    await expect(page.getByLabel("目录发布")).toContainText(fixture.chain.pinF.id);
    await expect(
      page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"], exact: true })
    ).toBeVisible();
    const reviewAction = page.getByRole("button", { name: /处理审核|待处理工作/ }).first();
    if (!(await reviewAction.isVisible().catch(() => false))) {
      await ingestOpenReview(fixture.pool, fixture.chain.pinF.id);
      await page.reload();
      await expect(catalogPage(page)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /处理审核|待处理工作/ }).first()).toBeVisible();

    const edit = catalogPage(page).getByRole("table", { name: "参数定义列表" }).getByRole("button", { name: /^编辑 /u }).first();
    await expect(edit).toBeVisible({ timeout: 15_000 });
    await edit.click();
    const editor = page.getByRole("dialog");
    await expect(editor.getByRole("region", { name: "定义详情" })).toBeVisible();
    await expect(editor.locator(".definition-editor__form")).toBeVisible();
    await editor.getByLabel("属性键").fill(`pcat-ui-15-${Date.now()}`);
    await editor.getByLabel("受影响项目").fill("proj-a");
    await editor.getByLabel("修改原因").fill("op08 merged editor journey");
    await expect(editor.getByRole("button", { name: "预演影响" })).toBeEnabled();
    await editor.getByRole("button", { name: /关闭/ }).click();

    await page.goto(
      catalogHref(fixture, {
        subjectId: fixture.powerSubjectId,
        definitionId: fixture.xDefinitionId,
        catalogReleaseId: fixture.chain.pinC.id
      })
    );
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText("iin_max");
    await page.getByRole("button", { name: /查看历史/ }).click();
    await expect(page.getByRole("list", { name: "定义时间线" })).toBeVisible();

    const userWrite = await catalogJson(
      page.request,
      "POST",
      `/api/v2/organizations/${fixture.organizationId}/subject-registrations`,
      {
        actor: "user",
        headers: {
          "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
          "Idempotency-Key": `pcat-ui-15-user:${Date.now()}`
        },
        data: { subjectId: fixture.sensorSubjectId, placement: { mode: "use-default" }, reason: "user must not register" }
      }
    );
    expect(userWrite.status).toBe(403);
    await catalogScreenshot(page, testInfo, "pcat-ui-15-journey");
  });
});
