import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance ORG-DELETION-PREVIEW-001
// @operation ORG-DELETION-PREVIEW-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/platform/organizations", status: 503 }, { method: "GET", path: "/api/v1/platform/organizations", status: 403 }] });

test("previews the selected Organization's full erasure impact, retries a failed read and never mutates it", async ({ page }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), org = `deletion-preview-${suffix}`, name = `删除影响验收组织-${suffix}`;
  const member = `${org}-member`, inactive = `${org}-inactive`, entry = randomUUID(), notification = randomUUID(), feedback = randomUUID();
  const erasurePosts: string[] = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/(?:deletions|organization-deletions)(?:\/|$)/.test(pathname)) erasurePosts.push(pathname);
  });
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
    await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$3,'组织管理员','管理员',true),($2,$3,'待调离平台账号','平台管理员',false)", [member, inactive, org]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'admin'),($4,$5,$3,'platform-admin')", [`${member}-role`, member, org, `${inactive}-role`, inactive]);
    await client.query("insert into organization_teams(id,organization_id,name) values($1,$2,'验收团队')", [`${org}-team`, org]);
    await client.query("insert into projects(id,organization_id,name,code) values($1,$2,'验收项目',$3)", [`${org}-project`, org, `DELETE-${suffix}`]);
    await client.query("insert into knowledge_entries(id,organization_id,title,content_form) values($1,$2,'应计入的知识草稿','markdown')", [entry, org]);
    await client.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values($1,$2,$3,'shared.log','text/plain',5,'abc'),($4,$2,$5,'own.log','text/plain',5,'def'),($6,'org-chargelab',$3,'foreign.log','text/plain',5,'abc')", [`${org}-shared`, org, `${org}/shared-object`, `${org}-own`, `${org}/own-object`, `${org}-foreign`]);
    await client.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values($1,'org-chargelab',$2,'global.log','text/plain',5,'global')", [`${org}-global-foreign`, `${org}/platform-global-object`]);
    await client.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values($1,$2,$3,$4,$5)", [`global-definition-${suffix}`, org, inactive, `global-audit-${suffix}`, [`plane::${org}/platform-global-object`]]);
    await client.query("insert into jobs(id,organization_id,kind,target_type,target_id,status) values($1,$2,'preview-fixture','preview',$1,'queued')", [`${org}-job`, org]);
    await client.query("insert into product_feedback(id,organization_id,submitter_user_id,page_path,page_title,feedback_type,description) values($1,$2,$3,'/','预览来源','experience','目标组织业务内容')", [feedback, org, member]);
    await client.query("insert into user_notifications(id,organization_id,recipient_user_id,category,title,body,source_kind,source_id,metadata) values($1,'org-chargelab',$2,'feedback','来自目标组织的反馈','目标组织业务内容','product-feedback',$4,$3)", [notification, authHeadersForRole("platform-admin")["x-wiseeff-user"], { feedbackOrganizationId: org, feedbackId: feedback }, feedback]);
  });
  const path = `/api/v1/platform/organizations/${org}/deletion-preview`;
  let unavailable = true;
  await page.route(url => url.pathname === path, async route => {
    if (unavailable) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "删除影响服务暂不可用，请重试。" } }) });
    else await route.continue();
  });
  await signInBrowserAsRole(page, "platform-admin", "/platform/organizations"); await prepareInteractionSurface(page);
  const searched = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === org && response.ok());
  await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
  await searched;
  const directoryRow = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name });
  await expect(directoryRow).toBeVisible();
  await directoryRow.getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  const failure = page.waitForResponse(response => new URL(response.url()).pathname === path && response.status() === 503);
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).click();
  expect((await failure).status()).toBe(503);
  const dialog = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("删除影响服务暂不可用");
  await page.screenshot({ path: testInfo.outputPath("organization-deletion-preview-error-1440.png"), animations: "disabled" });
  unavailable = false;
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === path && response.status() === 200);
  await dialog.getByRole("button", { name: "重试", exact: true }).press("Enter");
  const response = await loaded, preview = (await response.json() as { item: { inventory: Array<{ key: string; count: number }>; storage: { exclusiveObjects: number; sharedObjects: number } } }).item;
  expect(preview.inventory).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: "public.users", count: 2 }), expect.objectContaining({ key: "public.projects", count: 1 }),
    expect.objectContaining({ key: "public.knowledge_entries", count: 1 }), expect.objectContaining({ key: "public.user_notifications", count: 1 }),
    expect.objectContaining({ key: "parameter_catalog.definition_erasures", category: "shared-references", count: 1 })
  ]));
  expect(preview.storage).toEqual({ exclusiveObjects: 1, sharedObjects: 1 });
  await expect(dialog).toContainText(name); await expect(dialog).toContainText(org);
  await expect(dialog.getByRole("button", { name: "确认彻底删除", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("organization-deletion-preview-counts-1440.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "关闭预览", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("region", { name: "平台账号影响" })).toContainText("待调离平台账号");
  await expect(dialog.getByRole("region", { name: "删除边界" })).toContainText("在线删除不等于备份即时擦除");
  await expect(dialog.getByRole("region", { name: "删除边界" })).toContainText("平台级参数定义删除回执和未完成的全局清理任务保留");
  await page.screenshot({ path: testInfo.outputPath("organization-deletion-preview-boundary-1440.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "关闭预览", exact: true }).press("Enter"); await expect(dialog).toHaveCount(0);
  await directoryRow.getByRole("button", { name: /更多$/ }).press("Enter");
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).press("Enter");
  const begin = dialog.getByRole("button", { name: "开始彻底删除", exact: true });
  await begin.scrollIntoViewIfNeeded(); await expect(begin).toBeVisible(); await begin.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
  await expect(confirmation.getByRole("textbox", { name: "输入组织编号确认" })).toBeEmpty();
  await expect(confirmation.getByRole("button", { name: "确认彻底删除", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("organization-deletion-preview-confirmation-1440.png"), animations: "disabled" });
  await confirmation.getByRole("button", { name: "取消", exact: true }).press("Enter"); await expect(confirmation).toHaveCount(0);
  expect(erasurePosts).toEqual([]);
  const ordinary = await page.request.get(apiRoute(path), { headers: authHeadersForUser(member, `${member}@example.test`, "组织管理员", org) }); expect(ordinary.status()).toBe(403);
  await withPgClient(async client => {
    expect((await client.query("select count(*)::int n from users where organization_id=$1", [org])).rows).toEqual([{ n: 2 }]);
    expect((await client.query("select count(*)::int n from log_file_objects where organization_id=$1", [org])).rows).toEqual([{ n: 2 }]);
    expect((await client.query("select body from user_notifications where id=$1", [notification])).rows).toEqual([{ body: "目标组织业务内容" }]);
    expect((await client.query("select count(*)::int n from audit_events where organization_id=$1", [org])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select pending_object_refs from parameter_catalog.definition_erasures where definition_id=$1", [`global-definition-${suffix}`])).rows).toEqual([{ pending_object_refs: [`plane::${org}/platform-global-object`] }]);
  });
  await recordOperationEvidence({ operationId: "ORG-DELETION-PREVIEW-001", title: "Organization erasure impact preview", status: "passed", page, testInfo,
    artifacts: ["organization-deletion-preview-error-1440.png", "organization-deletion-preview-counts-1440.png", "organization-deletion-preview-boundary-1440.png", "organization-deletion-preview-confirmation-1440.png"].map(file => testInfo.outputPath(file)),
    api: [{ method: "GET", path, status: response.status(), responseSummary: "Readonly counts include inactive accounts, private-domain categories, shared file keys and foreign-Home notification copies; failed read is retryable." }],
    db: [{ table: "users", predicate: "the selected organization", observed: "both active and inactive members retained", rowCount: 2 }, { table: "audit_events", predicate: "the selected organization", observed: "preview made no audit mutation", rowCount: 0 }]
  });
});
