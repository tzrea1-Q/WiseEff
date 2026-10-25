import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance ORG-LIFECYCLE-001
// @operation ORG-LIFECYCLE-001

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "PATCH", path: "/api/v1/platform/organizations", status: 503 },
  { method: "PATCH", path: "/api/v1/organization", status: 403 }
] });

test("suspends and restores a fixed Organization, preserves readonly member access and supports keyboard retry", async ({ page, browser }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), org = `lifecycle-${suffix}`, member = `lifecycle-member-${suffix}`, disabled = `lifecycle-disabled-${suffix}`;
  const name = `生命周期验收组织-${suffix}`, memberName = `组织管理员-${suffix}`;
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
    await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$3,$4,'管理员',true),($2,$3,'已停用成员','工程师',false)", [member, disabled, org, memberName]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin')", [`${member}-role`, member, org]);
  });
  const headers = authHeadersForRole("platform-admin"), lifecycle = `/api/v1/platform/organizations/${org}/lifecycle`;
  let failNext = true;
  await page.route(url => url.pathname === lifecycle, async route => {
    if (failNext && route.request().method() === "PATCH") {
      failNext = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "组织状态服务暂不可用，请重试。" } }) });
    } else await route.continue();
  });
  try {
    await signInBrowserAsRole(page, "platform-admin", "/platform/organizations"); await prepareInteractionSurface(page);
    await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
    const row = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: /更多$/ }).click();
    await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
    let details = page.getByRole("dialog", { name: "组织资料", exact: true });
    await details.getByRole("button", { name: "停用组织", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "停用组织", exact: true });
    await expect(confirmation).toContainText("已发出的设备操作显示实际结果");
    await page.screenshot({ path: testInfo.outputPath("organization-suspend-confirmation-1440.png"), animations: "disabled" });
    await confirmation.getByRole("button", { name: "确认停用组织", exact: true }).press("Enter");
    await expect(confirmation.getByRole("alert")).toContainText("组织状态服务暂不可用");
    await confirmation.getByRole("button", { name: "确认停用组织", exact: true }).press("Enter"); await expect(confirmation).toHaveCount(0);
    await expect(details).toContainText("已停用");
    await page.screenshot({ path: testInfo.outputPath("organization-suspended-directory-1440.png"), animations: "disabled" });
    await details.getByRole("button", { name: "进入组织", exact: true }).click();
    await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText("已停用 · 仅可查看");
    await expect(page.getByRole("status").filter({ hasText: "可继续办理交接" })).toBeVisible();
    const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }), memberPage = await memberContext.newPage();
    await signInBrowserAsUser(memberPage, member, `${member}@example.test`, memberName, "/organization/settings", org);
    await expect(memberPage.getByRole("region", { name: "当前操作组织" })).toContainText("已停用 · 仅可查看");
    await expect(memberPage.getByRole("status").filter({ hasText: "组织已停用" })).toHaveCount(1);
    await expect(memberPage.getByLabel("显示名称", { exact: true })).toHaveValue(name);
    await expect(memberPage.getByLabel("显示名称", { exact: true })).toBeDisabled();
    const forbidden = await memberPage.request.patch(apiRoute("/api/v1/organization"), { headers: authHeadersForUser(member, `${member}@example.test`, memberName, org), data: { name: "Must not change" } });
    expect(forbidden.status()).toBe(403);
    await memberPage.screenshot({ path: testInfo.outputPath("organization-member-readonly-1440.png"), animations: "disabled" });
    await memberContext.close();
    await page.getByRole("button", { name: "组织目录", exact: true }).click(); await prepareInteractionSurface(page);
    await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
    await page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name }).getByRole("button", { name: /更多$/ }).click();
    await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
    details = page.getByRole("dialog", { name: "组织资料", exact: true });
    await details.getByRole("button", { name: "恢复组织", exact: true }).click();
    await page.getByRole("dialog", { name: "恢复组织", exact: true }).getByRole("button", { name: "确认恢复组织", exact: true }).press("Enter");
    await expect(details.getByRole("button", { name: "停用组织", exact: true })).toBeVisible();
    expect((await page.request.patch(apiRoute("/api/v1/organization"), { headers: authHeadersForUser(member, `${member}@example.test`, memberName, org), data: { name: `${name}-已恢复` } })).status()).toBe(200);
    await withPgClient(async client => {
      expect((await client.query("select is_active from users where id=$1", [disabled])).rows).toEqual([{ is_active: false }]);
      expect((await client.query("select status from organizations where id=$1", [org])).rows).toEqual([{ status: "active" }]);
      expect((await client.query("select action,actor_user_id from audit_events where organization_id=$1 and kind='organization-lifecycle' order by created_at", [org])).rows)
        .toEqual([{ action: "suspend", actor_user_id: headers["x-wiseeff-user"] }, { action: "restore", actor_user_id: headers["x-wiseeff-user"] }]);
    });
    await recordOperationEvidence({ operationId: "ORG-LIFECYCLE-001", title: "Organization suspend and restore", status: "passed", page, testInfo,
      artifacts: ["organization-suspend-confirmation-1440.png", "organization-suspended-directory-1440.png", "organization-member-readonly-1440.png"].map(file => testInfo.outputPath(file)),
      api: [{ method: "PATCH", path: lifecycle, status: 200, responseSummary: "Suspended and restored with compare-and-set confirmation; injected 503 kept the dialog retryable." },
        { method: "PATCH", path: "/api/v1/organization", status: forbidden.status(), responseSummary: "Suspended member business mutation refused." }],
      db: [{ table: "organizations", predicate: "the selected organization", observed: "active after explicit restore", rowCount: 1 },
        { table: "users", predicate: "the individually disabled fixture member", observed: "is_active remains false", rowCount: 1 }],
      audit: [{ kind: "organization-lifecycle", action: "suspend", targetId: org }, { kind: "organization-lifecycle", action: "restore", targetId: org }]
    });
  } finally {
    const current = await page.request.get(apiRoute(`/api/v1/platform/organizations/${org}`), { headers });
    if (current.ok() && (await current.json() as { item: { status: string } }).item.status === "suspended") await page.request.patch(apiRoute(lifecycle), { headers, data: { status: "active", expectedStatus: "suspended" } });
  }
});
