import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { selectControlOption } from "./helpers/selectControl";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "GET", path: "/api/v1/me", status: 401 }, // Actual signed-out login screen.
  { method: "PUT", path: "/api/v1/users/", status: 409 } // The real last-administrator refusal asserted below.
] });

const operatorUsername = "organization.succession.operator";
type Session = { token: string; auth: { user: { id: string }; permissions: string[] } };
type Organization = { id: string; name: string; administrators: Array<{ id: string; name: string }> };

async function signIn(page: Page, username: string, route: string) {
  await page.goto(route);
  await expect(page.getByRole("heading", { name: "登录雷泽", exact: true })).toBeVisible();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  const loggingIn = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const response = await loggingIn; expect(response.status()).toBe(200);
  await prepareInteractionSurface(page);
  return await response.json() as Session;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /打开用户菜单$/ }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录雷泽", exact: true })).toBeVisible();
}

async function requestSelfDemotion(page: Page, name: string, userId: string) {
  await page.getByRole("button", { name: `查看 ${name} 的成员资料`, exact: true }).click();
  const details = page.getByRole("dialog", { name: `${name} · 成员资料`, exact: true });
  const form = details.getByRole("form", { name: "组织角色设置", exact: true });
  await form.getByRole("checkbox", { name: "软件开发", exact: true }).check();
  await form.getByRole("checkbox", { name: "管理员", exact: true }).uncheck();
  await form.getByRole("button", { name: "保存", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "确认调整用户角色", exact: true });
  const saving = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/users/${userId}/organization-roles` && response.request().method() === "PUT");
  await confirmation.getByRole("button", { name: "确认调整", exact: true }).focus(); await page.keyboard.press("Enter");
  return { response: await saving, details, confirmation, form };
}

test.describe("organization administrator succession with actual local login", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the native local-provider lane and real password login; shared HMAC/OIDC runs do not establish this local session/recovery acceptance.");
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
    const hash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient((client) => client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,$2,$3)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`, [acceptanceCast.platformOperator.userId, operatorUsername, hash]));
  });

  test("protects the last administrator, completes emergency recovery and refreshes a departing administrator's authority", async ({ page }, testInfo) => {
    // API prepares only this test's isolated Organization; all governance under test uses the actual UI.
    const operator = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: operatorUsername, password: LOCAL_DEMO_SHARED_PASSWORD } });
    expect(operator.status()).toBe(200);
    const operatorSession = await operator.json() as Session;
    const suffix = randomUUID().slice(0, 8), firstName = `离任管理员-${suffix}`, nextName = `接任管理员-${suffix}`;
    const firstUsername = `succession.${suffix}`, nextUsername = `${firstUsername}.next`;
    const created = await page.request.post(apiRoute("/api/v1/platform/organizations"), { headers: { Authorization: `Bearer ${operatorSession.token}` }, data: {
      name: `管理员交接验收-${suffix}`, initialAdministrator: { name: firstName, username: firstUsername, password: LOCAL_DEMO_SHARED_PASSWORD }
    } });
    expect(created.status()).toBe(201);
    const organization = (await created.json() as { item: Organization }).item, firstId = organization.administrators[0].id;

    await signIn(page, firstUsername, "/organization/members");
    const refused = await requestSelfDemotion(page, firstName, firstId);
    expect(refused.response.status()).toBe(409);
    await expect(refused.confirmation.getByRole("alert")).toContainText("组织至少需要保留一位可登录的有效管理员");
    await page.screenshot({ path: testInfo.outputPath("last-organization-administrator-protected-1440.png"), animations: "disabled" });
    await refused.confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await refused.form.getByRole("button", { name: "放弃", exact: true }).click();
    await refused.details.getByRole("button", { name: "关闭", exact: true }).click();
    await signOut(page);

    await signIn(page, operatorUsername, "/platform/organizations");
    const directoryRefresh = () => page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === organization.id);
    const searching = directoryRefresh();
    await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(organization.id);
    expect((await searching).status()).toBe(200);
    const row = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: organization.name });
    await row.getByRole("button", { name: "查看", exact: true }).click();
    const details = page.getByRole("dialog", { name: "组织资料", exact: true });
    await expect(details).toContainText("当前有 1 位可登录的组织管理员");
    await details.getByRole("button", { name: "紧急停用管理员", exact: true }).click();
    await selectControlOption(details.getByRole("combobox", { name: "紧急停用的管理员", exact: true }), firstId);
    await details.getByLabel("紧急停用原因", { exact: true }).fill("管理员离职，先停用再指定接任者");
    const disabling = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/administrators/${firstId}/emergency-disable`) && response.request().method() === "POST");
    const disabledDirectory = directoryRefresh();
    await details.getByRole("button", { name: "确认紧急停用", exact: true }).focus(); await page.keyboard.press("Enter");
    expect((await disabling).status()).toBe(200);
    expect((await disabledDirectory).status()).toBe(200);
    await expect(details).toContainText("当前没有可登录的组织管理员，请指定负责人");
    await page.screenshot({ path: testInfo.outputPath("organization-awaiting-administrator-recovery-1440.png"), animations: "disabled" });

    await details.getByRole("button", { name: "新建管理员", exact: true }).click();
    await details.getByLabel("新管理员姓名", { exact: true }).fill(nextName);
    await details.getByLabel("新管理员用户名", { exact: true }).fill(nextUsername);
    await details.getByLabel("新管理员初始密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const recovered = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/${organization.id}/administrator-recovery`) && response.request().method() === "POST");
    const recoveredDirectory = directoryRefresh();
    await details.getByRole("button", { name: "确认指定管理员", exact: true }).focus(); await page.keyboard.press("Enter");
    const recoveryResponse = await recovered; expect(recoveryResponse.status()).toBe(200);
    expect((await recoveredDirectory).status()).toBe(200);
    const successorId = (await recoveryResponse.json() as { item: Organization }).item.administrators.find((admin) => admin.name === nextName)!.id;
    await expect(details).toContainText("当前有 1 位可登录的组织管理员");
    await expect(details).toContainText(nextName);
    await page.screenshot({ path: testInfo.outputPath("organization-administrator-recovered-1440.png"), animations: "disabled" });
    await details.getByRole("button", { name: "指定现有成员", exact: true }).click();
    await selectControlOption(details.getByRole("combobox", { name: "接任成员", exact: true }), firstId);
    const appointing = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/${organization.id}/administrator-recovery`) && response.request().method() === "POST");
    const appointedDirectory = directoryRefresh();
    await details.getByRole("button", { name: "确认指定管理员", exact: true }).click();
    expect((await appointing).status()).toBe(200);
    expect((await appointedDirectory).status()).toBe(200);
    await expect(details).toContainText("当前有 2 位可登录的组织管理员");
    await details.getByRole("button", { name: "关闭", exact: true }).click();
    await signOut(page);

    const successor = await signIn(page, nextUsername, "/organization/members");
    const departed = await requestSelfDemotion(page, nextName, successorId);
    expect(departed.response.status()).toBe(200);
    await expect(page).toHaveURL(new URL("/", page.url()).toString());
    await prepareInteractionSurface(page);
    await expect(page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: `${nextName} · 成员资料`, exact: true })).toHaveCount(0);
    const actual = await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${successor.token}` } });
    expect(actual.status()).toBe(200);
    expect((await actual.json() as Session["auth"]).permissions).not.toContain("users:manage");
    await page.getByRole("link", { name: "打开雷泽工作台", exact: true }).click();
    await expect(page).toHaveURL(/\/parameter-home$/);
    await prepareInteractionSurface(page);
    await expect(page.getByRole("button", { name: "组织管理", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("administrator-self-handover-permissions-refreshed-1440.png"), animations: "disabled" });
  });
});
