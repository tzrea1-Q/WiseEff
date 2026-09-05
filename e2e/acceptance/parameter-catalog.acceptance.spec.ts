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
  catalogUiCopy,
  dismissXiaozeHint,
  openCatalogAt,
  openCatalogViaNav,
  selectDefinitionByKey,
  selectSubjectByName,
  signInCatalogActor,
  waitForCatalogState
} from "./helpers/catalogBrowser";
import {
  ensureCatalogAcceptanceFixture,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

const CHARGER_SUBJECT = /^charger/;

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async () => {
  fixture = await ensureCatalogAcceptanceFixture();
});

test.describe("canonical parameter catalog page", () => {
  test("enters the only Parameter definitions destination without Effective or Governance peers", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-01
    // @operation PCAT-CATALOG-DISCOVER-001
    await openCatalogViaNav(page, "org-admin");
    const region = catalogPage(page);
    await expect(region).toHaveAttribute("data-catalog-page", "true");
    await expect(page.getByLabel("目录发布")).toContainText(fixture.chain.pinF.id);
    const document = await catalogJson(page.request, "GET", "/api/v2/catalog");
    expect(document.status).toBe(200);
    expect((document.body as { item: { catalogReleaseId: string } }).item.catalogReleaseId).toBe(
      fixture.chain.pinF.id
    );
    await expect(page.getByRole("button", { name: /有效定义|治理历史|Effective|Governance/ })).toHaveCount(0);
    await expect(page.getByText(/生效目录|治理视图|catalogView/)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "组织配置子视图" }).getByRole("button", { name: /参数定义管理/ })).toBeVisible();
    await catalogScreenshot(page, testInfo, "pcat-ui-01-entry");
  });

  test("restores opaque subject, definition, and catalogReleaseId through reload, Back, and Forward", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-02
    // @operation PCAT-CATALOG-DEEP-LINK-001
    const queryCounts = { current: 0, pinned: 0 };
    await page.route("**/api/v2/catalog**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET" && url.pathname === "/api/v2/catalog") {
        if (url.searchParams.get("catalogReleaseId") === fixture.chain.pinC.id) {
          queryCounts.pinned += 1;
        } else {
          queryCounts.current += 1;
        }
      }
      await route.continue();
    });
    await openCatalogViaNav(page, "org-admin");
    await selectDefinitionByKey(page, "iin_max");
    await expect(page).toHaveURL(new RegExp(`subjectId=${fixture.powerSubjectId}`));
    await expect(page).toHaveURL(new RegExp(`definitionId=${fixture.xDefinitionId}`));
    await expect(page).toHaveURL(new RegExp(`catalogReleaseId=${fixture.chain.pinF.id}`));

    await page.goto(
      catalogHref(fixture, {
        subjectId: fixture.powerSubjectId,
        definitionId: fixture.xDefinitionId,
        catalogReleaseId: fixture.chain.pinC.id
      })
    );
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-release", fixture.chain.pinC.id);
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText(`修订 #${fixture.oracle.xOnC.revisionNumber}`);

    await page.reload();
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-release", fixture.chain.pinC.id);
    await expect(page).toHaveURL(new RegExp(`catalogReleaseId=${fixture.chain.pinC.id}`));
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`catalogReleaseId=${fixture.chain.pinC.id}`));
    await page.goForward();
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-release", fixture.chain.pinC.id);
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText(fixture.xDefinitionId);
    await catalogScreenshot(page, testInfo, "pcat-ui-02-deep-link");
    expect(queryCounts.pinned, "pinned first-page catalog reads").toBeGreaterThan(0);
    expect(queryCounts.current + queryCounts.pinned, "current vs pinned query counts recorded").toBeGreaterThan(0);
    await testInfo.attach("op08-query-baseline", {
      body: Buffer.from(
        JSON.stringify(
          {
            note: "Local OP-08 query counts for GET /api/v2/catalog. Not an SLO or Hosted evidence.",
            currentDocumentReads: queryCounts.current,
            pinnedCDocumentReads: queryCounts.pinned
          },
          null,
          2
        )
      ),
      contentType: "application/json"
    });
  });

  test("inspects formal Subject and Definition identity, revisions, usage, Registration, and Placement", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-03
    // @operation PCAT-DEFINITION-DETAIL-001
    await openCatalogAt(
      page,
      "org-admin",
      catalogHref(fixture, {
        subjectId: fixture.powerSubjectId,
        definitionId: fixture.xDefinitionId,
        catalogReleaseId: fixture.chain.pinC.id
      }).slice(CATALOG_PAGE_PATH.length)
    );
    const detail = page.getByRole("region", { name: "定义详情" });
    await expect(detail).toContainText("iin_max");
    await expect(detail).toContainText(fixture.powerSubjectId);
    await expect(detail).toContainText(fixture.xDefinitionId);
    await expect(detail).toContainText(`修订 #${fixture.oracle.xOnC.revisionNumber}`);
    await expect(detail).toContainText(fixture.oracle.xOnC.documentation);
    await expect(detail).toContainText(fixture.oracle.xOnC.publishedInReleaseId);
    await expect(detail).toContainText(
      `策略 ${fixture.oracle.usage.policyCount} · 项目 ${fixture.oracle.usage.projectCount} · 当前值 ${fixture.oracle.usage.currentValueCount}`
    );
    const definition = await catalogJson(page.request, "GET", `/api/v2/catalog/definitions/${fixture.xDefinitionId}?catalogReleaseId=${fixture.chain.pinC.id}`);
    expect(definition.status).toBe(200);
    const item = (definition.body as { item: { id: string; currentRevision: { revisionNumber: number; documentation: string } } }).item;
    expect(item.id).toBe(fixture.xDefinitionId);
    expect(item.currentRevision.revisionNumber).toBe(fixture.oracle.xOnC.revisionNumber);
    expect(item.currentRevision.documentation).toBe(fixture.oracle.xOnC.documentation);
    await catalogScreenshot(page, testInfo, "pcat-ui-03-detail");
  });

  test("pages Definition timeline catalog publication facts with authorized history", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-05
    // @operation PCAT-TIMELINE-001
    await openCatalogAt(
      page,
      "org-admin",
      catalogHref(fixture, {
        subjectId: fixture.powerSubjectId,
        definitionId: fixture.xDefinitionId,
        catalogReleaseId: fixture.chain.pinC.id
      }).slice(CATALOG_PAGE_PATH.length)
    );
    const timeline = page.getByRole("list", { name: "定义时间线" });
    await expect(timeline.getByText("目录发布").first()).toBeVisible();
    const facts = timeline.locator("li");
    const ids = await facts.locator(".parameter-catalog__anchor-id").allTextContents();
    expect(ids).toContain(fixture.chain.pinA.id);
    expect(ids).toContain(fixture.chain.pinC.id);
    expect(new Set(ids).size).toBe(ids.filter(Boolean).length);
    expect(ids).not.toContain(fixture.chain.pinF.id);
    const api = await catalogJson(
      page.request,
      "GET",
      `/api/v2/catalog/definitions/${fixture.xDefinitionId}/timeline?catalogReleaseId=${fixture.chain.pinC.id}&limit=1`
    );
    expect(api.status).toBe(200);
    const body = api.body as { items: Array<{ id: string; catalogReleaseId?: string }>; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    if (body.nextCursor) {
      const page2 = await catalogJson(
        page.request,
        "GET",
        `/api/v2/catalog/definitions/${fixture.xDefinitionId}/timeline?catalogReleaseId=${fixture.chain.pinC.id}&limit=1&cursor=${encodeURIComponent(body.nextCursor)}`
      );
      expect(page2.status).toBe(200);
      const second = page2.body as { items: Array<{ id: string }> };
      expect(second.items[0]?.id).not.toBe(body.items[0]?.id);
    }
    await catalogScreenshot(page, testInfo, "pcat-ui-05-timeline");
  });

  test("exposes only role-authorized ready actions while keeping the Catalog Release visible", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-06
    // @operation PCAT-READY-ACTIONS-001
    const assertReleaseVisible = async () => {
      await expect(page.getByLabel("目录发布")).toContainText(fixture.chain.pinF.id);
    };

    await signInCatalogActor(page, "user", CATALOG_PAGE_PATH);
    await dismissXiaozeHint(page);
    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
    await catalogScreenshot(page, testInfo, "pcat-ui-06-user");

    await openCatalogAt(page, "org-admin");
    await assertReleaseVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"] })).toBeVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["create-proposal"] })).toBeVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["accept-proposal"] })).toHaveCount(0);
    const userWrite = await catalogJson(page.request, "POST", `/api/v2/organizations/${fixture.organizationId}/subject-registrations`, {
      actor: "user",
      headers: {
        "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
        "Idempotency-Key": `pcat-ui-06-user:${Date.now()}`
      },
      data: { subjectId: fixture.sensorSubjectId, placement: { mode: "use-default" }, reason: "user must not register" }
    });
    expect(userWrite.status).toBe(403);
    await catalogScreenshot(page, testInfo, "pcat-ui-06-org-admin");

    await openCatalogAt(page, "platform-admin");
    await assertReleaseVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["accept-proposal"] }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["reject-proposal"] }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"] })).toHaveCount(0);
    await catalogScreenshot(page, testInfo, "pcat-ui-06-platform-admin");

    await openCatalogAt(page, "agent");
    await assertReleaseVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["create-proposal"] })).toHaveCount(0);
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"] })).toHaveCount(0);
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["accept-proposal"] })).toHaveCount(0);
    const agentWrite = await catalogJson(page.request, "POST", `/api/v2/organizations/${fixture.organizationId}/subject-registrations`, {
      actor: "agent",
      headers: {
        "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
        "Idempotency-Key": `pcat-ui-06-agent:${Date.now()}`
      },
      data: { subjectId: fixture.sensorSubjectId, placement: { mode: "use-default" }, reason: "agent must not register" }
    });
    expect(agentWrite.status).toBe(403);
    await catalogScreenshot(page, testInfo, "pcat-ui-06-agent");
  });

  test("distinguishes loading, error, no registrations, no definitions, no review work, and no filter match", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-08
    // @operation PCAT-CATALOG-STATES-001
    let catalogMode: "delay" | "not-ready" | "no-registrations" | "live" = "delay";
    await page.route("**/api/v2/catalog**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (method === "GET" && url.pathname === "/api/v2/catalog" && catalogMode === "delay") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
        return;
      }
      if (method === "GET" && url.pathname === "/api/v2/catalog" && catalogMode === "not-ready") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Catalog is not ready.",
              details: { reason: "catalog-not-ready" }
            }
          })
        });
        return;
      }
      if (method === "GET" && url.pathname === "/api/v2/catalog/subjects" && catalogMode === "no-registrations") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [],
            nextCursor: null,
            catalogReleaseId: fixture.chain.pinF.id,
            emptyReason: "no-registrations"
          })
        });
        return;
      }
      await route.continue();
    });

    const loadingPromise = openCatalogAt(page, "org-admin");
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-state", "loading", { timeout: 5_000 });
    await expect(catalogPage(page)).toHaveAttribute("data-writes-enabled", "false");
    await expect(page.getByText(/正在加载目录|正在刷新目录发布/).first()).toBeVisible();
    await loadingPromise;

    catalogMode = "not-ready";
    await page.reload();
    await expect(catalogPage(page)).toHaveAttribute("data-catalog-state", "error");
    await expect(page.getByRole("alert").first()).toContainText("目录发布尚未就绪");
    await expect(catalogPage(page)).toHaveAttribute("data-writes-enabled", "false");
    await expect(page.getByText(catalogUiCopy.emptyMessages["no-registrations"])).toHaveCount(0);
    await catalogScreenshot(page, testInfo, "pcat-ui-08-not-ready");

    catalogMode = "no-registrations";
    await page.reload();
    await expect(catalogPage(page)).toHaveAttribute("data-empty-reason", "no-registrations");
    await expect(page.getByText(catalogUiCopy.emptyMessages["no-registrations"]).first()).toBeVisible();

    catalogMode = "live";
    await page.reload();
    await selectSubjectByName(page, CHARGER_SUBJECT);
    await expect(page.getByText(catalogUiCopy.emptyMessages["no-definitions"]).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "待审核事项" })).toBeVisible();

    await page.getByRole("searchbox", { name: "搜索参数定义" }).fill("zzzz-no-such-definition");
    await page.getByRole("button", { name: "搜索" }).click();
    await expect(page.getByText(catalogUiCopy.emptyMessages["no-filter-match"]).first()).toBeVisible();
    await catalogScreenshot(page, testInfo, "pcat-ui-08-filter");
  });

  test("keeps retired or deprecated history readable and disables prohibited new actions", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-09
    // @operation PCAT-RETIRED-HISTORY-001
    await openCatalogAt(
      page,
      "org-admin",
      catalogHref(fixture, {
        subjectId: fixture.powerSubjectId,
        definitionId: fixture.xDefinitionId,
        catalogReleaseId: fixture.chain.pinF.id
      }).slice(CATALOG_PAGE_PATH.length)
    );
    await waitForCatalogState(page, "retired");
    await expect(catalogPage(page)).toHaveAttribute("data-writes-enabled", "false");
    await expect(page.getByText(/已退役或已弃用，历史记录仍可阅读|该主体已退役/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: catalogUiCopy.actionLabels["create-proposal"] })).toBeDisabled();
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText(fixture.xDefinitionId);
    const retiredWrite = await catalogJson(page.request, "POST", `/api/v2/organizations/${fixture.organizationId}/subject-registrations`, {
      headers: {
        "X-WiseEff-Catalog-Release": fixture.chain.pinF.id,
        "Idempotency-Key": `pcat-ui-09:${Date.now()}`
      },
      data: { subjectId: fixture.powerSubjectId, placement: { mode: "use-default" }, reason: "retired subject" }
    });
    expect([409, 400, 422]).toContain(retiredWrite.status);
    await catalogScreenshot(page, testInfo, "pcat-ui-09-retired");
  });

  test("keeps list, detail, and timeline usable at 1440x900, 768x1024, and 390x844 without overflow", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-14
    // @operation PCAT-RESPONSIVE-001
    for (const viewport of CATALOG_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openCatalogAt(
        page,
        "org-admin",
        catalogHref(fixture, {
          subjectId: fixture.powerSubjectId,
          definitionId: fixture.xDefinitionId,
          catalogReleaseId: fixture.chain.pinC.id
        }).slice(CATALOG_PAGE_PATH.length)
      );
      await expect(catalogPage(page)).toBeVisible();
      await assertNoPageOverflow(page);
      if (viewport.name === "desktop") {
        await expect(page.getByRole("region", { name: "定义详情" })).toBeVisible();
        await expect(page.getByRole("region", { name: "定义时间线" })).toBeVisible();
        await page.getByRole("searchbox", { name: "搜索参数定义" }).focus();
        await expect(page.getByRole("searchbox", { name: "搜索参数定义" })).toBeFocused();
      } else {
        const sheet = page.getByRole("dialog");
        await expect(sheet).toBeVisible();
        await sheet.getByRole("tab", { name: "时间线" }).click();
        await expect(sheet.getByText("目录发布")).toBeVisible();
        await sheet.getByRole("tab", { name: "详情" }).focus();
        await expect(sheet.getByRole("tab", { name: "详情" })).toBeFocused();
      }
      await catalogScreenshot(page, testInfo, `pcat-ui-14-${viewport.name}`);
    }
  });
});
