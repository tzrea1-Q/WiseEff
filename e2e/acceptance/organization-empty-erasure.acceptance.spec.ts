import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance ORG-EMPTY-ERASURE-001
// @operation ORG-EMPTY-ERASURE-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/platform/organization-deletions", status: 503 }] });

test("permanently erases a management-only Organization and keeps independent retryable records", async ({ page }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), org = `empty-erasure-${suffix}`, name = `空组织删除验收-${suffix}`;
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
    await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'本组织管理员','管理员',true),($3,$2,'不再保留的平台账号','平台管理员',false)", [`${org}-admin`, org, `${org}-inactive`]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin'),($4,$5,$3,'platform-admin')", [`${org}-admin-role`, `${org}-admin`, org, `${org}-inactive-role`, `${org}-inactive`]);
    await client.query("insert into organization_teams(id,organization_id,name) values($1,$2,'待清理团队')", [`${org}-team`, org]);
    // A real final-receipt persistence fault, after target/account removal.
    await client.query(`create or replace function test_empty_erasure_receipt() returns trigger language plpgsql as $$ begin
      if new.target_organization_id='${org}' and new.status='deleted' then raise exception 'acceptance receipt fault'; end if; return new; end $$;
      drop trigger if exists test_empty_erasure_receipt on organization_erasures;
      create trigger test_empty_erasure_receipt before update on organization_erasures for each row execute function test_empty_erasure_receipt()`);
  });
  await signInBrowserAsRole(page, "platform-admin", "/platform/organizations"); await prepareInteractionSurface(page);
  const searched = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === org && response.ok());
  await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
  await searched;
  await page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name }).getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded();
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
  const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
  await expect(confirmation.getByRole("button", { name: "确认彻底删除", exact: true })).toBeDisabled();
  await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
  await page.screenshot({ path: testInfo.outputPath("organization-empty-erasure-confirm-1440.png"), animations: "disabled" });
  const erasedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && response.status() === 202);
  await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
  const response = await erasedResponse, erased = (await response.json() as { item: { id: string; status: string } }).item;
  expect(erased.status).toBe("failed");
  const records = page.getByRole("dialog", { name: "组织清理记录", exact: true });
  await expect(records.getByRole("region", { name: `组织 ${org} 清理` })).toContainText("清理失败，可重试");
  await withPgClient(async client => {
    expect((await client.query("select count(*)::int n from organizations where id=$1", [org])).rows).toEqual([{ n: 0 }]);
    await client.query("drop trigger test_empty_erasure_receipt on organization_erasures; drop function test_empty_erasure_receipt()");
  });
  await records.getByRole("button", { name: "继续清理", exact: true }).press("Enter");
  await expect(records.getByRole("region", { name: `组织 ${org} 清理` })).toContainText("已删除");
  await page.screenshot({ path: testInfo.outputPath("organization-empty-erasure-receipt-1440.png"), animations: "disabled" });
  await records.getByRole("button", { name: "关闭记录", exact: true }).press("Enter");
  await expect(page.getByRole("table", { name: "平台组织目录" })).not.toContainText(name);
  let unavailable = true;
  await page.route(url => url.pathname === "/api/v1/platform/organization-deletions", async route => {
    if (unavailable) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "清理记录暂不可用，请重试。" } }) }); else await route.continue();
  });
  await page.getByRole("button", { name: "组织目录：更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "清理记录", exact: true }).press("Enter");
  await expect(records.getByRole("alert")).toContainText("清理记录暂不可用");
  await page.screenshot({ path: testInfo.outputPath("organization-empty-erasure-retry-1440.png"), animations: "disabled" });
  unavailable = false;
  await records.getByRole("button", { name: "重试", exact: true }).press("Enter");
  await expect(records.getByRole("region", { name: `组织 ${org} 清理` })).toContainText("已删除");
  await withPgClient(async client => {
    expect((await client.query("select count(*)::int n from organizations where id=$1", [org])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select count(*)::int n from users where organization_id=$1", [org])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select status,stage from organization_erasures where id=$1", [erased.id])).rows).toEqual([{ status: "deleted", stage: "complete" }]);
  });
  await records.getByRole("button", { name: "关闭记录", exact: true }).press("Enter");
  await recordOperationEvidence({ operationId: "ORG-EMPTY-ERASURE-001", title: "Empty Organization permanent erasure", status: "passed", page, testInfo,
    artifacts: ["organization-empty-erasure-confirm-1440.png", "organization-empty-erasure-receipt-1440.png", "organization-empty-erasure-retry-1440.png"].map(file => testInfo.outputPath(file)),
    api: [{ method: "POST", path: `/api/v1/platform/organizations/${org}/deletions`, status: response.status(), responseSummary: "Confirmed deletion removed management-only Organization and accounts; independent receipt remained readable after a failed read and retry." }],
    db: [{ table: "organizations", predicate: "selected empty Organization", observed: "Organization physically removed", rowCount: 0 }, { table: "users", predicate: "selected Organization", observed: "all target accounts removed", rowCount: 0 }]
  });
});
