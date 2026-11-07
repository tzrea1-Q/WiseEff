import "./helpers/loadAcceptanceEnvironment";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, test } from "playwright/test";
import { createCatalogKernel } from "../../server/modules/catalog-kernel/interface";
import { captureCurrentCatalogPin } from "../../server/modules/catalog-publication/runtime";
import { createSourceBackedBindingService } from "../../server/modules/parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { DefinitionRevisionId, ParameterDefinitionId, SubjectRegistrationId } from "../../server/modules/parameter-catalog-contract";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
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

test("diagnoses agent-edited export metadata and supports manual copying before repair", async ({ page, request }, info) => {
  await seedAcceptanceRoleMatrix();
  const exported = await request.post(apiRoute(endpoint), { headers: authHeadersForRole("admin"), data: {} });
  expect(exported.status(), await exported.text()).toBe(200);
  const original = await exported.json();
  const edited = structuredClone(original);
  edited.counts.modules++;
  edited.source.catalogReleaseId = "agent-replaced-release";
  edited.limits.maxBytes++;
  // The deployed HTTP/IP site may not expose navigator.clipboard.
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
  await page.getByRole("button", { name: "导入结构" }).click();
  const dialog = page.getByRole("dialog", { name: "导入模块结构" });
  await dialog.getByLabel("JSON 文件").setInputFiles({ name: "module-structure-import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(edited)) });
  await dialog.getByRole("button", { name: "预览" }).click();
  const diagnostic = dialog.getByRole("region", { name: "导入错误诊断" });
  await expect(diagnostic).toContainText("document.counts.modules");
  await expect(diagnostic).toContainText("document.source.catalogReleaseId");
  await expect(diagnostic).toContainText("document.limits.maxBytes");
  await expect(diagnostic).toContainText("不要重新计算");
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await diagnostic.getByRole("button", { name: "复制诊断信息" }).focus();
  await page.keyboard.press("Enter");
  const text = diagnostic.getByLabel("导入诊断信息");
  await expect(text).toBeVisible();
  await expect(text).toBeFocused();
  const report = JSON.parse(await text.inputValue());
  expect(JSON.stringify(report)).toContain("readonly-module-structure-fields");
  expect(JSON.stringify(report)).toContain("module-structure-import.json");
  await page.screenshot({ path: info.outputPath("module-structure-diagnostics-1440x900.png"), animations: "disabled" });
  await dialog.getByLabel("JSON 文件").setInputFiles({ name: "repaired.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
  await expect(diagnostic).toHaveCount(0);
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByText("没有领域数据变更。")).toBeVisible();
});

test("diagnoses a recognition field with subject identity, exact value and a repair rule", async ({ page, request }, info) => {
  await seedAcceptanceRoleMatrix();
  const exported = await request.post(apiRoute(endpoint), { headers: authHeadersForRole("admin"), data: {} });
  expect(exported.status(), await exported.text()).toBe(200);
  const original = await exported.json();
  const edited = structuredClone(original);
  const index = edited.subjects.findIndex((subject: { kind: string; recognition: unknown }) => subject.kind === "node-type" && subject.recognition);
  expect(index).toBeGreaterThanOrEqual(0);
  const subject = edited.subjects[index];
  subject.recognition.mode = "override";
  subject.recognition.override = { ...subject.recognition.effective, nodeTypeName: "battery_checker@0" };
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
  await page.getByRole("button", { name: "导入结构" }).click();
  const dialog = page.getByRole("dialog", { name: "导入模块结构" });
  await dialog.getByLabel("JSON 文件").setInputFiles({ name: "recognition-diagnostic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(edited)) });
  await dialog.getByRole("button", { name: "预览" }).click();
  const diagnostic = dialog.getByRole("region", { name: "导入错误诊断" });
  await expect(diagnostic).toContainText(subject.subjectId);
  await expect(diagnostic).toContainText(`/subjects/${index}/recognition/override/nodeTypeName`);
  await expect(diagnostic).toContainText("battery_checker@0");
  await expect(diagnostic).toContainText("节点类型名包含 @ 单元地址");
  await expect(diagnostic).toContainText("格式示例（仅示意");
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("module-structure-recognition-diagnostic-1440x900.png"), animations: "disabled" });
  await diagnostic.getByRole("button", { name: "复制诊断信息" }).focus();
  await page.keyboard.press("Enter");
  const report = JSON.parse(await diagnostic.getByLabel("导入诊断信息").inputValue());
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
    subject: expect.objectContaining({ subjectId: subject.subjectId, kind: "node-type", index }),
    code: "unit-address-present", received: "battery_checker@0", example: "battery_checker",
    jsonPointer: `/subjects/${index}/recognition/override/nodeTypeName`, hint: expect.stringContaining("不带 @"),
  })]));
  await dialog.getByLabel("JSON 文件").setInputFiles({ name: "recognition-repaired.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByText("没有领域数据变更。")).toBeVisible();
});

test("MODULE-STRUCTURE-MIXED-001: review one mixed update", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-MIXED-001
  // @operation MODULE-STRUCTURE-MIXED-001
  const suffix = String(Date.now()), organization = `structure-mixed-${suffix}`, user = `mixed-user-${suffix}`;
  const oldModule = `mixed-old-${suffix}`, email = `${user}@example.test`;
  const subjects = await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values ($1,'Mixed structure')", [organization]);
    await client.query("insert into users(id,organization_id,name,title,email,is_active) values ($1,$2,'Mixed admin','Admin',$3,true)", [user, organization, email]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`role-${suffix}`, user, organization]);
    await client.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,'Old category',$1,'business','curated')", [oldModule, organization]);
    const ids = (await client.query<{ id: string }>(`select s.id from parameter_catalog.catalog_subjects s join parameter_catalog.catalog_state cs on cs.singleton
      join parameter_catalog.catalog_release_subjects rs on rs.release_id=cs.current_catalog_release_id and rs.subject_id=s.id
      where s.owner_subject_id is null and s.kind='driver' and rs.lifecycle='active' order by s.id limit 2`)).rows.map(row => row.id);
    await client.query("begin"); await client.query("set constraints all deferred");
    await client.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id,display_alias)
      values ($1,$2,$3,'retired','explicit','{}',$4,'Retired driver')`, [`registration-${suffix}`, organization, ids[0], `placement-${suffix}`]);
    await client.query("insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin) values ($1,$2,$3,$4,'curated')", [`placement-${suffix}`, `registration-${suffix}`, organization, oldModule]);
    await client.query("commit"); return ids;
  });
  expect(subjects).toHaveLength(2);
  const base = `/api/v2/organizations/${organization}/module-structure`, headers = authHeadersForUser(user, email, "Mixed admin", organization);
  const exported = await request.post(apiRoute(`${base}/exports`), { headers, data: {} });
  expect(exported.status(), await exported.text()).toBe(200);
  const document = await exported.json();
  document.modules.find((item: { sourceId: string }) => item.sourceId === oldModule).operation = "delete";
  document.modules.push({ ref: "new-parent", name: "New parent", parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" },
    { ref: "new-child", name: "New child", parentRef: "new-parent", description: "", scope: "", sortOrder: 0, importance: "medium" });
  const retired = document.subjects.find((item: { subjectId: string }) => item.subjectId === subjects[0]);
  retired.placement = { kind: "module", moduleRef: "new-child" };
  retired.recognition.mode = "override"; retired.recognition.override = { ...retired.recognition.effective, compatibles: [`wiseeff,mixed-${suffix}`] };
  document.subjects.push({ subjectId: subjects[1], state: "active", placement: { kind: "module", moduleRef: "new-child" } });
  await signInBrowserAsUser(page, user, email, "Mixed admin", "/parameter-admin/modules", organization);
  await page.getByRole("button", { name: "导入结构" }).click();
  const dialog = page.getByRole("dialog", { name: "导入模块结构" });
  await dialog.getByLabel("JSON 文件").setInputFiles({ name: "mixed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByText(/Retired driver/).first()).toBeVisible();
  await expect(dialog.getByText(/New parent \/ New child/).first()).toBeVisible();
  await expect(dialog.getByText(`wiseeff,mixed-${suffix}`, { exact: false }).first()).toBeVisible();
  await expect(dialog.getByText(/删除模块/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("module-structure-mixed-1440x900.png"), animations: "disabled" });
  await dialog.getByLabel("变更原因").fill("Review mixed update");
  const applied = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${base}/applies` && response.status() === 200);
  await dialog.getByRole("button", { name: "确认提交" }).click(); const response = await applied;
  await expect(dialog.getByRole("status")).toContainText("回执");
  const after = await request.post(apiRoute(`${base}/exports`), { headers, data: {} }); const result = await after.json();
  expect(result.modules.some((item: { sourceId: string }) => item.sourceId === oldModule)).toBe(false);
  expect(result.subjects.find((item: { subjectId: string }) => item.subjectId === subjects[0]).state).toBe("retired");
  expect(result.subjects.find((item: { subjectId: string }) => item.subjectId === subjects[1]).state).toBe("active");
  await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-MIXED-001", title: "Review a mixed structure update", status: "passed", page, testInfo: info,
    artifacts: [info.outputPath("module-structure-mixed-1440x900.png")], api: [summarizeApiResponse(response, { method: "POST", path: `${base}/applies`, responseSummary: "Mixed update committed." })],
    notes: "Real API at 1440×900: new parent and child, registration, retired placement, recognition and deletion." });
});

test("MODULE-STRUCTURE-LIFECYCLE-001: register, retire and restore roots", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-LIFECYCLE-001
  // @operation MODULE-STRUCTURE-LIFECYCLE-001
  const suffix = `${Date.now()}`;
  const organization = `structure-life-${suffix}`, user = `structure-life-user-${suffix}`, moduleId = `structure-life-module-${suffix}`;
  const email = `${user}@example.test`;
  const subjects = await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values ($1,'Structure lifecycle')", [organization]);
    await client.query("insert into users(id,organization_id,name,title,email,is_active) values ($1,$2,'Lifecycle admin','Admin',$3,true)", [user, organization, email]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`role-${suffix}`, user, organization]);
    await client.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,'Lifecycle category',$1,'business','curated')", [moduleId, organization]);
    return (await client.query<{ id: string }>(`select s.id from parameter_catalog.catalog_subjects s join parameter_catalog.catalog_state cs on cs.singleton
      join parameter_catalog.catalog_release_subjects rs on rs.release_id=cs.current_catalog_release_id and rs.subject_id=s.id
      where s.owner_subject_id is null and s.kind='driver' and rs.lifecycle='active'
      and exists (select 1 from parameter_catalog.parameter_definitions d where d.subject_id=s.id) order by s.id limit 2`)).rows.map(row => row.id);
  });
  expect(subjects).toHaveLength(2);
  const base = `/api/v2/organizations/${organization}/module-structure`;
  const headers = authHeadersForUser(user, email, "Lifecycle admin", organization);
  const exportDocument = async () => { const response = await request.post(apiRoute(`${base}/exports`), { headers, data: {} }); expect(response.status(), await response.text()).toBe(200); return response.json(); };
  const document = await exportDocument();
  document.subjects.push(...subjects.map(subjectId => ({ subjectId, state: "active", placement: { kind: "module", moduleRef: moduleId } })));
  await signInBrowserAsUser(page, user, email, "Lifecycle admin", "/parameter-admin/modules", organization);
  let lastResponse: Awaited<ReturnType<typeof page.waitForResponse>> | undefined;
  for (const operation of ["register", "retire", "restore"] as const) {
    if (operation === "retire") {
      const projectId = `structure-life-project-${suffix}`;
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query("insert into projects(id,organization_id,name,code) values ($1,$2,'Lifecycle project',$3)", [projectId, organization, `L${suffix}`]);
        const row = (await pool.query<{ registration_id: string; definition_id: string; revision_id: string }>(`select r.id as registration_id,d.id as definition_id,d.current_revision_id as revision_id
          from parameter_catalog.organization_subject_registrations r join parameter_catalog.parameter_definitions d on d.subject_id=r.subject_id
          where r.organization_id=$1 and r.subject_id=$2 order by d.id limit 1`, [organization, subjects[0]])).rows[0]!;
        const pin = await captureCurrentCatalogPin(pool);
        if (!pin) throw new Error("Catalog unavailable");
        const snapshot = await createCatalogKernel(pool).loadCurrentCatalog(pin);
        if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.error));
        const binding = await createSourceBackedBindingService(pool).stabilize({ snapshot: snapshot.value,
          organizationId: organization, projectId, logicalNodeId: `lifecycle_${suffix}`, registrationId: SubjectRegistrationId(row.registration_id),
          definitionId: ParameterDefinitionId(row.definition_id), effectiveRevisionId: DefinitionRevisionId(row.revision_id), expectedEffectiveRevisionId: null });
        if (!binding.ok) throw new Error(JSON.stringify(binding.error));
      } finally { await pool.end(); }
    }
    const edited = operation === "register" ? document : await exportDocument();
    if (operation !== "register") for (const subject of edited.subjects) if (subjects.includes(subject.subjectId)) subject.state = operation === "retire" ? "retired" : "active";
    await page.getByRole("button", { name: "导入结构" }).click();
    const dialog = page.getByRole("dialog", { name: "导入模块结构" });
    await dialog.getByLabel("JSON 文件").setInputFiles({ name: `${operation}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(edited)) });
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.locator("li").filter({ hasText: "登记状态" })).toHaveCount(2);
    if (operation !== "register") {
      await expect(dialog.getByRole("heading", { name: "受影响项目" })).toBeVisible();
      await expect(dialog.getByText(`项目 structure-life-project-${suffix}`, { exact: false })).toContainText("绑定 1");
    }
    await dialog.getByLabel("变更原因").fill(`Review ${operation}`);
    if (operation === "retire") await page.screenshot({ path: info.outputPath("module-structure-lifecycle-1440x900.png"), animations: "disabled" });
    const applied = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${base}/applies` && response.status() === 200);
    await dialog.getByRole("button", { name: "确认提交" }).click();
    lastResponse = await applied;
    await expect(dialog.getByRole("status")).toContainText("回执");
    await dialog.getByRole("button", { name: "关闭" }).click();
    const after = await exportDocument();
    for (const id of subjects) expect(after.subjects.find((item: { subjectId: string }) => item.subjectId === id).state).toBe(operation === "retire" ? "retired" : "active");
  }
  await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-LIFECYCLE-001", title: "Review root registration lifecycle", status: "passed", page, testInfo: info,
    artifacts: [info.outputPath("module-structure-lifecycle-1440x900.png")],
    api: [summarizeApiResponse(lastResponse!, { method: "POST", path: `${base}/applies`, responseSummary: "Reviewed restore committed." })],
    db: [{ table: "project_parameter_bindings", predicate: "isolated lifecycle project", observed: "One binding and its definition shown during review", rowCount: 1 }],
    notes: "Real API batch registration, retirement and restoration at 1440×900." });
});

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
    await expect(dialog.getByText(`文件：recognition.json；来源组织：${org}；目标组织：${org}`, { exact: true })).toBeVisible();
    const edited = structuredClone(original);
    const rule = edited.subjects.find((item: { subjectId: string }) => item.subjectId === subjectId).recognition;
    rule.mode = "override"; rule.override = { ...rule.effective, compatibles: ["wiseeff,recognition-1499"] };
    dialog = await upload(edited);
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.locator("li").filter({ hasText: "wiseeff,recognition-1499" }).first()).toBeVisible();
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
    await expect(dialog.locator("li").filter({ hasText: "wiseeff,recognition-1499" }).first()).toBeVisible();
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
    await expect(dialog.getByText(`文件：edit.json；来源组织：${org}；目标组织：${org}`, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText('current edit', { exact: true })).toBeVisible();
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

test("MODULE-STRUCTURE-DELETE-001: move a child into a new category and delete its parent", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-DELETE-001
  // @operation MODULE-STRUCTURE-DELETE-001
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin"), base = `/api/v2/organizations/${org}/module-structure`, suffix = Date.now();
  const create = async (name: string, parentId?: string) => {
    const response = await request.post(apiRoute("/api/v1/parameter-modules"), { headers, data: { name, parentId } });
    expect(response.status(), await response.text()).toBe(201); return (await response.json()).item.id as string;
  };
  const parent = await create(`Delete parent ${suffix}`), child = await create(`Move child ${suffix}`, parent);
  let exportId = "";
  try {
    const exported = await request.post(apiRoute(endpoint), { headers, data: {} });
    expect(exported.status(), await exported.text()).toBe(200);
    const document = await exported.json(); exportId = document.source.exportId;
    document.modules.find((item: { sourceId: string }) => item.sourceId === parent).operation = "delete";
    document.modules.find((item: { sourceId: string }) => item.sourceId === child).parentRef = "new-destination";
    document.modules.push({ ref: "new-destination", name: `Destination ${suffix}`, parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" });
    await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
    await page.getByRole("button", { name: "导入结构" }).click();
    const dialog = page.getByRole("dialog", { name: "导入模块结构" });
    await dialog.getByLabel("JSON 文件").setInputFiles({ name: "delete.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText(/删除模块/).first()).toBeVisible();
    await expect(dialog.getByText(/上级模块/).first()).toContainText(`Destination ${suffix}`);
    await expect(dialog.getByText(/将解除的遗留引用数/).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("module-structure-delete-1440x900.png"), animations: "disabled" });
    await dialog.getByLabel("变更原因").fill("Review category deletion");
    await page.route(`**${base}/applies`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Temporary apply error", details: {}, requestId: "controlled" } }) }), { times: 1 });
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    const applied = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${base}/applies` && response.status() === 200);
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const response = await applied; await expect(dialog.getByRole("status")).toContainText("回执");
    const rows = await withPgClient(async client => (await client.query("select id,parent_id from parameter_modules where id=any($1::text[]) order by id", [[parent, child]])).rows);
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(child); expect(rows[0].parent_id).toBeTruthy();
    await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-DELETE-001", title: "Review module deletion", status: "passed", page, testInfo: info,
      artifacts: [info.outputPath("module-structure-delete-1440x900.png")], api: [summarizeApiResponse(response, { method: "POST", path: `${base}/applies`, responseSummary: "Deletion committed after retry." })],
      db: [{ table: "parameter_modules", predicate: "deleted parent and moved child", observed: "Parent removed and child retained", rowCount: 1 }], notes: "Real API at 1440×900; controlled failure exercised retry." });
  } finally {
    await request.delete(apiRoute(`/api/v1/parameter-modules/${child}`), { headers });
    const ids = await withPgClient(async client => (await client.query<{ module_id: string }>("select module_id from parameter_catalog.module_structure_created_refs where organization_id=$1 and export_id=$2", [org, exportId])).rows);
    for (const row of ids) await request.delete(apiRoute(`/api/v1/parameter-modules/${row.module_id}`), { headers });
    await request.delete(apiRoute(`/api/v1/parameter-modules/${parent}`), { headers });
  }
});

test("MODULE-STRUCTURE-COPY-001: confirm reuse and creation in a nonempty target", async ({ page, request }, info) => {
  // @acceptance MODULE-STRUCTURE-COPY-001
  // @operation MODULE-STRUCTURE-COPY-001
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin"); const suffix = String(Date.now());
  const sourceOrg = `copy-source-${suffix}`; const sourceId = `copy-source-module-${suffix}`; const name = `Copy root ${suffix}`;
  await withPgClient(async client => {
    await client.query("insert into organizations(id,name) values ($1,'Copy source')", [sourceOrg]);
    await client.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,$3,$1,'business','curated')", [sourceId, sourceOrg, name]);
  });
  const created = await request.post(apiRoute("/api/v1/parameter-modules"), { headers, data: { name } });
  expect(created.status(), await created.text()).toBe(201);
  const targetId = (await created.json()).item.id as string; let childId: string | undefined;
  try {
    const exported = await request.post(apiRoute(endpoint), { headers, data: {} });
    const document = await exported.json();
    const root = document.modules.find((entry: { sourceId: string }) => entry.sourceId === targetId);
    document.source = { ...document.source, organizationId: sourceOrg, exportId: `browser-copy-${suffix}` };
    document.modules = [{ ...root, ref: sourceId, sourceId }, { ref: `child-${suffix}`, name: `Copy child ${suffix}`, parentRef: sourceId,
      description: "", scope: "", sortOrder: 0, importance: "medium" }];
    document.subjects = []; document.references = [];
    await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
    await page.getByRole("button", { name: "导入结构" }).click();
    const dialog = page.getByRole("dialog", { name: "导入模块结构" });
    await dialog.getByLabel("导入模式").click(); await page.getByRole("option", { name: "复制到当前组织" }).click();
    await dialog.getByLabel("JSON 文件").setInputFiles({ name: "copy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await dialog.getByRole("button", { name: "预览" }).click();
    await expect(dialog.getByText(`来源组织：${sourceOrg}`, { exact: false })).toBeVisible();
    await dialog.getByLabel(`${sourceId} 的目标模块`).click(); await page.getByRole("option", { name: `建议：复用 ${name}` }).click();
    await expect(dialog.getByLabel(`${sourceId} 的目标模块`)).toContainText(name);
    await dialog.getByLabel(`child-${suffix} 的目标模块`).click(); await page.getByRole("option", { name: "新建目标模块" }).click();
    await expect(dialog.getByText("待解决冲突（0）")).toBeVisible();
    await dialog.getByLabel("变更原因").fill("Review cross-organization copy");
    await page.screenshot({ path: info.outputPath("module-structure-copy-1440x900.png"), animations: "disabled" });
    const applied = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v2/organizations/${org}/module-structure/applies` && response.status() === 200);
    await dialog.getByRole("button", { name: "确认提交" }).click(); const response = await applied;
    await expect(dialog.getByRole("status")).toContainText("回执");
    const result = await withPgClient(async client => ({ child: (await client.query<{ id: string; parent_id: string }>("select id,parent_id from parameter_modules where organization_id=$1 and name=$2", [org, `Copy child ${suffix}`])).rows[0],
      source: (await client.query("select name from parameter_modules where organization_id=$1 and id=$2", [sourceOrg, sourceId])).rows }));
    childId = result.child.id; expect(result.child.parent_id).toBe(targetId); expect(result.source).toEqual([{ name }]);
    await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-COPY-001", title: "Copy modules into a nonempty organization", status: "passed", page, testInfo: info,
      artifacts: [info.outputPath("module-structure-copy-1440x900.png")], api: [summarizeApiResponse(response, { method: "POST", path: `/api/v2/organizations/${org}/module-structure/applies`, responseSummary: "Confirmed reuse and creation committed." })],
      db: [{ table: "parameter_modules", predicate: "target and source organizations", observed: "Target child references reused root; source remains unchanged." }] });
  } finally {
    if (childId) await request.delete(apiRoute(`/api/v1/parameter-modules/${childId}`), { headers });
    await request.delete(apiRoute(`/api/v1/parameter-modules/${targetId}`), { headers });
    await withPgClient(async client => { await client.query("delete from parameter_modules where id=$1", [sourceId]); await client.query("delete from organizations where id=$1", [sourceOrg]); });
  }
});

test("copy retained Subject settings into a populated target", async ({ page, request }, info) => {
  const suffix = String(Date.now()), sourceOrg = `subject-source-${suffix}`, targetOrg = `subject-target-${suffix}`;
  const sourceUser = `subject-source-user-${suffix}`, targetUser = `subject-target-user-${suffix}`;
  const sourceModule = `subject-source-module-${suffix}`, targetModule = `subject-target-module-${suffix}`;
  const email = (user: string) => `${user}@example.test`;
  const subjectId = await withPgClient(async client => {
    for (const [id, user, moduleId] of [[sourceOrg, sourceUser, sourceModule], [targetOrg, targetUser, targetModule]]) {
      await client.query("insert into organizations(id,name) values ($1,'Subject copy')", [id]);
      await client.query("insert into users(id,organization_id,name,title,email,is_active) values ($1,$2,'Copy admin','Admin',$3,true)", [user, id, email(user)]);
      await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [`role-${user}`, user, id]);
      await client.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ($1,$2,'Copy category',$1,'business','curated')", [moduleId, id]);
    }
    const subject = (await client.query<{ id: string }>(`select s.id from parameter_catalog.catalog_subjects s
      join parameter_catalog.catalog_state cs on cs.singleton join parameter_catalog.catalog_release_subjects rs on rs.subject_id=s.id and rs.release_id=cs.current_catalog_release_id
      where s.kind='driver' and s.owner_subject_id is null and rs.lifecycle='active'
      and not exists (select 1 from parameter_catalog.catalog_subjects child where child.owner_subject_id=s.id) order by s.id limit 1`)).rows[0]!.id;
    await client.query("begin"); await client.query("set constraints all deferred");
    for (const [id, moduleId, status, alias] of [[sourceOrg, sourceModule, "retired", "Source alias"], [targetOrg, targetModule, "active", "Target alias"]]) {
      await client.query(`insert into parameter_catalog.organization_subject_registrations(id,organization_id,subject_id,status,registration_method,proof,current_placement_id,display_alias)
        values ($1,$2,$3,$4,'explicit','{}',$5,$6)`, [`registration-${id}`, id, subject, status, `placement-${id}`, alias]);
      await client.query("insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin) values ($1,$2,$3,$4,'curated')",
        [`placement-${id}`, `registration-${id}`, id, moduleId]);
    }
    await client.query(`insert into registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
      values ($1,$2,$3,array['wiseeff,copy-browser'],'physical-device','multiple')`, [sourceOrg, `registration-${sourceOrg}`, subject]);
    await client.query("commit"); return subject;
  });
  const headers = authHeadersForUser(sourceUser, email(sourceUser), "Copy admin", sourceOrg);
  const exported = await request.post(apiRoute(`/api/v2/organizations/${sourceOrg}/module-structure/exports`), { headers, data: {} });
  expect(exported.status(), await exported.text()).toBe(200);
  const document = await exported.json();
  await signInBrowserAsUser(page, targetUser, email(targetUser), "Copy admin", "/parameter-admin/modules", targetOrg);
  await page.getByRole("button", { name: "导入结构" }).click();
  const dialog = page.getByRole("dialog", { name: "导入模块结构" });
  await dialog.getByLabel("导入模式").click(); await page.getByRole("option", { name: "复制到当前组织" }).click();
  await dialog.getByLabel("JSON 文件").setInputFiles({ name: "subjects.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await dialog.getByRole("button", { name: "预览" }).click();
  await dialog.getByLabel(`${sourceModule} 的目标模块`).click(); await page.getByRole("option", { name: "建议：复用 Copy category" }).click();
  for (const field of ["state", "displayAlias", "recognition"]) {
    await dialog.getByLabel(`subject:${subjectId}:${field} 的冲突选择`).click();
    await page.getByRole("option", { name: "采用文件" }).click();
  }
  await expect(dialog.getByText("待解决冲突（0）")).toBeVisible();
  await expect(dialog.getByText("Source alias", { exact: false }).first()).toBeVisible();
  await dialog.getByLabel("变更原因").fill("Copy reviewed Subject settings");
  await page.screenshot({ path: info.outputPath("module-structure-subject-copy-1440x900.png"), animations: "disabled" });
  const applied = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v2/organizations/${targetOrg}/module-structure/applies` && response.status() === 200);
  await dialog.getByRole("button", { name: "确认提交" }).click(); const response = await applied;
  await expect(dialog.getByRole("status")).toContainText("回执");
  const rows = await withPgClient(async client => (await client.query("select organization_id,status,display_alias from parameter_catalog.organization_subject_registrations where organization_id=any($1::text[]) order by organization_id", [[sourceOrg, targetOrg]])).rows);
  expect(rows).toEqual([{ organization_id: sourceOrg, status: "retired", display_alias: "Source alias" }, { organization_id: targetOrg, status: "retired", display_alias: "Source alias" }]);
  await recordOperationEvidence({ operationId: "MODULE-STRUCTURE-COPY-001", title: "Copy Subject settings into a populated organization", status: "passed", page, testInfo: info,
    artifacts: [info.outputPath("module-structure-subject-copy-1440x900.png")], api: [summarizeApiResponse(response, { method: "POST", path: `/api/v2/organizations/${targetOrg}/module-structure/applies`, responseSummary: "Reviewed Subject settings committed." })],
    db: [{ table: "organization_subject_registrations", predicate: "isolated source and target", observed: "Target state and alias copied; source unchanged.", rowCount: 2 }] });
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
  await page.getByText("导出与填写说明", { exact: true }).click();
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
  const contents = await readFile((await download.path())!, "utf8");
  const document = JSON.parse(contents);
  expect(contents).toBe(JSON.stringify(document, null, 2));
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
