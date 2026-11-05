import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";
import { compileOrThrow, firstReleaseBundle, refreshReleaseSource } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import type { CatalogReleaseNode } from "../../server/modules/catalog-kernel/compiler/types";
import { createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../../server/modules/parameter-catalog-contract";
import { createRegistrationService } from "../../server/modules/parameter-governance/registration";
import { createSourceBackedBindingService } from "../../server/modules/parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../../server/modules/parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../server/modules/parameter-files/service";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { setParameterIdentityMode } from "../../server/modules/parameter-kernel/parameterIdentityMode";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { apiRoute } from "./helpers/runtime";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { selectControlOption } from "./helpers/selectControl";
import { startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo } from "./helpers/disposablePostCutoverRuntime";
import { captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime } from "./helpers/semanticBindingFixture";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

test.use({ viewport: { width: 1440, height: 900 } });
test("reads grouped DTS and software instances with exact counts and full values", async ({ page, request }, testInfo) => {
  // @acceptance PARLIB-INSTANCES-001
  // @acceptance PARLIB-COMPARE-001
  // @acceptance PARLIB-FILTER-001
  // @acceptance PARLIB-RETURN-001
  // @acceptance PARLIB-SHARE-001
  // @operation PARLIB-INSTANCES-001
  // @operation PARLIB-COMPARE-001
  // @operation PARLIB-FILTER-001
  // @operation PARLIB-RETURN-001
  // @operation PARLIB-SHARE-001
  test.setTimeout(180_000);
  const environment = captureProcessEnvForDisposableRuntime();
  if (!environment.databaseUrl) throw new Error("A dedicated PostgreSQL lane is required");
  const runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { label: "parlib_instances", catalog: "fixture-owned" });
  applyDisposableRuntimeEnv(runtime);
  const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
  const db = createPostgresDatabase(runtime.databaseUrl);
  const storage = createLocalObjectStore(runtime.objectStoreRoot);
  const organizationId = "org-chargelab";
  const definitionId = ParameterDefinitionId("pdef_acme_power_iin_max");
  const jsonDefinition = "pdef_parlib_software_value";
  const fullValue = "software configuration ".repeat(12);
  const fullSourceToken = `[\n  ${JSON.stringify(fullValue).replace("software", "\\u0073oftware")}\n]`;
  setParameterIdentityMode("semantic");
  try {
    const bundle = firstReleaseBundle();
    const release = bundle.releases[0] as Mutable<CatalogReleaseNode>;
    const template = release.documents.find((item) => item.kind === "definition");
    if (!template || template.kind !== "definition") throw new Error("Missing definition fixture");
    release.documents.push({ source: template.source, kind: "subject", normalizedDigest: template.normalizedDigest, content: {
      id: "csub_parlib_software", kind: "configuration-schema", canonicalKey: "parlib.software", lifecycle: "active",
      selector: { kind: "configuration-schema-id", value: "parlib.software", provenance: { source: template.source.path } }, subtype: {}, tombstone: null,
    } });
    const json = structuredClone(template);
    Object.assign(json.content, { id: jsonDefinition, subjectId: "csub_parlib_software", propertyKey: "software_value" });
    Object.assign(json.content.revision, { id: "drev_parlib_software_1", displayName: "软件配置值", valueSchema: { type: "array", items: { type: "string" } },
      matching: { ...json.content.revision.matching, selectorKind: "configuration-schema-id", sourceProperty: "software_value" } });
    release.documents.push(json);
    for (const [suffix, type] of [["empty", "string"], ["null", "null"], ["false", "boolean"]] as const) {
      const typed = structuredClone(json);
      Object.assign(typed.content, { id: `pdef_parlib_${suffix}`, propertyKey: `software_${suffix}` });
      Object.assign(typed.content.revision, { id: `drev_parlib_${suffix}_1`, displayName: `软件 ${suffix}`, valueSchema: { type },
        matching: { ...typed.content.revision.matching, sourceProperty: `software_${suffix}` } });
      release.documents.push(typed);
    }
    const unused = structuredClone(template);
    Object.assign(unused.content, { id: "pdef_parlib_unused", propertyKey: "unused_parameter" });
    Object.assign(unused.content.revision, { id: "drev_parlib_unused_1", displayName: "未使用的定义",
      matching: { ...unused.content.revision.matching, sourceProperty: "unused_parameter" } });
    release.documents.push(unused);
    const boolean = structuredClone(template);
    Object.assign(boolean.content, { id: "pdef_parlib_boolean", propertyKey: "parlib_enabled" });
    Object.assign(boolean.content.revision, { id: "drev_parlib_boolean_1", displayName: "设备使能", valueSchema: { type: "boolean" },
      matching: { ...boolean.content.revision.matching, sourceProperty: "parlib_enabled" } });
    delete boolean.content.revision.unit;
    release.documents.push(boolean);
    refreshReleaseSource(release);
    const compiled = compileOrThrow(bundle);
    const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.aggregateDigest });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    const pin = { id: compiled.release.id, digest: compiled.release.digest };
    await pool.query("insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values ('parlib-instances-attr',$1,'driver-registration','Driver','compatible:acme,power')", [organizationId]);
    await pool.query("insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('parlib-instances-attr','physical-device','multiple')");
    await pool.query("insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin) values ('parlib-instances-module',$1,'参数模块','parlib-instances-module',1,'business','curated')", [organizationId]);
    const register = (subjectId: string, subjectKind: "driver" | "configuration-schema") => createRegistrationService(pool).execute({
      kind: "register", organizationId, subjectId: CatalogSubjectId(subjectId), subjectKind, expectedRelease: pin, placement: { mode: "use-default" },
      destinationModuleId: "parlib-instances-module", method: "explicit", proof: { reason: "browser fixture" }, idempotencyKey: `register-${subjectId}`,
      context: { actorKind: "org-admin", principalId: acceptanceCast.xuYun.userId },
    });
    const driver = await register("csub_acme_power", "driver");
    const software = await register("csub_parlib_software", "configuration-schema");
    if (!driver.ok || !software.ok) throw new Error("Registration fixture failed");
    const loaded = await createCatalogKernel(pool).loadCurrentCatalog(pin);
    if (!loaded.ok) throw new Error("Catalog fixture unavailable");
    for (const [projectId, name, count] of [["parlib-instances-a", "多实例项目", 2], ["parlib-instances-b", "软件项目", 1]] as const) {
      await pool.query("insert into public.projects(id,organization_id,name,code,status) values ($1,$2,$3,$1,'initialized')", [projectId, organizationId, name]);
      for (let index = 0; index < count; index += 1) {
        const binding = await createSourceBackedBindingService(pool, { objectStore: storage, sourceRawValue: `<0x${(1001 + index).toString(16)}>`, initialPayload: { kind: "number", value: 1001 + index } }).stabilize({
          snapshot: loaded.value, organizationId, projectId, logicalNodeId: `${projectId}-node-${index}`, registrationId: driver.value.registrationId,
          definitionId, effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_1"), expectedEffectiveRevisionId: null,
        });
        if (!binding.ok) throw new Error("DTS fixture failed");
        if (projectId === "parlib-instances-a" && index === 0) await pool.query(`update public.dts_config_set set name='default'
          where id=(select occurrence.config_set_id from parameter_catalog.project_parameter_bindings binding
            join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id where binding.id=$1)`, [binding.value.binding.id]);
      }
    }
    await pool.query("insert into public.projects(id,organization_id,name,code,status) values ('parlib-instances-empty',$1,'无配置项目','parlib-instances-empty','initialized')", [organizationId]);
    const booleanBinding = await createSourceBackedBindingService(pool, { objectStore: storage, sourceRawValue: null,
      initialPayload: { kind: "boolean", value: true } }).stabilize({ snapshot: loaded.value, organizationId,
      projectId: "parlib-instances-a", logicalNodeId: "parlib-boolean-node", registrationId: driver.value.registrationId,
      definitionId: ParameterDefinitionId("pdef_parlib_boolean"), effectiveRevisionId: DefinitionRevisionId("drev_parlib_boolean_1"), expectedEffectiveRevisionId: null });
    if (!booleanBinding.ok) throw new Error("Boolean fixture failed");
    const auth = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId, organizationId, permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });
    const set = await createConfigSet(db, auth, { projectId: "parlib-instances-b", name: "软件配置集" });
    const uploaded = await uploadProjectParameterFile(db, storage, auth, { projectId: "parlib-instances-b", fileName: "settings.json", bytes: Buffer.from(`{"software_value":${fullSourceToken},"software_empty":"","software_null":null,"software_false":false}`) });
    await addConfigSetFile(db, auth, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, loaded.value, {
      projectId: "parlib-instances-b", configSetId: set.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
      configurationSchemaId: "parlib.software", rootPointer: "", mappings: [{ definitionId: jsonDefinition, pointer: "/software_value" },
        ...["empty", "null", "false"].map((suffix) => ({ definitionId: `pdef_parlib_${suffix}`, pointer: `/software_${suffix}` }))],
      invocation: createUserInvocation(auth), requestId: "parlib-json", refusalSink: createTrustedRefusalAuditSink(db),
    }));
    const headers = authHeadersForRole("admin");
    const response = await request.get(apiRoute(`/api/v2/catalog/definitions/${definitionId}/project-configurations`), { headers });
    expect(response.status()).toBe(200);
    expect((await response.json()).summary).toEqual({ configuredProjectCount: 2, configuredInstanceCount: 3 });
    for (const [suffix, raw] of [["empty", '""\n'], ["null", "null\n"], ["false", "false\n"]]) {
      const typed = await request.get(apiRoute(`/api/v2/catalog/definitions/pdef_parlib_${suffix}/project-configurations`), { headers });
      expect(typed.status()).toBe(200);
      const binding = (await typed.json()).items[0];
      expect(binding.valuePreview).toBe(raw);
      const compared = await request.get(apiRoute(`/api/v2/catalog/definitions/pdef_parlib_${suffix}/project-configurations?baselineBindingId=${binding.bindingId}&targetBindingId=${binding.bindingId}`), { headers });
      expect(compared.status()).toBe(200);
      expect((await compared.json()).target.comparison).toMatchObject({ status: "same" });
      const wrongDefinition = await request.get(apiRoute(`/api/v2/catalog/definitions/${definitionId}/project-configurations?baselineBindingId=${binding.bindingId}`), { headers });
      expect(wrongDefinition.status()).toBe(404);
    }
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameters/definitions?definitionId=${definitionId}&tab=configurations`);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: runtime.frontendUrl });
    const copyLink = async () => {
      await page.getByRole("button", { name: "复制当前视图链接" }).click();
      await expect(page.getByText(/链接已复制/)).toBeVisible();
      return page.evaluate(() => navigator.clipboard.readText());
    };
    await expect(page.getByRole("tabpanel", { name: "当前项目配置" })).toContainText("已配置项目 2 · 已配置实例 3");
    const group = page.getByRole("table", { name: "多实例项目 的当前配置" });
    await expect(group.locator("tbody tr")).toHaveCount(2);
    const dtsReturn = page.url();
    const [handoffResponse] = await Promise.all([
      page.waitForResponse((result) => result.url().includes("selectedBindingId=") && result.url().includes("hintProjectId=")),
      group.locator("tbody tr").filter({ hasText: "default" }).getByRole("button", { name: /在项目中打开/ }).click(),
    ]);
    expect(handoffResponse.status()).toBe(200);
    await expect(page).toHaveURL(/\/parameters\?/);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("return-dts-1440.png") });
    await page.getByRole("dialog").getByRole("textbox", { name: "目标值" }).fill("1002");
    await page.getByRole("button", { name: "关闭参数详情" }).click();
    await page.getByRole("button", { name: "返回参数库" }).focus();
    await expect(page.getByRole("button", { name: "返回参数库" })).toBeFocused();
    expect((await new AxeBuilder({ page }).include(".permission-inline-note").analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("return-action-1440.png") });
    await page.getByRole("button", { name: "返回参数库" }).click();
    await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "继续编辑" }).click();
    await page.goBack();
    await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "继续编辑" }).click();
    await expect(page).toHaveURL(/\/parameters\?/);
    await page.getByRole("button", { name: /参数详情/ }).first().click();
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "目标值" })).toHaveValue("1002");
    await page.getByRole("button", { name: "关闭参数详情" }).click();
    await page.getByRole("button", { name: "返回参数库" }).click();
    await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃并离开" }).click();
    await expect(page).toHaveURL(dtsReturn);
    await group.locator("tbody tr").filter({ hasNotText: "default" }).getByRole("button", { name: /在项目中打开/ }).click();
    await expect(page.getByRole("dialog")).toContainText("1002");
    const directBinding = new URL(page.url()).searchParams.get("bindingId");
    expect(directBinding).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("dialog")).toContainText("1002");
    await page.getByRole("button", { name: "关闭参数详情" }).click();
    await page.getByRole("button", { name: "返回参数库" }).click();
    await expect(page).toHaveURL(dtsReturn);
    await page.goto(`${runtime.frontendUrl}/parameters?project=parlib-instances-a&binding=${directBinding}`);
    await expect(page.getByRole("dialog")).toContainText("1002");
    await page.goto(dtsReturn);
    await group.getByRole("button", { name: /查看 .* 的完整值/ }).first().click();
    await expect(page.getByRole("region", { name: "选中的完整值" })).toContainText(/<0x3e[9a]>/);
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=${jsonDefinition}&tab=configurations`);
    await expect(page.getByRole("tabpanel", { name: "当前项目配置" })).toContainText("软件配置集");
    await selectControlOption(page.getByRole("combobox", { name: "项目", exact: true }), "parlib-instances-b");
    await selectControlOption(page.getByRole("combobox", { name: "配置集", exact: true }), set.id);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "配置集", exact: true })).toHaveAttribute("data-value", set.id);
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "配置集", exact: true })).toHaveAttribute("data-value", "");
    await page.goForward();
    await expect(page.getByRole("combobox", { name: "配置集", exact: true })).toHaveAttribute("data-value", set.id);
    await expect(page.getByRole("tabpanel", { name: "当前项目配置" })).toContainText("筛选结果 1 条");
    const jsonReturn = page.url();
    await page.getByRole("button", { name: /在项目中打开 settings.json/ }).click();
    await expect(page.getByRole("dialog")).toContainText(fullValue);
    await page.screenshot({ path: testInfo.outputPath("return-json-1440.png") });
    await page.getByRole("button", { name: "关闭参数详情" }).click();
    await page.getByRole("button", { name: "返回参数库" }).click();
    await expect(page).toHaveURL(jsonReturn);
    await page.getByRole("table", { name: "软件项目 的当前配置" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("instances-1440.png") });
    await page.getByRole("button", { name: "查看 settings.json 的完整值" }).click();
    await expect(page.getByRole("region", { name: "选中的完整值" })).toContainText(fullSourceToken);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
    await page.getByRole("button", { name: "复制完整原值" }).click();
    await expect(page.getByRole("alert")).toContainText("复制失败");
    await expect(page.getByRole("region", { name: "选中的完整值" })).toBeVisible();
    await page.evaluate(() => { delete (navigator as unknown as { clipboard?: Clipboard }).clipboard; });
    await page.getByRole("button", { name: "复制完整原值" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullSourceToken);
    const configurationLink = await copyLink();
    expect(configurationLink).toContain("configSetId=");
    expect(decodeURIComponent(configurationLink)).not.toContain("\\u0073oftware");
    await page.goto(`${runtime.frontendUrl}/parameters/definitions${new URL(configurationLink).search}`);
    await expect(page.getByRole("region", { name: "选中的完整值" })).toContainText(fullSourceToken);
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters/definitions${new URL(configurationLink).search}`);
    await expect(page.getByRole("region", { name: "选中的完整值" })).toContainText(fullSourceToken);
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameters/definitions${new URL(configurationLink).search}`);
    try {
      await pool.query("update parameter_catalog.organization_subject_registrations set status='retired' where id=$1", [software.value.registrationId]);
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("选中的实例已不可用");
      await page.getByRole("tab", { name: "定义", exact: true }).click();
      await expect(page.getByRole("tabpanel", { name: "定义" })).toContainText("定义说明");
    } finally {
      await pool.query("update parameter_catalog.organization_subject_registrations set status='active' where id=$1", [software.value.registrationId]);
    }
    await page.goto(`${runtime.frontendUrl}/parameters/definitions${new URL(configurationLink).search}`);
    await page.getByLabel("实例 / 来源").fill("nothing-matches");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByText(/没有匹配的项目配置/)).toBeVisible();
    await page.getByRole("button", { name: "重置筛选" }).click();
    await page.getByLabel("显示无当前配置项目").check();
    await expect(page.getByRole("heading", { name: "无配置项目", exact: true })).toBeVisible();
    await expect(page.getByText("无当前配置", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "项目", exact: true })).toBeEnabled();
    await page.getByRole("combobox", { name: "项目", exact: true }).focus();
    await expect(page.getByRole("combobox", { name: "项目", exact: true })).toBeFocused();
    expect((await new AxeBuilder({ page }).include(".parameter-library-filters").analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("filters-1440.png") });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath("filters-1280.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=pdef_parlib_boolean&tab=configurations`);
    await expect(page.getByRole("tabpanel", { name: "当前项目配置" })).toContainText("存在");
    await page.getByRole("button", { name: /查看 .* 的完整值/ }).click();
    await expect(page.getByRole("region", { name: "选中的完整值" })).toContainText("布尔属性以存在表示");
    await page.getByRole("button", { name: "复制完整原值" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("");
    for (const [suffix, raw] of [["empty", '""'], ["false", "false"]]) {
      await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=pdef_parlib_${suffix}&tab=configurations`);
      await page.getByRole("button", { name: /查看 .* 的完整值/ }).click();
      await page.getByRole("button", { name: "复制完整原值" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
    }
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=pdef_parlib_unused&tab=configurations`);
    await expect(page.getByText("当前没有可显示的项目配置。")).toBeVisible();
    await page.route("**/project-configurations*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }) }));
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=${definitionId}&tab=configurations`);
    await expect(page.getByText(/当前项目配置不可用/)).toBeVisible();
    await page.getByRole("tab", { name: "定义", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "定义" })).toContainText("定义说明");
    await page.unroute("**/project-configurations*");
    await page.getByRole("tab", { name: "当前项目配置" }).click();
    await expect(page.getByRole("tabpanel", { name: "当前项目配置" })).toContainText("已配置实例 3");
    // Keep the real API and fixture while forcing a one-row page to exercise
    // a baseline that is no longer in the target page.
    await page.route("**/project-configurations*", (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("limit", "1");
      return route.continue({ url: url.toString() });
    });
    await page.getByRole("tab", { name: "对比", exact: true }).click();
    await expect(page.getByText(/请选择基准实例/)).toBeVisible();
    await page.getByRole("button", { name: "设为基准" }).click();
    const baselineUrl = page.url();
    await expect(page.getByRole("heading", { name: "基准实例" })).toBeVisible();
    await selectControlOption(page.getByRole("combobox", { name: "项目", exact: true }), "parlib-instances-b");
    await expect(page.getByRole("heading", { name: "基准实例" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "对比" })).toContainText("已配置项目 1 · 已配置实例 1");
    await expect(page.getByRole("tabpanel", { name: "对比" })).toContainText("筛选结果 1 条");
    await expect(page.getByRole("table", { name: "软件项目 的当前配置" })).toBeVisible();
    await selectControlOption(page.getByRole("combobox", { name: "项目", exact: true }), "parlib-instances-a");
    await page.getByRole("button", { name: "下一页" }).click();
    await page.getByRole("button", { name: "查看对比" }).click();
    await expect(page.getByRole("heading", { name: "目标实例" })).toBeVisible();
    const compareReturn = page.url();
    await page.getByRole("table", { name: "多实例项目 的当前配置" }).getByRole("button", { name: /在项目中打开/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "关闭参数详情" }).click();
    await page.getByRole("button", { name: "返回参数库" }).click();
    await expect(page).toHaveURL(compareReturn);
    await expect(page.getByRole("heading", { name: "基准实例" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "目标实例" })).toBeVisible();
    for (const label of ["基准实例", "目标实例"]) {
      const displayed = await page.getByRole("textbox", { name: `${label}原值` }).textContent();
      await page.getByRole("button", { name: `复制${label}完整原值` }).click();
      expect(displayed).toMatch(/^<0x3e[9a]>$/);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
    }
    const comparisonLink = await copyLink();
    expect(comparisonLink).toMatch(/baseline=.*target=/);
    await page.goto(`${runtime.frontendUrl}/parameters/definitions${new URL(comparisonLink).search}`);
    await expect(page.getByRole("heading", { name: "目标实例" })).toBeVisible();
    await expect(page.getByRole("region", { name: "实例对比" }).getByRole("status")).toContainText("类型化值不同");
    await expect(page.getByRole("region", { name: "实例对比" }).getByRole("status")).toContainText(/目标 − 基准：-?1/);
    expect((await new AxeBuilder({ page }).include(".parameter-library-compare").analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("compare-1440.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("compare-1280.png"), fullPage: true });
    const targetBindingId = new URL(page.url()).searchParams.get("target");
    expect(targetBindingId).toBeTruthy();
    await pool.query(`insert into parameter_catalog.catalog_releases
      (id, release_sequence, release_version, release_digest, predecessor_release_id, compiled_model_digest, toolchain_digest, published_at)
      select 'parlib-browser-compare-release', release_sequence+1, 'browser-compare', 'browser-compare-digest', id, compiled_model_digest, toolchain_digest, now()
      from parameter_catalog.catalog_releases where id=$1`, [pin.id]);
    await pool.query(`insert into parameter_catalog.definition_revisions(id, definition_id, revision_number, catalog_release_id, content_digest, content)
      select 'parlib-browser-compare-revision', definition_id, 2, 'parlib-browser-compare-release', 'browser-compare-content', content || '{"unit":"A"}'::jsonb
      from parameter_catalog.definition_revisions where id='drev_acme_power_iin_max_1'`);
    await pool.query("alter table parameter_catalog.project_parameter_values disable trigger all");
    try {
      await pool.query(`update parameter_catalog.project_parameter_values set definition_revision_id='parlib-browser-compare-revision'
        where id=(select current_value_id from parameter_catalog.project_parameter_bindings where id=$1)`, [targetBindingId]);
      await page.reload();
      await expect(page.getByRole("region", { name: "实例对比" }).getByRole("status")).toContainText("定义语义不同，不计算差值");
      await expect(page.getByRole("region", { name: "实例对比" })).toContainText("固定修订不同");
      await page.screenshot({ path: testInfo.outputPath("compare-incompatible-1280.png"), fullPage: true });
    } finally {
      await pool.query(`update parameter_catalog.project_parameter_values set definition_revision_id='drev_acme_power_iin_max_1'
        where id=(select current_value_id from parameter_catalog.project_parameter_bindings where id=$1)`, [targetBindingId]);
      await pool.query("alter table parameter_catalog.project_parameter_values enable trigger all");
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "基准实例" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "目标实例" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/parameters\?/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "基准实例" })).toBeVisible();
    expect(baselineUrl).toContain("baseline=");
    await page.goto(baselineUrl);
    try {
      await pool.query("update parameter_catalog.organization_subject_registrations set status='retired' where id=$1", [driver.value.registrationId]);
      await page.reload();
      await expect(page.getByRole("alert")).toContainText("基准实例已不可用");
      await page.getByRole("button", { name: "重新选择" }).click();
      await expect(page.getByText(/请选择基准实例/)).toBeVisible();
    } finally {
      await pool.query("update parameter_catalog.organization_subject_registrations set status='active' where id=$1", [driver.value.registrationId]);
    }
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=${jsonDefinition}&tab=compare`);
    await page.getByRole("button", { name: "设为基准" }).click();
    await page.getByRole("button", { name: "查看对比" }).click();
    await expect(page.getByRole("region", { name: "实例对比" })).toContainText(fullSourceToken);
    await page.getByRole("textbox", { name: "基准实例原值" }).focus();
    await expect(page.getByRole("textbox", { name: "基准实例原值" })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("compare-long-1280.png"), fullPage: true });
    await recordOperationEvidence({ operationId: "PARLIB-COMPARE-001", title: "Explicit instance comparison", status: "passed", page, testInfo,
      assertions: ["ui", "api", "screenshot"], api: [{ method: "GET", path: `/api/v2/catalog/definitions/${definitionId}/project-configurations`, status: 200, responseSummary: "Explicit baseline and target on separate pages, current values read from one API response." }] });
    await page.unroute("**/project-configurations*");
    await page.goto(`${runtime.frontendUrl}/parameters/definitions`);
    await page.getByLabel("有当前配置").check();
    await expect(page.getByText("未使用的定义", { exact: true })).toHaveCount(0);
    await selectControlOption(page.getByRole("combobox", { name: "项目使用" }), "parlib-instances-b");
    const listLink = await copyLink();
    expect(listLink).toContain("configured=true");
    expect(listLink).toContain("usageProjectId=parlib-instances-b");
    await expect(page).toHaveURL(/usageProjectId=parlib-instances-b/);
    await expect(page.getByText("数量为所选项目已配置数量")).toBeVisible();
    const currentLimit = page.getByRole("row").filter({ hasText: "iin_max" });
    await expect(currentLimit.getByRole("cell").nth(4)).toHaveText("1");
    await expect(currentLimit.getByRole("cell").nth(5)).toHaveText("1");
    await page.reload();
    await expect(page.getByRole("combobox", { name: "项目使用" })).toHaveAttribute("data-value", "parlib-instances-b");
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "项目使用" })).toHaveAttribute("data-value", "");
    await page.goForward();
    await expect(page.getByRole("combobox", { name: "项目使用" })).toHaveAttribute("data-value", "parlib-instances-b");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=${definitionId}`);
    await expect(page).toHaveURL(/catalogReleaseId=/);
    const definitionLink = await copyLink();
    await page.goto(`${runtime.frontendUrl}/parameters/definitions${new URL(definitionLink).search}`);
    await expect(page.getByRole("tabpanel", { name: "定义" })).toBeVisible();
    expect((await new AxeBuilder({ page }).include(".parameter-library-detail").analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("share-definition-1440.png") });
    await recordOperationEvidence({ operationId: "PARLIB-SHARE-001", title: "Share a current view and copy selected source", status: "passed", page, testInfo,
      assertions: ["ui", "api", "screenshot"], api: [{ method: "GET", path: `/api/v2/catalog/definitions/${jsonDefinition}/project-configurations`, status: 200, responseSummary: "Selected exact multiline source read through the authenticated current configuration API." }] });
    await recordOperationEvidence({ operationId: "PARLIB-FILTER-001", title: testInfo.title, status: "passed", page, testInfo,
      assertions: ["ui", "api", "screenshot"], api: [{ method: "GET", path: `/api/v2/catalog/definitions/${definitionId}/project-configurations`, status: response.status(), responseSummary: "Filtered project and configuration set, with optional unconfigured projects." }] });
    await recordOperationEvidence({ operationId: "PARLIB-INSTANCES-001", title: testInfo.title, status: "passed", page, testInfo,
      assertions: ["ui", "api", "screenshot"], api: [{ method: "GET", path: `/api/v2/catalog/definitions/${definitionId}/project-configurations`, status: response.status(), responseSummary: "Two projects, three exact DTS instances." }] });
    const defaultSet = await createConfigSet(db, auth, { projectId: "parlib-instances-b", name: "default" });
    const defaultFile = await uploadProjectParameterFile(db, storage, auth, { projectId: "parlib-instances-b", fileName: "default-settings.json", bytes: Buffer.from('{"software_value":"default source"}') });
    await addConfigSetFile(db, auth, { configSetId: defaultSet.id, fileId: defaultFile.file.id, role: "base", sortOrder: 0 });
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, loaded.value, {
      projectId: "parlib-instances-b", configSetId: defaultSet.id, fileId: defaultFile.file.id, fileVersionId: defaultFile.version.id,
      configurationSchemaId: "parlib.software", rootPointer: "", mappings: [{ definitionId: jsonDefinition, pointer: "/software_value" }],
      invocation: createUserInvocation(auth), requestId: "parlib-default-json", refusalSink: createTrustedRefusalAuditSink(db),
    }));
    await page.goto(`${runtime.frontendUrl}/parameters/definitions?definitionId=${jsonDefinition}&tab=configurations`);
    await page.getByRole("button", { name: /在项目中打开 default-settings.json/ }).click();
    await expect(page.getByRole("dialog")).toContainText("default source");
    await page.getByRole("button", { name: "关闭参数详情" }).click();
    await page.getByRole("button", { name: "返回参数库" }).click();
    await expect(page.getByRole("tabpanel", { name: "当前项目配置" })).toContainText("default-settings.json");
    await recordOperationEvidence({ operationId: "PARLIB-RETURN-001", title: "Exact project configuration return", status: "passed", page, testInfo,
      assertions: ["ui", "api", "screenshot"], api: [{ method: "GET", path: `/api/v2/catalog/definitions/${definitionId}/project-configurations`, status: handoffResponse.status(), responseSummary: "Resolved the exact Binding and verified project and configuration-set hints." }] });
  } finally {
    setParameterIdentityMode(null);
    await db.close(); await pool.end();
    try { await runtime.dispose(disposableRuntimeOutcomeFromTestInfo(testInfo)); } finally { restoreProcessEnvFromDisposableRuntime(environment); }
  }
});
