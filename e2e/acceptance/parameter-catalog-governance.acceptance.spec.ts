import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { catalogAppUrl, test } from "./helpers/catalogFixtureRuntime";

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
  openDefinitionEditor,
  waitForCatalogState
} from "./helpers/catalogBrowser";
import {
  countSubjectRegistrations,
  ingestOpenReview,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

test.use({ viewport: { width: 1440, height: 900 } });

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async ({ catalogAcceptanceRuntime }) => {
  fixture = catalogAcceptanceRuntime.fixture;
});

test.describe("canonical parameter catalog governance interactions", () => {
  test("resolves Review Queue items through one atomic typed command", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-04
    // @operation PCAT-REVIEW-RESOLVE-001
    await ingestOpenReview(fixture.pool, fixture.chain.pinF.id);
    await openCatalogAt(page, "org-admin");
    await waitForCatalogState(page, "empty");
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-release", fixture.chain.pinF.id);
    await page.getByRole("button", { name: /待审核事项/ }).click();
    const queue = page.getByRole("region", { name: "待审核事项" });
    await expect(queue).toBeVisible();
    const resolveButton = queue.getByRole("button", { name: "处理审核" }).first();
    await expect(resolveButton).toBeEnabled();
    const listedBefore = await catalogJson(
      page.request,
      "GET",
      `/api/v2/organizations/${fixture.organizationId}/parameter-review-items`
    );
    expect(listedBefore.status).toBe(200);
    const openBefore = ((listedBefore.body as { items: Array<{ status: string }> }).items ?? []).filter(
      (item) => item.status === "open"
    ).length;
    expect(openBefore).toBeGreaterThan(0);
    await resolveButton.click();
    const dialog = page.getByRole("dialog", { name: "处理审核" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "标为范围外", exact: true }).check();
    await dialog.getByRole("textbox", { name: "原因" }).fill("op08 mark out of scope");
    await dialog.getByRole("button", { name: "继续确认" }).click();
    await expect(page.getByRole("dialog", { name: "确认处理审核" })).toContainText("op08 mark out of scope");
    await confirmGovernanceDialog(page, "确认处理");
    await expect(dialog.getByRole("status").filter({ hasText: "已标为范围外" })).toBeVisible();
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
    expect(openItems).toHaveLength(openBefore - 1);
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
    // The latest pin retires the only definition owner, so its default active
    // collection is empty while independent review work remains accessible.
    await waitForCatalogState(page, "empty");
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-release", fixture.chain.pinF.id);
    await expect(page.getByRole("button", { name: /待审核事项/ })).toBeEnabled();

    await page.goto(catalogAppUrl(catalogHref(fixture, {
      subjectId: fixture.powerSubjectId,
      catalogReleaseId: fixture.chain.pinC.id
    })));
    await waitForCatalogState(page, "unregistered");
    await expect(
      page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"], exact: true })
    ).toBeVisible();

    // Exercise authoring against the explicit fixture pin whose owner is active.
    await page.goto(catalogAppUrl(catalogHref(fixture, { catalogReleaseId: fixture.chain.pinC.id })));
    const { dialog: editor, authoringAllowed } = await openDefinitionEditor(page, page.request);
    if (authoringAllowed) {
      await editor.getByLabel("属性键").fill(`pcat-ui-15-${Date.now()}`);
      const projects = editor.getByRole("group", { name: "受影响项目" });
      await projects.getByRole("checkbox", { name: "OP-08 archived-link project", exact: true }).check();
      await editor.getByLabel("修改原因").fill("op08 merged editor journey");
      await expect(editor.getByRole("button", { name: "预演影响" })).toBeEnabled();
    } else {
      await expect(editor.getByRole("region", { name: "定义详情" })).toBeVisible();
    }
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    if (authoringAllowed) {
      const discard = page.getByRole("dialog", { name: "放弃未保存的修改？" });
      await expect(discard).toBeVisible();
      await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
      await expect(editor.getByLabel("修改原因")).toHaveValue("op08 merged editor journey");
      await expect(editor.getByRole("group", { name: "受影响项目" })
        .getByRole("checkbox", { name: "OP-08 archived-link project", exact: true })).toBeChecked();
      await editor.getByRole("button", { name: "关闭", exact: true }).click();
      await discard.getByRole("button", { name: "放弃修改", exact: true }).click();
    }
    await expect(editor).not.toBeVisible();

    await page.goto(
      catalogAppUrl(
        catalogHref(fixture, {
          subjectId: fixture.powerSubjectId,
          definitionId: fixture.xDefinitionId,
          catalogReleaseId: fixture.chain.pinC.id
        })
      )
    );
    await expect(page.getByRole("dialog").getByRole("heading", { name: /^(编辑|查看) iin_max$/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText("Documented maximum accepted input current.");
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
