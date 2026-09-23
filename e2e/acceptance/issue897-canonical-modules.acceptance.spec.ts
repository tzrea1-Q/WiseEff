import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import { expect, test } from "playwright/test";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler";
import { refreshAuthoritativeSource } from "../../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { firstReleaseBundle } from "../../server/testing/parameterCatalog/cutoverPopulatedFixture";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo, type DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";
import { captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });
const expectedApiFailures: ExpectedApiFailure[] = [];
useBrowserDiagnostics(test, { expectedApiFailures });
const organizationId = "org-chargelab";
const projectId = "issue897-project";

test.describe("Issue 897 canonical module ownership", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  let runtime: DisposablePostCutoverRuntime;
  let releaseId: string;
  let driverRegistrationId: string;
  let bindingId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("An explicit dedicated PostgreSQL lane is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { label: "issue897_modules" });
    applyDisposableRuntimeEnv(runtime);
    const bundle = firstReleaseBundle();
    const release = structuredClone(bundle.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
    const subject = release.documents.find(document => document.kind === "subject")!;
    const definition = release.documents.find(document => document.kind === "definition")!;
    if (subject.kind !== "subject" || definition.kind !== "definition") throw new Error("Missing fixture documents");
    for (let index = 0; index < 120; index++) {
      const extra = structuredClone(definition);
      const suffix = String(index).padStart(3, "0");
      extra.content.id = `pdef_issue897_extra_${suffix}`;
      extra.content.propertyKey = `extra_${suffix}`;
      extra.content.revision.id = `drev_issue897_extra_${suffix}`;
      extra.content.revision.displayName = `Extra ${suffix}`;
      extra.content.revision.matching.sourceProperty = `extra_${suffix}`;
      release.documents.push(extra);
    }
    for (const [kind, selectorKind, id, key] of [
      ["node-type", "node-type-name", "csub_issue897_node", "issue897-node"],
      ["configuration-schema", "configuration-schema-id", "csub_issue897_config", "wiseeff.issue897.settings"]
    ] as const) {
      const next = structuredClone(subject);
      next.content = { id, kind, canonicalKey: key, lifecycle: "active", selector: { kind: selectorKind, value: key, provenance: { source: "issue897-fixture" } }, subtype: {}, tombstone: null };
      release.documents.push(next);
      const nextDefinition = structuredClone(definition);
      nextDefinition.content.id = `pdef_${id}_limit`;
      nextDefinition.content.subjectId = id;
      nextDefinition.content.propertyKey = "limit";
      nextDefinition.content.revision.id = `drev_${id}_limit`;
      nextDefinition.content.revision.matching = { sourceProperty: "limit", selectorKind };
      release.documents.push(nextDefinition);
    }
    refreshAuthoritativeSource(release);
    const fixture = { ...bundle, releases: [release] };
    const compiled = compileCatalogRelease(fixture);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    releaseId = compiled.value.release.id;
    const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
    try {
      const installed = await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(fixture), expectedTargetDigest: compiled.value.aggregateDigest });
      expect(installed.ok, JSON.stringify(installed)).toBe(true);
    } finally { await pool.end(); }
    await withPgClient(async client => {
      await client.query(`insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values
        ('issue897-driver-attr',$1,'driver-registration','Acme power','compatible:acme,power'),
        ('issue897-node-attr',$1,'node-type-definition','Fixture node','nodetype:issue897-node')`, [organizationId]);
      await client.query("insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('issue897-driver-attr','physical-device','multiple')");
      await client.query("insert into node_type_definitions(attribution_subject_id,bare_node_name) values ('issue897-node-attr','issue897-node')");
      await client.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin) values
        ('issue897-root',$1,'Issue 897 Modules','issue897-root',1,'business','curated')`, [organizationId]);
      for (const [id, name, kind, attributionId] of [
        ["issue897-driver-a", "Input hardware", "driver-group", "issue897-driver-attr"],
        ["issue897-driver-b", "Output hardware", "driver-group", "issue897-driver-attr"],
        ["issue897-node", "Fixture node", "node-type", "issue897-node-attr"],
        ["issue897-config", "JSON settings", "business", null]
      ]) {
        await client.query(`insert into parameter_modules(id,organization_id,name,parent_id,path,depth,kind,origin,attribution_subject_id)
          values ($1,$2,$3,'issue897-root','issue897-root/'||$1,2,$4,'curated',$5)`, [id, organizationId, name, kind, attributionId]);
      }
      await client.query(`insert into parameter_module_mappings(id,organization_id,parameter_module_id,match_kind,match_value,priority)
        values ('issue897-overlay-mapping',$1,'issue897-driver-a','compatible','issue897,uncovered',0)`, [organizationId]);
      await client.query("insert into organizations(id,name) values ('issue897-foreign-org','Foreign organization')");
      await client.query(`insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
        values ('issue897-foreign-attr','issue897-foreign-org','driver-registration','Foreign driver','compatible:issue897,foreign')`);
      await client.query("insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('issue897-foreign-attr','physical-device','multiple')");
      await client.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
        values ('issue897-foreign-module','issue897-foreign-org','Foreign module','issue897-foreign-module',1,'driver-group','curated','issue897-foreign-attr')`);
      await client.query(`insert into projects(id,organization_id,name,code,status) values ($1,$2,'Issue 897 Project','I897','initialized')`, [projectId, organizationId]);
      await client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('issue897-reader',$1,$2,$3,'software-user')`, [acceptanceCast.liuMin.userId, organizationId, projectId]);
    });
    const headers = authHeadersForRole("admin");
    const registration = await request.post(apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`), {
      headers: { ...headers, "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": "issue897-driver-registration" },
      data: { subjectId: "csub_acme_power", destinationModuleId: "issue897-driver-a", placement: { mode: "use-default" } }
    });
    expect(registration.status(), await registration.text()).toBe(201);
    driverRegistrationId = (await registration.json()).item.id;
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), { headers, data: { name: "default" } });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id;
    const upload = () => request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "charger.dts", contentBase64: Buffer.from('/dts-v1/;\n/ { charger { compatible = "acme,power"; iin_max = <1000>; }; };\n').toString("base64") }
    });
    const file = await upload();
    expect(file.status(), await file.text()).toBe(201);
    const fileId = (await file.json()).item.id;
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), { headers, data: { fileId, role: "base", sortOrder: 0 } });
    expect(member.ok(), await member.text()).toBe(true);
    const parsed = await upload();
    expect(parsed.status(), await parsed.text()).toBe(201);
    const bindings = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers });
    const rows = (await bindings.json()).items;
    expect(rows).toHaveLength(1);
    bindingId = rows[0].id;
    await withPgClient(async client => {
      expect((await client.query("select count(*)::int as count from public.project_parameter_bindings where project_id=$1", [projectId])).rows[0].count).toBe(0);
      expect((await client.query("select count(*)::int as count from public.parameter_specs where organization_id=$1", [organizationId])).rows[0].count).toBe(0);
    });
  });
  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  test("shows canonical counts and all subject kinds", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const registry = await request.get(apiRoute("/api/v2/parameter-modules"), { headers: authHeadersForRole("admin") });
    expect(registry.status(), await registry.text()).toBe(200);
    expect((await registry.json()).item.modules.find((module: { id: string }) => module.id === "issue897-driver-a"))
      .toMatchObject({ parameterCount: 1, definitionCount: 121 });
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible()) await dismiss.click();
    await expect(page.getByText("acme,power", { exact: true })).toBeVisible();
    await expect(page.getByText("wiseeff.issue897.settings", { exact: true })).toBeVisible();
    await expect(page.getByText("issue897-node", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-module-subjects.png"), animations: "disabled" });
    const driver = page.locator('[data-canonical-subject-id="csub_acme_power"]');
    await driver.getByRole("button", { name: "查看参数" }).click();
    await expect(driver.getByText("extra_119", { exact: true })).toBeVisible();
    await driver.getByRole("button", { name: "收起参数" }).click();
    for (const [subjectName, moduleId] of [
      ["wiseeff.issue897.settings", "issue897-config"],
      ["issue897-node", "issue897-node"]
    ]) {
      await page.getByRole("button", { name: `登记主体：${subjectName}`, exact: true }).click();
      await page.getByRole("combobox", { name: "目标模块" }).selectOption(moduleId);
      await page.getByRole("button", { name: "继续确认", exact: true }).click();
      await page.getByRole("checkbox", { name: "我已确认放置选择与当前目录发布" }).check();
      await page.getByRole("button", { name: "确认登记", exact: true }).click();
      await expect(page.getByRole("button", { name: `调整归属：${subjectName}`, exact: true })).toBeVisible();
    }
    const placementUrl = apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations/${driverRegistrationId}/placement`);
    const priorPlacement = await request.get(placementUrl, { headers: authHeadersForRole("admin") });
    const priorEtag = priorPlacement.headers().etag;
    expect(priorEtag).toMatch(/^".+:\d+"$/);
    await driver.getByRole("button", { name: "调整归属：acme,power", exact: true }).click();
    await expect(page.getByText(/本主体 121 个有效定义、1 个当前/)).toBeVisible();
    await page.getByRole("combobox", { name: "目标模块" }).selectOption("issue897-driver-b");
    await page.screenshot({ path: info.outputPath("canonical-placement-impact.png"), animations: "disabled" });
    await page.getByRole("button", { name: "继续确认", exact: true }).click();
    await page.getByRole("checkbox", { name: "我已确认放置选择与当前目录发布" }).check();
    const moveResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/subject-registrations/${driverRegistrationId}/placement`));
    await page.getByRole("button", { name: "确认调整放置", exact: true }).click();
    const moved = await moveResponse;
    expect(moved.status(), await moved.text()).toBe(200);
    const moveHeaders = moved.request().headers();
    const replay = await request.patch(placementUrl, {
      headers: { ...authHeadersForRole("admin"), "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": moveHeaders["idempotency-key"]!, "If-Match": priorEtag },
      data: moved.request().postDataJSON()
    });
    expect(replay.status(), await replay.text()).toBe(200);
    expect(replay.headers().etag).toBe(moved.headers().etag);
    expect((await replay.json()).item).toEqual((await moved.json()).item);
    await expect(driver.getByText("归属：Output hardware", { exact: true })).toBeVisible();
    await page.reload();
    await expect(driver.getByText("归属：Output hardware", { exact: true })).toBeVisible();
    const movedRegistry = await request.get(apiRoute("/api/v2/parameter-modules"), { headers: authHeadersForRole("admin") });
    const modules = (await movedRegistry.json()).item.modules;
    expect(modules.find((module: { id: string }) => module.id === "issue897-driver-b")).toMatchObject({ parameterCount: 1, definitionCount: 121 });
    expect(modules.find((module: { id: string }) => module.id === "issue897-driver-a")).toMatchObject({ parameterCount: 0, definitionCount: 0 });
    expect(modules.find((module: { id: string }) => module.id === "issue897-config")).toMatchObject({ parameterCount: 0, definitionCount: 1 });
    const currentBindings = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers: authHeadersForRole("admin") });
    expect((await currentBindings.json()).items.find((row: { id: string }) => row.id === bindingId)).toMatchObject({ moduleId: "issue897-driver-b" });
    const stale = await request.patch(placementUrl, {
      headers: { ...authHeadersForRole("admin"), "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": "issue897-stale", "If-Match": priorEtag },
      data: { destinationModuleId: "issue897-driver-a", placement: { mode: "use-default" } }
    });
    expect(stale.status(), await stale.text()).toBe(409);
    const current = await request.get(placementUrl, { headers: authHeadersForRole("admin") });
    expect((await current.json()).item.moduleId).toBe("issue897-driver-b");
    for (const destinationModuleId of ["issue897-config", "issue897-foreign-module"]) {
      const rejected = await request.patch(placementUrl, {
        headers: { ...authHeadersForRole("admin"), "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": `reject-${destinationModuleId}`, "If-Match": current.headers().etag },
        data: { destinationModuleId, placement: { mode: "use-default" } }
      });
      expect(rejected.status(), await rejected.text()).toBe(400);
    }
    const forbidden = await request.patch(placementUrl, {
      headers: { ...authHeadersForRole("software-user"), "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": "issue897-forbidden", "If-Match": current.headers().etag },
      data: { destinationModuleId: "issue897-driver-a", placement: { mode: "use-default" } }
    });
    expect(forbidden.status(), await forbidden.text()).toBe(403);
    const scopedRegistration = await request.get(apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations/${driverRegistrationId}`), { headers: authHeadersForRole("software-user") });
    expect(scopedRegistration.status(), await scopedRegistration.text()).toBe(200);
    expect((await scopedRegistration.json()).item.impact).toBeUndefined();
    const configModuleUrl = apiRoute("/api/v1/parameter-modules/issue897-config");
    const renamed = await request.patch(configModuleUrl, { headers: authHeadersForRole("admin"), data: { name: "Renamed JSON settings" } });
    expect(renamed.status(), await renamed.text()).toBe(200);
    const reparented = await request.post(`${configModuleUrl}/move`, { headers: authHeadersForRole("admin"), data: { parentId: null } });
    expect(reparented.status(), await reparented.text()).toBe(200);
    for (const moduleId of ["issue897-config", "issue897-driver-b"]) {
      const blockedDelete = await request.delete(apiRoute(`/api/v1/parameter-modules/${moduleId}`), { headers: authHeadersForRole("admin") });
      expect(blockedDelete.status(), await blockedDelete.text()).toBe(409);
    }
    await page.reload();
    await expect(page.locator('[data-canonical-subject-id="csub_issue897_config"]').getByText("归属：Renamed JSON settings", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "筛选规范主体" }).fill("no-such-subject");
    await expect(page.getByText("没有匹配的规范主体。", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "筛选规范主体" }).fill("");
    expectedApiFailures.push({ method: "GET", path: "/api/v2/catalog/subjects", status: 500 });
    await page.route("**/api/v2/catalog/subjects?*", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Injected subject query failure" } }) }));
    await page.getByRole("button", { name: "刷新规范数据", exact: true }).click();
    await expect(page.getByRole("region", { name: "规范主体归属" }).getByRole("alert")).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-module-query-error.png"), animations: "disabled" });
    await page.unroute("**/api/v2/catalog/subjects?*");
    await page.getByRole("button", { name: "刷新规范数据", exact: true }).click();
    await expect(driver.getByText("归属：Output hardware", { exact: true })).toBeVisible();
    await page.getByRole("tree", { name: "模块归属树" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("canonical-module-tree-after-move.png"), animations: "disabled" });
    await page.getByRole("button", { name: "修改模块 Input hardware", exact: true }).click();
    await page.getByRole("button", { name: "配置组织级解析", exact: true }).click();
    await page.getByRole("button", { name: "添加参数定义", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "选择参数定义", exact: true });
    await picker.getByPlaceholder("搜索属性键，如 gpio_int").fill("extra_119");
    await expect(picker.getByText("extra_119", { exact: true })).toBeVisible();
    await expect(picker.getByText("Output hardware", { exact: true })).toBeVisible();
    await picker.getByText("extra_119", { exact: true }).click();
    await page.screenshot({ path: info.outputPath("canonical-overlay-page-two.png"), animations: "disabled" });
    await picker.getByRole("button", { name: "使用所选", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "配置组织级解析", exact: true }).getByText("extra_119", { exact: true })).toBeVisible();
    await page.goto(`${runtime.frontendUrl}/parameter-admin/specs?q=iin_max`);
    const definitionRow = page.getByRole("table", { name: "参数定义列表" }).getByRole("row").filter({ hasText: "iin_max" });
    await expect(definitionRow).toContainText("Output hardware");
    await page.screenshot({ path: info.outputPath("canonical-definition-module.png"), animations: "disabled" });
    await page.goto(`${runtime.frontendUrl}/parameters?project=${projectId}`);
    await expect(page.locator(`[data-binding-id="${bindingId}"]`)).toBeVisible();
    await expect(page.getByText("Output hardware", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-project-module.png"), animations: "disabled" });
  });
});
