import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import { expect } from "playwright/test";
import { catalogAppUrl, catalogRuntimeTest as test } from "./helpers/catalogFixtureRuntime";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { readSelectControlOptions, selectControlOption } from "./helpers/selectControl";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { CATALOG_EXPECTED_API_FAILURES, catalogJson, catalogScreenshot, confirmGovernanceDialog } from "./helpers/catalogBrowser";
import { SUBJECT_ID as sourceSubjectId } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler/index";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { apiRoute } from "./helpers/runtime";
import { placementReplacementBundle, PLACEMENT_PEER_SUBJECT_ID as targetSubjectId, PLACEMENT_PEER_COMPATIBLE } from "./helpers/placementReplacementFixture";

test.use({ viewport: { width: 1440, height: 900 }, catalogRuntimeScope: import.meta.url });
useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

const organizationId = "org-chargelab";
const projectId = "placement-replacement-project";
const sourceModuleId = "pmod-placement-source";
const targetModuleId = "pmod-placement-target";
const source = `/dts-v1/;
/ {
  source_driver { compatible = "acme,power"; iin_max = <1000>; };
  target_driver { compatible = "${PLACEMENT_PEER_COMPATIBLE}"; iin_max = <2000>; };
};
`;

// This spec owns a fresh Catalog rather than the OP-08 A-to-F history. Both
// drivers and their definitions stay active, and actual source uploads create
// bindings/values/history for both sides before the browser edits any placement.
test("shares an occupied business category after a stale placement retry without changing values or history", async ({ page, catalogRuntime }, testInfo) => {
  // @acceptance PCAT-UI-07
  // @operation PCAT-REGISTRATION-001
  test.setTimeout(180_000);
  const pool = new pg.Pool({ connectionString: catalogRuntime.databaseUrl });
  const headers = authHeadersForRole("admin");
  const registrationPath = `/api/v2/organizations/${organizationId}/subject-registrations`;
  const json = (method: string, path: string, init: { headers?: Record<string, string>; data?: unknown } = {}) =>
    catalogJson(page.request, method, path, { ...init, headers: { ...headers, ...init.headers } });
  try {
    await pool.query(`insert into public.projects(id,organization_id,name,code,status)
      values ($1,$2,'Placement replacement source project','PLACEMENT-REPLACE','initialized')`, [projectId, organizationId]);
    for (const [id, name, compatible] of [[sourceModuleId, "Source driver", "acme,power"], [targetModuleId, "Power / Battery / Battery Authentication / Replacement driver with a long module path", PLACEMENT_PEER_COMPATIBLE]]) {
      const attributionId = `attr-${id}`;
      await pool.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
        values ($1,$2,'driver-registration',$3,$4)`, [attributionId, organizationId, name, `compatible:${compatible}`]);
      await pool.query(`insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
        values ($1,'physical-device','multiple')`, [attributionId]);
      await pool.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
        values ($1,$2,$3,$1,1,'business','curated')`, [id, organizationId, name]);
    }
    const bundle = placementReplacementBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(`Replacement Catalog did not compile: ${JSON.stringify(compiled.error)}`);
    const installed = await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    const releaseId = compiled.value.release.id;
    const registrations: Array<{ id: string; subjectId: string; placement: { id: string; moduleId: string }; status: string }> = [];
    for (const [subjectId, moduleId] of [[sourceSubjectId, sourceModuleId], [targetSubjectId, targetModuleId]]) {
      const registered = await json("POST", registrationPath, {
        headers: { "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": `placement-fixture-${subjectId}` },
        data: { subjectId, destinationModuleId: moduleId, placement: { mode: "use-default" }, reason: "Replacement source fixture" }
      });
      expect(registered.status, JSON.stringify(registered.body)).toBe(201);
      registrations.push((registered.body as { item: typeof registrations[number] }).item);
    }
    const [current, target] = registrations;
    const config = await page.request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers, data: { name: "default", description: "Actual two-driver replacement source" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id as string;
    const upload = () => page.request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "placement-drivers.dts", contentBase64: Buffer.from(source).toString("base64") }
    });
    const firstUpload = await upload();
    expect(firstUpload.status(), await firstUpload.text()).toBe(201);
    const fileId = (await firstUpload.json()).item.id as string;
    const membership = await page.request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
      headers, data: { fileId, role: "base", sortOrder: 0 }
    });
    expect(membership.ok(), await membership.text()).toBe(true);
    const secondUpload = await upload();
    expect(secondUpload.status(), await secondUpload.text()).toBe(201);
    const byOwner = await pool.query<{ registration_id: string; count: string }>(
      `select registration_id,count(*)::text as count from parameter_catalog.project_parameter_bindings
       where organization_id=$1 and project_id=$2 group by registration_id order by registration_id`, [organizationId, projectId]);
    expect(byOwner.rows).toHaveLength(2);
    for (const registered of registrations) expect(byOwner.rows.find((row) => row.registration_id === registered.id)?.count).toBe("1");
    const snapshot = async () => {
      const result: Record<string, unknown[]> = {};
      for (const table of ["project_parameter_bindings", "project_parameter_values", "binding_history_events", "project_value_source_pins"]) {
        const owner = table === "project_parameter_bindings" ? "item" : "binding";
        const join = table === "project_parameter_bindings" ? "" :
          "join parameter_catalog.project_parameter_bindings binding on binding.id=item.binding_id";
        const rows = await pool.query<{ items: unknown[] }>(
          `select coalesce(jsonb_agg(to_jsonb(item) order by item.id),'[]'::jsonb) as items
           from parameter_catalog.${table} item ${join}
           where ${owner}.organization_id=$1 and ${owner}.project_id=$2`, [organizationId, projectId]);
        result[table] = rows.rows[0].items;
      }
      return result;
    };
    const before = await snapshot();
    for (const rows of Object.values(before)) expect(rows.length).toBeGreaterThan(0);
    const targetBefore = await json("GET", `${registrationPath}/${target.id}`);
    expect(targetBefore.status).toBe(200);
    const impact = (targetBefore.body as { item: { impact: { bindingCount: number } } }).item.impact;
    expect(impact.bindingCount).toBeGreaterThan(0);
    const path = `${registrationPath}/${current.id}/placement`;
    const sourceBefore = await json("GET", path);
    expect(sourceBefore.status).toBe(200);
    await page.addInitScript(() => { Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined }); });
    await signInBrowserAsRole(page, "admin", catalogAppUrl("/parameter-admin/modules?subjectQ=acme%2Cpower"));
    const row = page.locator(`[data-canonical-subject-id="${sourceSubjectId}"]`);
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() === "PATCH" && new URL(request.url()).pathname === path) writes.push(request.url()); });
    await row.getByRole("button", { name: /^编辑主体：/ }).click();
    const dialog = page.getByRole("dialog", { name: /^编辑主体：/ });
    await expect(dialog.getByRole("tab", { name: "识别规则", exact: true })).toHaveAttribute("aria-selected", "true");
    await dialog.getByRole("tab", { name: "归属", exact: true }).click();
    await expect(dialog.getByRole("tab", { name: "归属", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tabpanel", { name: "归属", exact: true })).toBeVisible();
    await expect(dialog.getByRole("tabpanel", { name: "识别规则", exact: true })).not.toBeVisible();
    const options = await readSelectControlOptions(dialog.getByRole("combobox", { name: "目标模块" }));
    expect(options.find((option) => option.value === targetModuleId)?.label).toContain("当前 1 个主体、1 个有效定义");
    await selectControlOption(dialog.getByRole("combobox", { name: "目标模块" }), targetModuleId);
    await expect(dialog.getByRole("region", { name: "替换归属影响" })).toHaveCount(0);
    await expect(dialog.getByText("仅调整归属，不改参数值。")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "继续确认" })).toBeEnabled();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      const layout = await dialog.evaluate((card) => {
        const scroll = card.querySelector<HTMLElement>(".confirm-dialog__scroll")!;
        const bounds = card.getBoundingClientRect();
        return { width: scroll.clientWidth, contentWidth: scroll.scrollWidth,
          top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
      });
      expect(layout.contentWidth).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.bottom).toBeLessThanOrEqual(viewport.height);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(viewport.width);
      await expect(dialog.getByRole("button", { name: "继续确认" })).toBeInViewport();
      await catalogScreenshot(page, testInfo, `placement-replacement-editor-${viewport.width}x${viewport.height}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole("button", { name: "继续确认" }).click();
    const confirmation = page.getByRole("dialog", { name: "确认调整放置", exact: true });
    await expect(confirmation).toContainText("目标模块");
    await confirmation.evaluate(async (card) => {
      const backdrop = card.parentElement ?? card;
      await Promise.all(backdrop.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    await catalogScreenshot(page, testInfo, "placement-replacement-confirmation-1440x900");
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    expect(writes).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
    await pool.query(`update parameter_catalog.subject_placements set updated_at=updated_at + interval '1 microsecond' where id=$1`, [current.placement.id]);
    const changedSource = await json("GET", path);
    expect(changedSource.status).toBe(200);
    await dialog.getByRole("button", { name: "继续确认" }).click();
    const staleResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === path);
    await confirmGovernanceDialog(page, "确认调整放置");
    const stale = await staleResponse;
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { details: { reason: "placement-conflict" } } });
    await expect(dialog.getByRole("alert")).toContainText("输入已保留");
    expect(writes).toHaveLength(1);
    expect(await snapshot()).toEqual(before);
    await expect(dialog.getByRole("combobox", { name: "目标模块" })).toHaveAttribute("data-value", targetModuleId);
    await dialog.getByRole("button", { name: "刷新证据" }).click();
    await dialog.getByRole("button", { name: "继续确认" }).click();
    const confirm = confirmation.getByRole("button", { name: "确认调整放置", exact: true });
    await expect(confirm).toBeDisabled();
    await confirmation.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === path);
    await confirm.press("Enter");
    const response = await saved;
    expect(response.status(), await response.text()).toBe(200);
    expect(response.request().headers()["if-match"]).toBe(changedSource.headers.etag);
    expect(response.request().postDataJSON()).toEqual({ destinationModuleId: targetModuleId, placement: { mode: "use-default" } });
    expect(writes).toHaveLength(2);
    await expect(dialog).toHaveCount(0);
    const sourceAfter = await json("GET", path);
    expect((sourceAfter.body as { item: { id: string; moduleId: string } }).item).toMatchObject({ id: current.placement.id, moduleId: targetModuleId });
    const targetAfter = await json("GET", `${registrationPath}/${target.id}`);
    const retained = (targetAfter.body as { item: { status: string; placement: { id: string; moduleId?: string } } }).item;
    expect(retained.status).toBe(target.status);
    expect(retained.placement.id).toBe(target.placement.id);
    expect(retained.placement.moduleId).toBe(targetModuleId);
    const shared = await pool.query(`select registration_id from parameter_catalog.subject_placements where organization_id=$1 and module_id=$2 order by registration_id`, [organizationId, targetModuleId]);
    expect(shared.rows.map((row) => row.registration_id).sort()).toEqual([current.id, target.id].sort());
    const oldModule = await pool.query(`select id from parameter_catalog.subject_placements where organization_id=$1 and module_id=$2`, [organizationId, sourceModuleId]);
    expect(oldModule.rows).toEqual([]);
    expect(await snapshot()).toEqual(before);
    await page.reload();
    await expect(row.getByRole("button", { name: /^编辑主体：/ })).toBeVisible();
    const reread = await json("GET", `${registrationPath}/${target.id}/placement`);
    expect((reread.body as { item: { moduleId?: string } }).item.moduleId).toBe(targetModuleId);
    await catalogScreenshot(page, testInfo, "placement-replacement-persisted-1440x900");
  } finally {
    await pool.end();
  }
});
