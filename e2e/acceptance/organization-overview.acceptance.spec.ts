import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { authHeadersForRole, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/organization/workspace-summary", status: 503 }] });

test("organization overview and six entries retain scope, real counts and ordinary read-only access", async ({ page }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), org = `overview-${suffix}`, empty = `overview-empty-${suffix}`, admin = `overview-admin-${suffix}`, member = `overview-member-${suffix}`;
  const name = `协作验收组织-${suffix}`, scope = `?organizationId=${org}`;
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,$2),($3,'空组织')", [org, name, empty]);
    await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$3,'概览组织管理员','管理员',true),($2,$3,'概览普通成员','工程师',true)", [admin, member, org]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$5,'admin'),($3,$4,$5,'hardware-user')", [`${admin}-role`, admin, `${member}-role`, member, org]);
    await client.query("insert into organization_teams(id,organization_id,name) values($1,$2,'研发团队')", [`${org}-team`, org]);
    await client.query("insert into projects(id,organization_id,name,code,status) values($1,$3,'概览项目甲',$1,'initialized'),($2,$3,'概览项目乙',$2,'initialized')", [`${org}-project-a`, `${org}-project-b`, org]);
  });
  let suspendedSuccessfully = false;
  try {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let holding = true;
    await page.route(url => url.pathname === "/api/v1/organization/workspace-summary", async route => { if (holding) await hold; await route.continue(); });
    await signInBrowserAsRole(page, "platform-admin", `/organization${scope}`);
    await expect(page.getByRole("status", { name: "正在加载组织概览", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "成员 0", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("organization-overview-loading-1440.png"), animations: "disabled" });
    holding = false; release();
    await expect(page.getByRole("button", { name: "成员 2", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "团队 1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "项目 2", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("organization-overview-ready-1440.png"), animations: "disabled" });
    const nav = page.getByRole("navigation", { name: "组织管理范围", exact: true });
    for (const [label, path] of [["成员与权限", "members"], ["团队", "teams"], ["项目参与", "projects"], ["资源", "resources"], ["设置", "settings"], ["概览", ""]]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/organization${path ? `/${path}` : ""}\\?organizationId=${org}$`));
      await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(name);
      if (path === "members") await expect(page.getByRole("table", { name: "平台用户", exact: true })).toContainText("概览普通成员");
      if (path === "teams") await expect(page.getByRole("table", { name: "组织团队", exact: true })).toContainText("研发团队");
      if (path === "projects") await expect(page.getByRole("combobox", { name: "选择项目", exact: true })).toBeVisible();
    }
    await nav.getByRole("button", { name: "资源", exact: true }).click();
    for (const title of ["参数资源", "知识库", "日志分析", "设备代理", "集成凭据"]) await expect(page.getByRole("region", { name: "组织资源", exact: true }).getByRole("button", { name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "设备代理", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organization/bridges\\?organizationId=${org}$`));
    await page.getByRole("button", { name: "集成凭据", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organization/integrations\\?organizationId=${org}$`));
    await nav.getByRole("button", { name: "资源", exact: true }).click();
    for (const [title, destination] of [["参数资源", "/parameter-admin"], ["知识库", "/knowledge"], ["日志分析", "/logs"]]) {
      await page.getByRole("region", { name: "组织资源", exact: true }).getByRole("button", { name: title, exact: true }).click();
      await expect(page).toHaveURL(url => url.pathname === destination && url.searchParams.get("organizationId") === org);
      await prepareInteractionSurface(page);
      await page.goto(`/organization/resources${scope}`); await prepareInteractionSurface(page);
    }
    await page.screenshot({ path: testInfo.outputPath("organization-resources-1440.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await page.locator("body").evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("organization-resources-1280.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 900 });
    let failSummary = true;
    await page.route(url => url.pathname === "/api/v1/organization/workspace-summary", async route => {
      if (failSummary) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "组织概览暂不可用" } }) }); }
      else await route.continue();
    });
    await nav.getByRole("button", { name: "概览", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("组织概览暂不可用");
    await page.screenshot({ path: testInfo.outputPath("organization-overview-failure-1440.png"), animations: "disabled" });
    failSummary = false;
    await page.getByRole("button", { name: "重试", exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: "项目 2", exact: true })).toBeVisible();
    await page.goto(`/organization?organizationId=${empty}`); await prepareInteractionSurface(page);
    await expect(page.getByRole("button", { name: "成员 0", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("organization-overview-empty-1440.png"), animations: "disabled" });
    await page.getByRole("button", { name: "项目 0", exact: true }).click();
    await expect(page.getByText("创建项目后可在此查看参与名单。", { exact: false })).toBeVisible();
    await page.goto(`/parameters?organizationId=${empty}`);
    await prepareInteractionSurface(page);
    await expect(page.getByText("请先选择项目，或由管理员创建项目。", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("organization-parameters-empty-1440.png"), animations: "disabled" });
    await signInBrowserAsUser(page, admin, `${admin}@example.test`, "概览组织管理员", "/organization", org);
    await expect(page.getByRole("button", { name: "成员 2", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "组织目录", exact: true })).toHaveCount(0);
    const suspended = await page.request.patch(apiRoute(`/api/v1/platform/organizations/${org}/lifecycle`), { headers: authHeadersForRole("platform-admin"), data: { status: "suspended", expectedStatus: "active" } });
    expect(suspended.status()).toBe(200);
    suspendedSuccessfully = true;
    const adminRequests: string[] = [];
    const pausedSuggestions: string[] = [];
    page.on("request", request => { if (/\/api\/v1\/(users|organization\/(teams|project-candidates|invitations|project-handovers)|log-integration-credentials|device-bridges\/organization)(?:\?|$)/.test(request.url())) adminRequests.push(request.url()); });
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/v1/agent/xiaoze/suggest" && request.method() === "POST") pausedSuggestions.push(request.url()); });
    await signInBrowserAsUser(page, member, `${member}@example.test`, "概览普通成员", "/organization", org);
    await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText("已停用 · 仅可查看");
    await expect(page.getByRole("region", { name: "组织待办", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "项目 2", exact: true })).toBeVisible();
    for (const label of ["成员与权限", "团队", "项目参与"]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByText("此区域由组织管理员维护", { exact: true })).toBeVisible();
    }
    await nav.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(name);
    await expect(page.getByLabel("显示名称", { exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("organization-member-readonly-1440.png"), animations: "disabled" });
    await nav.getByRole("button", { name: "概览", exact: true }).click();
    await page.getByRole("button", { name: "项目 2", exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === "/parameters" && url.searchParams.get("organizationId") === org);
    await prepareInteractionSurface(page);
    await page.goto("/user-permissions"); await prepareInteractionSurface(page);
    await expect(page.getByText("此区域由组织管理员维护", { exact: true })).toBeVisible();
    expect(adminRequests).toEqual([]);
    await signInBrowserAsRole(page, "platform-admin", `/parameters${scope}`); await prepareInteractionSurface(page);
    await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText("所属组织：");
    await expect(page.getByRole("status").filter({ hasText: "组织已停用" })).toBeVisible();
    expect(pausedSuggestions).toEqual([]);
    const restored = await page.request.patch(apiRoute(`/api/v1/platform/organizations/${org}/lifecycle`), { headers: authHeadersForRole("platform-admin"), data: { status: "active", expectedStatus: "suspended" } });
    expect(restored.status()).toBe(200); suspendedSuccessfully = false;
    const proactiveEnabled = process.env.VITE_XIAOZE_PROACTIVE_ENABLED?.trim().toLowerCase() === "true";
    const resumed = proactiveEnabled ? page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/agent/xiaoze/suggest" && response.request().method() === "POST") : null;
    await page.reload(); await prepareInteractionSurface(page);
    if (resumed) expect((await resumed).status()).toBe(200);
    else expect(pausedSuggestions).toEqual([]);
    // The owned CI frontend deliberately disables opt-in suggestions. The same
    // restored Organization must still admit the real server operation.
    const restoredSuggestion = await page.request.post(apiRoute(`/api/v1/agent/xiaoze/suggest?organizationId=${org}`), {
      headers: authHeadersForRole("platform-admin"),
      data: { context: { pageKey: "parameters", projectId: `${org}-project-a`, path: `/parameters${scope}` } }
    });
    expect(restoredSuggestion.status()).toBe(200);
  } finally {
    if (suspendedSuccessfully) {
      const restored = await page.request.patch(apiRoute(`/api/v1/platform/organizations/${org}/lifecycle`), { headers: authHeadersForRole("platform-admin"), data: { status: "active", expectedStatus: "suspended" } });
      expect(restored.status()).toBe(200);
    }
  }
});
