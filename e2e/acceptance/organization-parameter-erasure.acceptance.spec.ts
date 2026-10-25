import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance ORG-PARAMETER-ERASURE-001
// @operation ORG-PARAMETER-ERASURE-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("erases project parameter files and retries the failed domain from the Organization cleanup dialog", async ({ page }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), org = `parameter-erasure-${suffix}`, project = `${org}-project`, name = `项目参数清理验收-${suffix}`;
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values($1,$2)", [org, name]);
    await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'待清理成员','成员',true)", [`${org}-member`, org]);
    await client.query("insert into projects(id,organization_id,name,code) values($1,$2,'包含来源文件的项目',$3)", [project, org, suffix]);
    await client.query(`create or replace function test_parameter_erasure_domain() returns trigger language plpgsql as $$ begin
      if old.id='${project}' then raise exception 'acceptance parameter domain fault'; end if; return old; end $$;
      drop trigger if exists test_parameter_erasure_domain on projects;
      create trigger test_parameter_erasure_domain before delete on projects for each row execute function test_parameter_erasure_domain()`);
  });
  const upload = await page.request.post(apiRoute(`/api/v1/projects/${project}/parameter-file-candidates?organizationId=${org}`), {
    headers: authHeadersForRole("platform-admin"), data: { fileName: "settings.json", contentBase64: Buffer.from('{"limit":42}').toString("base64") }
  });
  expect(upload.status(), await upload.text()).toBe(201);
  await signInBrowserAsRole(page, "platform-admin", "/platform/organizations"); await prepareInteractionSurface(page);
  const searched = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/platform/organizations" && new URL(response.url()).searchParams.get("q") === org && response.ok());
  await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
  await searched;
  const directoryRow = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name });
  await expect(directoryRow).toBeVisible();
  await directoryRow.getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "删除影响", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded();
  await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
  const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
  await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
  const startedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && response.status() === 202);
  await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
  const started = (await (await startedResponse).json() as { item: { id: string; status: string } }).item;
  expect(started.status).toBe("failed");
  const records = page.getByRole("dialog", { name: "组织清理记录", exact: true }), region = records.getByRole("region", { name: `组织 ${org} 清理` });
  await expect(region.getByLabel("领域清理进度")).toContainText("项目与组织参数");
  await expect(region.getByLabel("领域清理进度")).toContainText("清理失败，可重试");
  await page.screenshot({ path: testInfo.outputPath("organization-parameter-erasure-failed-1440.png"), animations: "disabled" });
  await withPgClient(async client => { await client.query("drop trigger test_parameter_erasure_domain on projects; drop function test_parameter_erasure_domain()"); });
  await region.getByRole("button", { name: "继续清理", exact: true }).press("Enter");
  await expect(region).toContainText("已删除");
  await expect(region.getByLabel("领域清理进度")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("organization-parameter-erasure-complete-1440.png"), animations: "disabled" });
  await withPgClient(async client => {
    expect((await client.query("select count(*)::int n from organizations where id=$1", [org])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select count(*)::int n from project_parameter_file_candidates where organization_id=$1", [org])).rows).toEqual([{ n: 0 }]);
    expect((await client.query("select domain_progress,attempts from organization_erasures where id=$1", [started.id])).rows).toEqual([{ domain_progress: {}, attempts: 0 }]);
  });
  await recordOperationEvidence({ operationId: "ORG-PARAMETER-ERASURE-001", title: "Organization project and parameter domain failure/retry", status: "passed", page, testInfo,
    artifacts: ["organization-parameter-erasure-failed-1440.png", "organization-parameter-erasure-complete-1440.png"].map(file => testInfo.outputPath(file)),
    api: [{ method: "POST", path: `/api/v1/platform/organizations/${org}/deletions`, status: 202, responseSummary: "Real domain failure remained visible and retry finished project/files and Organization cleanup." }],
    db: [{ table: "organizations", predicate: "selected project/parameter Organization", observed: "Organization physically removed", rowCount: 0 }]
  });
});
