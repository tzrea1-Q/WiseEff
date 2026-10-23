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
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/projects/roster-ui-one/members", status: 503 }] });

test.describe("explicit project participation roster", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane.");
  test.beforeAll(async () => {
    const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient(async (db) => {
      await db.query("insert into organizations(id,name) values('roster-ui-home','项目平台所属组织'),('roster-ui-target','项目参与目标组织') on conflict(id) do nothing");
      for (const [id, org, name, active] of [
        ["roster-ui-platform", "roster-ui-home", "项目名单平台管理员", true],
        ["roster-ui-editor", "roster-ui-target", "存量项目编辑者", true],
        ["roster-ui-inactive", "roster-ui-target", "停用项目编辑者", false]
      ] as const) {
        await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$3,'研发工程师',$4) on conflict(id) do nothing", [id, org, name, active]);
      }
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('roster-ui-platform-role','roster-ui-platform','roster-ui-home','platform-admin') on conflict(id) do nothing");
      await db.query(`insert into user_password_credentials(user_id,username,password_hash) values('roster-ui-platform','roster.ui.platform',$1)
        on conflict(user_id) do update set password_hash=excluded.password_hash`, [passwordHash]);
      await db.query(`insert into projects(id,organization_id,name,code) values
        ('roster-ui-one','roster-ui-target','A 已有参与项目','ROSTER'),
        ('roster-ui-empty','roster-ui-target','B 无参与项目','EMPTY'),
        ('roster-ui-home-project','roster-ui-home','所属组织项目','HOME') on conflict(id) do nothing`);
      await db.query(`insert into project_members(organization_id,project_id,user_id,roles) values
        ('roster-ui-target','roster-ui-one','roster-ui-editor',array['hardware-user','software-committer']),
        ('roster-ui-target','roster-ui-one','roster-ui-inactive',array['software-user']) on conflict do nothing`);
    });
  });

  test("reads target participation, preserves inactive accounts and isolates empty and late project responses", async ({ page }, testInfo) => {
    const login = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: "roster.ui.platform", password: LOCAL_DEMO_SHARED_PASSWORD } });
    expect(login.status()).toBe(200);
    const { token } = await login.json() as { token: string };
    await page.addInitScript((value) => localStorage.setItem("wiseeff.localAuthToken", value), token);
    const headers = { Authorization: `Bearer ${token}` };
    await page.goto("/organization/projects?organizationId=roster-ui-target");
    await prepareInteractionSurface(page);
    await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText("项目参与目标组织");
    const table = page.getByRole("table", { name: "项目参与名单", exact: true });
    await expect(table).toContainText("存量项目编辑者");
    await expect(table).toContainText("停用项目编辑者");
    await expect(table).toContainText("硬件开发、软件MDE");
    await expect(table.getByRole("row").filter({ hasText: "停用项目编辑者" })).toContainText("已停用");
    await expect(table.getByRole("button", { name: /编辑|修改|删除|保存/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("project-members-1440.png"), animations: "disabled" });

    const home = await page.context().newPage();
    const homeDiagnostics = installBrowserDiagnostics(home, testInfo);
    await home.goto("/organization/projects"); await prepareInteractionSurface(home);
    await expect(home.getByRole("region", { name: "当前操作组织" })).toContainText("项目平台所属组织");
    await expect(home.getByText("暂无项目参与者", { exact: true })).toBeVisible();
    await expect(home.getByRole("combobox", { name: "选择项目" })).toContainText("所属组织项目");

    const selector = page.getByRole("combobox", { name: "选择项目" });
    await selector.focus(); await selector.press("Enter");
    await page.getByRole("option", { name: "B 无参与项目", exact: true }).click();
    await expect(page.getByText("暂无项目参与者", { exact: true })).toBeVisible();
    await expect(page.getByText("存量项目编辑者", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("project-members-empty-1440.png"), animations: "disabled" });

    const projectRoute = (url: URL) => url.pathname === "/api/v1/projects/roster-ui-one/members";
    await page.route(projectRoute, (route) => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Project roster temporarily unavailable." } })
    }));
    await selector.click(); await page.getByRole("option", { name: "A 已有参与项目", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("存量项目编辑者", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("project-members-error-1440.png"), animations: "disabled" });
    await page.unroute(projectRoute);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(table).toContainText("存量项目编辑者");
    await selector.click(); await page.getByRole("option", { name: "B 无参与项目", exact: true }).click();
    await expect(page.getByText("暂无项目参与者", { exact: true })).toBeVisible();

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const received = new Promise<void>((resolve) => { started = resolve; });
    await page.route(projectRoute, async (route) => {
      const response = await route.fetch(); started(); await held; await route.fulfill({ response });
    });
    await selector.click(); await page.getByRole("option", { name: "A 已有参与项目", exact: true }).click();
    await received;
    await selector.click(); await page.getByRole("option", { name: "B 无参与项目", exact: true }).click();
    const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/projects/roster-ui-one/members");
    release(); await lateResponse;
    await page.unroute(projectRoute);
    await expect(page.getByText("暂无项目参与者", { exact: true })).toBeVisible();
    await expect(page.getByText("存量项目编辑者", { exact: true })).toHaveCount(0);
    await expect(selector).toContainText("B 无参与项目");
    const identity = await page.request.get(apiRoute("/api/v1/me"), { headers });
    expect((await identity.json() as { organization: { id: string } }).organization.id).toBe("roster-ui-home");
    await withPgClient(async (db) => {
      expect((await db.query("select is_active from users where id='roster-ui-inactive'")).rows).toEqual([{ is_active: false }]);
      expect((await db.query("select project_id from user_role_bindings where user_id='roster-ui-platform'")).rows).toEqual([{ project_id: null }]);
    });
    homeDiagnostics.assertNoBrowserDiagnosticsFailures();
    await home.close();
  });
});
