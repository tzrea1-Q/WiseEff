import "./helpers/loadAcceptanceEnvironment";
import { selectControlOption } from "./helpers/selectControl";
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
  signInCatalogActor,
  waitForCatalogState
} from "./helpers/catalogBrowser";
import {
  countSubjectRegistrations,
  ingestOpenReview,
  type CatalogAcceptanceFixture
} from "./helpers/catalogEvidence";

test.use({ viewport: { width: 1440, height: 900 }, catalogRuntimeScope: import.meta.url });

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

let fixture: CatalogAcceptanceFixture;

test.beforeAll(async ({ catalogAcceptanceRuntime }) => {
  fixture = catalogAcceptanceRuntime.fixture;
});

test.describe("canonical parameter catalog governance interactions", () => {
  test("removes and restores organization subjects with visible impact and stale-state recovery", async ({ page }, testInfo) => {
    // @acceptance PCAT-UI-07
    // @operation PCAT-REGISTRATION-001
    const registrationPath = `/api/v2/organizations/${fixture.organizationId}/subject-registrations`;
    const created = await catalogJson(page.request, "POST", registrationPath, {
      headers: { "X-WiseEff-Catalog-Release": fixture.chain.pinF.id, "Idempotency-Key": `lifecycle-register:${Date.now()}` },
      data: { subjectId: fixture.sensorSubjectId, destinationModuleId: "pmod-op08-driver", placement: { mode: "use-default" }, reason: "lifecycle browser fixture" }
    });
    expect(created.status).toBe(201);
    const registration = (created.body as { item: { id: string; placement: { id: string } } }).item;
    const subject = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${fixture.sensorSubjectId}`);
    const name = (subject.body as { item: { canonicalName: string } }).item.canonicalName;
    const modulesUrl = "/parameter-admin/modules?moduleId=pmod-op08-driver";
    await signInCatalogActor(page, "org-admin", modulesUrl);
    const row = page.locator(`[data-canonical-subject-id="${fixture.sensorSubjectId}"]`);
    await row.getByRole("button", { name: `移除驱动：${name}` }).click();
    const remove = page.getByRole("dialog", { name: "移除驱动", exact: true });
    await expect(remove).toContainText("0 个参数绑定，涉及 0 个项目");
    await expect(remove.getByRole("button", { name: "确认移除" })).toBeDisabled();
    await remove.getByRole("button", { name: "取消", exact: true }).click();
    await expect(remove).toHaveCount(0);
    const initial = await catalogJson(page.request, "GET", `${registrationPath}/${registration.id}`);
    expect((initial.body as { item: { status: string } }).item.status).toBe("active");

    await row.getByRole("button", { name: `移除驱动：${name}` }).click();
    await expect(remove).toContainText("0 个参数绑定，涉及 0 个项目");
    await remove.getByRole("textbox", { name: "操作原因" }).fill("浏览器移除验证，保留此原因");
    // A real intervening retire/restore cycle makes the open confirmation stale.
    const retire = await catalogJson(page.request, "POST", `${registrationPath}/${registration.id}/retire`, {
      headers: { "X-WiseEff-Catalog-Release": fixture.chain.pinF.id, "Idempotency-Key": `lifecycle-race-retire:${Date.now()}`, "If-Match": initial.headers.etag }, data: { reason: "concurrent browser test" }
    });
    expect(retire.status).toBe(200);
    const restore = await catalogJson(page.request, "POST", `${registrationPath}/${registration.id}/restore`, {
      headers: { "X-WiseEff-Catalog-Release": fixture.chain.pinF.id, "Idempotency-Key": `lifecycle-race-restore:${Date.now()}`, "If-Match": retire.headers.etag }, data: { reason: "concurrent restore test" }
    });
    expect(restore.status).toBe(200);
    const acknowledgement = remove.getByRole("checkbox");
    await acknowledgement.focus();
    await acknowledgement.press("Space");
    await remove.getByRole("button", { name: "确认移除" }).click();
    await expect(remove.getByRole("alert")).toContainText("输入已保留");
    await expect(remove.getByRole("textbox", { name: "操作原因" })).toHaveValue("浏览器移除验证，保留此原因");
    await remove.getByRole("button", { name: "刷新影响数据" }).click();
    await expect(remove).toContainText("0 个参数绑定，涉及 0 个项目");
    await expect(acknowledgement).not.toBeChecked();
    await acknowledgement.check();
    await catalogScreenshot(page, testInfo, "registration-removal-impact-1440x900");
    await remove.getByRole("button", { name: "确认移除" }).click();
    await expect(remove).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(page.getByRole("button", { name: "修改模块 Driver", exact: true })).toBeVisible();

    await openCatalogAt(page, "org-admin");
    const navigator = catalogPage(page).getByRole("navigation", { name: "参数定义模块树" });
    await expect(navigator.getByRole("button", { name: "Driver 0", exact: true })).toBeVisible();
    await expect(navigator.getByRole("button", { name: `选择主体 ${name}` })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "包含已停用和退役主体" }).check();
    await navigator.getByRole("button", { name: "展开 Driver", exact: true }).click();
    await expect(navigator.getByRole("button", { name: `选择主体 ${name}` })).toBeVisible();

    await page.goto(catalogAppUrl(modulesUrl));
    await selectControlOption(page.getByRole("combobox", { name: "筛选登记状态" }), "retired");
    await expect(row).toContainText("已停用");
    await row.getByRole("button", { name: `恢复驱动：${name}` }).click();
    const recovery = page.getByRole("dialog", { name: "恢复驱动", exact: true });
    await expect(recovery).toContainText("当前归属：Driver");
    await recovery.getByRole("textbox", { name: "操作原因" }).fill("恢复浏览器测试登记");
    await recovery.getByRole("checkbox").check();
    await recovery.getByRole("button", { name: "确认恢复" }).click();
    await expect(recovery).toHaveCount(0);
    const final = await catalogJson(page.request, "GET", `${registrationPath}/${registration.id}`);
    expect((final.body as { item: { status: string; placement: { id: string } } }).item).toMatchObject({ status: "active", placement: { id: registration.placement.id } });
    await selectControlOption(page.getByRole("combobox", { name: "筛选登记状态" }), "registered");
    await expect(row.getByRole("button", { name: `移除驱动：${name}` })).toBeEnabled();
    await catalogScreenshot(page, testInfo, "registration-restored-1440x900");
    await signInCatalogActor(page, "user", modulesUrl);
    await expect(page.getByRole("button", { name: `移除驱动：${name}` })).toHaveCount(0);
  });

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

  test("adjusts a subject placement without randomUUID, reports preparation failures and persists an explicit retry", async ({ page }, testInfo) => {
    // Model the missing capability on ordinary HTTP while retaining Chromium's
    // real getRandomValues and the real API/database behind the page.
    await page.addInitScript(() => {
      Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    });
    const targetModuleId = "pmod-http-placement-target";
    const targetName = "HTTP 归属调整目标";
    await fixture.pool.query(
      `insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
       select $1, organization_id, $2, $1, 1, kind, origin, attribution_subject_id
       from public.parameter_modules where id = 'pmod-op08-driver'`,
      [targetModuleId, targetName]
    );
    const subject = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${fixture.sensorSubjectId}`);
    expect(subject.status).toBe(200);
    const subjectItem = (subject.body as { item: { canonicalName: string; registration: { status: string; id?: string } } }).item;
    let registrationId = subjectItem.registration.id;
    if (subjectItem.registration.status !== "active") {
      const registration = await catalogJson(page.request, "POST", `/api/v2/organizations/${fixture.organizationId}/subject-registrations`, {
        headers: { "X-WiseEff-Catalog-Release": fixture.chain.pinF.id, "Idempotency-Key": `http-placement-register:${Date.now()}` },
        data: { subjectId: fixture.sensorSubjectId, destinationModuleId: "pmod-op08-driver", placement: { mode: "use-default" }, reason: "HTTP placement browser fixture" }
      });
      expect(registration.status).toBe(201);
      registrationId = (registration.body as { item: { id: string } }).item.id;
    }
    expect(registrationId).toBeTruthy();
    const path = `/api/v2/organizations/${fixture.organizationId}/subject-registrations/${registrationId}/placement`;
    const initial = await catalogJson(page.request, "GET", path);
    expect(initial.status).toBe(200);
    const modulesUrl = `/parameter-admin/modules?subjectQ=${encodeURIComponent(subjectItem.canonicalName)}`;
    await signInCatalogActor(page, "org-admin", modulesUrl);
    expect(await page.evaluate(() => ({ uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues })))
      .toEqual({ uuid: "undefined", random: "function" });
    const row = page.locator(`[data-canonical-subject-id="${fixture.sensorSubjectId}"]`);
    await row.getByRole("button", { name: /^调整归属：/ }).click();
    const dialog = page.getByRole("dialog", { name: "调整放置", exact: true });
    await selectControlOption(dialog.getByRole("combobox", { name: "目标模块" }), targetModuleId);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && new URL(request.url()).pathname === path) writes.push(request.url());
    });
    await page.evaluate(() => {
      Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: () => { throw new Error("random source unavailable"); } });
    });
    await dialog.getByRole("button", { name: "继续确认" }).click();
    await confirmGovernanceDialog(page, "确认调整放置");
    await expect(dialog.getByRole("alert")).toContainText("目录写入失败，请稍后重试。");
    expect(writes).toHaveLength(0);
    await expect(dialog.getByRole("combobox", { name: "目标模块" })).toHaveAttribute("data-value", targetModuleId);
    await catalogScreenshot(page, testInfo, "http-placement-preparation-failure-1440x900");

    await page.evaluate(() => { Reflect.deleteProperty(crypto, "getRandomValues"); });
    await dialog.getByRole("button", { name: "继续确认" }).click();
    const confirmation = page.getByRole("dialog", { name: "确认调整放置", exact: true });
    const confirm = confirmation.getByRole("button", { name: "确认调整放置", exact: true });
    await expect(confirm).toBeDisabled();
    await confirmation.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === path);
    await confirm.press("Enter");
    const response = await saved;
    expect(response.status(), await response.text()).toBe(200);
    const headers = response.request().headers();
    expect(headers["if-match"]).toBe(initial.headers.etag);
    expect(headers["x-wiseeff-catalog-release"]).toBe(fixture.chain.pinF.id);
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(response.request().postDataJSON()).toMatchObject({ destinationModuleId: targetModuleId });
    expect(writes).toHaveLength(1);
    await expect(dialog).toHaveCount(0);
    const persisted = await catalogJson(page.request, "GET", path);
    expect(persisted.status).toBe(200);
    expect((persisted.body as { item: { moduleId: string } }).item.moduleId).toBe(targetModuleId);
    await expect(row).toContainText(targetName);
    await page.reload();
    await expect(row).toContainText(targetName);
    await catalogScreenshot(page, testInfo, "http-placement-persisted-1440x900");
  });
});
