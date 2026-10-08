import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import {
  startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime
} from "./helpers/disposablePostCutoverRuntime";
import {
  captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime
} from "./helpers/semanticBindingFixture";

const expectedApiFailures: ExpectedApiFailure[] = [];
useBrowserDiagnostics(test, { expectedApiFailures });
test.beforeEach(() => { expectedApiFailures.length = 0; });
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

test.describe("issue902 canonical-only JSON project initialization", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  const organizationId = "org-chargelab";
  const sourceProjectId = "issue902-json-source";
  const sourceProjectName = "Issue902 canonical JSON source";
  const targetProjectCode = "ISSUE902-TARGET";
  const targetProjectId = targetProjectCode.toLowerCase();
  const targetProjectName = "Issue902 canonical JSON target";
  const schemaId = "wiseeff.issue902.settings";
  const sourceContent = '{ "a/b": { "": 36.5, "keep": true }, "untouched": [1,2] }\n';
  let runtime: DisposablePostCutoverRuntime;
  let sourceBindingId: string;
  let sourceValueId: string;
  let sourceFileId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("Explicit disposable-runtime parent DATABASE_URL is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, {
      label: "issue902_canonical_initialization", apiEnv: { LOG_ANALYSIS_DETERMINISTIC: "true" }
    });
    applyDisposableRuntimeEnv(runtime);
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      await db.query(`insert into projects(id,organization_id,name,code,status,initialization_status)
        values ($1,$2,$3,'I902SOURCE','initialized','initialized')`,
      [sourceProjectId, organizationId, sourceProjectName]);
      await installConfigurationSourceFixture(db, makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId, organizationId
      }), { subjectId: "csub_issue902_json", schemaId });
    } finally {
      await db.close();
    }
    const headers = authHeadersForRole("admin");
    const config = await request.post(apiRoute(`/api/v1/projects/${sourceProjectId}/config-sets`), {
      headers, data: { name: "default", description: "Issue902 canonical-only JSON source" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id as string;
    const upload = await request.post(apiRoute(`/api/v1/projects/${sourceProjectId}/parameter-files`), {
      headers, data: { fileName: "settings.json", contentBase64: Buffer.from(sourceContent).toString("base64") }
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const file = (await upload.json()).item;
    sourceFileId = file.id;
    const member = await request.post(apiRoute(`/api/v1/projects/${sourceProjectId}/config-sets/${configSetId}/files`), {
      headers, data: { fileId: sourceFileId, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const registered = await request.post(apiRoute(
      `/api/v2/projects/${sourceProjectId}/parameter-files/${sourceFileId}/configuration-instances`
    ), {
      headers, data: {
        configSetId, fileVersionId: file.currentVersionId, configurationSchemaId: schemaId,
        rootPointer: "/a~1b", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/a~1b/" }]
      }
    });
    expect(registered.status(), await registered.text()).toBe(201);
    const registeredBindings = (await registered.json()).items;
    expect(registeredBindings).toHaveLength(1);
    sourceBindingId = registeredBindings[0].id;
    sourceValueId = registeredBindings[0].currentValueId;
    expect(sourceValueId).toBeTruthy();
    await withPgClient(async (client) => {
      expect((await client.query(`select id from projects
        where organization_id=$1 and id=$2`, [organizationId, targetProjectId])).rows).toEqual([]);
      expect((await client.query(`select id from project_parameter_bindings
        where organization_id=$1 and project_id=$2`, [organizationId, sourceProjectId])).rows).toEqual([]);
      expect((await client.query(`select id from parameter_catalog.current_project_parameter_bindings
        where organization_id=$1 and project_id=$2`, [organizationId, sourceProjectId])).rows)
        .toEqual([{ id: sourceBindingId }]);
    });
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  test("inherits a pinned JSON source through the wizard and reads the approved target", async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const headers = authHeadersForRole("admin");
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameters?project=${sourceProjectId}`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    const wizard = page.getByRole("dialog", { name: "新项目参数初始化" });
    await expect(wizard).toBeVisible();
    await wizard.getByLabel("项目名称", { exact: true }).fill(targetProjectName);
    await wizard.getByLabel("项目代号", { exact: true }).fill(targetProjectCode);
    await wizard.getByRole("button", { name: "下一步", exact: true }).click();
    await wizard.getByLabel(sourceProjectName, { exact: true }).check();
    const previewed = page.waitForResponse(response => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/parameters/projects/${targetProjectId}/initialization/preview`));
    await wizard.getByRole("button", { name: "下一步", exact: true }).click();
    const preview = await previewed;
    expect(preview.status(), await preview.text()).toBe(200);
    const selection = wizard.getByRole("table", { name: "来源参数选择表" });
    await expect(selection).toBeVisible();
    await expect(selection.getByRole("checkbox", { name: "选择 iin_max", exact: true })).toHaveCount(1);
    await selection.getByRole("checkbox", { name: "选择 iin_max", exact: true }).check();
    await expect(selection).toContainText("36.5");
    await wizard.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(wizard.getByRole("region", { name: "初始化快照预览" })).toContainText(/参数数量\s*1/);
    const created = page.waitForResponse(response => response.request().method() === "POST"
      && response.url().endsWith("/api/v1/parameters/admin/projects"));
    const submitted = page.waitForResponse(response => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/parameters/projects/${targetProjectId}/initialization/submit`));
    await wizard.getByRole("button", { name: "提交初始化审阅", exact: true }).click();
    const creation = await created;
    expect(creation.status(), await creation.text()).toBe(201);
    expect((await creation.json()).item).toMatchObject({ id: targetProjectId, code: targetProjectCode });
    const submission = await submitted;
    expect(submission.ok(), await submission.text()).toBe(true);
    const review = (await submission.json()).item;
    expect(review).toMatchObject({ projectId: targetProjectId, status: "pending" });
    expect(review.id).toBeTruthy();
    await expect(wizard).not.toBeVisible();

    const pending = await request.get(apiRoute(`/api/v1/parameters/projects/${targetProjectId}/initialization`), { headers });
    expect(pending.status(), await pending.text()).toBe(200);
    const pendingState = await pending.json();
    expect(pendingState.status).toBe("initialization_pending_review");
    expect(pendingState.draft.bindingSnapshots).toHaveLength(1);
    expect(pendingState.draft.bindingSnapshots[0]).toMatchObject({
      sourceProjectId, sourceProjectParameterBindingId: sourceBindingId, sourceProjectValueId: sourceValueId,
      sourceFormat: "json", propertyKey: "iin_max", rawValue: "36.5\n"
    });
    for (const field of ["sourceConfigSetId", "sourceConfigRevisionId", "sourceOccurrenceId", "sourceName", "sourceLocatorLabel"]) {
      expect(pendingState.draft.bindingSnapshots[0][field], field).toBeTruthy();
    }
    const beforeApproval = await request.get(apiRoute(`/api/v2/projects/${targetProjectId}/parameter-bindings`), { headers });
    expect(beforeApproval.status(), await beforeApproval.text()).toBe(200);
    expect((await beforeApproval.json()).items).toEqual([]);

    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-review?project=${targetProjectId}`);
    await expect(page).toHaveURL(new RegExp(`/parameter-review\\?project=${targetProjectId}$`));
    await page.getByRole("button", { name: `查看 ${targetProjectName} 初始化详情`, exact: true }).click();
    const detail = page.getByRole("complementary", { name: "审阅详情" });
    await expect(detail).toContainText(targetProjectName);
    const approved = page.waitForResponse(response => response.request().method() === "POST"
      && response.url().endsWith(`/api/v1/parameters/admin/initialization-reviews/${review.id}/approve`));
    await detail.getByRole("button", { name: "通过初始化", exact: true }).click();
    const approval = await approved;
    expect(approval.ok(), await approval.text()).toBe(true);
    expect((await approval.json()).item).toMatchObject({ id: review.id, projectId: targetProjectId, status: "approved" });
    const initialized = await request.get(apiRoute(`/api/v1/parameters/projects/${targetProjectId}/initialization`), { headers });
    expect(initialized.status(), await initialized.text()).toBe(200);
    expect((await initialized.json()).status).toBe("initialized");
    const target = await request.get(apiRoute(`/api/v2/projects/${targetProjectId}/parameter-bindings`), { headers });
    expect(target.status(), await target.text()).toBe(200);
    const targetBindings = (await target.json()).items;
    expect(targetBindings).toHaveLength(1);
    const targetBinding = targetBindings[0];
    expect(targetBinding).toMatchObject({ propertyKey: "iin_max", rawValue: "36.5\n" });
    expect(targetBinding.id).not.toBe(sourceBindingId);
    expect(targetBinding.currentValueId).toBeTruthy();
    expect(targetBinding.currentValueId).not.toBe(sourceValueId);
    const exported = await request.get(apiRoute(`/api/v2/projects/${targetProjectId}/parameter-bindings/${targetBinding.id}/export`), { headers });
    expect(exported.status(), await exported.text()).toBe(200);
    const exportedBinding = (await exported.json()).item;
    expect(exportedBinding).toMatchObject({ bindingId: targetBinding.id, currentValueId: targetBinding.currentValueId });
    expect(exportedBinding.files).toHaveLength(1);
    expect(exportedBinding.files[0].name).toMatch(/settings\.json$/);
    expect(JSON.parse(exportedBinding.files[0].content)).toEqual(JSON.parse(sourceContent));
    await withPgClient(async (client) => {
      expect((await client.query(`select id from project_parameter_bindings
        where organization_id=$1 and project_id in ($2,$3)`,
      [organizationId, sourceProjectId, targetProjectId])).rows).toEqual([]);
      const pins = await client.query(`select pin.file_id from parameter_catalog.project_value_source_pins pin
        where pin.organization_id=$1 and pin.project_id=$2 and pin.binding_id=$3 and pin.project_value_id=$4`,
      [organizationId, targetProjectId, targetBinding.id, targetBinding.currentValueId]);
      expect(pins.rows).toHaveLength(1);
      expect(pins.rows[0].file_id).not.toBe(sourceFileId);
    });
    const unchangedSource = await request.get(apiRoute(`/api/v2/projects/${sourceProjectId}/parameter-bindings`), { headers });
    expect(unchangedSource.status(), await unchangedSource.text()).toBe(200);
    expect((await unchangedSource.json()).items).toEqual([
      expect.objectContaining({ id: sourceBindingId, currentValueId: sourceValueId, rawValue: "36.5\n" })
    ]);

    // The inherited target is JSON-only, so it has no DTS topology revision yet; the page reports that and still lists the value.
    expectedApiFailures.push({ method: "GET", path: `/api/v2/projects/${targetProjectId}/config-sets`, status: 404 });
    await page.goto(`${runtime.frontendUrl}/parameters?project=${targetProjectId}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${targetProjectId}$`));
    const row = page.getByRole("row").filter({ hasText: "iin_max" });
    await expect(row).toHaveCount(1);
    await expect(row).toBeVisible();
    await expect(row).toContainText("36.5");
    await info.attach("issue902-approved-canonical-json-target", {
      body: await page.screenshot({ fullPage: true }), contentType: "image/png"
    });
  });
});
