import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);
const username = "organization.workspace.operator";
const operatorName = "工作区平台管理员";
type Organization = { id: string; name: string };
type Session = { token: string; auth: { user: { id: string; organizationId: string }; organization: Organization } };
function scopedResponse(page: Page, path: string, method: string, target: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === path && response.request().method() === method && url.searchParams.get("organizationId") === target;
  });
}

test.describe("fixed-target member and settings workspace", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane.");
  test.beforeAll(async () => {
    const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient(async (client) => {
      await client.query("insert into organizations(id,name) values('organization-workspace-home','工作区平台所属组织') on conflict(id) do nothing");
      await client.query("insert into users(id,organization_id,name,title,is_active) values('organization-workspace-operator','organization-workspace-home',$1,'平台管理员',true) on conflict(id) do update set is_active=true", [operatorName]);
      await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('organization-workspace-platform-role','organization-workspace-operator','organization-workspace-home','platform-admin') on conflict(id) do nothing");
      await client.query(`insert into user_password_credentials(user_id,username,password_hash) values('organization-workspace-operator',$1,$2)
        on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`, [username, passwordHash]);
    });
  });

  test("enters an organization, keeps two tabs independent and manages target accounts, settings and project duties", async ({ page }, testInfo) => {
    const login = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username, password: LOCAL_DEMO_SHARED_PASSWORD } });
    expect(login.status()).toBe(200);
    const session = await login.json() as Session, headers = { Authorization: `Bearer ${session.token}` };
    await page.addInitScript((token) => window.localStorage.setItem("wiseeff.localAuthToken", token), session.token);
    const suffix = randomUUID().slice(0, 8), organizationName = `组织范围验收-${suffix}`, memberName = `目标成员-${suffix}`, memberUsername = `workspace.${suffix}`;
    const created = await page.request.post(apiRoute("/api/v1/platform/organizations"), { headers, data: { name: organizationName,
      initialAdministrator: { name: `初始管理员-${suffix}`, username: `workspace.admin.${suffix}`, password: LOCAL_DEMO_SHARED_PASSWORD } } });
    expect(created.status()).toBe(201);
    const target = (await created.json() as { item: Organization }).item;
    const projectId = `workspace-project-${suffix}`, projectName = `目标项目-${suffix}`;
    await withPgClient((client) => client.query("insert into projects(id,organization_id,name,code,status) values($1,$2,$3,$4,'initialized')", [projectId, target.id, projectName, `W${suffix}`]));
    await page.goto("/platform/organizations"); await prepareInteractionSurface(page);
    await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(target.id);
    const row = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: organizationName });
    await row.getByRole("button", { name: "进入组织", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`organizationId=${target.id}`));
    await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText(organizationName);
    await page.getByRole("navigation", { name: "组织管理范围" }).getByRole("button", { name: "组织资料", exact: true }).click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(organizationName);

    const homePage = await page.context().newPage();
    await homePage.goto("/organization/settings"); await prepareInteractionSurface(homePage);
    await expect(homePage.getByLabel("显示名称", { exact: true })).toHaveValue(session.auth.organization.name);
    await page.getByLabel("显示名称", { exact: true }).fill(`${organizationName}-已改名`);
    await page.getByRole("button", { name: "返回所属组织", exact: true }).click();
    await page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true }).getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(`${organizationName}-已改名`);
    const rename = scopedResponse(page, "/api/v1/organization", "PATCH", target.id);
    await page.getByRole("button", { name: "保存组织名称", exact: true }).click(); expect((await rename).status()).toBe(200);
    await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText(`${organizationName}-已改名`);
    await expect(homePage.getByLabel("显示名称", { exact: true })).toHaveValue(session.auth.organization.name);
    await page.getByRole("button", { name: "成员与权限", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`organization/members\\?organizationId=${target.id}`));
    await expect(page.getByRole("table", { name: "平台用户", exact: true })).toContainText(`初始管理员-${suffix}`);
    await expect(page.getByRole("table", { name: "平台用户", exact: true })).not.toContainText(operatorName);
    await page.getByRole("button", { name: "添加成员", exact: true }).click();
    await page.getByRole("button", { name: "直接创建账号", exact: true }).click();
    const adding = page.getByRole("dialog", { name: "添加成员", exact: true });
    await adding.getByLabel("姓名", { exact: true }).fill(memberName);
    await adding.getByLabel("用户名", { exact: true }).fill(memberUsername);
    await adding.getByLabel("初始密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    await adding.getByLabel("确认密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const creating = scopedResponse(page, "/api/v1/users", "POST", target.id);
    await adding.getByRole("button", { name: "创建账号", exact: true }).click();
    const accountResponse = await creating; expect(accountResponse.status()).toBe(201);
    const account = (await accountResponse.json() as { item: { id: string; organizationId: string } }).item;
    expect(account.organizationId).toBe(target.id);
    let memberRow = page.getByRole("table", { name: "平台用户", exact: true }).getByRole("row").filter({ hasText: memberUsername });
    await memberRow.getByRole("button", { name: `查看 ${memberName} 的成员资料`, exact: true }).click();
    const details = page.getByRole("dialog", { name: `${memberName} · 成员资料`, exact: true });
    await details.getByLabel("姓名", { exact: true }).fill(`${memberName}-已改名`);
    const profile = scopedResponse(page, `/api/v1/users/${account.id}`, "PATCH", target.id);
    await details.getByRole("form", { name: "成员基本资料", exact: true }).getByRole("button", { name: "保存基本资料", exact: true }).click(); expect((await profile).status()).toBe(200);
    const renamedDetails = page.getByRole("dialog", { name: `${memberName}-已改名 · 成员资料`, exact: true });
    await renamedDetails.getByRole("tab", { name: "访问权限", exact: true }).click();
    await renamedDetails.getByRole("checkbox", { name: "软件开发", exact: true }).check();
    await renamedDetails.getByRole("form", { name: "组织角色设置", exact: true }).getByRole("button", { name: "保存组织角色", exact: true }).click();
    const roles = scopedResponse(page, `/api/v1/users/${account.id}/organization-roles`, "PUT", target.id);
    await page.getByRole("dialog", { name: "确认调整用户角色", exact: true }).getByRole("button", { name: "确认调整", exact: true }).click(); expect((await roles).status()).toBe(200);
    await renamedDetails.getByRole("tab", { name: "项目职责", exact: true }).click();
    await renamedDetails.getByRole("button", { name: `配置 ${memberName}-已改名 在 ${projectName} 的职责`, exact: true }).click();
    await renamedDetails.getByRole("checkbox", { name: `为 ${memberName}-已改名 配置 软件 MDE`, exact: true }).check();
    await renamedDetails.getByRole("form", { name: "项目审核角色设置", exact: true }).getByRole("button", { name: "保存审核职责", exact: true }).click();
    const duties = scopedResponse(page, `/api/v1/projects/${projectId}/workflow-role-bindings/${account.id}`, "PUT", target.id);
    await page.getByRole("dialog", { name: "确认更新项目审核角色", exact: true }).getByRole("button", { name: "确认保存", exact: true }).click(); expect((await duties).status()).toBe(200);
    await renamedDetails.getByRole("button", { name: "关闭", exact: true }).click();
    memberRow = page.getByRole("table", { name: "平台用户", exact: true }).getByRole("row").filter({ hasText: memberUsername });
    await memberRow.getByRole("button", { name: /：更多$/ }).click();
    await page.getByRole("menuitem", { name: `重置 ${memberName}-已改名 的密码`, exact: true }).click();
    const resetting = page.getByRole("dialog", { name: "重置密码", exact: true });
    await resetting.getByLabel("新密码", { exact: true }).fill(`${LOCAL_DEMO_SHARED_PASSWORD}-replacement`);
    await resetting.getByLabel("确认新密码", { exact: true }).fill(`${LOCAL_DEMO_SHARED_PASSWORD}-replacement`);
    await page.goBack();
    await page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true }).getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`organization/members\\?organizationId=${target.id}`));
    await expect(resetting.getByLabel("新密码", { exact: true })).toHaveValue(`${LOCAL_DEMO_SHARED_PASSWORD}-replacement`);
    const password = scopedResponse(page, `/api/v1/users/${account.id}/password`, "POST", target.id);
    await resetting.getByRole("button", { name: "确认重置", exact: true }).click(); expect((await password).status()).toBe(200);
    const memberLogin = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: memberUsername, password: `${LOCAL_DEMO_SHARED_PASSWORD}-replacement` } });
    expect(memberLogin.status()).toBe(200);
    expect((await memberLogin.json() as Session).auth.organization.id).toBe(target.id);
    for (const action of ["停用", "启用"] as const) {
      await memberRow.getByRole("button", { name: /：更多$/ }).click(); await page.getByRole("menuitem", { name: action, exact: true }).click();
      const activation = scopedResponse(page, `/api/v1/users/${account.id}/activation`, "PATCH", target.id);
      await page.getByRole("dialog", { name: `确认${action}用户`, exact: true }).getByRole("button", { name: `确认${action}`, exact: true }).click(); expect((await activation).status()).toBe(200);
    }
    await memberRow.getByRole("button", { name: `查看 ${memberName}-已改名 的成员资料`, exact: true }).click();
    const teamSource = page.getByRole("dialog", { name: `${memberName}-已改名 · 成员资料`, exact: true });
    await teamSource.getByLabel("姓名", { exact: true }).fill("未保存的成员姓名");
    await teamSource.getByRole("button", { name: "管理团队归属", exact: true }).click();
    await page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true }).getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(teamSource.getByLabel("姓名", { exact: true })).toHaveValue("未保存的成员姓名");
    await teamSource.getByRole("button", { name: "管理团队归属", exact: true }).click();
    await page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true }).getByRole("button", { name: "放弃并离开", exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === "/organization/teams" && url.searchParams.get("organizationId") === target.id && url.searchParams.get("memberId") === account.id);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`/organization/members?organizationId=${target.id}`); await prepareInteractionSurface(page);
    await expect(memberRow).toContainText(`${memberName}-已改名`);
    await expect(memberRow).not.toContainText("未保存的成员姓名");
    await page.screenshot({ path: testInfo.outputPath("organization-target-members-1440.png"), animations: "disabled" });
    await memberRow.getByRole("button", { name: /：更多$/ }).click(); await page.getByRole("menuitem", { name: `注销 ${memberName}-已改名`, exact: true }).click();
    const deleting = scopedResponse(page, `/api/v1/users/${account.id}`, "DELETE", target.id);
    await page.getByRole("dialog", { name: "确认注销用户", exact: true }).getByRole("button", { name: "确认注销", exact: true }).click(); expect((await deleting).status()).toBe(204);
    await expect(memberRow).toHaveCount(0);
    const actorAfter = await page.request.get(apiRoute("/api/v1/me"), { headers });
    expect((await actorAfter.json() as Session["auth"]).organization).toEqual(session.auth.organization);
    await homePage.close();
  });
});
