import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import { expect, test } from "playwright/test";
import { compileOrThrow, firstReleaseBundle } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../../server/modules/parameter-catalog-contract";
import { createRegistrationService } from "../../server/modules/parameter-governance/registration";
import { createSourceBackedBindingService } from "../../server/modules/parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { apiRoute } from "./helpers/runtime";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { readSelectControlOptions } from "./helpers/selectControl";
import { startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo } from "./helpers/disposablePostCutoverRuntime";
import { captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

test("project-role reader sees Organization usage without project write access", async ({ page, request }, testInfo) => {
  // @acceptance PARLIB-SCOPE-001
  // @operation PARLIB-SCOPE-001
  test.setTimeout(180_000);
  const environment = captureProcessEnvForDisposableRuntime();
  if (!environment.databaseUrl) throw new Error("An explicit dedicated PostgreSQL lane is required");
  const catalogRuntime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { label: "parlib_scope", catalog: "fixture-owned" });
  applyDisposableRuntimeEnv(catalogRuntime);
  const pool = new pg.Pool({ connectionString: catalogRuntime.databaseUrl });
  const objectStore = createLocalObjectStore(catalogRuntime.objectStoreRoot);
  const organizationId = "org-chargelab";
  const definitionId = ParameterDefinitionId("pdef_acme_power_iin_max");
  const revisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");
  let firstBinding = "";
  let secondBinding = "";
  try {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.aggregateDigest });
    expect(installed.ok).toBe(true);
    const pin = { id: compiled.release.id, digest: compiled.release.digest };
    await pool.query("insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values ('parlib-scope-attr',$1,'driver-registration','Scope driver','compatible:acme,power')", [organizationId]);
    await pool.query("insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('parlib-scope-attr','physical-device','multiple')");
    await pool.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin) values ('parlib-scope-module',$1,'Scope driver','parlib-scope-module',1,'business','curated')", [organizationId]);
    const registration = await createRegistrationService(pool).execute({ kind: "register", organizationId, subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: "parlib-scope-module", method: "explicit", proof: { reason: "scope browser fixture" }, idempotencyKey: "parlib-scope-registration", context: { actorKind: "org-admin", principalId: acceptanceCast.acceptanceAdmin.userId } });
    if (!registration.ok) throw new Error(JSON.stringify(registration.error));
    const loaded = await createCatalogKernel(pool).loadCurrentCatalog(pin);
    if (!loaded.ok) throw new Error("Catalog fixture unavailable");
    await pool.query("delete from public.user_role_bindings where user_id=$1", [acceptanceCast.liuMin.userId]);
    for (const projectId of ["parlib-scope-a", "parlib-scope-b"]) {
      await pool.query("insert into public.projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')", [projectId, organizationId]);
      const binding = await createSourceBackedBindingService(pool, { objectStore, sourceRawValue: "<0x3e9>", initialPayload: { kind: "number", value: 1001 } }).stabilize({ snapshot: loaded.value, organizationId, projectId, logicalNodeId: `${projectId}-node`, registrationId: registration.value.registrationId, definitionId, effectiveRevisionId: revisionId, expectedEffectiveRevisionId: null });
      if (!binding.ok) throw new Error(JSON.stringify(binding.error));
      if (projectId === "parlib-scope-a") firstBinding = binding.value.binding.id;
      if (projectId === "parlib-scope-b") secondBinding = binding.value.binding.id;
    }
    await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('parlib-scope-role',$1,$2,'parlib-scope-a','software-user')", [acceptanceCast.liuMin.userId, organizationId]);
    const headers = authHeadersForRole("software-user");
    const definition = await request.get(apiRoute(`/api/v2/catalog/definitions/${definitionId}`), { headers });
    expect(definition.status()).toBe(200);
    expect((await definition.json()).item.usageSummary).toMatchObject({ projectCount: 2, currentValueCount: 2, policyCount: null });
    const denied = await request.post(apiRoute("/api/v1/parameter-drafts"), { headers, data: { projectId: "parlib-scope-b", parameterId: secondBinding, targetValue: "9", reason: "scope browser test" } });
    expect(denied.status()).toBe(403);
    await signInBrowserAsRole(page, "software-user", `${catalogRuntime.frontendUrl}/parameter-admin/specs?subjectId=csub_acme_power&definitionId=${definitionId}`);
    await expect(page.getByRole("region", { name: "无权访问" })).toContainText("无权访问该页面");
    const navigationErrors: string[] = [];
    const onPageError = (error: Error) => navigationErrors.push(error.message);
    const onResponse = (response: import("playwright/test").Response) => {
      if (response.url().includes("/api/") && response.status() >= 500) navigationErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    };
    page.on("pageerror", onPageError);
    page.on("response", onResponse);
    await page.goto(`${catalogRuntime.frontendUrl}/parameters/definitions`);
    const navigation = page.getByRole("navigation", { name: "参数定义模块树" });
    await expect(navigation.getByText("Scope driver", { exact: true })).toBeVisible();
    await expect(navigation.getByText("未分类", { exact: true })).toHaveCount(0);
    await expect(navigation.getByText("unset（未分配模块）", { exact: true })).toHaveCount(0);
    await expect(page.getByText("正在加载参数库", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("library-navigation-1440.png") });
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    expect(navigationErrors).toEqual([]);
    await page.goto(`${catalogRuntime.frontendUrl}/parameters?project=parlib-scope-a`);
    await page.locator(`[data-binding-id="${firstBinding}"]`).getByRole("button", { name: /^参数详情 / }).click();
    const detail = page.getByRole("dialog", { name: /参数详情/ });
    await detail.getByRole("tab", { name: "跨项目对比", exact: true }).click();
    const selector = detail.getByRole("tabpanel", { name: "跨项目对比" }).getByRole("combobox");
    await expect.poll(async () => (await readSelectControlOptions(selector)).map(option => option.value)).toContain(secondBinding);
    await page.goto(`${catalogRuntime.frontendUrl}/parameters/definitions?definitionId=${definitionId}&tab=configurations`);
    await page.getByRole("table", { name: "parlib-scope-b 的当前配置" }).getByRole("button", { name: /在项目中打开/ }).click();
    const otherProjectDetail = page.getByRole("dialog", { name: /参数详情/ });
    await expect(otherProjectDetail.getByRole("textbox", { name: "目标值" })).toBeDisabled();
    await expect(otherProjectDetail.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await recordOperationEvidence({ operationId: "PARLIB-SCOPE-001", title: testInfo.title, status: "passed", role: "Software User", route: "/parameters", page, testInfo, assertions: ["ui", "api", "screenshot"], api: [
      { method: "GET", path: `/api/v2/catalog/definitions/${definitionId}`, status: definition.status(), responseSummary: "Organization usage: two projects and two retained bindings" },
      { method: "POST", path: "/api/v1/parameter-drafts", status: denied.status(), responseSummary: "Nonparticipant project write denied" }
    ] });
  } finally {
    await pool.end();
    try { await catalogRuntime.dispose(disposableRuntimeOutcomeFromTestInfo(testInfo)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  }
});
