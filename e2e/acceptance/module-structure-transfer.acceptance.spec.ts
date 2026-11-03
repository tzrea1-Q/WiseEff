import "./helpers/loadAcceptanceEnvironment";
import { readFile } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { acceptanceAdminOnlyUser, seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

const org = "org-chargelab";
const endpoint = `/api/v2/organizations/${org}/module-structure/exports`;
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: endpoint, status: 503 },
  { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, status: 409 },
  { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, status: 503 }] });

test("MODULE-STRUCTURE-IMPORT-001: review conflict, stale preview and receipt", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-IMPORT-001
  // @operation MODULE-STRUCTURE-IMPORT-001
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin");
  const created = await request.post(apiRoute("/api/v1/parameter-modules"), { headers, data: { name: `Import ${Date.now()}` } });
  expect(created.status(), await created.text()).toBe(201);
  const moduleId = (await created.json()).item.id as string;
  try {
    const exported = await request.post(apiRoute(endpoint), { headers, data: {} });
    expect(exported.status(), await exported.text()).toBe(200);
    const document = await exported.json();
    const module = document.modules.find((entry: { sourceId: string }) => entry.sourceId === moduleId);
    expect(module).toBeTruthy();
    module.description = "file edit";
    const patch = async (description: string) => {
      const response = await request.patch(apiRoute(`/api/v1/parameter-modules/${moduleId}`), { headers, data: { description } });
      expect(response.status(), await response.text()).toBe(200);
    };
    await patch("current edit");
    await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
    await page.getByRole("button", { name: "导入结构" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "导入模块结构" });
    await dialog.getByLabel("JSON 文件").setInputFiles({ name: "edit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await dialog.getByRole("button", { name: "关闭" }).click();
    await page.getByRole("dialog", { name: "放弃导入？" }).getByRole("button", { name: "继续编辑" }).click();
    await expect(dialog.getByText(/edit.json/)).toBeVisible();
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText('"current edit"')).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
    await dialog.getByLabel(`${module.ref}:description 的冲突选择`).click();
    await page.getByRole("option", { name: "采用文件" }).click();
    await expect(dialog.getByText(/待解决冲突（0）/)).toBeVisible();
    await dialog.getByLabel("变更原因").fill("Reviewed import");
    await patch("later edit");
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog.getByRole("alert")).toContainText("重新预览");
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText(/later edit/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("module-structure-import-1440x900.png"), animations: "disabled" });
    await page.route(`**/api/v2/organizations/${org}/module-structure/applies`, route => route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Temporary apply error", details: {}, requestId: "controlled" } }) }), { times: 1 });
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("变更原因")).toHaveValue("Reviewed import");
    const applyResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/module-structure/applies") && response.status() === 200);
    await dialog.getByRole("button", { name: "确认提交" }).focus();
    await page.keyboard.press("Enter");
    const applied = await applyResponse;
    await expect(dialog.getByRole("status")).toContainText("回执");
    await page.screenshot({ path: info.outputPath("module-structure-receipt-1440x900.png"), animations: "disabled" });
    const actual = await withPgClient(async client => (await client.query<{ description: string }>("select description from parameter_modules where id=$1 and organization_id=$2", [moduleId, org])).rows[0]);
    expect(actual?.description).toBe("file edit");
    await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-IMPORT-001", title: "Review and apply module structure update",
      status: "passed", page, testInfo: info, artifacts: [info.outputPath("module-structure-import-1440x900.png"), info.outputPath("module-structure-receipt-1440x900.png")],
      api: [summarizeApiResponse(applied, { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, responseSummary: "Reviewed update committed after stale preview was refreshed." })],
      db: [{ table: "parameter_modules", predicate: "created module in authorized organization", observed: "file edit committed", rowCount: 1 }],
      notes: "Real API and PostgreSQL, 1440×900; conflicting and stale target edits used the public module API. One controlled 503 exercised retry." });
  } finally {
    const deleted = await request.delete(apiRoute(`/api/v1/parameter-modules/${moduleId}`), { headers });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
  }
});

test("MODULE-STRUCTURE-EXPORT-001: complete filtered download, retry and reader permissions", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-EXPORT-001
  // @operation MODULE-STRUCTURE-EXPORT-001
  await seedAcceptanceRoleMatrix();
  const counts = await withPgClient(async client => (await client.query<{ modules: number; subjects: number }>(`select
    (select count(*)::int from parameter_modules where organization_id=$1 and kind='business' and archived_at is null) as modules,
    (select count(*)::int from parameter_catalog.organization_subject_registrations where organization_id=$1) as subjects`, [org])).rows[0]!);
  expect(counts.modules).toBeGreaterThan(0);
  await signInBrowserAsUser(page, acceptanceAdminOnlyUser.userId, acceptanceAdminOnlyUser.email, acceptanceAdminOnlyUser.name, "/parameter-admin/modules");
  await page.getByRole("searchbox", { name: "搜索模块" }).fill("no-matching-module-1495");
  const controls = page.getByRole("group", { name: "模块结构导出" });
  const exportButton = controls.getByRole("button", { name: "导出完整结构" });
  await expect(exportButton).toBeEnabled();

  await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Temporary export error", details: {}, requestId: "controlled" } }) }), { times: 1 });
  await exportButton.focus();
  await page.keyboard.press("Enter");
  await expect(controls.getByRole("status")).toContainText("导出失败，请稍后重试。");
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === endpoint && response.status() === 200);
  const downloadPromise = page.waitForEvent("download");
  await exportButton.focus();
  await page.keyboard.press("Enter");
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  const document = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(download.suggestedFilename()).toBe("module-structure.json");
  expect(document).toMatchObject({ format: "wiseeff-module-structure", version: 1, source: { organizationId: org }, counts });
  expect(document.modules).toHaveLength(counts.modules);
  expect(document.subjects).toHaveLength(counts.subjects);
  await expect(controls.getByRole("status")).toContainText(`${counts.modules} 个模块，${counts.subjects} 个主体`);
  const persisted = await withPgClient(async client => (await client.query<{ baseline: boolean; audited: boolean }>(`select
    exists(select 1 from parameter_catalog.module_structure_export_baselines where organization_id=$1 and export_id=$2) as baseline,
    exists(select 1 from audit_events where organization_id=$1 and action='module-structure-export' and metadata->>'exportId'=$2) as audited`,
  [org, document.source.exportId])).rows[0]!);
  expect(persisted).toEqual({ baseline: true, audited: true });
  const guideDownload = page.waitForEvent("download");
  await controls.getByRole("button", { name: "下载填写说明" }).focus();
  await page.keyboard.press("Enter");
  const guide = await guideDownload;
  expect(guide.suggestedFilename()).toBe("module-structure-guide.md");
  expect(await readFile((await guide.path())!, "utf8")).toContain("sourceId");
  await page.screenshot({ path: info.outputPath("module-structure-export-1440x900.png"), animations: "disabled" });

  await signInBrowserAsRole(page, "guest", "/parameter-admin/modules");
  await expect(page.getByRole("region", { name: "无权访问" })).toContainText("无权访问该页面");
  await expect(page.getByRole("button", { name: "导出完整结构" })).toHaveCount(0);
  const denied = await request.post(apiRoute(endpoint), { headers: authHeadersForRole("guest"), data: {} });
  expect(denied.status()).toBe(403);
  await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-EXPORT-001", title: "Complete module structure export",
    status: "passed", page, testInfo: info, artifacts: [info.outputPath("module-structure-export-1440x900.png")],
    api: [summarizeApiResponse(response, { method: "POST", path: endpoint, responseSummary: "Complete export succeeded after controlled failure." }),
      summarizeApiResponse(denied, { method: "POST", path: endpoint, responseSummary: "Guest denied." })],
    db: [{ table: "parameter_modules and organization_subject_registrations", predicate: "authorized organization", observed: `modules=${counts.modules}, subjects=${counts.subjects}` },
      { table: "parameter_catalog.module_structure_export_baselines", predicate: "authorized organization and export ID", observed: "Baseline retained", rowCount: 1 }],
    audit: [{ kind: "module-structure-export", action: "module-structure-export", metadataSummary: "Export audited." }],
    notes: "Real API and PostgreSQL; the first 503 was injected in the browser to exercise retry." });
});
