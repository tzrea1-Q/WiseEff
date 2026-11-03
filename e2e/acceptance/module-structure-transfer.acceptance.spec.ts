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
  { method: "POST", path: `/api/v2/organizations/${org}/module-structure/previews`, status: 400 },
  { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, status: 409 },
  { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, status: 503 }] });

test("MODULE-STRUCTURE-RECOGNITION-001: validate, override and restore inheritance", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-RECOGNITION-001
  // @operation MODULE-STRUCTURE-RECOGNITION-001
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin");
  const base = `/api/v2/organizations/${org}/module-structure`;
  const exportDocument = async () => {
    const response = await request.post(apiRoute(endpoint), { headers, data: {} });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const original = await exportDocument();
  const subject = original.subjects.find((item: { kind: string; recognition: { mode: string } | null }) => item.kind === "driver" && item.recognition?.mode === "inherit");
  expect(subject, "The isolated acceptance lane needs an inherited driver registration").toBeTruthy();
  const subjectId = subject.subjectId as string;
  const upload = async (document: unknown) => {
    const dialog = page.getByRole("dialog", { name: "导入模块结构" });
    await dialog.getByLabel("JSON 文件").setInputFiles({ name: "recognition.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    return dialog;
  };
  try {
    await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
    await page.getByRole("button", { name: "导入结构" }).focus(); await page.keyboard.press("Enter");
    const invalid = structuredClone(original);
    const invalidRule = invalid.subjects.find((item: { subjectId: string }) => item.subjectId === subjectId).recognition;
    invalidRule.mode = "override"; invalidRule.override = { ...invalidRule.effective, compatibles: ["invalid selector!"] };
    let dialog = await upload(invalid);
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByText(/recognition.json/)).toBeVisible();
    const edited = structuredClone(original);
    const rule = edited.subjects.find((item: { subjectId: string }) => item.subjectId === subjectId).recognition;
    rule.mode = "override"; rule.override = { ...rule.effective, compatibles: ["wiseeff,recognition-1499"] };
    dialog = await upload(edited);
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText(/wiseeff,recognition-1499/)).toBeVisible();
    await dialog.getByLabel("变更原因").fill("Review recognition override");
    await dialog.getByRole("button", { name: "确认提交" }).focus(); await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toContainText("回执");
    await dialog.getByRole("button", { name: "关闭" }).click();
    const reset = await exportDocument();
    const resetRule = reset.subjects.find((item: { subjectId: string }) => item.subjectId === subjectId).recognition;
    expect(resetRule.mode).toBe("override");
    resetRule.mode = "inherit"; resetRule.override = null;
    await page.getByRole("button", { name: "导入结构" }).click(); dialog = await upload(reset);
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText(/wiseeff,recognition-1499/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("recognition-reset-1440x900.png"), animations: "disabled" });
    await dialog.getByLabel("变更原因").fill("Restore inherited recognition");
    const applied = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${base}/applies` && response.status() === 200);
    await dialog.getByRole("button", { name: "确认提交" }).focus(); await page.keyboard.press("Enter");
    const response = await applied;
    await expect(dialog.getByRole("status")).toContainText("回执");
    const after = await exportDocument();
    expect(after.subjects.find((item: { subjectId: string }) => item.subjectId === subjectId).recognition.mode).toBe("inherit");
    const saved = await withPgClient(async client => (await client.query(`select 1 from public.registration_recognition_rules rule
      join parameter_catalog.organization_subject_registrations registration on registration.id=rule.registration_id and registration.organization_id=rule.organization_id
      where registration.organization_id=$1 and registration.subject_id=$2`, [org, subjectId])).rowCount);
    expect(saved).toBe(0);
    await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-RECOGNITION-001", title: "Review and reset recognition settings", status: "passed", page, testInfo: info,
      artifacts: [info.outputPath("recognition-reset-1440x900.png")], api: [summarizeApiResponse(response, { method: "POST", path: `${base}/applies`, responseSummary: "Reviewed reset committed." })],
      db: [{ table: "registration_recognition_rules", predicate: "selected inherited driver", observed: "Override removed", rowCount: 0 }], notes: "Real API at 1440×900; validation, override and reset were exercised by keyboard." });
  } finally {
    const current = await exportDocument();
    const rule = current.subjects.find((item: { subjectId: string }) => item.subjectId === subjectId)?.recognition;
    if (rule?.mode === "override") {
      rule.mode = "inherit"; rule.override = null;
      const preview = await request.post(apiRoute(`${base}/previews`), { headers, data: { document: current, resolutions: {} } });
      expect(preview.status(), await preview.text()).toBe(200);
      const token = (await preview.json()).token;
      const cleanup = await request.post(apiRoute(`${base}/applies`), { headers, data: { document: current, resolutions: {}, token, idempotencyKey: `recognition-cleanup-${Date.now()}`, reason: "Restore test state" } });
      expect(cleanup.status(), await cleanup.text()).toBe(200);
    }
  }
});

test("MODULE-STRUCTURE-IMPORT-001: review conflict, stale preview and receipt", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  // @acceptance MODULE-STRUCTURE-IMPORT-001
  // @operation MODULE-STRUCTURE-IMPORT-001
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin");
  const created = await request.post(apiRoute("/api/v1/parameter-modules"), { headers, data: { name: `Import ${Date.now()}` } });
  expect(created.status(), await created.text()).toBe(201);
  const moduleId = (await created.json()).item.id as string;
  const extraIds: string[] = [];
  let treeExportId: string | undefined;
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
    await dialog.getByRole("button", { name: "关闭" }).click();
    const suffix = `${Date.now()}`;
    const createModule = async (name: string, parentId?: string) => {
      const response = await request.post(apiRoute("/api/v1/parameter-modules"), { headers, data: { name, parentId } });
      expect(response.status(), await response.text()).toBe(201);
      const id = (await response.json()).item.id as string; extraIds.push(id); return id;
    };
    const left = await createModule(`Left ${suffix}`);
    const right = await createModule(`Right ${suffix}`);
    const child = await createModule(`Child ${suffix}`, left);
    const leaf = await createModule(`Leaf ${suffix}`, child);
    const structureExport = await request.post(apiRoute(endpoint), { headers, data: {} });
    expect(structureExport.status(), await structureExport.text()).toBe(200);
    const structure = await structureExport.json();
    treeExportId = structure.source.exportId;
    const leftEntry = structure.modules.find((entry: { sourceId: string }) => entry.sourceId === left);
    const rightEntry = structure.modules.find((entry: { sourceId: string }) => entry.sourceId === right);
    const childEntry = structure.modules.find((entry: { sourceId: string }) => entry.sourceId === child);
    [leftEntry.name, rightEntry.name] = [rightEntry.name, leftEntry.name];
    childEntry.parentRef = rightEntry.ref;
    structure.modules.push({ ref: `new-parent-${suffix}`, name: `New parent ${suffix}`, parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" },
      { ref: `new-child-${suffix}`, name: `New child ${suffix}`, parentRef: `new-parent-${suffix}`, description: "", scope: "", sortOrder: 0, importance: "medium" });
    await page.getByRole("button", { name: "导入结构" }).click();
    const treeDialog = page.getByRole("dialog", { name: "导入模块结构" });
    await treeDialog.getByLabel("JSON 文件").setInputFiles({ name: "tree.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(structure)) });
    await treeDialog.getByRole("button", { name: "预览" }).click();
    await expect(treeDialog.getByText(/新增模块/).first()).toBeVisible();
    await expect(treeDialog.getByText(/上级模块/).first()).toBeVisible();
    await treeDialog.getByLabel("变更原因").fill("Review module tree");
    await page.screenshot({ path: info.outputPath("module-structure-tree-1440x900.png"), animations: "disabled" });
    await treeDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(treeDialog.getByRole("status")).toContainText("回执");
    const createdRefs = await withPgClient(async client => (await client.query<{ module_id: string; package_ref: string }>(`select module_id,package_ref from parameter_catalog.module_structure_created_refs
      where organization_id=$1 and export_id=$2 order by package_ref desc`, [org, structure.source.exportId])).rows);
    expect(createdRefs).toHaveLength(2);
    extraIds.push(...createdRefs.map(row => row.module_id));
    const moved = await withPgClient(async client => (await client.query<{ path: string; parent_id: string }>("select path,parent_id from parameter_modules where id=$1", [leaf])).rows[0]);
    expect(moved).toEqual({ parent_id: child, path: `${right}/${child}/${leaf}` });
    await treeDialog.getByRole("button", { name: "关闭" }).click();
    const newParent = createdRefs.find(row => row.package_ref === `new-parent-${suffix}`)!;
    const renamed = await request.patch(apiRoute(`/api/v1/parameter-modules/${newParent.module_id}`), { headers, data: { name: `Renamed ${suffix}` } });
    expect(renamed.status(), await renamed.text()).toBe(200);
    await page.getByRole("button", { name: "导入结构" }).click();
    await treeDialog.getByLabel("JSON 文件").setInputFiles({ name: "tree-again.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(structure)) });
    await treeDialog.getByRole("button", { name: "预览" }).click();
    await expect(treeDialog.getByText("没有领域数据变更。")).toBeVisible();
    await treeDialog.getByLabel("变更原因").fill("Repeat reviewed tree");
    await treeDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(treeDialog.getByRole("status")).toContainText("回执");
    await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-IMPORT-001", title: "Review and apply module structure update",
      status: "passed", page, testInfo: info, artifacts: [info.outputPath("module-structure-import-1440x900.png"), info.outputPath("module-structure-receipt-1440x900.png"), info.outputPath("module-structure-tree-1440x900.png")],
      api: [summarizeApiResponse(applied, { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, responseSummary: "Reviewed update committed after stale preview was refreshed." })],
      db: [{ table: "parameter_modules", predicate: "created module in authorized organization", observed: "file edit committed", rowCount: 1 }],
      notes: "Real API and PostgreSQL, 1440×900; conflicting and stale target edits used the public module API. One controlled 503 exercised retry." });
  } finally {
    if (treeExportId) {
      const createdIds = await withPgClient(async client => (await client.query<{ module_id: string }>(`select r.module_id from parameter_catalog.module_structure_created_refs r
        join parameter_modules m on m.id=r.module_id and m.organization_id=r.organization_id
        where r.organization_id=$1 and r.export_id=$2 order by m.depth`, [org, treeExportId])).rows);
      for (const row of createdIds) if (!extraIds.includes(row.module_id)) extraIds.push(row.module_id);
    }
    for (const id of extraIds.reverse()) {
      const deleted = await request.delete(apiRoute(`/api/v1/parameter-modules/${id}`), { headers });
      expect(deleted.ok(), await deleted.text()).toBeTruthy();
    }
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
