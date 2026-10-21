import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type APIRequestContext } from "playwright/test";
import { apiRoute } from "./helpers/runtime";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import type { RegistrationRoleRequestDto } from "../../server/modules/users/types";
import type { AuthContext } from "../../server/modules/auth/types";
import { authHeadersForRole } from "./helpers/bearerAuth";
import { createBearerTokenForUser } from "./helpers/runtime";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/users/registration-role-requests", status: 503 }] });
const password = "registration-browser-password";
const local = process.env.AUTH_PROVIDER === "local" && !process.env.VITE_WISEEFF_API_AUTHORIZATION && !process.env.M5_SMOKE_AUTHORIZATION && !process.env.WISEEFF_SMOKE_AUTHORIZATION;
type Applicant = { username: string; name: string; token?: string };
async function signIn(page: Page, token: string, path: string) {
  await page.goto("/favicon.svg"); await page.evaluate(value => localStorage.setItem("wiseeff.localAuthToken", value), token);
  await page.goto(path); await prepareInteractionSurface(page);
}
async function applicant(request: APIRequestContext, name: string): Promise<Applicant> {
  const username = `registration.${randomUUID()}`;
  if (!local) {
    // A deployment may retain local pending requests after switching provider.
    // HMAC acceptance uses an existing request, never a nonexistent signup route.
    const userId = `registration-${randomUUID()}`;
    await withPgClient(async client => {
      await client.query("insert into users(id,organization_id,name,title,is_active) values($1,'org-chargelab',$2,'Applicant',false)", [userId, name]);
      await client.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values($1,$2,'org-chargelab',null,'software-user')", [randomUUID(), userId]);
      await client.query("insert into local_registration_role_requests(id,user_id,organization_id,current_role_id,requested_role_id) values($1,$2,'org-chargelab','software-user','software-committer')", [randomUUID(), userId]);
    });
    const authorization = createBearerTokenForUser(userId, `${userId}@example.test`, name); expect(authorization).toBeTruthy();
    return { username, name, token: authorization!.replace(/^Bearer\s+/, "") };
  }
  const created = await request.post(apiRoute("/api/v1/auth/register"), { data: { username, name, password, roleId: "software-committer" } }); expect(created.status()).toBe(202);
  return { username, name };
}
async function administrator(request: APIRequestContext) {
  if (!local) { await seedAcceptanceRoleMatrix(); return { token: authHeadersForRole("admin").Authorization.replace(/^Bearer\s+/, "") }; }
  const username = `registration.admin.${randomUUID()}`;
  const created = await request.post(apiRoute("/api/v1/auth/register"), { data: { username, name: "注册审批管理员", password, roleId: "software-user" } }); expect(created.status()).toBe(201);
  const identity = await created.json() as { auth: { user: { id: string } }; token: string };
  await withPgClient(client => client.query("update user_role_bindings set role_id='admin' where user_id=$1 and project_id is null", [identity.auth.user.id]));
  const login = await request.post(apiRoute("/api/v1/auth/login"), { data: { username, password } }); expect(login.status()).toBe(200);
  return { token: (await login.json() as { token: string }).token };
}

async function authenticate(request: APIRequestContext, target: Applicant) {
  const response = local ? await request.post(apiRoute("/api/v1/auth/login"), { data: { username: target.username, password } })
    : await request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${target.token}` } });
  const body = await response.json() as { token: string; auth: AuthContext } & AuthContext;
  return { status: response.status(), token: local ? body.token : target.token!, auth: local ? body.auth : body };
}

test(`${local ? "local signup" : "existing request under HMAC"}: enables an applicant by keyboard, retaining failure and recording access`, async ({ page, request }, testInfo) => {
  expect((await (await request.get(apiRoute("/api/v1/auth/local-config"))).json()).provider).toBe(local ? "local" : "hmac");
  if (!local) expect((await request.post(apiRoute("/api/v1/auth/register"), { data: { username: "unavailable.signup", name: "Unavailable", password } })).status()).toBe(404);
  const admin = await administrator(request), target = await applicant(request, `普通成员启用-${Date.now().toString(36)}`);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const pending = await request.get(apiRoute("/api/v1/users/registration-role-requests"), { headers }); expect(pending.status()).toBe(200);
  const item = (await pending.json() as { items: RegistrationRoleRequestDto[] }).items.find(item => item.userName === target.name)!;
  expect(item.currentRoleId).toBe("software-user");
  const login = () => authenticate(request, target); expect((await login()).status).toBe(403);
  await signIn(page, admin.token, "/organization/members?tab=approvals");
  const row = page.locator("article").filter({ has: page.getByText(target.name, { exact: true }) });
  await expect(row.getByRole("button", { name: "批准申请角色", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "拒绝并保持停用", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "按普通成员启用", exact: true }).focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "按普通成员启用？", exact: true });
  await expect(dialog).toContainText("软件开发"); await expect(dialog).toContainText("不授予申请角色"); await expect(dialog).toContainText(target.name);
  const path = `/api/v1/users/registration-role-requests/${item.id}/enable-basic`;
  await page.route(`**${path}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "启用暂时不可用，请重试。" } }) }), { times: 1 });
  await dialog.getByRole("button", { name: "启用普通成员", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("请重试"); await expect(dialog).toContainText(target.name); expect((await login()).status).toBe(403);
  const failureImage = testInfo.outputPath("registration-basic-failure-1440.png"); await page.screenshot({ path: failureImage, animations: "disabled" }); await testInfo.attach("registration-basic-failure-1440", { path: failureImage, contentType: "image/png" });
  const completed = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === path);
  await dialog.getByRole("button", { name: "启用普通成员", exact: true }).focus(); await page.keyboard.press("Enter");
  const response = await completed; expect(response.status()).toBe(200); expect((await response.json() as { item: RegistrationRoleRequestDto }).item).toMatchObject({ decisionOutcome: "basic-enabled", decisionCanLogin: true, decisionRoleIds: ["software-user"] });
  await expect(dialog).toHaveCount(0); await expect(row).toHaveCount(0);
  await page.getByRole("radio", { name: "处理历史", exact: true }).focus(); await page.keyboard.press("Space");
  const history = page.locator("article").filter({ has: page.getByText(target.name, { exact: true }) });
  await expect(history.getByText("已按软件开发启用", { exact: true })).toBeVisible(); await expect(history.getByText("决定时：可登录 · 软件开发", { exact: true })).toBeVisible();
  await page.reload(); await expect(history.getByText("已按软件开发启用", { exact: true })).toBeVisible();
  const readyImage = testInfo.outputPath("registration-basic-history-1440.png"); await page.screenshot({ path: readyImage, animations: "disabled" }); await testInfo.attach("registration-basic-history-1440", { path: readyImage, contentType: "image/png" });
  const user = await login(); expect(user.status).toBe(200);
  expect(user.auth.roles).toEqual([{ projectId: null, roleId: "software-user" }]); expect(user.auth.permissions).not.toContain("parameter:review");
  const notices = await request.get(apiRoute("/api/v1/notifications"), { headers: { Authorization: `Bearer ${user.token}` } });
  expect((await notices.json() as { items: Array<{ body: string; metadata: { requestId?: string } }> }).items.find(notice => notice.metadata.requestId === item.id)?.body).toContain("软件开发；可登录");
  await signIn(page, user.token, "/feedback"); await expect(page.getByRole("button", { name: /打开用户菜单$/ })).toContainText(target.name);
});

test(`${local ? "local signup" : "existing request under HMAC"}: closes an obsolete request without replacing newer account settings`, async ({ page, request }, testInfo) => {
  const admin = await administrator(request), target = await applicant(request, `保留管理调整-${Date.now().toString(36)}`), headers = { Authorization: `Bearer ${admin.token}` };
  const pending = await request.get(apiRoute("/api/v1/users/registration-role-requests"), { headers });
  const item = (await pending.json() as { items: RegistrationRoleRequestDto[] }).items.find(item => item.userName === target.name)!;
  expect((await request.put(apiRoute(`/api/v1/users/${item.userId}/organization-roles`), { headers, data: { roles: ["hardware-user"], expectedRoles: ["software-user"] } })).status()).toBe(200);
  expect((await request.patch(apiRoute(`/api/v1/users/${item.userId}/activation`), { headers, data: { isActive: true } })).status()).toBe(200);
  await signIn(page, admin.token, "/organization/members?tab=approvals");
  const row = page.locator("article").filter({ has: page.getByText(target.name, { exact: true }) });
  await expect(row.getByRole("button", { name: "批准申请角色", exact: true })).toBeDisabled(); await expect(row.getByRole("button", { name: "按普通成员启用", exact: true })).toBeDisabled();
  await row.getByRole("button", { name: "关闭申请，保留现状", exact: true }).focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "拒绝注册申请？", exact: true }); await expect(dialog).toContainText("保留最新设置");
  await dialog.getByRole("button", { name: "确认拒绝", exact: true }).focus(); await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
  await page.getByRole("radio", { name: "处理历史", exact: true }).click();
  const history = page.locator("article").filter({ has: page.getByText(target.name, { exact: true }) });
  await expect(history.getByText("已拒绝提升，保留账号设置", { exact: true })).toBeVisible(); await expect(history.getByText("决定时：可登录 · 硬件开发", { exact: true })).toBeVisible();
  const preservedImage = testInfo.outputPath("registration-preserved-history-1440.png"); await page.screenshot({ path: preservedImage, animations: "disabled" }); await testInfo.attach("registration-preserved-history-1440", { path: preservedImage, contentType: "image/png" });
  const login = await authenticate(request, target); expect(login.status).toBe(200);
  expect(login.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
});
