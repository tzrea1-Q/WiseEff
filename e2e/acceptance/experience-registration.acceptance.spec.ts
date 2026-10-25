import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
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
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "GET", path: "/api/v1/me", status: 401 },
  { method: "PATCH", path: "/api/v1/platform/experience-registration", status: 503 }
] });

test("configures one experience target, preserves failed edits for retry, and closes signup without losing pending members", async ({ page, browser }, testInfo) => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires real local authentication; HMAC/OIDC cannot establish public local registration.");
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), target = `experience-${suffix}`, targetName = `体验空间-${suffix}`, username = `experience.${suffix}`;
  await withPgClient(async (client) => {
    await client.query("insert into organizations(id,name) values($1,$2)", [target, targetName]);
    await client.query("update public_experience_registration set enabled=false,organization_id=null where singleton=true");
    await client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,'experience.operator',$2)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`, [acceptanceCast.platformOperator.userId, await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD)]);
  });
  const registerSecret = (value: string) => {
    for (const root of [process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/acceptance", process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR ?? "playwright-report/acceptance"]) {
      mkdirSync(path.resolve(root), { recursive: true }); persistGate0ExactValuesForRescan(path.resolve(root), [value]);
    }
  };
  registerSecret(LOCAL_DEMO_SHARED_PASSWORD);
  await page.route((url) => url.pathname === "/api/v1/auth/login", async (route) => {
    const response = await route.fetch(); if (response.ok()) registerSecret((await response.json() as { token: string }).token);
    await route.fulfill({ response });
  });
  await page.goto("/platform/organizations");
  await expect(page.getByText("加入组织请联系管理员获取邀请链接或创建账号。", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "注册", exact: true })).toHaveCount(0);
  await page.getByLabel("用户名", { exact: true }).fill("experience.operator"); await page.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await prepareInteractionSurface(page);
  await page.getByRole("button", { name: "组织目录：更多", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "体验注册设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "公开体验注册", exact: true });
  await expect(dialog.getByText(/当前入口：已关闭/)).toBeVisible();
  await dialog.getByLabel("开启公开体验注册", { exact: true }).check();
  await expect(dialog.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "体验目标组织", exact: true }).click();
  await page.getByRole("option", { name: targetName, exact: true }).click();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(dialog.getByLabel("开启公开体验注册", { exact: true })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "体验目标组织", exact: true })).toHaveText(targetName);
  let fail = true;
  await page.route((url) => url.pathname === "/api/v1/platform/experience-registration", async (route) => {
    if (fail && route.request().method() === "PATCH") { fail = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "体验注册设置暂不可用，请重试。" } }) }); }
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("体验注册设置暂不可用");
  await expect(dialog.getByLabel("开启公开体验注册", { exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "保存设置", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByText("体验注册设置已保存。", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存设置", exact: true })).toBeDisabled();
  await expect(dialog.getByText(/配置来源：平台设置/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("experience-registration-settings-1440.png"), animations: "disabled" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), applicant = await context.newPage();
  const diagnostics = installBrowserDiagnostics(applicant, testInfo, { expectedApiFailures: [{ method: "GET", path: "/api/v1/me", status: 401 }] });
  try {
    await applicant.goto("/parameter-home");
    await applicant.getByRole("tab", { name: "注册", exact: true }).click();
    await expect(applicant.getByText(new RegExp(`新账号将加入体验组织「${targetName}」`))).toBeVisible();
    await applicant.getByLabel("姓名", { exact: true }).fill(`体验申请-${suffix}`); await applicant.getByLabel("用户名", { exact: true }).fill(username);
    await applicant.getByRole("combobox", { name: "角色", exact: true }).click(); await applicant.getByRole("option", { name: "Software Committer", exact: true }).click();
    await applicant.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD); await applicant.getByLabel("确认密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    await applicant.getByRole("button", { name: "注册", exact: true }).click();
    await expect(applicant.getByRole("heading", { name: "注册申请已提交", exact: true })).toBeVisible();
    await applicant.screenshot({ path: testInfo.outputPath("experience-registration-pending-1440.png"), animations: "disabled" });
    await dialog.getByLabel("开启公开体验注册", { exact: true }).uncheck(); await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog.getByText(/当前入口：已关闭/)).toBeVisible();
    await applicant.reload(); await expect(applicant.getByRole("tab", { name: "注册", exact: true })).toHaveCount(0);
    await expect(applicant.getByText("加入组织请联系管理员获取邀请链接或创建账号。", { exact: true })).toBeVisible();
    diagnostics.assertNoBrowserDiagnosticsFailures();
  } finally { await context.close(); }
  const pending = await withPgClient((client) => client.query("select requests.status,users.is_active from local_registration_role_requests requests join users on users.id=requests.user_id join user_password_credentials credentials on credentials.user_id=users.id where credentials.username=$1 and users.organization_id=$2", [username, target]));
  expect(pending.rows).toEqual([{ status: "pending", is_active: false }]);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true })).toHaveCount(0);
  expect((await page.request.post(apiRoute("/api/v1/auth/register"), { data: { name: "Closed", username: `closed.${suffix}`, password: LOCAL_DEMO_SHARED_PASSWORD } })).status()).toBe(403);
});
