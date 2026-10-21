import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { acceptanceAdminOnlyUser, seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { readSelectControlOptions, selectControlOption } from "./helpers/selectControl";
import { waitForInteractionSurfaceReady } from "./helpers/interactionSurface";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 } });

const adminHeaders = () => authHeadersForRole("admin");

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

test("B1 preserves canonical admin and read-only Definition pages at PC 1440x900", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const legacyWrites: string[] = [];
  page.on("request", (browserRequest) => {
    if (browserRequest.method() !== "GET" && /parameter-specs|parameter-spec-review-tasks|identity-mapping-tasks/.test(browserRequest.url())) {
      legacyWrites.push(browserRequest.url());
    }
  });
  const actor = acceptanceAdminOnlyUser;
  const definitions = await request.get(apiRoute("/api/v2/catalog/definitions?limit=50"), {
    headers: authHeadersForUser(actor.userId, actor.email, actor.name)
  });
  expect(definitions.status()).toBe(200);
  const body = await definitions.json();
  const definition = body.items.find((item: { lifecycle: string }) => item.lifecycle === "active");
  expect(definition).toBeTruthy();
  await signInBrowserAsUser(page, actor.userId, actor.email, actor.name, "/parameter-admin/specs");
  await dismissXiaozeHint(page);
  await expect(page.getByRole("region", { name: "参数定义目录" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "参数定义模块树" })).toBeVisible();
  const query = new URLSearchParams({
    subjectId: definition.subject.id,
    definitionId: definition.id,
    catalogReleaseId: body.catalogReleaseId
  });
  await page.goto(`/parameter-admin/specs?${query}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("region", { name: "定义详情" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: `查看 ${definition.propertyKey}`, exact: true })).toBeVisible();
  await expect(dialog.getByText(definition.currentRevision.displayName, { exact: true })).toBeVisible();
  const identifiers = dialog.locator("details").filter({ has: page.locator("summary", { hasText: /^技术标识$/ }) });
  await identifiers.locator("summary").click();
  await expect(identifiers.getByText(definition.id, { exact: true })).toBeVisible();
  await expect(identifiers.getByText(definition.subject.id, { exact: true })).toBeVisible();
  await expect(identifiers.getByText(definition.currentRevision.publishedInCatalogReleaseId, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存内容修订" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "属性键" })).toHaveCount(0);
  await dialog.getByRole("button", { name: /查看历史/ }).click();
  await expect(dialog.getByRole("region", { name: "定义时间线" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const screenshot = testInfo.outputPath("b1-org-admin-definition-1440.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("b1-org-admin-definition-1440", { path: screenshot, contentType: "image/png" });
  expect(legacyWrites).toEqual([]);
});

test.describe("parameter-admin project list", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  test("removes archived projects from parameter and debugging selectors and restores their availability", async ({ page, request }, testInfo) => {
    const suffix = randomUUID().slice(0, 8);
    const projectId = `archive-selector-${suffix}`;
    const name = `项目归档选择检查-${suffix}`;
    const selectors = [["/parameters", "项目"], ["/dts-reload", "选择项目"]] as const;
    const url = apiRoute(`/api/v1/parameters/admin/projects/${projectId}`);
    const created = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
      headers: adminHeaders(), data: { id: projectId, name, code: `AS${suffix}` }
    });
    expect(created.status()).toBe(201);
    try {
      await signInBrowserAsRole(page, "admin", "/dts-reload");
      await selectControlOption(page.getByRole("combobox", { name: "选择项目", exact: true }), projectId);
      await expect(page.getByRole("combobox", { name: "选择项目", exact: true })).toHaveAttribute("data-value", projectId);
      const archived = await request.patch(url, { headers: adminHeaders(), data: { status: "archived" } });
      expect(archived.status()).toBe(200);
      const adminList = await request.get(apiRoute("/api/v1/parameters/admin/projects"), { headers: adminHeaders() });
      expect((await adminList.json()).items).toContainEqual(expect.objectContaining({ id: projectId, status: "archived" }));
      const activeList = await request.get(apiRoute("/api/v1/projects"), { headers: adminHeaders() });
      const activeIds = (await activeList.json()).items.map((item: { id: string }) => item.id);
      expect(activeIds.length).toBeGreaterThan(0);
      for (const [route, label] of selectors) {
        if (route === "/parameters") await page.goto("/parameters");
        else await page.goto("/dts-reload");
        await waitForInteractionSurfaceReady(page);
        const selector = page.getByRole("combobox", { name: label, exact: true });
        await expect(selector).not.toHaveAttribute("data-value", projectId);
        const options = await readSelectControlOptions(selector);
        expect(options.map((option) => option.value)).toEqual(activeIds);
        expect(options).not.toContainEqual(expect.objectContaining({ value: projectId }));
        await selector.click();
        await testInfo.attach(`archived-project-selector-${route.slice(1)}`, { contentType: "image/png", body: await page.screenshot() });
        await page.keyboard.press("Escape");
      }
      const restored = await request.patch(url, { headers: adminHeaders(), data: { status: "initialized" } });
      expect(restored.status()).toBe(200);
      for (const [route, label] of selectors) {
        if (route === "/parameters") await page.goto("/parameters");
        else await page.goto("/dts-reload");
        await waitForInteractionSurfaceReady(page);
        expect(await readSelectControlOptions(page.getByRole("combobox", { name: label, exact: true })))
          .toContainEqual(expect.objectContaining({ value: projectId, label: name }));
      }
    } finally {
      const cleanup = await request.delete(url, { headers: adminHeaders() });
      expect(cleanup.status()).toBe(200);
    }
  });

  test("previews canonical project deletion and retained shared resources at PC 1440x900", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-ADMIN-003
    // @operation PARAM-ADMIN-003
    const list = await request.get(apiRoute("/api/v1/parameters/admin/projects"), { headers: adminHeaders() });
    expect(list.status()).toBe(200);
    const project = (await list.json()).items.find((item: { id: string }) => item.id === "aurora");
    expect(project).toBeTruthy();
    const bindings = await withPgClient((client) => client.query(
      "select count(*)::int as count from parameter_catalog.project_parameter_bindings where project_id=$1", [project.id]
    ));
    expect(bindings.rows[0].count).toBeGreaterThan(0);
    await signInBrowserAsRole(page, "admin");
    await page.goto(`/parameter-admin/projects?q=${encodeURIComponent(project.name)}`);
    await dismissXiaozeHint(page);
    const row = page.getByRole("row").filter({ hasText: project.name }).first();
    await row.getByRole("button", { name: `${project.name}操作：更多`, exact: true }).click();
    const deleteAction = page.getByRole("menuitem", { name: `删除影响预览 ${project.name}`, exact: true });
    await expect(deleteAction).toBeEnabled();
    await expect(page.getByRole("menuitem", { name: `${project.status === "archived" ? "恢复项目" : "归档"} ${project.name}`, exact: true })).toBeEnabled();
    await deleteAction.click();
    const dialog = page.getByRole("dialog", { name: /项目删除影响预览/ });
    await expect(dialog.getByRole("region", { name: "项目专属数据：计划清理" })).toBeVisible();
    await expect(dialog).toContainText("平台共享参数定义");
    await expect(dialog).toContainText("共享保留");
    await expect(dialog.getByRole("button", { name: "确认彻底删除", exact: true })).toBeDisabled();
    expect(project.canonicalOwned).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const screenshot = testInfo.outputPath("canonical-project-delete-1440.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("canonical-project-delete-1440", { path: screenshot, contentType: "image/png" });
    await recordOperationEvidence({
      operationId: "PARAM-ADMIN-003", title: "canonical project deletion scope and retained resources", status: "passed",
      role: "Admin", route: "/parameter-admin/projects", page, testInfo, artifacts: [screenshot],
      api: [summarizeApiResponse(list, { method: "GET", path: "/api/v1/parameters/admin/projects",
        responseSummary: `project=${project.id}; canonicalOwned=true` })],
      db: [{ table: "parameter_catalog.project_parameter_bindings", predicate: `project_id=${project.id}`,
        observed: "Canonical Bindings retained", rowCount: bindings.rows[0].count }],
      notes: "At 1440x900 the administrator opens a real canonical deletion preview, inspects planned project data and retained shared resources, and cannot delete without explicit confirmation. Archive or restore remains available."
    });
    await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
    expect((await request.get(apiRoute(`/api/v1/parameters/admin/projects/${project.id}`), { headers: adminHeaders() })).status()).toBe(200);
  });

  test("preserves DataTable behavior and URL history at PC 1440x900", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-ADMIN-003
    // @operation PARAM-ADMIN-003
    const suffix = randomUUID().slice(0, 8);
    const queryLabel = `T${suffix.slice(0, 5)}`;
    const projectIds: string[] = [];
    const screenshotPaths: string[] = [];

    try {
      for (let index = 1; index <= 12; index += 1) {
        const ordinal = String(index).padStart(2, "0");
        const id = `td112-${suffix}-${ordinal}`;
        const response = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
          headers: adminHeaders(),
          data: {
            id,
            name: `${queryLabel}-${ordinal}`,
            code: `T${suffix.slice(0, 5)}${ordinal}`
          }
        });
        expect(response.status()).toBe(201);
        projectIds.push(id);
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      let releaseBindings!: () => void;
      let bindingsHeld!: () => void;
      const bindingsGate = new Promise<void>((resolve) => { releaseBindings = resolve; });
      const bindingsRequestHeld = new Promise<void>((resolve) => { bindingsHeld = resolve; });
      const routeTaskSettlements: Promise<PromiseSettledResult<void>[]>[] = [];
      const requiredBindings = (url: URL) => url.pathname === "/api/v2/projects/aurora/parameter-bindings";
      await page.route(requiredBindings, (route) => {
        const task = (async () => {
          bindingsHeld();
          await bindingsGate;
          if (!route.request().failure()) await route.continue();
        })();
        const settlement = Promise.allSettled([task]);
        routeTaskSettlements.push(settlement);
        return settlement;
      });
      let signInSettled = false;
      const signIn = signInBrowserAsRole(page, "admin", "/parameter-admin/projects")
        .finally(() => { signInSettled = true; });
      let failure: PromiseRejectedResult | undefined;
      try {
        await Promise.race([bindingsRequestHeld, signIn.then(() => bindingsRequestHeld)]);
        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator("#main-content")).toHaveAttribute("data-runtime-state", "loading");
        await expect(page.locator("#main-content > .page-content")).toHaveAttribute("inert", "");
        expect(signInSettled).toBe(false);
      } catch (reason) {
        failure = { status: "rejected", reason };
      } finally {
        releaseBindings();
        await Promise.all(routeTaskSettlements);
        const settled = await Promise.allSettled([signIn, page.unroute(requiredBindings)]);
        const settledRoutes = (await Promise.all(routeTaskSettlements)).flat();
        failure ??= [...settled, ...settledRoutes].find((result) => result.status === "rejected");
      }
      if (failure) throw failure.reason;
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目清单", exact: true })).toBeVisible({ timeout: 30_000 });

      const search = page.getByRole("searchbox", { name: "搜索项目" });
      await search.fill(queryLabel);
      await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(queryLabel)}`));
      await expect(page.getByText("第 1 / 2 页 · 共 12 条")).toBeVisible();

      await page.getByRole("button", { name: "筛选状态" }).click();
      await page.getByRole("checkbox", { name: "未初始化" }).check();
      await expect(page).toHaveURL(/status=not_initialized/);
      await page.getByRole("button", { name: "筛选状态" }).click();

      const nameHeader = page.getByRole("columnheader", { name: /项目名称/ });
      await nameHeader.getByRole("button", { name: /项目名称/ }).click();
      await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
      await expect(page).toHaveURL(/sort=name-desc/);

      await page.reload();
      await dismissXiaozeHint(page);
      await expect(search).toHaveValue(queryLabel);
      await expect(page.getByRole("button", { name: "筛选状态" })).toContainText("1");
      await expect(nameHeader).toHaveAttribute("aria-sort", "descending");

      await page.getByRole("button", { name: "筛选状态" }).click();
      await page.getByRole("checkbox", { name: "未初始化" }).uncheck();
      await expect(page).not.toHaveURL(/status=not_initialized/);
      await page.getByRole("button", { name: "筛选状态" }).click();
      await page.goBack();
      await expect(page.getByRole("button", { name: "筛选状态" })).toContainText("1");
      await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
      await page.goForward();
      await expect(page.getByRole("button", { name: "筛选状态" })).not.toContainText("1");

      await page.evaluate(([q]) => {
        window.history.replaceState(null, "", `/parameter-admin/projects?q=${encodeURIComponent(q)}&status=not_initialized&sort=name-asc`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, [queryLabel] as const);
      await expect(search).toHaveValue(queryLabel);
      await expect(page.getByRole("button", { name: "筛选状态" })).toContainText("1");
      await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

      const desktopLayout = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>(".admin-list-page .horizontal-drag-scroll-rail");
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          railVisible: rail ? !rail.hidden && getComputedStyle(rail).display !== "none" : false
        };
      });
      expect(desktopLayout.pageOverflow).toBeLessThanOrEqual(1);
      expect(desktopLayout.railVisible).toBe(false);
      const desktopScreenshot = testInfo.outputPath("parameter-admin-projects-1440.png");
      await page.screenshot({ path: desktopScreenshot, fullPage: true });
      screenshotPaths.push(desktopScreenshot);

      const firstRow = page.getByRole("row").filter({ hasText: queryLabel }).first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.getByRole("button", { name: /配置工作台/ })).toBeVisible();

      await expect(firstRow.getByRole("button")).toHaveCount(2);
      await firstRow.getByRole("button", { name: /更多/ }).click();
      await page.getByRole("menuitem", { name: /编辑/ }).click();
      await expect(page.getByRole("dialog", { name: "编辑项目详情" })).toBeVisible();
      await page.getByRole("dialog", { name: "编辑项目详情" }).getByRole("button", { name: "取消" }).click();
      await firstRow.getByRole("button", { name: /更多/ }).click();
      await page.getByRole("menuitem", { name: /^删除影响预览 / }).click();
      const deletePreview = page.getByRole("dialog", { name: /项目删除影响预览/ });
      await expect(deletePreview).toBeVisible();
      await expect(deletePreview).toContainText("无法恢复");
      await expect(deletePreview).toContainText("平台共享参数定义");
      await expect(deletePreview.getByRole("button", { name: "确认彻底删除", exact: true })).toBeDisabled();
      await deletePreview.getByRole("button", { name: "关闭预览", exact: true }).click();
      await expect(page).toHaveURL(/\/parameter-admin\/projects\?/);

      const listUrl = page.url();
      await firstRow.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/parameter-admin\/projects\/td112-[^/]+\/configuration(?:\?|$)/);
      await page.goto(listUrl);
      await expect(page.getByRole("region", { name: "项目清单", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "下一页" }).click();
      await expect(page.getByText("第 2 / 2 页 · 共 12 条")).toBeVisible();
      await expect(page).toHaveURL(/page=2/);
      await page.reload();
      await dismissXiaozeHint(page);
      await expect(page.getByText("第 2 / 2 页 · 共 12 条")).toBeVisible();

      for (const screenshotPath of screenshotPaths) {
        await testInfo.attach(screenshotPath.split("/").at(-1) ?? "responsive-screenshot", {
          path: screenshotPath,
          contentType: "image/png"
        });
      }

      const layoutArtifact = await writeOperationJsonArtifact(testInfo, "parameter-admin-projects-layout.json", {
        desktop: desktopLayout,
        history: { reload: true, popstate: true, back: true, forward: true }
      });
      const listResponse = await request.get(apiRoute("/api/v1/parameters/admin/projects"), {
        headers: adminHeaders()
      });
      expect(listResponse.ok()).toBe(true);

      await recordOperationEvidence({
        operationId: "PARAM-ADMIN-003",
        title: "project Admin DataTable URL history and PC layout",
        status: "passed",
        role: "Admin",
        route: "/parameter-admin/projects",
        page,
        testInfo,
        artifacts: [...screenshotPaths, layoutArtifact],
        api: [
          summarizeApiResponse(listResponse, {
            method: "GET",
            path: "/api/v1/parameters/admin/projects",
            responseSummary: `seededProjects=${projectIds.length}`
          })
        ],
        notes:
          "Verified search/status/sort URL writes; reload, popstate, Back, and Forward restoration; >10 pagination; keyboard row entry; isolated edit/delete actions; and the PC 1440x900 no-page-overflow layout contract."
      });
    } finally {
      for (const projectId of projectIds.reverse()) {
        await request.delete(apiRoute(`/api/v1/parameters/admin/projects/${encodeURIComponent(projectId)}`), {
          headers: adminHeaders()
        });
      }
    }
  });
});
