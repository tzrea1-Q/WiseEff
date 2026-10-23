import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { persistGate0ExactValuesForRescan } from "../../scripts/gate0-artifact-sanitizer";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { installBrowserDiagnostics, useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/me", status: 401 }] });

test("manages one-time invitations and joins with an immediately usable local account", async ({ page, browser }, testInfo) => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires real local password authentication; HMAC/OIDC lanes do not prove local invitation login.");
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), target = `invitation-target-${suffix}`, username = `invited.${suffix}`, label = `研发邀请-${suffix}`;
  await withPgClient(async (client) => {
    await client.query("insert into organizations(id,name) values($1,'邀请目标组织')", [target]);
    await client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,'invitation.operator',$2)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`, [acceptanceCast.platformOperator.userId, await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD)]);
  });
  const registerToken = (token: string) => {
    persistGate0ExactValuesForRescan(path.resolve(process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/acceptance"), [token]);
    persistGate0ExactValuesForRescan(path.resolve(process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR ?? "playwright-report/acceptance"), [token]);
  };
  registerToken(LOCAL_DEMO_SHARED_PASSWORD);
  await page.route((url) => url.pathname.startsWith("/api/v1/organization/invitations"), async (route) => {
    const response = await route.fetch();
    if (response.ok() && route.request().method() === "POST" && !route.request().url().includes("/revoke")) {
      const body = await response.json() as { token?: string }; if (body.token) registerToken(body.token);
    }
    await route.fulfill({ response });
  });
  await page.goto(`/organization/members?organizationId=${target}`);
  await expect(page.getByRole("heading", { name: "登录雷泽", exact: true })).toBeVisible();
  await page.getByLabel("用户名", { exact: true }).fill("invitation.operator");
  await page.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  const operatorLogin = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/login");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  registerToken((await (await operatorLogin).json() as { token: string }).token);
  await prepareInteractionSurface(page);
  await page.getByRole("button", { name: "管理邀请", exact: true }).click();
  await expect(page.getByText("暂无邀请。", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "成员邀请操作", exact: true }).getByRole("button", { name: "创建邀请", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "创建邀请", exact: true });
  await dialog.getByLabel("邀请备注", { exact: true }).fill(label);
  await dialog.getByRole("button", { name: /^组织角色/ }).click();
  await dialog.getByRole("checkbox", { name: "Hardware User", exact: true }).uncheck();
  await dialog.getByRole("checkbox", { name: "Software Committer", exact: true }).check();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "邀请链接已生成", exact: true });
  const oldLink = await dialog.getByLabel("一次性邀请链接", { exact: true }).inputValue();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const table = page.getByRole("table", { name: "成员邀请", exact: true }), row = table.getByRole("row").filter({ hasText: label });
  await expect(row).toContainText("待接受"); await expect(row).toContainText("Software Committer");
  await row.getByRole("button", { name: "重新生成", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "修改并重新生成邀请", exact: true });
  await expect(dialog).toContainText("旧链接立即失效");
  await dialog.getByRole("button", { name: "生成新链接", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "邀请链接已生成", exact: true });
  const link = await dialog.getByLabel("一次性邀请链接", { exact: true }).inputValue();
  expect(link === oldLink).toBe(false);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("organization-invitations-1440.png"), animations: "disabled" });
  expect((await page.request.post(apiRoute("/api/v1/auth/invitations/preview"), { data: { token: new URL(oldLink).hash.slice(1) } })).status()).toBe(404);

  const recipientContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const recipient = await recipientContext.newPage();
  const diagnostics = installBrowserDiagnostics(recipient, testInfo, { expectedApiFailures: [{ method: "GET", path: "/api/v1/me", status: 401 }] });
  try {
    await recipient.goto(`/invite${new URL(link).hash}`);
    await expect(recipient.getByText("邀请目标组织", { exact: true })).toBeVisible();
    await expect(recipient).toHaveURL(/\/invite$/);
    await recipient.screenshot({ path: testInfo.outputPath("invitation-acceptance-1440.png"), animations: "disabled" });
    await recipient.getByLabel("姓名", { exact: true }).fill(`受邀工程师-${suffix}`);
    await recipient.getByLabel("用户名", { exact: true }).fill(username);
    await recipient.getByLabel("设置密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    await recipient.getByRole("button", { name: "接受邀请并创建账号", exact: true }).click();
    await expect(recipient.getByText("账号已创建，可直接登录。", { exact: true })).toBeVisible();
    await recipient.getByRole("link", { name: "前往登录", exact: true }).click();
    await recipient.getByLabel("用户名", { exact: true }).fill(username);
    await recipient.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const loggingIn = recipient.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/login");
    await recipient.getByRole("button", { name: "登录", exact: true }).click();
    const response = await loggingIn; expect(response.status()).toBe(200);
    const session = await response.json() as { token: string; auth: { organization: { id: string }; roles: Array<{ projectId: string | null; roleId: string }> } };
    registerToken(session.token);
    expect(session.auth.organization.id).toBe(target);
    expect(session.auth.roles).toEqual([{ projectId: null, roleId: "software-committer" }]);
    await prepareInteractionSurface(recipient);
    diagnostics.assertNoBrowserDiagnosticsFailures();
  } finally { await recipientContext.close(); }
  await page.reload(); await prepareInteractionSurface(page);
  await expect(table.getByRole("row").filter({ hasText: label })).toContainText("已接受");
  await page.getByRole("group", { name: "成员邀请操作", exact: true }).getByRole("button", { name: "创建邀请", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "创建邀请", exact: true });
  await dialog.getByLabel("邀请备注", { exact: true }).fill(`撤销邀请-${suffix}`);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "邀请链接已生成", exact: true });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const revokedRow = table.getByRole("row").filter({ hasText: `撤销邀请-${suffix}` });
  await revokedRow.getByRole("button", { name: `撤销邀请-${suffix} 操作：更多`, exact: true }).click();
  await page.getByRole("menuitem", { name: "撤销", exact: true }).click();
  await page.getByRole("dialog", { name: "撤销邀请？", exact: true }).getByRole("button", { name: "撤销邀请", exact: true }).click();
  await expect(revokedRow).toContainText("已撤销");
  await page.screenshot({ path: testInfo.outputPath("organization-invitation-accepted-1440.png"), animations: "disabled" });
  const actor = await withPgClient((client) => client.query("select actor_user_id,organization_id from audit_events where kind='organization-invitation' and action='create' and organization_id=$1", [target]));
  expect(actor.rows).toEqual([{ actor_user_id: acceptanceCast.platformOperator.userId, organization_id: target }, { actor_user_id: acceptanceCast.platformOperator.userId, organization_id: target }]);
});
