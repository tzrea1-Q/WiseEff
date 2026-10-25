import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { acceptanceUserIdForRole, authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { withTestClusterRoleCatalogLock } from "../../server/testing/testDatabase";

// @acceptance ORG-MIXED-ERASURE-RECOVERY-001
// @operation ORG-MIXED-ERASURE-RECOVERY-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("converges a populated four-domain Organization after actual file failure to a minimal receipt", async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8), org = `mixed-erasure-${suffix}`, project = `${org}-project`, name = `组合清理验收-${suffix}`;
  await withTestClusterRoleCatalogLock(async () => {
    await seedAcceptanceRoleMatrix();
    await withPgClient(async client => {
      await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
      await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'待清理成员','成员',true)", [`${org}-member`, org]);
      await client.query("insert into projects(id,organization_id,name,code) values($1,$2,'B项目',$3)", [project, org, suffix]);
      await client.query("insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values($1,$2,$3,'xiaoze','{}','archived','B暂存业务内容')", [`${org}-agent`, org, `${org}-member`]);
    });
  });
  const headers = authHeadersForRole("platform-admin"), keys: string[] = [];
  const candidate = await page.request.post(apiRoute(`/api/v1/projects/${project}/parameter-file-candidates?organizationId=${org}`), { headers, data: { fileName: "settings.json", contentBase64: Buffer.from('{"limit":42}').toString("base64") } });
  expect(candidate.status(), await candidate.text()).toBe(201);
  await withPgClient(async client => { keys.push((await client.query<{ storage_key: string }>("select storage_key from project_parameter_file_candidates where organization_id=$1", [org])).rows[0]!.storage_key); });
  const knowledge = await page.request.post(apiRoute(`/api/v1/knowledge/entries?organizationId=${org}`), { headers, data: { title: `B知识-${suffix}`, contentForm: "file", tags: [], file: {
    fileName: "private.pdf", contentType: "application/pdf", contentBase64: (await readFile(new URL("../../server/modules/knowledge/testing/fixtures/sample.pdf", import.meta.url))).toString("base64")
  } } }); expect(knowledge.status(), await knowledge.text()).toBe(201);
  keys.push((await knowledge.json() as { item: { file: { storageKey: string } } }).item.file.storageKey);
  const log = await page.request.post(apiRoute(`/api/v1/log-files?organizationId=${org}`), { headers, data: { fileName: "device.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO boot\nERROR B file").toString("base64") } });
  expect(log.status(), await log.text()).toBe(201); keys.push((await log.json() as { fileObject: { storageKey: string } }).fileObject.storageKey);
  const feedback = await page.request.post(apiRoute(`/api/v1/product-feedback?organizationId=${org}`), { headers, data: { pagePath: "/", pageTitle: "B页面", feedbackType: "experience", description: `B业务内容-${suffix}`,
    attachments: [{ fileName: "private.png", contentType: "image/png", contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=" }] } });
  expect(feedback.status(), await feedback.text()).toBe(201); keys.push((await feedback.json() as { item: { attachments: Array<{ storageKey: string }> } }).item.attachments[0]!.storageKey);
  for (const key of keys) expect((await readFile(path.resolve(process.env.OBJECT_STORE_ROOT!, key))).length).toBeGreaterThan(0);
  await withPgClient(client => client.query(`create function test_mixed_erasure_ack() returns trigger language plpgsql as $$ begin
    if old.organization_id='${org}' then raise exception 'Isolated log object ack failure'; end if; return old; end $$;
    create trigger test_mixed_erasure_ack before delete on parameter_catalog.organization_log_erasure_objects for each row execute function test_mixed_erasure_ack()`));
  await signInBrowserAsRole(page, "platform-admin", "/platform/organizations");
  const searched = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === org && response.ok());
  await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
  await searched;
  const directoryRow = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name });
  await expect(directoryRow).toBeVisible();
  await directoryRow.getByRole("button", { name: /更多$/ }).press("Enter");
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).press("Enter");
  const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded(); await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
  const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
  await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
  await page.screenshot({ path: testInfo.outputPath("organization-mixed-confirm-1440.png"), animations: "disabled" });
  const startedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && response.status() === 202);
  await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
  const started = (await (await startedResponse).json() as { item: { id: string; status: string } }).item; expect(started.status).toBe("failed");
  const records = page.getByRole("dialog", { name: "组织清理记录", exact: true }), region = records.getByRole("region", { name: `组织 ${org} 清理` });
  const progress = region.getByLabel("领域清理进度");
  for (const label of ["Agent、设备与反馈", "知识与索引", "项目与组织参数", "日志与分析"]) await expect(progress).toContainText(label);
  await expect(progress).toContainText("清理失败，可重试");
  await page.screenshot({ path: testInfo.outputPath("organization-mixed-failed-1440.png"), animations: "disabled" });
  await withPgClient(client => client.query("drop trigger test_mixed_erasure_ack on parameter_catalog.organization_log_erasure_objects; drop function test_mixed_erasure_ack()"));
  await region.getByRole("button", { name: "继续清理", exact: true }).press("Enter"); await expect(region).toContainText("已删除");
  await expect(region.getByLabel("领域清理进度")).toHaveCount(0);
  await expect(page.locator('[aria-label="平台组织目录"] tbody tr').filter({ hasText: name })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("organization-mixed-minimal-receipt-1440.png"), animations: "disabled" });
  for (const key of keys) await expect(readFile(path.resolve(process.env.OBJECT_STORE_ROOT!, key))).rejects.toMatchObject({ code: "ENOENT" });
  await withPgClient(async client => {
    expect((await client.query("select id from organizations where id=$1", [org])).rowCount).toBe(0);
    expect((await client.query("select domain_progress,attempts from organization_erasures where id=$1", [started.id])).rows).toEqual([{ domain_progress: {}, attempts: 0 }]);
    expect((await client.query("select id from users where id=$1", [acceptanceUserIdForRole("platform-admin")])).rowCount).toBe(1);
  });
  await recordOperationEvidence({ operationId: "ORG-MIXED-ERASURE-RECOVERY-001", title: "Mixed Organization cleanup and minimal receipt", status: "passed", page, testInfo,
    artifacts: ["organization-mixed-confirm-1440.png", "organization-mixed-failed-1440.png", "organization-mixed-minimal-receipt-1440.png"].map(file => testInfo.outputPath(file)),
    api: [{ method: "POST", path: `/api/v1/platform/organizations/${org}/deletions`, status: 202, responseSummary: "Four real domains retained actual file cleanup failure; retry removed target data and compacted the final receipt." }],
    db: [{ table: "organizations", predicate: "selected mixed Organization", observed: "Target absent; original platform actor retained", rowCount: 0 }] });
});
