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
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: endpoint, status: 503 }] });

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
