import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import { expect, test } from "playwright/test";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler/index";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { bindingCompareListResponseSchema, bindingHistoryListResponseSchema } from "../../server/modules/contracts/dtoSchemas/parameterCatalog";
import { firstReleaseBundle } from "../../server/testing/parameterCatalog/cutoverPopulatedFixture";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { createPostgresDatabase } from "../../server/shared/database/client";
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
test.beforeEach(() => { expectedApiFailures.length = 0; });
test.describe("Issue 899 canonical-only DTS queries", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  const organizationId = "org-chargelab";
  const projectId = "issue899-project-a";
  let runtime: DisposablePostCutoverRuntime;
  let bindingId: string;
  let otherProjectBindingId: string;
  let definitionId: string;
  let effectiveRevisionId: string;
  let initialCurrentValueId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("An explicit dedicated PostgreSQL lane is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { label: "issue899_query" });
    applyDisposableRuntimeEnv(runtime);
    const bundle = firstReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error("Catalog fixture compilation failed");
    const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
    try {
      const installed = await installPublishedRelease(pool, {
        mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest
      });
      expect(installed.ok, JSON.stringify(installed)).toBe(true);
    } finally { await pool.end(); }
    await withPgClient(async client => {
      await client.query(`insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
        values ('issue899-attr',$1,'driver-registration','Acme power','compatible:acme,power')`, [organizationId]);
      await client.query(`insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
        values ('issue899-attr','physical-device','multiple')`);
      await client.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
        values ('issue899-module',$1,'Acme power','issue899-module',1,'driver-group','curated','issue899-attr')`, [organizationId]);
    });
    const headers = authHeadersForRole("admin");
    const registered = await request.post(apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`), {
      headers: { ...headers, "X-WiseEff-Catalog-Release": compiled.value.release.id, "Idempotency-Key": "issue899-registration" },
      data: { subjectId: "csub_acme_power", placement: { mode: "use-default" }, reason: "Issue 899 isolated fixture" }
    });
    expect(registered.status(), await registered.text()).toBe(201);
    for (const [id, name, values] of [
      [projectId, "Issue 899 A", [1000, 1100]],
      ["issue899-project-b", "Issue 899 B", [1200, 1300]]
    ] as const) {
      await withPgClient(async client => {
        await client.query(`insert into projects(id,organization_id,name,code,status) values ($1,$2,$3,$1,'initialized')`, [id, organizationId, name]);
        await client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,'software-user')`,
          [`${id}-reader`, acceptanceCast.liuMin.userId, organizationId, id]);
        await client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,'software-committer')`,
          [`${id}-reviewer`, acceptanceCast.sunMei.userId, organizationId, id]);
      });
      const config = await request.post(apiRoute(`/api/v1/projects/${id}/config-sets`), { headers, data: { name: "default" } });
      expect(config.status(), await config.text()).toBe(201);
      const configSetId = (await config.json()).item.id;
      const source = `/dts-v1/;\n/ {\n${values.map((value, i) => `charger${i} { compatible = "acme,power"; iin_max = <${value}>; };`).join("\n")}\n};\n`;
      const upload = () => request.post(apiRoute(`/api/v1/projects/${id}/parameter-files`), {
        headers, data: { fileName: "charger.dts", contentBase64: Buffer.from(source).toString("base64") }
      });
      const first = await upload();
      expect(first.status(), await first.text()).toBe(201);
      const fileId = (await first.json()).item.id;
      const member = await request.post(apiRoute(`/api/v1/projects/${id}/config-sets/${configSetId}/files`), {
        headers, data: { fileId, role: "base", sortOrder: 0 }
      });
      expect(member.ok(), await member.text()).toBe(true);
      const second = await upload();
      expect(second.status(), await second.text()).toBe(201);
      const bindings = await request.get(apiRoute(`/api/v2/projects/${id}/parameter-bindings`), { headers });
      expect(bindings.ok(), await bindings.text()).toBe(true);
      const rows = (await bindings.json()).items;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.definitionId).toBe("pdef_acme_power_iin_max");
        expect(row.effectiveRevisionId).toBeTruthy();
        expect(row.currentValueId).toBeTruthy();
      }
      if (id === projectId) {
        const current = rows.find((row: { rawValue: string }) => row.rawValue.includes("1000"));
        bindingId = current.id;
        definitionId = current.definitionId;
        effectiveRevisionId = current.effectiveRevisionId;
        initialCurrentValueId = current.currentValueId;
      } else otherProjectBindingId = rows[0].id;
    }
    await withPgClient(async client => {
      const canonical = await client.query(`select count(*)::int as bindings, count(distinct source_occurrence_id)::int as instances
        from parameter_catalog.project_parameter_bindings where project_id=any($1)`, [[projectId, "issue899-project-b"]]);
      expect(canonical.rows[0]).toEqual({ bindings: 4, instances: 4 });
      const legacy = await client.query(`select (select count(*) from public.project_parameter_bindings where project_id = any($1))::int as bindings,
        (select count(*) from public.parameter_specs where id in (select definition_id from parameter_catalog.project_parameter_bindings where project_id=any($1)))::int as specs`, [[projectId, "issue899-project-b"]]);
      expect(legacy.rows[0]).toEqual({ bindings: 0, specs: 0 });
    });
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  test("loads exact canonical details and preserves each comparable instance after reload", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${projectId}`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible()) await dismiss.click();
    const open = async () => {
      const row = page.locator(`[data-binding-id="${bindingId}"]`);
      await row.getByRole("button", { name: /查看/ }).click();
      const detail = page.getByRole("dialog", { name: /参数详情/ });
      await expect(detail).not.toContainText("规格详情暂时无法加载");
      await expect(detail).not.toContainText("暂无其他项目的对比数据");
      await expect(detail.getByRole("button", { name: "打开跨项目对比" })).toBeVisible();
      return detail;
    };
    const exactDefinition = page.waitForResponse(response => response.request().method() === "GET" && response.url().includes(`/definitions/${definitionId}/revisions/${effectiveRevisionId}`));
    let detail = await open();
    const definitionResponse = await exactDefinition;
    expect(definitionResponse.status(), await definitionResponse.text()).toBe(200);
    expect((await definitionResponse.json()).item).toMatchObject({ id: effectiveRevisionId, definitionId });
    await page.screenshot({ path: info.outputPath("canonical-detail.png"), animations: "disabled" });
    await detail.getByRole("button", { name: "打开跨项目对比" }).click();
    const comparison = page.getByRole("dialog", { name: /跨项目对比/ });
    const selector = comparison.getByRole("combobox");
    await expect(selector).toHaveValue("");
    await expect(selector.locator('option:not([value=""])')).toHaveCount(3);
    await expect(selector).toContainText("charger.dts!/charger1");
    const options = await selector.locator('option:not([value=""])').evaluateAll(elements => elements.map(element => (element as HTMLOptionElement).value));
    expect(new Set(options).size).toBe(3);
    const response = await request.get(apiRoute(`/api/v2/projects/${projectId}/bindings/${bindingId}/compare`), { headers: authHeadersForRole("software-user") });
    expect(response.status(), await response.text()).toBe(200);
    const compareBody = await response.json();
    expect(bindingCompareListResponseSchema.safeParse(compareBody).success, "The shared Catalog client must accept the same response").toBe(true);
    const peers: { bindingId: string; rawValue: string }[] = compareBody.items;
    expect(peers.map(peer => peer.rawValue.match(/\d+/)?.[0]).sort()).toEqual(["1100", "1200", "1300"]);
    for (const value of options) {
      const peer = peers.find(item => item.bindingId === value);
      expect(peer, `Selection must preserve canonical Binding identity: ${value}`).toBeDefined();
      await selector.selectOption(value);
      await expect(comparison.locator('[data-kind="add"] code')).toContainText(peer!.rawValue.match(/\d+/)![0]);
      await expect(comparison.locator('[data-kind="remove"] code')).toContainText("1000");
    }
    await page.screenshot({ path: info.outputPath("canonical-instances.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.reload();
    detail = await open();
    await expect(detail).toContainText("1000");
    await page.keyboard.press("Escape");
    // Produce history through the existing human-reviewed value/source owners.
    await page.locator(`[data-binding-id="${bindingId}"]`).getByRole("button", { name: /编辑/ }).click();
    const editor = page.getByRole("dialog", { name: "修改草稿" });
    await editor.getByLabel("目标值", { exact: true }).fill("<1400>");
    await editor.getByLabel("修改原因", { exact: true }).fill("Issue 899 exact history");
    const created = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/parameter-bindings/${bindingId}/drafts`));
    await editor.getByRole("button", { name: "校验并加入本轮" }).click();
    const draftResponse = await created;
    expect(draftResponse.status(), await draftResponse.text()).toBe(201);
    const draftId = (await draftResponse.json()).item.draftId;
    const submitted = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-value-drafts/${draftId}/submit`), {
      headers: authHeadersForRole("software-user"), data: { assignedToUserId: acceptanceCast.sunMei.userId }
    });
    expect(submitted.ok(), await submitted.text()).toBe(true);
    const requestId = (await submitted.json()).item.id;
    const approved = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}/review`), {
      headers: authHeadersForRole("software-committer"), data: { decision: "approve" }
    });
    expect(approved.ok(), await approved.text()).toBe(true);
    const historyResponse = await request.get(apiRoute(`/api/v2/projects/${projectId}/bindings/${bindingId}/history`), { headers: authHeadersForRole("software-user") });
    expect(historyResponse.status(), await historyResponse.text()).toBe(200);
    const historyBody = await historyResponse.json();
    expect(bindingHistoryListResponseSchema.safeParse(historyBody).success, "The shared Catalog client must accept canonical history").toBe(true);
    expect(historyBody.items).toEqual(expect.arrayContaining([expect.objectContaining({
      bindingId, fromRawValue: "<1000>", toRawValue: "<1400>", oldCurrentValueId: initialCurrentValueId,
      oldDefinitionRevisionId: effectiveRevisionId, newDefinitionRevisionId: effectiveRevisionId,
      newCurrentValueId: expect.any(String), successAuditRef: expect.any(String), valueState: "present"
    })]));
    const changedEvent = historyBody.items.find((item: { oldCurrentValueId: string | null }) => item.oldCurrentValueId === initialCurrentValueId);
    expect(changedEvent.newCurrentValueId).not.toBe(initialCurrentValueId);
    await page.reload();
    detail = await open();
    await expect(detail).toContainText("1400");
    await expect(detail.getByRole("list", { name: "参数历史" })).toContainText("1400");
    await detail.getByRole("button", { name: "查看历史差异" }).click();
    const historyDiff = page.getByRole("dialog", { name: /历史差异/ });
    const changed = historyDiff.locator(".parameter-history-diff-card").filter({ has: page.locator("strong", { hasText: /1000.*→.*1400/ }) });
    await expect(changed.locator('[data-kind="remove"] code')).toContainText("1000");
    await expect(changed.locator('[data-kind="add"] code')).toContainText("1400");
    await page.screenshot({ path: info.outputPath("canonical-history.png"), animations: "disabled" });
  });

  test("displays HTTP query failures and retries instead of empty results", async ({ page }, info) => {
    const historyPath = `/api/v2/projects/${projectId}/bindings/${bindingId}/history`;
    const comparePath = `/api/v2/projects/${projectId}/bindings/${bindingId}/compare`;
    for (const path of [historyPath, comparePath]) {
      expectedApiFailures.push({ method: "GET", path, status: 500 });
      await page.route(`**${path}`, route => route.fulfill({
        status: 500, contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Issue 899 injected query failure" } })
      }));
    }
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${projectId}`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible()) await dismiss.click();
    await page.locator(`[data-binding-id="${bindingId}"]`).getByRole("button", { name: /查看/ }).click();
    const detail = page.getByRole("dialog", { name: /参数详情/ });
    await expect(detail.getByRole("alert")).toHaveCount(2);
    await expect(detail).not.toContainText("暂无历史记录");
    await expect(detail).not.toContainText("暂无其他项目的对比数据");
    await page.screenshot({ path: info.outputPath("query-errors.png"), animations: "disabled" });
    for (const path of [historyPath, comparePath]) await page.unroute(`**${path}`);
    await detail.getByRole("button", { name: "重试历史", exact: true }).click();
    await detail.getByRole("button", { name: "重试对比", exact: true }).click();
    await expect(detail.getByRole("alert")).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "打开跨项目对比" })).toBeVisible();
  });

  test("filters inaccessible project instances and displays real authorization failures", async ({ page, request }, info) => {
    await withPgClient(async client => {
      expect((await client.query(`delete from user_role_bindings where id='issue899-project-b-reader' returning id`)).rowCount).toBe(1);
    });
    try {
      const compared = await request.get(apiRoute(`/api/v2/projects/${projectId}/bindings/${bindingId}/compare`), { headers: authHeadersForRole("software-user") });
      expect(compared.status(), await compared.text()).toBe(200);
      const items = (await compared.json()).items;
      expect(items).toHaveLength(1);
      expect(items[0].projectId).toBe(projectId);
      expect(items[0].bindingId).not.toBe(bindingId);
      for (const query of ["history", "compare"]) {
        const denied = await request.get(apiRoute(`/api/v2/projects/issue899-project-b/bindings/${otherProjectBindingId}/${query}`), { headers: authHeadersForRole("software-user") });
        expect(denied.status(), await denied.text()).toBe(403);
      }
      await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${projectId}`);
      const dismiss = page.getByRole("button", { name: "不再提示" });
      if (await dismiss.isVisible()) await dismiss.click();
      const view = page.locator(`[data-binding-id="${bindingId}"]`).getByRole("button", { name: /查看/ });
      await expect(view).toBeVisible();
      await withPgClient(async client => {
        expect((await client.query(`delete from user_role_bindings where id='issue899-project-a-reader' returning id`)).rowCount).toBe(1);
      });
      try {
        for (const query of ["history", "compare"]) expectedApiFailures.push({ method: "GET", path: `/api/v2/projects/${projectId}/bindings/${bindingId}/${query}`, status: 403 });
        await view.click();
        const detail = page.getByRole("dialog", { name: /参数详情/ });
        await expect(detail.getByRole("alert")).toHaveCount(2);
        await expect(detail.getByRole("alert").first()).toContainText(/权限|无权/);
        await page.screenshot({ path: info.outputPath("query-forbidden.png"), animations: "disabled" });
      } finally {
        await withPgClient(client => client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
          values ('issue899-project-a-reader',$1,'org-chargelab',$2,'software-user')`, [acceptanceCast.liuMin.userId, projectId]));
      }
      await page.getByRole("dialog", { name: /参数详情/ }).getByRole("button", { name: "重试历史", exact: true }).click();
      await page.getByRole("dialog", { name: /参数详情/ }).getByRole("button", { name: "重试对比", exact: true }).click();
      await expect(page.getByRole("dialog", { name: /参数详情/ }).getByRole("alert")).toHaveCount(0);
    } finally {
      await withPgClient(client => client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('issue899-project-b-reader',$1,'org-chargelab','issue899-project-b','software-user')`, [acceptanceCast.liuMin.userId]));
    }
  });
});

test.describe("Issue 899 JSON query regression", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  const projectId = "issue899-json";
  let runtime: DisposablePostCutoverRuntime;
  let bindingId: string;
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("An explicit dedicated PostgreSQL lane is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { label: "issue899_json" });
    applyDisposableRuntimeEnv(runtime);
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      await db.query(`insert into projects(id,organization_id,name,code,status) values ($1,'org-chargelab','Issue 899 JSON','I899JSON','initialized')`, [projectId]);
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('issue899-json-reader',$1,'org-chargelab',$2,'software-user')`, [acceptanceCast.liuMin.userId, projectId]);
      await installConfigurationSourceFixture(db, makeTestAuthContext({ userId: acceptanceCast.xuYun.userId, organizationId: "org-chargelab" }),
        { subjectId: "csub_issue899_json", schemaId: "wiseeff.issue899.settings" });
    } finally { await db.close(); }
    const headers = authHeadersForRole("admin");
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), { headers, data: { name: "default" } });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id;
    const upload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "settings.json", contentBase64: Buffer.from('{"limit":36.5,"keep":true}\n').toString("base64") }
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const file = (await upload.json()).item;
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), { headers, data: { fileId: file.id, role: "base", sortOrder: 0 } });
    expect(member.ok(), await member.text()).toBe(true);
    const registered = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-files/${file.id}/configuration-instances`), {
      headers, data: { configSetId, fileVersionId: file.currentVersionId, configurationSchemaId: "wiseeff.issue899.settings",
        rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }] }
    });
    expect(registered.status(), await registered.text()).toBe(201);
    bindingId = (await registered.json()).items[0].id;
    await withPgClient(async client => {
      expect((await client.query(`select count(*)::int as count from public.project_parameter_bindings where project_id=$1`, [projectId])).rows[0].count).toBe(0);
    });
  });
  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });
  test("keeps canonical JSON detail, history and exact source export", async ({ page, request }, info) => {
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${projectId}`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible()) await dismiss.click();
    await page.getByRole("tab", { name: /JSON 参数/ }).click();
    const table = page.getByRole("table", { name: "JSON 参数列表" });
    await expect(table).toContainText("36.5");
    await withPgClient(async client => {
      const removed = await client.query("delete from user_role_bindings where id='issue899-json-reader'");
      expect(removed.rowCount).toBe(1);
    });
    try {
      for (const operation of ["change-history", "export"]) {
        const denied = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/${operation}`), {
          headers: authHeadersForRole("software-user")
        });
        expect(denied.status(), await denied.text()).toBe(403);
      }
    } finally {
      await withPgClient(client => client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('issue899-json-reader',$1,'org-chargelab',$2,'software-user')`, [acceptanceCast.liuMin.userId, projectId]));
    }
    await table.getByRole("button", { name: /^查看 / }).click();
    const detail = page.getByRole("dialog", { name: /参数详情/ });
    const history = page.waitForResponse(response => response.url().includes(`/parameter-bindings/${bindingId}/change-history`));
    await detail.getByRole("button", { name: "查看固定值历史" }).click();
    expect((await history).status()).toBe(200);
    const exported = page.waitForResponse(response => response.url().includes(`/parameter-bindings/${bindingId}/export`));
    const download = page.waitForEvent("download");
    await detail.getByRole("button", { name: "导出源文件" }).click();
    const exportResponse = await exported;
    expect(exportResponse.status()).toBe(200);
    expect((await exportResponse.json()).item.files[0].content).toBe('{"limit":36.5,"keep":true}\n');
    expect((await download).suggestedFilename()).toBeTruthy();
    await expect(detail.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("json-query-regression.png"), animations: "disabled" });
    await page.reload();
    await page.getByRole("tab", { name: /JSON 参数/ }).click();
    await expect(table).toContainText("36.5");
  });
});
