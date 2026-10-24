import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { withTestClusterRoleCatalogLock } from "../../server/testing/testDatabase";

// @acceptance ORG-LOG-ERASURE-001
// @operation ORG-LOG-ERASURE-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("erases real log files and analysis through Organization confirmation and durable retry", async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8), org = `log-erasure-${suffix}`, name = `日志组织清理验收-${suffix}`, member = `${org}-admin`;
  await withTestClusterRoleCatalogLock(async () => {
    await seedAcceptanceRoleMatrix();
    await withPgClient(async client => {
      await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
      await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'日志管理员','管理员',true)", [member, org]);
      await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin')", [`${member}-role`, member, org]);
    });
  });
  const headers = authHeadersForUser(member, `${member}@example.test`, "日志管理员", org);
  const uploaded = await page.request.post(apiRoute("/api/v1/log-files"), { headers, data: {
    fileName: "private.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO boot\nERROR private device failed\n").toString("base64")
  } });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const log = await uploaded.json() as { log: { id: string }; fileObject: { storageKey: string }; job: { id: string } };
  expect(log.job.id).toBeTruthy();
  const physicalFile = resolve(process.env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store", log.fileObject.storageKey);
  expect((await stat(physicalFile)).size).toBeGreaterThan(0);
  await withPgClient(client => client.query(`create function test_log_erasure_${suffix}() returns trigger language plpgsql as $$ begin
    if old.organization_id='${org}' then raise exception 'acceptance log deletion fault'; end if; return old; end $$;
    create trigger test_log_erasure_${suffix} before delete on log_records for each row execute function test_log_erasure_${suffix}()`));
  try {
    await signInBrowserAsRole(page, "platform-admin", "/platform/organizations"); await prepareInteractionSurface(page);
    await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
    await page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name }).getByRole("button", { name: "查看", exact: true }).click();
    await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
    await expect(preview).toContainText("log_records");
    await expect(preview).toContainText("public.jobs");
    await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded();
    await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
    const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
    await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
    await page.screenshot({ path: testInfo.outputPath("log-erasure-confirm-1440.png"), animations: "disabled" });
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && response.status() === 202);
    await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
    const response = await responsePromise;
    expect((await response.json() as { item: { status: string } }).item.status).toBe("failed");
    const records = page.getByRole("dialog", { name: "组织清理记录", exact: true }), record = records.getByRole("region", { name: `组织 ${org} 清理` });
    await expect(record).toContainText("清理失败，可重试");
    await expect(record.getByText("日志与分析", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("log-erasure-failed-1440.png"), animations: "disabled" });
    await withPgClient(client => client.query(`drop trigger test_log_erasure_${suffix} on log_records; drop function test_log_erasure_${suffix}()`));
    await records.getByRole("button", { name: "继续清理", exact: true }).press("Enter");
    await expect(record).toContainText("已删除");
    await page.screenshot({ path: testInfo.outputPath("log-erasure-complete-1440.png"), animations: "disabled" });
    await expect(stat(physicalFile)).rejects.toMatchObject({ code: "ENOENT" });
    await withPgClient(async client => {
      for (const table of ["log_records", "log_file_objects", "log_analysis_runs", "log_analysis_reports", "log_webhook_outbox", "jobs", "log_object_writes"]) {
        expect((await client.query(`select count(*)::int n from ${table} where organization_id=$1`, [org])).rows).toEqual([{ n: 0 }]);
      }
    });
    await recordOperationEvidence({ operationId: "ORG-LOG-ERASURE-001", title: "Organization log erasure", status: "passed", page, testInfo,
      artifacts: ["log-erasure-confirm-1440.png", "log-erasure-failed-1440.png", "log-erasure-complete-1440.png"].map(file => testInfo.outputPath(file)),
      api: [{ method: "POST", path: `/api/v1/platform/organizations/${org}/deletions`, status: response.status(), responseSummary: "Real log storage and analysis erased; a real database fault remained visible until retry." }],
      db: [{ table: "log_records", predicate: "the confirmed Organization", observed: "records, jobs and isolated physical log removed", rowCount: 0 }] });
  } finally {
    await withPgClient(client => client.query(`drop trigger if exists test_log_erasure_${suffix} on log_records; drop function if exists test_log_erasure_${suffix}()`));
  }
});
