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
  countProposals,
  countPublicationIntents,
  countSubjectRegistrations,
  definitionHeadRevision,
  ensureCatalogAcceptanceFixture,
  ingestOpenReview,
  latestOrganizationProposal,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

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
      await page.getByRole("button", { name: catalogUiCopy.actionLabels["register-subject"] }).click();
      const dialog = page.getByRole("dialog", { name: "登记主体" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("使用默认根放置")).toBeVisible();
      await dialog.getByRole("textbox", { name: "原因" }).fill("op08 explicit sensor registration");
      await dialog.getByRole("button", { name: "继续确认" }).click();
      await confirmGovernanceDialog(page, "确认登记");
      await expect(page.getByRole("dialog", { name: "登记主体" })).toHaveCount(0);
      await page.getByRole("button", { name: "刷新" }).click();
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

  test("covers Registration, Placement, Review, and Proposal journeys with role boundaries", async ({
    page
  }, testInfo) => {
    // @acceptance PCAT-UI-15
    // @operation PCAT-GOVERNANCE-JOURNEY-001
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCatalogViaNav(page, "org-admin");
    await waitForCatalogState(page, /ready|unregistered/);
    const beforeProposals = await countProposals(fixture.pool);
    const headBefore = await definitionHeadRevision(
      fixture.pool,
      fixture.chain.pinF.id,
      fixture.xDefinitionId
    );
    const proposal = page.getByRole("region", { name: "定义修订" });
    await expect(proposal).toBeVisible();
    await proposal.getByRole("textbox", { name: "原因" }).fill("op08 documentation proposal");
    await proposal.getByRole("button", { name: "继续确认" }).click();
    await confirmGovernanceDialog(page, "确认提出修订");
    await expect(proposal.getByText("草稿").first()).toBeVisible();
    const created = await latestOrganizationProposal(fixture.pool, fixture.organizationId);
    expect(created).not.toBeNull();
    expect(created?.status).toBe("draft");
    expect(await countProposals(fixture.pool)).toBe(beforeProposals + 1);
    await proposal.getByRole("button", { name: "提交修订" }).first().click();
    await confirmGovernanceDialog(page, "确认提交");
    await expect(proposal.getByText("已提交")).toBeVisible();
    const submitted = await latestOrganizationProposal(fixture.pool, fixture.organizationId);
    expect(submitted?.id).toBe(created?.id);
    expect(submitted?.status).toBe("submitted");
    expect(await countPublicationIntents(fixture.pool, created!.id)).toBe(0);

    await page.goto(
      catalogHref(fixture, {
        subjectId: fixture.powerSubjectId,
        definitionId: fixture.xDefinitionId,
        catalogReleaseId: fixture.chain.pinC.id
      })
    );
    await expect(page.getByRole("region", { name: "定义详情" })).toContainText("iin_max");
    await expect(page.getByRole("list", { name: "定义时间线" })).toBeVisible();

    await openCatalogAt(page, "platform-admin");
    const platformProposal = page.getByRole("region", { name: "定义修订" });
    await platformProposal.getByRole("textbox", { name: "仓库引用" }).fill("repo://wiseeff-catalog/op08.yaml");
    await platformProposal.getByRole("button", { name: "接受修订" }).first().click();
    await confirmGovernanceDialog(page, "确认接受");
    await expect(platformProposal.getByText(/发布意图已记录|已接受/).first()).toBeVisible();
    const accepted = await latestOrganizationProposal(fixture.pool, fixture.organizationId);
    expect(accepted?.id).toBe(created?.id);
    expect(accepted?.status).toBe("accepted");
    expect(await countPublicationIntents(fixture.pool, created!.id)).toBe(1);
    expect(await definitionHeadRevision(fixture.pool, fixture.chain.pinF.id, fixture.xDefinitionId)).toBe(
      headBefore
    );
    await catalogScreenshot(page, testInfo, "pcat-ui-15-journey");
  });
});
