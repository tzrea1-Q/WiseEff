import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { authHeadersForRole, acceptanceUserIdForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withTestClusterRoleCatalogLock } from "../../server/testing/testDatabase";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance ORG-RUNTIME-ERASURE-001
// @operation ORG-RUNTIME-ERASURE-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("erases runtime feedback bytes and foreign-Home projections with visible durable retry", async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8), org = `runtime-erasure-${suffix}`, name = `运行状态清理-${suffix}`;
  await withTestClusterRoleCatalogLock(async () => {
    await seedAcceptanceRoleMatrix();
    await withPgClient(client => client.query("insert into organizations(id,name) values($1,$2)", [org, name]));
  });
  const headers = authHeadersForRole("platform-admin");
  const created = await page.request.post(apiRoute(`/api/v1/product-feedback?organizationId=${org}`), { headers, data: {
    pagePath: "/", pageTitle: "删除验收", feedbackType: "experience", description: `待删除反馈-${suffix}`,
    attachments: [{ fileName: "capture.png", contentType: "image/png", contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=" }]
  } });
  expect(created.status(), await created.text()).toBe(201);
  const feedback = (await created.json() as { item: { id: string; attachments: Array<{ storageKey: string }> } }).item;
  const file = path.resolve(process.env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store", feedback.attachments[0]!.storageKey);
  expect((await readFile(file)).length).toBeGreaterThan(0);
  const progress = await page.request.post(apiRoute(`/api/v1/product-feedback/${feedback.id}/progress?organizationId=${org}`), { headers, data: { toStatus: "in_progress", publicMessage: `B反馈通知-${suffix}` } });
  expect(progress.status(), await progress.text()).toBe(200);
  await withPgClient(async client => {
    expect((await client.query("select id from user_notifications where metadata->>'feedbackOrganizationId'=$1 and organization_id<>$1", [org])).rowCount).toBe(1);
    await client.query(`create function test_runtime_erasure_ack() returns trigger language plpgsql as $$ begin
      if exists(select 1 from organization_erasures where id=old.erasure_id and target_organization_id='${org}') then raise exception 'isolated ack failure'; end if; return old; end $$;
      create trigger test_runtime_erasure_ack before delete on organization_runtime_erasure_objects for each row execute function test_runtime_erasure_ack()`);
  });
  await signInBrowserAsRole(page, "platform-admin", "/platform/organizations");
  await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
  await page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name }).getByRole("button", { name: /更多$/ }).press("Enter");
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).press("Enter");
  const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
  await expect(preview).toContainText("反馈、通知与跨组织通知副本");
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded();
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
  const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
  await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
  await page.screenshot({ path: testInfo.outputPath("runtime-erasure-confirm-1440.png"), animations: "disabled" });
  const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && result.status() === 202);
  await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
  const receipt = (await (await response).json() as { item: { id: string; status: string } }).item; expect(receipt.status).toBe("failed");
  const records = page.getByRole("dialog", { name: "组织清理记录", exact: true }), region = records.getByRole("region", { name: `组织 ${org} 清理` });
  await expect(region).toContainText("清理失败，可重试");
  await page.screenshot({ path: testInfo.outputPath("runtime-erasure-failed-1440.png"), animations: "disabled" });
  await withPgClient(client => client.query("drop trigger test_runtime_erasure_ack on organization_runtime_erasure_objects; drop function test_runtime_erasure_ack()"));
  await records.getByRole("button", { name: "继续清理", exact: true }).press("Enter");
  await expect(region).toContainText("已删除");
  await page.screenshot({ path: testInfo.outputPath("runtime-erasure-complete-1440.png"), animations: "disabled" });
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  await withPgClient(async client => {
    expect((await client.query("select id from organizations where id=$1", [org])).rowCount).toBe(0);
    expect((await client.query("select id from notification_outbox where payload->'metadata'->>'feedbackOrganizationId'=$1", [org])).rowCount).toBe(0);
    expect((await client.query("select id from user_notifications where metadata->>'feedbackOrganizationId'=$1", [org])).rowCount).toBe(0);
    expect((await client.query("select id from users where id=$1", [acceptanceUserIdForRole("platform-admin")])).rowCount).toBe(1);
  });
  await recordOperationEvidence({ operationId: "ORG-RUNTIME-ERASURE-001", title: "Organization runtime cleanup with durable retry", status: "passed", page, testInfo,
    artifacts: ["runtime-erasure-confirm-1440.png", "runtime-erasure-failed-1440.png", "runtime-erasure-complete-1440.png"].map(fileName => testInfo.outputPath(fileName)),
    api: [{ method: "POST", path: `/api/v1/platform/organizations/${org}/deletions`, status: 202, responseSummary: "Persisted domain failure was retried; actual feedback bytes and foreign-Home notifications were removed." }],
    db: [{ table: "organizations", predicate: "confirmed Organization", observed: "Organization removed, foreign-Home projections absent and actual platform operator retained", rowCount: 0 }]
  });
});
