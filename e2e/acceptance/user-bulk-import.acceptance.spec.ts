import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { expect, test } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { persistGate0ExactValuesForRescan } from "../../scripts/gate0-artifact-sanitizer";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance PERM-USER-IMPORT-001
// @operation PERM-USER-IMPORT-001

test.use({ viewport: { width: 1440, height: 900 } });

test("creates a reviewed roster and safely retries a lost response", async ({ page, browser }, testInfo) => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane.");
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !/Failed to load resource: (the server responded with a status of 401|net::ERR_ABORTED)/.test(message.text())) browserErrors.push(message.text()); });
  page.on("requestfailed", request => { if (request.failure()?.errorText !== "net::ERR_ABORTED") browserErrors.push(`request failed: ${new URL(request.url()).pathname}`); });
  page.on("response", response => { if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/api/") && !(response.status() === 401 && new URL(response.url()).pathname === "/api/v1/me")) browserErrors.push(`API ${response.status()}: ${new URL(response.url()).pathname}`); });
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), organization = `bulk-import-${suffix}`, username = `bulk.${suffix}`;
  const registerSecret = (secret: string) => {
    for (const root of [process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/acceptance", process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR ?? "playwright-report/acceptance"]) {
      mkdirSync(path.resolve(root), { recursive: true }); persistGate0ExactValuesForRescan(path.resolve(root), [secret]);
    }
  };
  registerSecret(LOCAL_DEMO_SHARED_PASSWORD);
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,'批量导入目标')", [organization]);
    await client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,'bulk.operator',$2)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`, [acceptanceCast.platformOperator.userId, await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD)]);
  });
  await page.goto(`/organization/members?organizationId=${organization}`);
  await page.getByLabel("用户名", { exact: true }).fill("bulk.operator");
  await page.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/login");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  registerSecret((await (await login).json() as { token: string }).token);
  await prepareInteractionSurface(page);
  await expect(page.getByText("暂无组织成员。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "批量导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "批量导入成员" });
  const templateDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载模板" }).click();
  const templatePath = await (await templateDownload).path();
  const template = XLSX.read(readFileSync(templatePath!), { type: "buffer" });
  expect(template.SheetNames).toEqual(["用户数据", "填写说明", "填写示例"]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["姓名", "用户名", "初始密码", "职务", "组织角色"], ["批量新成员", username, LOCAL_DEMO_SHARED_PASSWORD, "工程师", "管理员；硬件开发"]]), "用户数据");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await expect(dialog.getByLabel("选择填写后的 XLSX 文件")).toBeEnabled();
  await dialog.getByLabel("选择填写后的 XLSX 文件").setInputFiles({ name: "roster.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes });
  await expect(dialog.getByText("预检通过", { exact: true })).toBeVisible();
  await expect(dialog.getByText("管理员权限", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("批量导入目标");
  await page.screenshot({ path: testInfo.outputPath("user-import-preview-1440.png"), animations: "disabled" });
  let drop = true;
  let createdUserId = "";
  await page.route(url => url.pathname === "/api/v1/users/imports", async route => {
    if (drop && route.request().method() === "POST") {
      drop = false;
      const beforePost = await page.evaluate(() => JSON.parse(sessionStorage.getItem("wiseeff.user-import.pending")!));
      expect(beforePost).toEqual({ importId: expect.any(String), actorId: acceptanceCast.platformOperator.userId, organizationId: organization });
      const response = await route.fetch(); expect(response.status()).toBe(200);
      createdUserId = (await response.json() as { item: { rows: Array<{ userId: string }> } }).item.rows[0].userId;
      await route.abort("aborted");
    }
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "确认创建 1 位成员" }).click();
  await expect(dialog.getByText("结果尚未确认", { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => Object.values(sessionStorage).join("\n"));
  expect(stored).not.toContain(LOCAL_DEMO_SHARED_PASSWORD);
  expect(stored).not.toContain(username);
  const locator = await page.evaluate(() => JSON.parse(sessionStorage.getItem("wiseeff.user-import.pending")!));
  expect(locator).toEqual({ importId: expect.any(String), actorId: acceptanceCast.platformOperator.userId, organizationId: organization });
  let dropLookup = true;
  await page.route(url => /^\/api\/v1\/users\/imports\/[^/]+$/.test(url.pathname), async route => {
    if (dropLookup) await route.abort("aborted");
    else await route.continue();
  });
  await page.reload();
  await prepareInteractionSurface(page);
  await page.getByRole("button", { name: "批量导入", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("暂时无法查询批次结果，请检查连接后重试。")).toBeVisible();
  dropLookup = false;
  const lookup = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/users/imports/${locator.importId}`);
  await dialog.getByRole("button", { name: "查询原批次结果" }).click();
  expect((await lookup).status()).toBe(200);
  await expect(dialog.getByRole("heading", { name: "创建完成" })).toBeVisible();
  await expect(dialog).toContainText(username);
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载结果清单" }).click();
  const reportPath = await (await downloading).path();
  const report = XLSX.read(readFileSync(reportPath!), { type: "buffer" });
  expect(JSON.stringify(report)).not.toContain(LOCAL_DEMO_SHARED_PASSWORD);
  expect(XLSX.utils.sheet_to_json<string[]>(report.Sheets[report.SheetNames[0]], { header: 1 })).toContainEqual(["2", username, "批量新成员", "", "已创建", "", ""]);
  await page.screenshot({ path: testInfo.outputPath("user-import-result-1440.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("button", { name: "批量导入", exact: true })).toBeFocused();
  await expect(page.getByText(username, { exact: true }).first()).toBeVisible();
  const newContext = await browser.newContext();
  try {
    const member = await newContext.newPage();
    await member.goto("/organization/members");
    await member.getByLabel("用户名", { exact: true }).fill(username);
    await member.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const response = member.waitForResponse(item => new URL(item.url()).pathname === "/api/v1/auth/login");
    await member.getByRole("button", { name: "登录", exact: true }).click();
    const result = await response; expect(result.status()).toBe(200);
    const session = await result.json() as { token: string; auth: { organization: { id: string } } };
    registerSecret(session.token); expect(session.auth.organization.id).toBe(organization);
  } finally { await newContext.close(); }
  const observations = await withPgClient(async client => ({
    receipts: (await client.query("select count(*)::int n from user_import_receipts where organization_id=$1", [organization])).rows,
    users: (await client.query("select count(*)::int n from users where organization_id=$1 and id=$2", [organization, createdUserId])).rows,
    audit: (await client.query<{ id: string; kind: string; action: string; target_id: string; actor_user_id: string }>("select id,kind,action,target_id,actor_user_id from audit_events where organization_id=$1 and target_id=$2 and kind='user-create'", [organization, createdUserId])).rows
  }));
  expect(observations.receipts).toEqual([{ n: 1 }]); expect(observations.users).toEqual([{ n: 1 }]);
  expect(observations.audit).toEqual([expect.objectContaining({ kind: "user-create", action: "create", target_id: createdUserId, actor_user_id: acceptanceCast.platformOperator.userId })]);
  expect(browserErrors).toEqual([]);
  await recordOperationEvidence({ operationId: "PERM-USER-IMPORT-001", title: "Local user import and interrupted result recovery", status: "passed", role: "Platform Admin", route: "/organization/members", page, testInfo,
    assertions: ["ui", "api", "db", "audit", "screenshot"],
    api: [{ method: "POST", path: "/api/v1/users/imports", status: 200, responseSummary: "Committed response dropped; original receipt recovered after refresh and another connection failure." }, { method: "GET", path: "/api/v1/users/imports/:importId", status: 200, responseSummary: "Recovered the committed result without the workbook or passwords." }],
    db: [{ table: "user_import_receipts", predicate: "target Organization", observed: "One committed receipt", rowCount: 1 }, { table: "users", predicate: "created user and target Organization", observed: "One created user", rowCount: 1 }],
    audit: observations.audit.map(item => ({ id: item.id, kind: item.kind, action: item.action, targetId: item.target_id, metadataSummary: "Original platform operator created the account in the target Organization." })) });
});
