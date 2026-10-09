import "./helpers/loadAcceptanceEnvironment";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { expect, test } from "playwright/test";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler";
import { refreshAuthoritativeSource } from "../../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { firstReleaseBundle } from "../../server/testing/parameterCatalog/cutoverPopulatedFixture";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { acceptanceAdminOnlyUser, seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
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

test("Issue 1064: seeded canonical modules render without organization overlays", async ({ page }, info) => {
  const overlayRequests: string[] = [];
  page.on("request", request => {
    if (request.method() === "GET" && request.url().includes("/organization-driver-schemas")) {
      overlayRequests.push(new URL(request.url()).pathname);
    }
  });
  const registrationsResponse = page.waitForResponse(response =>
    response.request().method() === "GET" &&
    /\/subject-registrations$/.test(new URL(response.url()).pathname) && response.status() === 200
  );
  await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
  const registrations = await (await registrationsResponse).json();
  expect(registrations.items.length).toBeGreaterThan(0);
  const canonical = page.getByRole("region", { name: "规范主体归属" });
  await expect(canonical.getByRole("list", { name: "规范主体列表" })).toBeVisible();
  await expect(canonical).toContainText("归属：");
  const tree = page.getByRole("tree", { name: "模块归属树" });
  await expect.poll(() => tree.getByRole("treeitem").count()).toBeGreaterThan(0);
  await expect(page.getByText("没有匹配的模块。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("正在加载模块注册表…", { exact: true })).toHaveCount(0);
  expect(overlayRequests).toEqual([]);
  await canonical.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("issue1064-canonical-registrations-1440x900.png"), animations: "disabled" });
  await tree.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("issue1064-canonical-tree-1440x900.png"), animations: "disabled" });
});

test("Issue 1067: historical modules expose provenance without structural controls", async ({ page, request }, info) => {
  await seedAcceptanceRoleMatrix();
  const actor = acceptanceAdminOnlyUser;
  const headers = authHeadersForUser(actor.userId, actor.email, actor.name);
  const navigation = await request.get(apiRoute("/api/v2/parameter-modules"), { headers });
  expect(navigation.status(), await navigation.text()).toBe(200);
  const registry = (await navigation.json()).item;
  expect(registry.navigationOnly).toBe(true);
  expect(registry.mappings).toEqual([]);
  for (const module of registry.modules) {
    expect(module.sourceKey).toBeNull();
    expect(module.attributionSubjectId).toBeNull();
  }
  const provenance = await request.get(apiRoute("/api/v2/parameter-modules/driver-registry"), { headers });
  expect(provenance.status(), await provenance.text()).toBe(200);
  const historical = (await provenance.json()).items.find((item: { moduleId: string }) =>
    registry.modules.some((module: { id: string; kind: string }) =>
      module.id === item.moduleId && module.kind === "driver-group"));
  expect(historical).toBeDefined();
  const structuralWrites: string[] = [];
  page.on("request", call => {
    const path = new URL(call.url()).pathname;
    if (call.method() !== "GET" && path.includes("parameter-modules")) structuralWrites.push(path);
  });
  await signInBrowserAsUser(page, actor.userId, actor.email, actor.name, "/parameter-admin/modules");
  const history = page.getByRole("region", { name: "历史驱动注册表" });
  await expect(history).toHaveAttribute("aria-busy", "false");
  const ancestors = [];
  let parentId = registry.modules.find((module: { id: string }) => module.id === historical.moduleId).parentId;
  while (parentId) {
    const parent = registry.modules.find((module: { id: string }) => module.id === parentId);
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  for (const parent of ancestors) {
    const expand = history.getByRole("button", { name: `展开 ${parent.name} 子模块`, exact: true });
    if (await expand.count()) await expand.click();
  }
  await page.getByRole("button", { name: `修改模块 ${historical.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: historical.name, exact: true });
  await expect(dialog.getByLabel("驱动性质", { exact: true })).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("实例基数", { exact: true })).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("模块名称", { exact: true })).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("默认业务分类", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "从注册回放放置" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "管理规范主体与归属" })).toBeVisible();
  for (const compatible of historical.compatibles) await expect(dialog.getByText(compatible, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  expect(structuralWrites).toEqual([]);
  await page.screenshot({ path: info.outputPath("issue1067-readonly-provenance-1440x900.png"), animations: "disabled" });
});

test("Issue 1066: old Platform bookmark explains retirement and links to Catalog", async ({ page }, info) => {
  await seedAcceptanceRoleMatrix();
  const retiredRequests: string[] = [];
  page.on("request", request => {
    if (/\/organization-driver-schemas|\/driver-schemas\/(promotion-candidates|promotions)/.test(request.url())) {
      retiredRequests.push(new URL(request.url()).pathname);
    }
  });
  await signInBrowserAsRole(page, "platform-admin", "/platform-console");
  await expect(page.getByRole("heading", { name: "覆盖解析已退役" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "晋升历史（只读）" })).toBeVisible();
  await expect(page.getByRole("button", { name: /晋升至平台|撤销晋升|恢复/ })).toHaveCount(0);
  await expect(page.getByText("正在加载晋升历史…")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("issue1066-platform-history-1440x900.png"), animations: "disabled" });
  const catalogLink = page.getByRole("link", { name: "前往 Catalog", exact: true });
  await expect(catalogLink).toHaveAttribute("href", "/parameter-admin/specs");
  await catalogLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/parameter-admin\/specs/);
  expect(retiredRequests).toEqual([]);
});

test.describe("Issue 897 canonical module ownership", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  let runtime: DisposablePostCutoverRuntime;
  let releaseId: string;
  let releaseFixture: ReturnType<typeof firstReleaseBundle>;
  let driverRegistrationId: string;
  let canonicalOnlyRegistrationId: string;
  let bindingId: string;
  let unknownObservationId: string;
  let valueStateBefore: { currentValueId: string; values: number; pins: number; history: number };

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("An explicit dedicated PostgreSQL lane is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { label: "issue897_modules", catalog: "fixture-owned" });
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
    const canonicalOnlyDriver = structuredClone(subject);
    canonicalOnlyDriver.content = {
      id: "csub_issue897_canonical_driver",
      kind: "driver",
      canonicalKey: "driver:issue897,canonical-only",
      lifecycle: "active",
      selector: {
        kind: "driver-compatible",
        value: "issue897,canonical-only",
        provenance: { source: "issue897-fixture" }
      },
      subtype: {
        nature: "physical-device",
        cardinality: { kind: "multiple" }
      },
      tombstone: null
    };
    release.documents.push(canonicalOnlyDriver);
    const canonicalOnlyDefinition = structuredClone(definition);
    canonicalOnlyDefinition.content.id = "pdef_csub_issue897_canonical_driver_value";
    canonicalOnlyDefinition.content.subjectId = "csub_issue897_canonical_driver";
    canonicalOnlyDefinition.content.propertyKey = "issue897_value";
    canonicalOnlyDefinition.content.revision.id = "drev_csub_issue897_canonical_driver_value";
    canonicalOnlyDefinition.content.revision.displayName = "Issue 897 value";
    canonicalOnlyDefinition.content.revision.matching.sourceProperty = "issue897_value";
    release.documents.push(canonicalOnlyDefinition);
    refreshAuthoritativeSource(release);
    const fixture = { ...bundle, releases: [release] };
    releaseFixture = fixture;
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
        ('issue897-canonical-only-attr',$1,'driver-registration','Issue 897 canonical shell','compatible:issue897,canonical-only'),
        ('issue897-node-attr',$1,'node-type-definition','Fixture node','nodetype:issue897-node')`, [organizationId]);
      await client.query("insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('issue897-driver-attr','physical-device','multiple')");
      await client.query("insert into node_type_definitions(attribution_subject_id,bare_node_name) values ('issue897-node-attr','issue897-node')");
      await client.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin) values
        ('issue897-root',$1,'Issue 897 Modules','issue897-root',1,'business','curated')`, [organizationId]);
      for (const [id, name, kind, attributionId] of [
        ["issue897-driver-a", "Input hardware", "driver-group", "issue897-driver-attr"],
        ["issue897-driver-b", "Output hardware", "driver-group", "issue897-driver-attr"],
        ["issue897-canonical-a", "Canonical source", "driver-group", "issue897-canonical-only-attr"],
        ["issue897-canonical-b", "Canonical destination", "driver-group", "issue897-canonical-only-attr"],
        ["issue897-node", "Fixture node", "node-type", "issue897-node-attr"],
        ["issue897-config", "JSON settings", "business", null]
      ]) {
        await client.query(`insert into parameter_modules(id,organization_id,name,parent_id,path,depth,kind,origin,attribution_subject_id)
          values ($1,$2,$3,'issue897-root','issue897-root/'||$1,2,$4,'curated',$5)`, [id, organizationId, name, kind, attributionId]);
      }
      await client.query(`insert into driver_registration_placements(
          id, organization_id, attribution_subject_id, driver_group_module_id,
          default_business_category_module_id
        ) values ('issue897-driver-a-placement',$1,'issue897-driver-attr','issue897-driver-a',null)`, [organizationId]);
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
    const canonicalOnlyRegistration = await request.post(
      apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`),
      {
        headers: {
          ...headers,
          "X-WiseEff-Catalog-Release": releaseId,
          "Idempotency-Key": "issue897-canonical-only-registration"
        },
        data: {
          subjectId: "csub_issue897_canonical_driver",
          destinationModuleId: "issue897-canonical-a",
          placement: { mode: "use-default" }
        }
      }
    );
    expect(canonicalOnlyRegistration.status(), await canonicalOnlyRegistration.text()).toBe(201);
    canonicalOnlyRegistrationId = (await canonicalOnlyRegistration.json()).item.id;
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
      const canonicalOnlyLegacyState = await client.query(`
        select module.attribution_subject_id as "attributionSubjectId",
          count(distinct registration.attribution_subject_id)::int as "legacyRegistrationCount",
          count(distinct placement.attribution_subject_id)::int as "legacyPlacementCount"
        from parameter_modules module
        left join driver_registrations registration
          on registration.attribution_subject_id = module.attribution_subject_id
        left join driver_registration_placements placement
          on placement.attribution_subject_id = module.attribution_subject_id
          and placement.organization_id = module.organization_id
        where module.id = 'issue897-canonical-a'
        group by module.attribution_subject_id`);
      expect(canonicalOnlyLegacyState.rows).toEqual([
        {
          attributionSubjectId: "issue897-canonical-only-attr",
          legacyRegistrationCount: 0,
          legacyPlacementCount: 0
        }
      ]);
      expect((await client.query("select count(*)::int as count from public.project_parameter_bindings where project_id=$1", [projectId])).rows[0].count).toBe(0);
      expect((await client.query("select count(*)::int as count from public.parameter_specs where organization_id=$1", [organizationId])).rows[0].count).toBe(0);
      const state = await client.query(`select binding.current_value_id as "currentValueId",
        (select count(*)::int from parameter_catalog.project_parameter_values where binding_id=binding.id) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins where binding_id=binding.id) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events where binding_id=binding.id) as history
        from parameter_catalog.project_parameter_bindings binding where binding.id=$1`, [bindingId]);
      valueStateBefore = state.rows[0];
    });
  });
  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  test("routes driver groups to canonical Placement and retires historical writes without changing provenance", async ({ page, request }, info) => {
    const browserResponses: Array<{ method: string; path: string; status: number }> = [];
    page.on("response", response => {
      if (response.url().includes("/api/")) browserResponses.push({
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status()
      });
    });
    const canonicalPlacementUrl = apiRoute(
      `/api/v2/organizations/${organizationId}/subject-registrations/${canonicalOnlyRegistrationId}/placement`
    );
    const initialPlacementResponse = await request.get(canonicalPlacementUrl, {
      headers: authHeadersForRole("admin")
    });
    expect(initialPlacementResponse.status(), await initialPlacementResponse.text()).toBe(200);
    const initialPlacement = (await initialPlacementResponse.json()).item;
    expect(initialPlacement).toMatchObject({ moduleId: "issue897-canonical-a" });

    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible()) await dismiss.click();

    await page.getByRole("button", { name: "修改模块 Canonical source", exact: true }).click();
    const canonicalEditor = page.getByRole("dialog", { name: "Canonical source" });
    await expect(canonicalEditor.getByRole("region", { name: "规范主体放置" })).toBeVisible();
    await expect(canonicalEditor.getByRole("button", { name: "管理规范主体与归属" })).toBeVisible();
    await expect(canonicalEditor.getByRole("region", { name: "业务归属" })).toHaveCount(0);
    await expect(canonicalEditor.getByLabel("默认业务分类")).toHaveCount(0);
    await expect(canonicalEditor.getByRole("button", { name: "从注册回放放置" })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("canonical-only-driver-group-entry.png"),
      animations: "disabled"
    });

    const canonicalManage = canonicalEditor.getByRole("button", { name: "管理规范主体与归属" });
    await canonicalManage.focus();
    await expect(canonicalManage).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(canonicalEditor).toHaveCount(0);
    const canonicalPanel = page.locator("#canonical-subject-placement");
    await expect(canonicalPanel).toBeFocused();
    const canonicalSubject = page.locator('[data-canonical-subject-id="csub_issue897_canonical_driver"]');
    await expect(canonicalSubject.getByText("归属：Canonical source", { exact: true })).toBeVisible();
    await expect(page.locator(".parameter-module-mapping-panel__error[role='alert']")).toHaveCount(0);
    expect(browserResponses.some(response =>
      response.path.startsWith("/api/v2/parameter-modules/driver-registry/issue897-canonical-a/")
    )).toBe(false);
    await page.screenshot({
      path: info.outputPath("canonical-placement-entry-focus.png"),
      animations: "disabled"
    });

    await page.getByRole("button", { name: "修改模块 Input hardware", exact: true }).click();
    const historicalEditor = page.getByRole("dialog", { name: "Input hardware" });
    await expect(historicalEditor.getByRole("region", { name: "历史驱动登记" })).toHaveCount(0);
    await expect(historicalEditor.getByRole("region", { name: "历史 compatible 溯源" })).toContainText("issue897,uncovered");
    await expect(historicalEditor.getByRole("region", { name: "历史 compatible 溯源" })).not.toContainText("acme,power");
    await expect(historicalEditor.getByText("历史驱动登记属性仅供溯源，不代表当前规范主体登记或归属。")).toBeVisible();
    await expect(historicalEditor.getByLabel("驱动性质")).not.toBeEditable();
    await expect(historicalEditor.getByLabel("默认业务分类")).toHaveCount(0);
    await expect(historicalEditor.getByRole("button", { name: "从注册回放放置" })).toHaveCount(0);
    await expect(historicalEditor.getByRole("region", { name: "规范主体放置" })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("historical-driver-group-controls.png"),
      animations: "disabled"
    });

    const readHistoricalState = () => withPgClient(async client => (await client.query(`
      select to_jsonb(module) as module, to_jsonb(registration) as registration,
        to_jsonb(placement) as placement
      from parameter_modules module
      join driver_registrations registration on registration.attribution_subject_id = module.attribution_subject_id
      left join driver_registration_placements placement on placement.attribution_subject_id = module.attribution_subject_id
        and placement.organization_id = module.organization_id
      where module.id = 'issue897-driver-a'
      order by placement.id`)).rows);
    const historicalBefore = await readHistoricalState();
    expect(historicalBefore).toHaveLength(1);
    const historicalDefaultResponse = await request.patch(apiRoute(
      "/api/v2/parameter-modules/driver-registry/issue897-driver-a/default-business-category"
    ), { headers: authHeadersForRole("admin"), data: { defaultBusinessCategoryId: "issue897-root" } });
    expect(historicalDefaultResponse.status(), await historicalDefaultResponse.text()).toBe(410);
    const historicalDefaultResult = await historicalDefaultResponse.json();
    expect(historicalDefaultResult).toMatchObject({
      error: { code: "GONE", details: { reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false } }
    });
    expect(await readHistoricalState()).toEqual(historicalBefore);

    const historicalReplayResponse = await request.post(apiRoute(
      "/api/v2/parameter-modules/driver-registry/issue897-driver-a/replay-placement"
    ), { headers: authHeadersForRole("admin"), data: {} });
    expect(historicalReplayResponse.status(), await historicalReplayResponse.text()).toBe(410);
    const historicalReplayResult = await historicalReplayResponse.json();
    expect(historicalReplayResult).toMatchObject({
      error: { code: "GONE", details: { reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false } }
    });
    expect(await readHistoricalState()).toEqual(historicalBefore);
    await historicalEditor.getByRole("button", { name: "取消" }).click();

    await expect(canonicalSubject.getByText("归属：Canonical source", { exact: true })).toBeVisible();
    await canonicalSubject.getByRole("button", { name: "调整归属：issue897,canonical-only", exact: true }).click();
    await page.getByRole("combobox", { name: "目标模块" }).selectOption("issue897-canonical-b");
    await page.getByRole("button", { name: "继续确认", exact: true }).click();
    await page.getByRole("checkbox", { name: "我已确认放置选择与当前目录发布" }).check();
    const canonicalMove = page.waitForResponse(response =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/subject-registrations/${canonicalOnlyRegistrationId}/placement`)
    );
    await page.getByRole("button", { name: "确认调整放置", exact: true }).click();
    const canonicalMoveResponse = await canonicalMove;
    expect(canonicalMoveResponse.status(), await canonicalMoveResponse.text()).toBe(200);
    await expect(canonicalSubject.getByText("归属：Canonical destination", { exact: true })).toBeVisible();
    const finalPlacementResponse = await request.get(canonicalPlacementUrl, {
      headers: authHeadersForRole("admin")
    });
    expect(finalPlacementResponse.status(), await finalPlacementResponse.text()).toBe(200);
    const finalPlacement = (await finalPlacementResponse.json()).item;
    expect(finalPlacement).toMatchObject({ moduleId: "issue897-canonical-b" });
    const finalRegistry = await request.get(apiRoute("/api/v2/parameter-modules"), {
      headers: authHeadersForRole("admin")
    });
    expect(finalRegistry.status(), await finalRegistry.text()).toBe(200);
    const finalModules = (await finalRegistry.json()).item.modules;
    expect(finalModules.find((module: { id: string }) => module.id === "issue897-canonical-a"))
      .toMatchObject({ parameterCount: 0, definitionCount: 0 });
    expect(finalModules.find((module: { id: string }) => module.id === "issue897-canonical-b"))
      .toMatchObject({ parameterCount: 0, definitionCount: 1 });
    await page.getByRole("tree", { name: "模块归属树" }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("canonical-placement-module-tree.png"),
      animations: "disabled"
    });

    const canonicalOnlyLegacyState = await withPgClient(async client => {
      const state = await client.query(`
        select module.attribution_subject_id as "attributionSubjectId",
          count(distinct registration.attribution_subject_id)::int as "legacyRegistrationCount",
          count(distinct placement.attribution_subject_id)::int as "legacyPlacementCount"
        from parameter_modules module
        left join driver_registrations registration
          on registration.attribution_subject_id = module.attribution_subject_id
        left join driver_registration_placements placement
          on placement.attribution_subject_id = module.attribution_subject_id
          and placement.organization_id = module.organization_id
        where module.id = 'issue897-canonical-b'
        group by module.attribution_subject_id`);
      expect(state.rows).toEqual([{
        attributionSubjectId: "issue897-canonical-only-attr",
        legacyRegistrationCount: 0,
        legacyPlacementCount: 0
      }]);
      const historical = await client.query(`
        select placement.default_business_category_module_id as "defaultBusinessCategoryId"
        from driver_registration_placements placement
        where placement.id = 'issue897-driver-a-placement'`);
      expect(historical.rows).toEqual([{ defaultBusinessCategoryId: null }]);
      return state.rows[0];
    });
    expect(await readHistoricalState()).toEqual(historicalBefore);
    expect(browserResponses).toContainEqual({
      method: "PATCH",
      path: `/api/v2/organizations/${organizationId}/subject-registrations/${canonicalOnlyRegistrationId}/placement`,
      status: 200
    });
    expect(browserResponses.filter(response => response.method !== "GET" && /\/driver-registry\//.test(response.path))).toEqual([]);
    await writeFile(
      info.outputPath("canonical-module-entry-evidence.json"),
      JSON.stringify({
        viewport: "1440x900",
        canonicalOnlyLegacyState,
        canonicalPlacementBefore: initialPlacement,
        canonicalPlacementMoveStatus: canonicalMoveResponse.status(),
        canonicalPlacementAfter: finalPlacement,
        historicalBefore,
        historicalAfter: await readHistoricalState(),
        historicalDefaultResponse: {
          status: historicalDefaultResponse.status(),
          body: historicalDefaultResult
        },
        historicalReplayResponse: {
          status: historicalReplayResponse.status(),
          body: historicalReplayResult
        },
        browserResponses,
        moduleTree: finalModules
          .filter((module: { id: string }) => module.id.startsWith("issue897-canonical-"))
          .map((module: { id: string; parameterCount: number; definitionCount: number }) => ({
            id: module.id,
            parameterCount: module.parameterCount,
            definitionCount: module.definitionCount
          }))
      }, null, 2)
    );
  });

  test("shows canonical counts and all subject kinds", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const moduleRequests: string[] = [];
    const moduleResponses: Array<{ method: string; path: string; status: number }> = [];
    page.on("request", call => {
      if (call.url().includes("/api/")) moduleRequests.push(`${call.method()} ${new URL(call.url()).pathname}`);
    });
    page.on("response", response => {
      if (response.url().includes("/api/")) moduleResponses.push({
        method: response.request().method(), path: new URL(response.url()).pathname, status: response.status()
      });
    });
    const registry = await request.get(apiRoute("/api/v2/parameter-modules"), { headers: authHeadersForRole("admin") });
    expect(registry.status(), await registry.text()).toBe(200);
    expect((await registry.json()).item.modules.find((module: { id: string }) => module.id === "issue897-driver-a"))
      .toMatchObject({ parameterCount: 1, definitionCount: 121 });
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible()) await dismiss.click();
    const discovery = page.getByRole("region", { name: "驱动兼容发现" });
    await expect(discovery.getByText("acme,power", { exact: true })).toBeVisible();
    await expect(discovery.getByText(/已识别主体 csub_acme_power/)).toBeVisible();
    const refreshedDiscovery = page.waitForResponse(response => response.url().includes("/driver-compatible-discovery") && response.status() === 200);
    await discovery.getByRole("button", { name: "刷新发现" }).click();
    await refreshedDiscovery;
    await expect(discovery.getByText(/已识别主体 csub_acme_power/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-driver-discovery.png"), animations: "disabled" });
    await expect(discovery.getByRole("button", { name: "编写覆盖解析" })).toHaveCount(0);
    const catalogLink = discovery.getByRole("link", { name: "前往 Catalog 提交定义提案" });
    await expect(catalogLink).toHaveAttribute("href", "/parameter-admin/specs");
    await catalogLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/parameter-admin\/specs/);
    await expect(page.getByRole("dialog", { name: "配置组织级解析" })).toHaveCount(0);
    await page.goBack();
    await expect(discovery.getByText(/已识别主体 csub_acme_power/)).toBeVisible();
    await expect(page.getByLabel("规范主体列表").getByText("acme,power", { exact: true })).toBeVisible();
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
    expect(moduleRequests.filter(path => path.includes("/driver-compatible-discovery")).length).toBeGreaterThanOrEqual(4);
    expect(moduleRequests.filter(path => /discovery-hints|recompute|\/mappings(?:\/|$)/.test(path))).toEqual([]);
    await withPgClient(async client => {
      const state = await client.query(`select binding.current_value_id as "currentValueId",
        (select count(*)::int from parameter_catalog.project_parameter_values where binding_id=binding.id) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins where binding_id=binding.id) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events where binding_id=binding.id) as history
        from parameter_catalog.project_parameter_bindings binding where binding.id=$1`, [bindingId]);
      expect(state.rows[0]).toEqual(valueStateBefore);
    });
    await writeFile(info.outputPath("canonical-module-network.json"), JSON.stringify(moduleResponses, null, 2));
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
      expect(blockedDelete.status(), await blockedDelete.text()).toBe(moduleId === "issue897-driver-b" ? 410 : 409);
      if (moduleId === "issue897-driver-b") {
        expect((await blockedDelete.json()).error.details).toMatchObject({
          reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false,
        });
      }
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
    const historicalDetails = page.getByRole("dialog", { name: "Input hardware", exact: true });
    await expect(historicalDetails.getByRole("region", { name: "历史 compatible 溯源" })).toContainText("issue897,uncovered");
    await expect(page.getByRole("button", { name: "配置组织级解析", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加参数定义", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "选择参数定义", exact: true })).toHaveCount(0);
    await historicalDetails.getByRole("button", { name: "取消", exact: true }).click();
    expect(moduleRequests.filter(call => call.includes("organization-driver-schemas"))).toEqual([]);
    await page.goto(`${runtime.frontendUrl}/parameter-admin/specs?q=extra_119`);
    const lastDefinitionRow = page.getByRole("table", { name: "参数定义列表" }).getByRole("row").filter({ hasText: "extra_119" });
    await expect(lastDefinitionRow).toContainText("Output hardware");
    await page.screenshot({ path: info.outputPath("canonical-definition-page-two.png"), animations: "disabled" });
    await page.goto(`${runtime.frontendUrl}/parameter-admin/specs?q=iin_max`);
    const definitionRow = page.getByRole("table", { name: "参数定义列表" }).getByRole("row").filter({ hasText: "iin_max" });
    await expect(definitionRow).toContainText("Output hardware");
    await page.screenshot({ path: info.outputPath("canonical-definition-module.png"), animations: "disabled" });
    await page.goto(`${runtime.frontendUrl}/parameters?project=${projectId}`);
    await expect(page.locator(`[data-binding-id="${bindingId}"]`)).toBeVisible();
    await expect(page.getByText("Output hardware", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-project-module.png"), animations: "disabled" });
  });

  test("opens the exact Review Item for two identical compatibles and ignores only one", async ({ page, request }, info) => {
    const headers = authHeadersForRole("admin");
    const content = '/dts-v1/;\n/ { first { compatible = "vendor,device"; }; second { compatible = "vendor,device"; }; };\n';
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers, data: { name: "issue897-review-source" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id;
    const upload = () => request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "review-board.dts", contentBase64: Buffer.from(content).toString("base64") }
    });
    const file = await upload();
    expect(file.status(), await file.text()).toBe(201);
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
      headers, data: { fileId: (await file.json()).item.id, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const parsed = await upload();
    expect(parsed.status(), await parsed.text()).toBe(201);
    const discoveryPath = `/api/v2/organizations/${organizationId}/driver-compatible-discovery?projectId=${projectId}`;
    const before = await request.get(apiRoute(discoveryPath), { headers });
    expect(before.status(), await before.text()).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.status).toBe("ready");
    const itemIds = beforeBody.items.flatMap((entry: { compatibles: Array<{ compatible: string; candidate: { reviewItemIds: string[] | null } }> }) =>
      entry.compatibles.filter(candidate => candidate.compatible === "vendor,device").flatMap(candidate => candidate.candidate.reviewItemIds ?? []));
    expect(itemIds).toHaveLength(2);
    unknownObservationId = beforeBody.items.find((entry: { compatibles: Array<{ compatible: string }> }) =>
      entry.compatibles.some(candidate => candidate.compatible === "vendor,device"))?.observationId;
    expect(unknownObservationId).toBeTruthy();

    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const discovery = page.getByRole("region", { name: "驱动兼容发现" });
    await expect(discovery.getByRole("button", { name: `查看复核项 ${itemIds[0]}` })).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-review-items-before.png"), animations: "disabled" });
    await discovery.getByRole("button", { name: `查看复核项 ${itemIds[0]}` }).click();
    await expect(page).toHaveURL(new RegExp(`reviewItemId=${itemIds[0]}`));
    const dialog = page.getByRole("dialog", { name: "处理审核" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "标为范围外" }).check();
    await dialog.getByLabel("原因").fill("此观察记录不在治理范围");
    await dialog.getByRole("button", { name: "继续确认" }).click();
    const confirm = page.getByRole("dialog", { name: "确认处理审核" });
    await confirm.getByRole("checkbox").check();
    const resolved = page.waitForResponse(response => response.url().includes(`/parameter-review-items/${itemIds[0]}/resolve`) && response.request().method() === "POST");
    await confirm.getByRole("button", { name: "确认处理" }).click();
    expect((await resolved).status()).toBe(200);

    await page.goto(`${runtime.frontendUrl}/parameter-admin/modules`);
    await expect(page.getByRole("region", { name: "驱动兼容发现" }).getByText(/已忽略复核项：1/)).toBeVisible();
    await expect(page.getByRole("button", { name: `查看复核项 ${itemIds[1]}` })).toBeVisible();
    expect(page.getByRole("button", { name: `查看复核项 ${itemIds[0]}` })).toHaveCount(0);
    const after = await request.get(apiRoute(discoveryPath), { headers });
    expect(after.status(), await after.text()).toBe(200);
    expect((await after.json()).ignoredReviewItemCount).toBe(1);
    await page.screenshot({ path: info.outputPath("canonical-review-items-after.png"), animations: "disabled" });
  });

  test("uses the real discovery release pin when more than fifty observations need a second page", async ({ page, request }, info) => {
    const headers = authHeadersForRole("admin");
    const content = `/dts-v1/;\n/ { ${Array.from({ length: 51 }, (_, index) =>
      `node_${index} { compatible = "acme,power"; };`).join(" ")} };\n`;
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers, data: { name: "issue897-paged-source" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const setId = (await config.json()).item.id;
    const upload = () => request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "paged-board.dts", contentBase64: Buffer.from(content).toString("base64") }
    });
    const file = await upload();
    expect(file.status(), await file.text()).toBe(201);
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${setId}/files`), {
      headers, data: { fileId: (await file.json()).item.id, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const parsed = await upload();
    expect(parsed.status(), await parsed.text()).toBe(201);
    const first = await request.get(apiRoute(`/api/v2/organizations/${organizationId}/driver-compatible-discovery?limit=50`), { headers });
    expect(first.status(), await first.text()).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.status).toBe("ready");
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    let pinnedHeader = "";
    page.on("request", call => {
      if (call.url().includes("driver-compatible-discovery") && new URL(call.url()).searchParams.has("cursor")) {
        pinnedHeader = call.headers()["x-wiseeff-catalog-release"] ?? "";
      }
    });
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const discovery = page.getByRole("region", { name: "驱动兼容发现" });
    await expect(discovery.locator(".canonical-driver-discovery__item")).toHaveCount(50);
    await discovery.getByRole("button", { name: "加载下一页" }).click();
    await expect.poll(() => discovery.locator(".canonical-driver-discovery__item").count()).toBeGreaterThan(50);
    expect(pinnedHeader).toBe(firstPage.catalogRelease.id);
    await page.screenshot({ path: info.outputPath("canonical-discovery-second-real-page.png"), animations: "disabled" });
  });

  test("UI simulation: paginates with release pin and keeps historical, unavailable and nullable states distinct", async ({ page }, info) => {
    const pin = { id: "crel_simulated", digest: "sha256:simulated" };
    const observation = (index: number, source: unknown, candidate: unknown) => ({
      observationId: `obs_sim_${index}`, projectId, logicalNodeId: `node_${index}`,
      configRevisionId: "revision_sim", observedCatalogReleaseId: pin.id,
      observedMatcherRevision: "matcher_sim", source,
      compatibles: index < 2 ? [] : [{ compatible: `vendor,device-${index}`, candidate }]
    });
    const current = { status: "current", configSetId: "set_sim", sourceName: "simulated.dts",
      fileVersionId: "version_sim", sourceDigest: "sha256:source", revisionDigest: "sha256:revision" };
    const firstItems = Array.from({ length: 50 }, (_, index) => observation(index,
      index === 0 ? { status: "historical", currentConfigRevisionId: "revision_new", historicalCompatibles: ["vendor,old"] }
        : index === 1 ? { status: "unavailable", reason: "source-proof-invalid" } : current,
      { kind: "review-required", reason: "unknown", reviewItemIds: index === 2 ? null : [] }));
    let phase: "pages" | "zero" = "pages";
    let pinnedHeader = "";
    await page.route("**/driver-compatible-discovery*", async route => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) pinnedHeader = route.request().headers()["x-wiseeff-catalog-release"] ?? "";
      const body = phase === "zero"
        ? { status: "ready", catalogRelease: pin, matcherRevision: "matcher_sim", items: [], nextCursor: null,
          ignoredReviewItemCount: null, emptyReason: "no-observations" }
        : cursor === "obs_sim_050" ? { status: "unavailable", reason: "release-drift" }
          : { status: "ready", catalogRelease: pin, matcherRevision: "matcher_sim",
            items: cursor === "obs_sim_049" ? [observation(50, current,
              { kind: "recognized", subjectId: "csub_sim", registrationId: null })] : firstItems,
            nextCursor: cursor === "obs_sim_049" ? "obs_sim_050" : "obs_sim_049",
            ignoredReviewItemCount: null };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const discovery = page.getByRole("region", { name: "驱动兼容发现" });
    await expect(discovery.getByText(/历史 compatible：vendor,old/)).toBeVisible();
    await expect(discovery.getByText(/来源不可用：source-proof-invalid/)).toBeVisible();
    await expect(discovery.getByText(/复核项关联不可查看/)).toBeVisible();
    await discovery.getByRole("button", { name: "加载下一页" }).click();
    await expect(discovery.getByText("vendor,device-50")).toBeVisible();
    expect(pinnedHeader).toBe(pin.id);
    await expect(discovery.getByText(/尚未登记/)).toBeVisible();
    await discovery.getByRole("button", { name: "加载下一页" }).click();
    await expect(discovery.getByRole("alert")).toContainText("目录发布已变化");
    await expect(discovery.getByText("vendor,device-50")).toBeVisible();
    phase = "zero";
    await discovery.getByRole("button", { name: "刷新发现" }).focus();
    await page.keyboard.press("Enter");
    await expect(discovery.getByText("当前范围没有来源观察记录。")).toBeVisible();
    await expect(discovery.getByText(/已忽略复核项：无权查看/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("simulated-discovery-zero.png"), animations: "disabled" });
  });

  test("project viewer has scoped HTTP discovery but the admin page remains role gated", async ({ page, request }, info) => {
    const response = await request.get(apiRoute(`/api/v2/organizations/${organizationId}/driver-compatible-discovery?observationId=${unknownObservationId}`), {
      headers: authHeadersForRole("software-user")
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.items).toHaveLength(1);
    expect(body.ignoredReviewItemCount).toBeNull();
    expect(body.items.flatMap((row: { compatibles: Array<{ candidate: { kind: string; reviewItemIds?: string[] | null } }> }) => row.compatibles)
      .filter((row: { candidate: { kind: string } }) => row.candidate.kind === "review-required")
      .every((row: { candidate: { reviewItemIds: string[] | null } }) => row.candidate.reviewItemIds === null)).toBe(true);
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameter-admin/modules`);
    await expect(page.getByText("无权访问该页面")).toBeVisible();
    await expect(page.getByRole("region", { name: "驱动兼容发现" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "全量重算" })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("canonical-admin-page-project-viewer-denied.png"), animations: "disabled" });
  });

  test("real HTTP 409 release drift keeps the first page separate and refreshes onto the new pin", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const headers = authHeadersForRole("admin");
    const content = `/dts-v1/;\n/ { ${Array.from({ length: 51 }, (_, index) =>
      `drift_node_${index} { compatible = "acme,power"; };`).join(" ")} };\n`;
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers, data: { name: "issue897-release-drift-source" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const upload = () => request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "release-drift.dts", contentBase64: Buffer.from(content).toString("base64") }
    });
    const file = await upload();
    expect(file.status(), await file.text()).toBe(201);
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${(await config.json()).item.id}/files`), {
      headers, data: { fileId: (await file.json()).item.id, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const parsed = await upload();
    expect(parsed.status(), await parsed.text()).toBe(201);
    const discoveryPath = `/api/v2/organizations/${organizationId}/driver-compatible-discovery`;
    const traffic: Array<{ method: string; path: string; status: number; releasePin: string | null }> = [];
    const legacyRequests: string[] = [];
    page.on("request", call => {
      if (/discovery-hints|\/parameter-modules\/mappings|\/parameter-modules\/recompute/.test(call.url())) {
        legacyRequests.push(`${call.method()} ${new URL(call.url()).pathname}`);
      }
    });
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.pathname === discoveryPath) traffic.push({
        method: response.request().method(), path: `${url.pathname}${url.search}`,
        status: response.status(),
        releasePin: response.request().headers()["x-wiseeff-catalog-release"] ?? null
      });
    });
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/modules`);
    const discovery = page.getByRole("region", { name: "驱动兼容发现" });
    await expect(discovery.locator(".canonical-driver-discovery__item")).toHaveCount(50);
    const first = await request.get(apiRoute(`${discoveryPath}?limit=50`), { headers });
    expect(first.status(), await first.text()).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.status).toBe("ready");
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(discovery.getByText(new RegExp(`目录发布 ${firstPage.catalogRelease.id}`))).toBeVisible();

    const successor = structuredClone(releaseFixture.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
    successor.manifest.release = { ...successor.manifest.release,
      id: "crel_issue897_drift_2", version: "1.1.0", sequence: successor.manifest.release.sequence + 1,
      publishedAt: "2026-09-28T00:00:00Z", predecessor: firstPage.catalogRelease };
    refreshAuthoritativeSource(successor);
    const nextBundle = { ...releaseFixture, targetReleaseId: successor.manifest.release.id,
      releases: [...releaseFixture.releases, successor] };
    const compiled = compileCatalogRelease(nextBundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
    try {
      const installed = await installPublishedRelease(pool, { mode: "advance",
        source: jsonCatalogReleaseSource(nextBundle), expectedCurrent: firstPage.catalogRelease,
        expectedTargetDigest: compiled.value.aggregateDigest });
      expect(installed.ok, JSON.stringify(installed)).toBe(true);
    } finally { await pool.end(); }

    expectedApiFailures.push({ method: "GET", path: discoveryPath, status: 409 });
    const driftedResponse = page.waitForResponse(response => new URL(response.url()).pathname === discoveryPath &&
      new URL(response.url()).searchParams.has("cursor") && response.status() === 409);
    await discovery.getByRole("button", { name: "加载下一页" }).click();
    const drifted = await driftedResponse;
    const errorBody = await drifted.json();
    expect(errorBody.error).toMatchObject({ code: "CONFLICT", details: {
      reason: "release-drift", expectedCatalogReleaseId: firstPage.catalogRelease.id,
      currentCatalogReleaseId: successor.manifest.release.id
    } });
    await expect(discovery.getByRole("alert")).toContainText("目录发布已变化，请刷新发现结果。");
    await expect(discovery.locator(".canonical-driver-discovery__item")).toHaveCount(50);
    await expect(discovery.getByRole("button", { name: "加载下一页" })).toHaveCount(0);
    await discovery.getByRole("alert").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("canonical-real-release-drift-409.png"), animations: "disabled" });

    const refreshedResponse = page.waitForResponse(response => new URL(response.url()).pathname === discoveryPath &&
      !new URL(response.url()).searchParams.has("cursor") && response.status() === 200);
    await discovery.getByRole("button", { name: "刷新发现" }).click();
    expect((await (await refreshedResponse).json()).catalogRelease.id).toBe(successor.manifest.release.id);
    await expect(discovery.getByText(new RegExp(`目录发布 ${successor.manifest.release.id}`))).toBeVisible();
    await expect(discovery.locator(".canonical-driver-discovery__item")).toHaveCount(50);
    const continuedResponse = page.waitForResponse(response => new URL(response.url()).pathname === discoveryPath &&
      new URL(response.url()).searchParams.has("cursor") && response.status() === 200);
    await discovery.getByRole("button", { name: "加载下一页" }).click();
    await continuedResponse;
    await expect.poll(() => discovery.locator(".canonical-driver-discovery__item").count()).toBeGreaterThan(50);
    expect(traffic.filter(entry => entry.path.includes("cursor="))).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 409, releasePin: firstPage.catalogRelease.id }),
      expect.objectContaining({ status: 200, releasePin: successor.manifest.release.id })
    ]));
    expect(legacyRequests).toEqual([]);
    await discovery.getByText(new RegExp(`目录发布 ${successor.manifest.release.id}`)).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("canonical-real-release-drift-refreshed.png"), animations: "disabled" });
    await writeFile(info.outputPath("canonical-real-release-drift-network.json"), JSON.stringify({
      fixturePublication: { previous: firstPage.catalogRelease, current: {
        id: successor.manifest.release.id, digest: compiled.value.release.digest } },
      traffic, conflict: errorBody.error.details, legacyRequests
    }, null, 2));
  });
});
