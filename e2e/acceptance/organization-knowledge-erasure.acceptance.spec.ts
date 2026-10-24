import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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

// @acceptance ORG-KNOWLEDGE-ERASURE-001
// @operation ORG-KNOWLEDGE-ERASURE-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("erases real knowledge attachments through the existing Organization confirmation and retry records", async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8), org = `knowledge-erasure-${suffix}`, name = `知识组织清理验收-${suffix}`, member = `${org}-admin`;
  await withTestClusterRoleCatalogLock(async () => {
    await seedAcceptanceRoleMatrix();
    await withPgClient(async client => {
      await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
      await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'知识管理员','管理员',true)", [member, org]);
      await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin')", [`${member}-role`, member, org]);
    });
  });
  const created = await page.request.post(apiRoute("/api/v1/knowledge/entries"), { headers: authHeadersForUser(member, `${member}@example.test`, "知识管理员", org), data: {
    contentForm: "file", title: "删除时清理的真实 PDF", tags: [], file: { fileName: "private.pdf", contentType: "application/pdf",
      contentBase64: (await readFile(new URL("../../server/modules/knowledge/testing/fixtures/sample.pdf", import.meta.url))).toString("base64") }
  } });
  expect(created.status(), await created.text()).toBe(201);
  const entry = (await created.json() as { item: { id: string; file: { storageKey: string } } }).item;
  const physicalFile = resolve(process.env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store", entry.file.storageKey);
  expect((await stat(physicalFile)).size).toBeGreaterThan(0);
  // A real domain mutation fault; no fabricated HTTP success or progress state.
  await withPgClient(async client => {
    await client.query(`create function test_knowledge_erasure_${suffix}() returns trigger language plpgsql as $$ begin
      if old.organization_id='${org}' then raise exception 'acceptance knowledge deletion fault'; end if; return old; end $$;
      create trigger test_knowledge_erasure_${suffix} before delete on knowledge_entries for each row execute function test_knowledge_erasure_${suffix}()`);
  });
  try {
    await signInBrowserAsRole(page, "platform-admin", "/platform/organizations"); await prepareInteractionSurface(page);
    await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
    await page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name }).getByRole("button", { name: "查看", exact: true }).click();
    await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
    await expect(preview).toContainText("knowledge_files");
    await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded();
    await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
    const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
    await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
    await page.screenshot({ path: testInfo.outputPath("knowledge-erasure-confirm-1440.png"), animations: "disabled" });
    const erasedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && response.status() === 202);
    await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
    const response = await erasedResponse, erased = (await response.json() as { item: { id: string; status: string } }).item;
    expect(erased.status).toBe("failed");
    const records = page.getByRole("dialog", { name: "组织清理记录", exact: true }), record = records.getByRole("region", { name: `组织 ${org} 清理` });
    await expect(record).toContainText("清理失败，可重试");
    await page.screenshot({ path: testInfo.outputPath("knowledge-erasure-failed-1440.png"), animations: "disabled" });
    await withPgClient(client => client.query(`drop trigger test_knowledge_erasure_${suffix} on knowledge_entries; drop function test_knowledge_erasure_${suffix}()`));
    await records.getByRole("button", { name: "继续清理", exact: true }).press("Enter");
    await expect(record).toContainText("已删除");
    await page.screenshot({ path: testInfo.outputPath("knowledge-erasure-complete-1440.png"), animations: "disabled" });
    await expect(stat(physicalFile)).rejects.toMatchObject({ code: "ENOENT" });
    await withPgClient(async client => {
      for (const table of ["knowledge_entries", "knowledge_files", "knowledge_revisions", "knowledge_chunks", "knowledge_index_status", "knowledge_attachment_writes"]) {
        expect((await client.query(`select count(*)::int n from ${table} where organization_id=$1`, [org])).rows).toEqual([{ n: 0 }]);
      }
    });
    await recordOperationEvidence({ operationId: "ORG-KNOWLEDGE-ERASURE-001", title: "Organization knowledge erasure", status: "passed", page, testInfo,
      artifacts: ["knowledge-erasure-confirm-1440.png", "knowledge-erasure-failed-1440.png", "knowledge-erasure-complete-1440.png"].map(file => testInfo.outputPath(file)),
      api: [{ method: "POST", path: `/api/v1/platform/organizations/${org}/deletions`, status: response.status(), responseSummary: "Real PDF and knowledge history erased; domain failure stayed visible and was retried in the existing records dialog." }],
      db: [{ table: "knowledge_files", predicate: "the confirmed Organization", observed: "metadata and isolated physical PDF removed", rowCount: 0 }]
    });
  } finally {
    await withPgClient(client => client.query(`drop trigger if exists test_knowledge_erasure_${suffix} on knowledge_entries; drop function if exists test_knowledge_erasure_${suffix}()`));
  }
});
