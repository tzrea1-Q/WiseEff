import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { installBrowserDiagnostics, useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "PUT", path: "/api/v1/projects/bulk-ui-project/members/bulk-ui-alice", status: 409 },
  { method: "PUT", path: "/api/v1/projects/bulk-ui-project/members/bulk-ui-bob", status: 503 }
] });
test.describe("concrete team project role grants", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane.");
  test.beforeAll(async () => {
    const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient(async (db) => {
      await db.query("insert into organizations(id,name) values('bulk-ui-home','批量授权平台所属组织'),('bulk-ui-target','批量授权目标组织') on conflict(id) do nothing");
      await db.query(`insert into users(id,organization_id,name,title,is_active) values
        ('bulk-ui-platform','bulk-ui-home','批量授权平台管理员','平台管理员',true),
        ('bulk-ui-alice','bulk-ui-target','甲工程师','研发',true),('bulk-ui-bob','bulk-ui-target','乙工程师','研发',true),
        ('bulk-ui-inactive','bulk-ui-target','停用工程师','研发',false),('bulk-ui-later','bulk-ui-target','后加入工程师','研发',true) on conflict(id) do nothing`);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('bulk-ui-platform-role','bulk-ui-platform','bulk-ui-home','platform-admin'),('bulk-ui-bob-role','bulk-ui-bob','bulk-ui-target','guest') on conflict(id) do nothing");
      for (const [id, username] of [["bulk-ui-platform", "bulk.ui.platform"], ["bulk-ui-bob", "bulk.ui.bob"]]) await db.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,$2,$3) on conflict(user_id) do update set password_hash=excluded.password_hash`, [id, username, passwordHash]);
      await db.query("insert into projects(id,organization_id,name,code) values('bulk-ui-project','bulk-ui-target','批量授权项目','BULKUI'),('bulk-ui-home-project','bulk-ui-home','所属组织项目','BULKHOME') on conflict(id) do nothing");
      await db.query("insert into project_members(organization_id,project_id,user_id,roles) values('bulk-ui-target','bulk-ui-project','bulk-ui-alice',array['hardware-user']) on conflict(organization_id,project_id,user_id) do update set roles=excluded.roles");
      await db.query("delete from project_members where project_id='bulk-ui-project' and user_id<>'bulk-ui-alice'");
      await db.query("insert into organization_teams(id,organization_id,name) values('bulk-ui-team','bulk-ui-target','研发团队') on conflict(id) do nothing");
      await db.query("delete from organization_team_members where team_id='bulk-ui-team'");
      await db.query("insert into organization_team_members(team_id,organization_id,user_id) values('bulk-ui-team','bulk-ui-target','bulk-ui-alice'),('bulk-ui-team','bulk-ui-target','bulk-ui-bob'),('bulk-ui-team','bulk-ui-target','bulk-ui-inactive')");
    });
  });
  test("previews explicit people, retains mixed results and safely retries without inheriting later team changes", async ({ page }, testInfo) => {
    const login = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: "bulk.ui.platform", password: LOCAL_DEMO_SHARED_PASSWORD } });
    expect(login.status()).toBe(200);
    const { token } = await login.json() as { token: string };
    const headers = { Authorization: `Bearer ${token}` };
    await page.addInitScript((value) => localStorage.setItem("wiseeff.localAuthToken", value), token);
    await page.goto("/organization/projects?organizationId=bulk-ui-target"); await prepareInteractionSurface(page);
    await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText("批量授权目标组织");
    const home = await page.context().newPage(), homeDiagnostics = installBrowserDiagnostics(home, testInfo);
    await home.goto("/organization/projects"); await prepareInteractionSurface(home);
    await expect(home.getByRole("region", { name: "当前操作组织" })).toContainText("批量授权平台所属组织");
    await expect(home.getByRole("button", { name: "批量授予项目角色", exact: true })).toBeVisible();

    const open = page.getByRole("button", { name: "批量授予项目角色", exact: true });
    await open.focus(); await open.press("Enter");
    const dialog = page.getByRole("dialog", { name: "批量授予项目角色", exact: true });
    const selector = dialog.getByRole("combobox", { name: "选择来源团队" });
    await selector.focus(); await selector.press("Enter"); await page.getByRole("option", { name: "研发团队", exact: true }).click();
    await dialog.getByRole("button", { name: "授予项目编辑角色", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "软件开发", exact: true }).check();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "预览授权", exact: true }).click();
    const table = dialog.getByRole("table", { name: "批量项目授权结果" });
    await expect(table.getByRole("row").filter({ hasText: "甲工程师" })).toContainText("硬件开发、软件开发");
    await expect(table.getByRole("row").filter({ hasText: "停用工程师" })).toContainText("账号已停用，未授予角色");
    await page.screenshot({ path: testInfo.outputPath("team-project-grants-preview-1440.png"), animations: "disabled" });
    const alicePath = "/api/v1/projects/bulk-ui-project/members/bulk-ui-alice?organizationId=bulk-ui-target";
    expect((await page.request.put(apiRoute(alicePath), { headers, data: { roles: ["hardware-user", "hardware-committer"], expectedRoles: ["hardware-user"] } })).status()).toBe(200);
    const bobRoute = (url: URL) => url.pathname === "/api/v1/projects/bulk-ui-project/members/bulk-ui-bob";
    await page.route(bobRoute, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Temporarily unavailable" } }) }));
    await dialog.getByRole("button", { name: "确认授予 2 人", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("已生效 0 人，待处理 3 人");
    await expect(table.getByRole("row").filter({ hasText: "甲工程师" })).toContainText("项目参与角色已更新");
    await expect(table.getByRole("row").filter({ hasText: "乙工程师" })).toContainText("请重新核对后重试");
    await page.screenshot({ path: testInfo.outputPath("team-project-grants-mixed-results-1440.png"), animations: "disabled" });
    await page.unroute(bobRoute);
    await dialog.getByRole("button", { name: "重新核对未完成项", exact: true }).click();
    await expect(table.getByRole("row").filter({ hasText: "甲工程师" })).toContainText("硬件MDE、硬件开发、软件开发");
    await dialog.getByRole("button", { name: "确认授予 2 人", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("已生效 2 人，待处理 1 人");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("team-project-grants-results-1280.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(open).toBeFocused();
    const rosterPath = "/api/v1/projects/bulk-ui-project/members?organizationId=bulk-ui-target";
    const granted = await (await page.request.get(apiRoute(rosterPath), { headers })).json();
    expect((await page.request.put(apiRoute("/api/v1/organization/teams/bulk-ui-team/members?organizationId=bulk-ui-target"), { headers, data: { userIds: ["bulk-ui-later"] } })).status()).toBe(200);
    expect(await (await page.request.get(apiRoute(rosterPath), { headers })).json()).toEqual(granted);
    const bobLogin = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: "bulk.ui.bob", password: LOCAL_DEMO_SHARED_PASSWORD } });
    expect(bobLogin.status()).toBe(200);
    const bobToken = (await bobLogin.json() as { token: string }).token;
    const bobIdentity = await (await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${bobToken}` } })).json() as { projectMemberships: unknown; roles: unknown };
    expect(bobIdentity.projectMemberships).toEqual([{ projectId: "bulk-ui-project", roles: ["software-user"] }]);
    expect(bobIdentity.roles).toEqual([{ projectId: null, roleId: "guest" }]);
    await expect(home.getByRole("combobox", { name: "选择项目" })).toContainText("所属组织项目");
    homeDiagnostics.assertNoBrowserDiagnosticsFailures(); await home.close();
  });
});
