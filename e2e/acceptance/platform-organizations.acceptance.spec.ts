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
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "GET", path: "/api/v1/me", status: 401 }, // The real login screen starts without a session.
  { method: "POST", path: "/api/v1/platform/organizations", status: 409 }
] });

type LocalSession = { token: string; auth: { user: { id: string; name: string; organizationId: string }; organization: { id: string; name: string }; roles: Array<{ projectId: string | null; roleId: string }> } };
const operatorUsername = "organization.directory.operator";
async function signInLocally(page: Page, username: string, password: string, route: string) {
  await page.goto(route);
  await expect(page.getByRole("heading", { name: "登录雷泽", exact: true })).toBeVisible();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const loggingIn = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const response = await loggingIn;
  expect(response.status()).toBe(200);
  const session = await response.json() as LocalSession;
  await prepareInteractionSurface(page);
  return session;
}

test.describe("platform Organization provisioning with actual local login", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires AUTH_PROVIDER=local with no injected HMAC smoke token; the shared HMAC/OIDC lane cannot verify local password login.");
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
    const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient((client) => client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,$2,$3)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`,
    [acceptanceCast.platformOperator.userId, operatorUsername, passwordHash]));
  });

  test("searches, creates a usable Organization, preserves conflicts for keyboard correction and contains dialog focus", async ({ page }, testInfo) => {
    const platform = await signInLocally(page, operatorUsername, LOCAL_DEMO_SHARED_PASSWORD, "/parameter-home");
    expect(platform.auth.roles).toContainEqual({ projectId: null, roleId: "platform-admin" });
    const sidebar = page.getByRole("complementary", { name: "主导航侧边栏" });
    const organizationEntry = sidebar.getByRole("button", { name: "组织管理", exact: true });
    await expect(sidebar.getByRole("button", { name: "组织目录", exact: true })).toHaveCount(0);
    await organizationEntry.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/platform\/organizations$/);
    await expect(organizationEntry).toHaveClass(/active/);
    await page.getByRole("button", { name: "所属组织", exact: true }).click();
    await expect(page).toHaveURL(/\/organization$/);
    await page.getByRole("navigation", { name: "组织管理范围" }).getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(platform.auth.organization.name);
    await expect(organizationEntry).toHaveClass(/active/);
    await organizationEntry.click();
    await expect(page).toHaveURL(/\/platform\/organizations$/);
    await prepareInteractionSurface(page);
    await expect(page.getByRole("table", { name: "平台组织目录" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "工作流发布", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "知识后台", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("organization-navigation-1440.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(organizationEntry).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "所属组织", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("organization-navigation-1280.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 900 });
    const search = page.getByRole("searchbox", { name: "搜索组织", exact: true });
    const searchingName = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === "chargelab");
    await search.fill("chargelab");
    expect((await searchingName).status()).toBe(200);
    await expect(page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: "ChargeLab" })).toHaveCount(1);
    await search.fill("不存在的组织-1370");
    await expect(page.getByText("未找到匹配的组织", { exact: true })).toBeVisible();
    const clearing = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/platform/organizations" && !new URL(response.url()).searchParams.has("q"));
    await search.fill(""); await clearing;
    const create = page.getByRole("button", { name: "创建组织", exact: true });
    await expect(create).toBeEnabled();
    let creates = 0;
    page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/platform/organizations") creates += 1; });
    await create.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "创建组织", exact: true });
    const organizationName = dialog.getByLabel("组织名称", { exact: true });
    const submit = dialog.getByRole("button", { name: "创建组织及管理员", exact: true });
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Tab"); await expect(organizationName).toBeFocused();
    await submit.click();
    await expect(organizationName).toBeFocused();
    expect(await organizationName.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
    expect(creates).toBe(0);
    await organizationName.fill("取消后不应创建");
    await dialog.getByLabel("管理员用户名", { exact: true }).fill("invalid username");
    expect(await dialog.getByLabel("管理员用户名", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
    await dialog.getByRole("button", { name: "取消", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0); await expect(create).toBeFocused(); expect(creates).toBe(0);
    await page.keyboard.press("Enter");
    await expect(organizationName).toHaveValue("");
    await organizationName.focus(); await page.keyboard.press("Shift+Tab"); await expect(submit).toBeFocused();
    await page.keyboard.press("Tab"); await expect(organizationName).toBeFocused();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(create).toBeFocused();

    const suffix = randomUUID().slice(0, 8), firstName = `组织协作验收-${suffix}`, secondName = `组织冲突修正-${suffix}`;
    const username = `organization.${suffix}`, administrator = `初始管理员-${suffix}`;
    await page.keyboard.press("Enter");
    await organizationName.fill(firstName);
    await dialog.getByLabel("初始管理员姓名", { exact: true }).fill(administrator);
    await dialog.getByLabel("管理员用户名", { exact: true }).fill(username);
    await dialog.getByLabel("管理员初始密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/platform/organizations");
    await submit.focus(); await page.keyboard.press("Enter");
    const createdResponse = await created; expect(createdResponse.status()).toBe(201);
    const firstOrganization = (await createdResponse.json() as { item: { id: string; name: string } }).item;
    const details = page.getByRole("dialog", { name: "组织资料", exact: true });
    await expect(details).toContainText(firstName); await expect(details).toContainText(firstOrganization.id); await expect(details).toContainText(administrator);
    await page.screenshot({ path: testInfo.outputPath("organization-created-1440.png"), animations: "disabled" });
    await details.getByRole("button", { name: "关闭", exact: true }).click();
    const searchingId = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === firstOrganization.id);
    await search.fill(firstOrganization.id);
    expect((await searchingId).status()).toBe(200);
    await expect(page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: firstName })).toHaveCount(1);
    await expect(page.getByRole("table", { name: "平台组织目录" }).getByRole("row")).toHaveCount(2);
    const clearingId = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/platform/organizations" && !new URL(response.url()).searchParams.has("q"));
    await search.fill(""); await clearingId; await expect(create).toBeEnabled(); await create.click();
    await organizationName.fill(secondName);
    await dialog.getByLabel("初始管理员姓名", { exact: true }).fill(administrator);
    await dialog.getByLabel("管理员用户名", { exact: true }).fill(username);
    await dialog.getByLabel("管理员初始密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const conflicting = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/platform/organizations");
    await submit.focus(); await page.keyboard.press("Enter"); expect((await conflicting).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toContainText("登录标识已被使用");
    await expect(organizationName).toHaveValue(secondName);
    await expect(dialog.getByLabel("初始管理员姓名", { exact: true })).toHaveValue(administrator);
    await expect(dialog.getByLabel("管理员用户名", { exact: true })).toHaveValue(username);
    await expect(dialog.getByLabel("管理员初始密码", { exact: true })).toHaveValue(LOCAL_DEMO_SHARED_PASSWORD);
    const absent = await page.request.get(apiRoute(`/api/v1/platform/organizations?q=${encodeURIComponent(secondName)}`), { headers: { Authorization: `Bearer ${platform.token}` } });
    expect(absent.status()).toBe(200); expect((await absent.json() as { items: unknown[] }).items).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("organization-conflict-preserved-1440.png"), animations: "disabled" });
    await dialog.getByLabel("管理员用户名", { exact: true }).fill(`${username}.retry`);
    const retrying = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/platform/organizations");
    await submit.focus(); await page.keyboard.press("Enter"); expect((await retrying).status()).toBe(201);
    await expect(details).toContainText(secondName); await details.getByRole("button", { name: "关闭", exact: true }).click();
    expect(creates).toBe(3);
    const actorAfter = await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${platform.token}` } });
    expect((await actorAfter.json() as LocalSession["auth"]).organization).toEqual(platform.auth.organization);

    await page.getByRole("button", { name: /打开用户菜单$/ }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    const initialAdministrator = await signInLocally(page, username, LOCAL_DEMO_SHARED_PASSWORD, "/organization/settings");
    expect(initialAdministrator.auth.organization).toEqual({ id: firstOrganization.id, name: firstName });
    expect(initialAdministrator.auth.user.name).toBe(administrator);
    expect(initialAdministrator.auth.roles).toEqual([{ projectId: null, roleId: "admin" }]);
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(firstName);
    await expect(page.getByText(firstOrganization.id, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "组织目录", exact: true })).toHaveCount(0);
    await page.goto("/parameter-home"); await prepareInteractionSurface(page);
    await organizationEntry.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/organization$/);
    await page.getByRole("navigation", { name: "组织管理范围" }).getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(firstName);
    await page.reload(); await prepareInteractionSurface(page);
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(firstName);
    await page.screenshot({ path: testInfo.outputPath("organization-initial-admin-login-1440.png"), animations: "disabled" });
  });
});
