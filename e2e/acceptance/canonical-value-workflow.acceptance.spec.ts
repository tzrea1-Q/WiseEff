import "./helpers/loadAcceptanceEnvironment";
import { createHash } from "node:crypto";
import pg from "pg";
import { expect, test, type APIRequestContext } from "playwright/test";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler/index";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { firstReleaseBundle } from "../../server/testing/parameterCatalog/cutoverPopulatedFixture";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { catalogBindingExportResponseSchema } from "../../server/modules/contracts/dtoSchemas/parameterCatalog";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import {
  startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime
} from "./helpers/disposablePostCutoverRuntime";
import {
  captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime
} from "./helpers/semanticBindingFixture";

const expectedApiFailures: ExpectedApiFailure[] = [];
useBrowserDiagnostics(test, { expectedApiFailures });
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
const projectId = "canonical-review-local";
const organizationId = "org-chargelab";
const source = `/dts-v1/;
/ {
  charger {
    compatible = "acme,power";
    iin_max = <1000>;
  };
};
`;

async function assertDeletedSourceGraph(input: {
  request: APIRequestContext; projectId: string; bindingId: string; requestId: string; previousValueId: string; format: "dts" | "json";
}) {
  const row = await withPgClient(async (client) => {
    const result = await client.query(`select binding.id as binding_id, file.id as file_id, file.current_version_id,
        value.id as value_id, value.value_state, value.value_digest, value.config_revision_id,
        pin.id as pin_id, pin.locator, pin.delete_proof, base_pin.id as base_pin_id, base_pin.project_value_id as before_value_id,
        base_value.value_digest as before_value_digest, old_version.checksum as before_checksum,
        new_version.checksum as after_checksum, request.applied_source_result,
        request.applied_audit_ref, request.applied_history_event_id, audit.kind as audit_kind
      from project_parameter_value_change_requests request
      join parameter_catalog.project_parameter_bindings binding on binding.id=request.binding_id
        and binding.organization_id=request.organization_id and binding.project_id=request.project_id
      join parameter_catalog.project_parameter_values value on value.id=request.applied_value_id
        and value.binding_id=binding.id and binding.current_value_id=value.id
      join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id
        and pin.binding_id=binding.id and pin.delete_request_id=request.id
        and pin.organization_id=binding.organization_id and pin.project_id=binding.project_id
        and pin.config_revision_id=value.config_revision_id
      join parameter_catalog.project_value_source_pins base_pin on base_pin.id=pin.base_source_pin_id
        and base_pin.id=request.source_pin_id and base_pin.binding_id=binding.id
        and base_pin.project_value_id=request.base_current_value_id
      join parameter_catalog.project_parameter_values base_value on base_value.id=base_pin.project_value_id
      join project_parameter_file_versions old_version on old_version.id=base_pin.file_version_id
      join project_parameter_file_versions new_version on new_version.id=pin.file_version_id
      join project_parameter_files file on file.id=pin.file_id and file.current_version_id=pin.file_version_id
      join audit_events audit on audit.id=request.applied_audit_ref
      join parameter_catalog.binding_history_events history on history.id=request.applied_history_event_id
        and history.binding_id=binding.id and history.old_current_value_id=base_value.id
        and history.new_current_value_id=value.id and history.success_audit_ref=audit.id
      where request.id=$1 and binding.id=$2 and request.project_id=$3 and request.organization_id=$4
        and request.status='approved' and request.action='delete'`,
    [input.requestId, input.bindingId, input.projectId, organizationId]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  });
  expect(row.value_state).toBe("deleted");
  expect(row.before_value_id).toBe(input.previousValueId);
  expect(row.value_id).not.toBe(input.previousValueId);
  expect(row.value_digest).toBe(row.before_value_digest);
  expect(row.locator.kind).toBe(`${input.format}-delete`);
  const digest = (checksum: string) => `sha256:${checksum.replace(/^sha256:/, "")}`;
  expect(row.delete_proof).toMatchObject({
    kind: `${input.format}-delete-v1`, beforeValueDigest: row.before_value_digest,
    beforeSourceDigest: digest(row.before_checksum), afterSourceDigest: digest(row.after_checksum),
  });
  expect(row.applied_source_result.bindings).toContainEqual(expect.objectContaining({
    kind: "target", bindingId: input.bindingId, oldValueId: input.previousValueId, newValueId: row.value_id,
    sourcePinId: row.pin_id, configRevisionId: row.config_revision_id, fileVersionId: row.current_version_id,
    historyEventId: row.applied_history_event_id, action: "delete", valueState: "deleted",
  }));
  const exported = await input.request.get(apiRoute(
    `/api/v2/projects/${input.projectId}/parameter-bindings/${input.bindingId}/export?projectValueId=${row.value_id}`
  ), { headers: authHeadersForRole("software-user") });
  expect(exported.status(), await exported.text()).toBe(200);
  const { item } = catalogBindingExportResponseSchema.parse(await exported.json());
  expect(item.valueState).toBe("deleted");
  expect(item.manifest).toMatchObject({
    sourcePinId: row.pin_id, projectValueId: row.value_id, fileVersionId: row.current_version_id,
    locator: row.locator, deleteProof: row.delete_proof, deleteRequestId: input.requestId, baseSourcePinId: row.base_pin_id,
  });
  if (input.format === "dts") {
    expect(row.locator).toEqual({ kind: "dts-delete", nodeOccurrenceId: expect.any(String),
      fileVersionId: row.current_version_id, propertyName: "iin_max" });
    expect(row.delete_proof).toMatchObject({ nodeOccurrenceId: row.locator.nodeOccurrenceId, propertyName: "iin_max" });
  }
  return row;
}

test.describe("canonical value workflow on real sources", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  let runtime: DisposablePostCutoverRuntime;
  let bindingId: string;
  let initialValueId: string;
  let sourceFileId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("Explicit disposable-runtime parent DATABASE_URL is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, {
      label: "canonical_value_workflow", apiEnv: { LOG_ANALYSIS_DETERMINISTIC: "true" },
    });
    applyDisposableRuntimeEnv(runtime);
    // Fixture-only setup stays in this owned database. Catalog installation is
    // explicit; normal runtime startup and reads never install a fixture release.
    await withPgClient(async (client) => {
      await client.query(`insert into projects(id,organization_id,name,code,status)
        values ($1,$2,'Canonical review local','CLOCAL','initialized')`, [projectId, organizationId]);
      for (const [userId, roleId] of [
        [acceptanceCast.liuMin.userId, "software-user"],
        [acceptanceCast.sunMei.userId, "software-committer"]
      ]) {
        await client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
          values ($1,$2,$3,$4,$5)`, [`local-${userId}`, userId, organizationId, projectId, roleId]);
      }
      await client.query(`insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
        values ('attr-local-acme',$1,'driver-registration','Acme power','compatible:acme,power')`, [organizationId]);
      await client.query(`insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
        values ('attr-local-acme','physical-device','multiple')`);
      await client.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
        values ('pmod-local-acme',$1,'Acme power','pmod-local-acme',1,'driver-group','curated','attr-local-acme')`, [organizationId]);
    });
    const bundle = firstReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error("Reviewed first-release fixture did not compile");
    const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
    try {
      const installed = await installPublishedRelease(pool, {
        mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest
      });
      expect(installed.ok, JSON.stringify(installed)).toBe(true);
    } finally {
      await pool.end();
    }
    const headers = authHeadersForRole("admin");
    const registration = await request.post(apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`), {
      headers: { ...headers, "X-WiseEff-Catalog-Release": compiled.value.release.id, "Idempotency-Key": "local-acme-registration" },
      data: { subjectId: "csub_acme_power", placement: { mode: "use-default" }, reason: "Local canonical workflow fixture" }
    });
    expect(registration.status(), await registration.text()).toBe(201);
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers, data: { name: "default", description: "Local canonical workflow" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id as string;
    const upload = () => request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "charger.dts", contentBase64: Buffer.from(source).toString("base64") }
    });
    const first = await upload();
    expect(first.status(), await first.text()).toBe(201);
    const fileId = (await first.json()).item.id as string;
    sourceFileId = fileId;
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
      headers, data: { fileId, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const second = await upload();
    expect(second.status(), await second.text()).toBe(201);
    const rows = await bindings(request);
    expect(rows).toHaveLength(1);
    bindingId = rows[0].id;
    initialValueId = rows[0].currentValueId;
    await withPgClient(async (client) => {
      expect((await client.query(`select id from project_parameter_bindings where project_id=$1`, [projectId])).rows).toEqual([]);
      expect((await client.query(`select id from parameter_submission_rounds where project_id=$1`, [projectId])).rows).toEqual([]);
      await client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('tracking-nonowner',$1,$2,$3,'hardware-user')`, [acceptanceCast.zhaoHeng.userId, organizationId, projectId]);
      await client.query(`insert into organizations(id,name) values ('tracking-foreign-org','Tracking foreign tenant')`);
      await client.query(`insert into projects(id,organization_id,name,code,status)
        values ('tracking-foreign-project','tracking-foreign-org','Foreign','TRACKFOREIGN','initialized')`);
      await client.query(`insert into users(id,organization_id,name,email,title)
        values ('tracking-scoped-user',$1,'Tracking scoped','tracking-scoped@example.test','Software')`, [organizationId]);
      await client.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('tracking-scoped-role','tracking-scoped-user',$1,$2,'software-user')`, [organizationId, projectId]);
    });
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  async function bindings(request: APIRequestContext) {
    const response = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
      headers: authHeadersForRole("software-user")
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).items as Array<{ id: string; currentValueId: string; rawValue: string }>;
  }

  test("creates and removes a draft, selects a software reviewer, withdraws, rejects and resubmits for approval", async ({ page, request }, info) => {
    // @acceptance PARAM-CANONICAL-VALUE-WORKFLOW-001
    // @operation PARAM-CANONICAL-VALUE-WORKFLOW-001
    test.setTimeout(180_000);
    const openParameters = async () => {
      await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${projectId}`);
      const dismiss = page.getByRole("button", { name: "不再提示" });
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
      await expect(page.getByRole("region", { name: "DTS 参数工作台" })).toBeVisible();
    };
    const createDraft = async (action: "set" | "delete" = "set") => {
      const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
      await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("iin_max");
      await workspace.locator(`[data-binding-id="${bindingId}"]`).getByRole("button", { name: /^(编辑|继续编辑) iin_max/ }).click();
      const dialog = page.getByRole("dialog", { name: "修改草稿" });
      if (action === "delete") {
        await dialog.getByRole("button", { name: "删除属性", exact: true }).click();
        await expect(dialog.getByLabel("目标值", { exact: true })).toHaveCount(0);
        await expect(dialog).toContainText("批准后生效");
      } else {
        await dialog.getByLabel("目标值", { exact: true }).fill("<1200>");
      }
      await dialog.getByLabel("修改原因", { exact: true }).fill("Local canonical source review");
      const created = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/parameter-bindings/${bindingId}/drafts`));
      await dialog.getByRole("button", { name: "校验并加入本轮" }).click();
      const response = await created;
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).item.draftId as string;
    };
    const submit = async (expectedValueId = initialValueId) => {
      const panel = page.getByRole("region", { name: "参数修改提交" });
      await expect(panel.getByLabel("硬件 MDE", { exact: true })).toHaveCount(0);
      await expect(panel.getByLabel("软件开发", { exact: true })).toHaveCount(0);
      await panel.getByLabel("软件 MDE", { exact: true }).selectOption(acceptanceCast.sunMei.userId);
      const submitted = page.waitForResponse(r => r.request().method() === "POST" && /parameter-value-drafts\/[^/]+\/submit$/.test(r.url()));
      await panel.getByRole("button", { name: /提交/ }).click();
      const response = await submitted;
      expect(response.ok(), await response.text()).toBe(true);
      const item = (await response.json()).item;
      expect(item.assignedToUserId).toBe(acceptanceCast.sunMei.userId);
      expect((await bindings(request))[0].currentValueId).toBe(expectedValueId);
      return item.id as string;
    };
    const openReview = async (role: "software-user" | "software-committer") => {
      await signInBrowserAsRole(page, role, `${runtime.frontendUrl}/parameter-review?project=${projectId}`);
      await expect(page.getByRole("combobox", { name: "项目", exact: true })).toContainText("Canonical review local");
      return page.getByRole("region", { name: "软件配置审核" });
    };
    await openParameters();
    const removedDraft = await createDraft();
    const deleted = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().endsWith(`/parameter-value-drafts/${removedDraft}`));
    await page.getByRole("button", { name: "移出本轮修改" }).click();
    expect((await deleted).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "本轮已修改" })).toHaveCount(0);
    await createDraft();
    const withdrawnId = await submit();
    const reloadedDrafts = page.waitForResponse(r => r.request().method() === "GET"
      && r.url().endsWith(`/projects/${projectId}/parameter-value-drafts`));
    await page.reload();
    const draftsResponse = await reloadedDrafts;
    expect(draftsResponse.ok(), await draftsResponse.text()).toBe(true);
    expect((await draftsResponse.json()).items).toEqual([]);
    await expect(page.getByRole("region", { name: "参数修改提交" })).toHaveCount(0);
    let review = await openReview("software-user");
    await expect(review.getByRole("button", { name: "批准软件配置" })).toHaveCount(0);
    const withdrawn = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/withdraw"));
    await review.getByRole("button", { name: "撤回我的提交" }).click();
    expect((await withdrawn).ok()).toBe(true);
    const assertTracking = async (requestId: string, status: string) => {
      const listed = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-value-change-requests?mine=true`), {
        headers: authHeadersForRole("software-user")
      });
      expect(listed.status(), await listed.text()).toBe(200);
      expect((await listed.json()).items).toContainEqual(expect.objectContaining({ id: requestId, status, submitterUserId: acceptanceCast.liuMin.userId }));
      await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameter-submissions?project=${projectId}&request=${requestId}`);
      await expect(page.getByRole("combobox", { name: "项目", exact: true })).toContainText("Canonical review local");
      await expect(page.getByText(requestId, { exact: true }).first()).toBeVisible();
      await expect(page.getByLabel("固定源变更前")).toBeVisible();
      await page.reload();
      await expect(page.getByText(requestId, { exact: true }).first()).toBeVisible();
      await expect(page.getByLabel("固定源变更前")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`tracking-${status}.png`), animations: "disabled" });
    };
    await assertTracking(withdrawnId, "withdrawn");
    await openParameters();
    const rejectedId = await submit();
    review = await openReview("software-committer");
    const rejected = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/review"));
    await review.getByRole("button", { name: "驳回", exact: true }).click();
    expect((await rejected).ok()).toBe(true);
    await assertTracking(rejectedId, "rejected");
    await openParameters();
    const approvedId = await submit();
    const nonownerHeaders = authHeadersForUser(acceptanceCast.zhaoHeng.userId, acceptanceCast.zhaoHeng.email, acceptanceCast.zhaoHeng.name);
    const nonowner = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-value-change-requests`), { headers: nonownerHeaders });
    expect(nonowner.status(), await nonowner.text()).toBe(200);
    expect((await nonowner.json()).items).toEqual([]);
    const hiddenDiff = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-value-change-requests/${approvedId}/source-diff`), { headers: nonownerHeaders });
    expect(hiddenDiff.status()).toBe(404);
    const crossProject = await request.get(apiRoute(`/api/v2/projects/aurora/parameter-value-change-requests/${approvedId}/source-diff`), { headers: authHeadersForRole("software-user") });
    expect(crossProject.status()).toBe(404);
    const foreign = await request.get(apiRoute("/api/v2/projects/tracking-foreign-project/parameter-value-change-requests?mine=true"), { headers: authHeadersForRole("admin") });
    expect(foreign.status()).toBe(404);
    const outsideScope = await request.get(apiRoute("/api/v2/projects/aurora/parameter-value-change-requests?mine=true"), {
      headers: authHeadersForUser("tracking-scoped-user", "tracking-scoped@example.test", "Tracking scoped")
    });
    expect(outsideScope.status()).toBe(403);
    review = await openReview("software-committer");
    await expect(review.getByLabel("固定源变更后")).toContainText("1200");
    await page.screenshot({ path: info.outputPath("canonical-software-review.png"), animations: "disabled" });
    const approved = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/review"));
    await review.getByRole("button", { name: "批准软件配置" }).click();
    const response = await approved;
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json()).item.status).toBe("approved");
    await assertTracking(approvedId, "approved");
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameter-submissions?project=${projectId}&request=missing-request`);
    await expect(page.getByRole("alert").filter({ hasText: /失效|不存在|不可用|无权/ })).toBeVisible();
    await expect(page.getByLabel("固定源变更前")).toHaveCount(0);
    await page.getByRole("combobox", { name: "项目", exact: true }).click();
    await page.getByRole("option", { name: /Aurora disposable/ }).click();
    await expect(page).toHaveURL(/parameter-submissions\?project=aurora$/);
    await expect(page.getByLabel("固定源变更前")).toHaveCount(0);
    const approvedBinding = (await bindings(request))[0];
    expect(approvedBinding).toMatchObject({ id: bindingId, rawValue: "<1200>" });
    expect(approvedBinding.currentValueId).not.toBe(initialValueId);
    const exported = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/export`), {
      headers: authHeadersForRole("software-user")
    });
    expect(exported.status(), await exported.text()).toBe(200);
    expect((await exported.json()).item).toMatchObject({
      bindingId, currentValueId: approvedBinding.currentValueId,
      files: [expect.objectContaining({ name: "charger.dts", content: source.replace("<1000>", "<1200>") })]
    });
    // Leave the app before the deliberate outage so its background auth polling
    // cannot race the stopped API. Reopen only after restart readiness succeeds.
    await page.goto("about:blank");
    const restart = await runtime.restartApi();
    await info.attach("api-restart-process-identities", {
      body: JSON.stringify({
        previous: restart.previousProcessIdentity,
        replacement: restart.replacementProcessIdentity,
      }, null, 2),
      contentType: "application/json",
    });
    expect(restart.replacementProcessIdentity.port).toBe(restart.previousProcessIdentity.port);
    expect(
      restart.replacementProcessIdentity.pid !== restart.previousProcessIdentity.pid ||
      restart.replacementProcessIdentity.startToken !== restart.previousProcessIdentity.startToken ||
      restart.replacementProcessIdentity.commandSha256 !== restart.previousProcessIdentity.commandSha256,
    ).toBe(true);
    expect(restart.previousProcessIdentity.commandSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(restart.replacementProcessIdentity.commandSha256).toMatch(/^[a-f0-9]{64}$/);
    const afterRestartBinding = (await bindings(request))[0];
    expect(afterRestartBinding).toEqual(approvedBinding);
    await assertTracking(approvedId, "approved");
    const exportedAfterRestart = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/export`), {
      headers: authHeadersForRole("software-user")
    });
    expect(exportedAfterRestart.status(), await exportedAfterRestart.text()).toBe(200);
    expect((await exportedAfterRestart.json()).item).toMatchObject({
      bindingId,
      currentValueId: approvedBinding.currentValueId,
      files: [expect.objectContaining({ name: "charger.dts", content: source.replace("<1000>", "<1200>") })]
    });
    await openReview("software-committer");
    await page.getByRole("tab", { name: "历史", exact: true }).click();
    await expect(page.getByRole("table", { name: "软件配置审核请求" })).toContainText("已批准");
    await openParameters();
    await createDraft("delete");
    const deletionRequestId = await submit(approvedBinding.currentValueId);
    review = await openReview("software-committer");
    await expect(review.getByLabel("固定源变更后")).toContainText("/delete-property/ iin_max");
    await page.screenshot({ path: info.outputPath("canonical-delete-review.png"), animations: "disabled" });
    const deletionApproved = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/${deletionRequestId}/review`));
    await review.getByRole("button", { name: "批准软件配置" }).click();
    const deletionResponse = await deletionApproved;
    expect(deletionResponse.ok(), await deletionResponse.text()).toBe(true);
    expect((await deletionResponse.json()).item).toMatchObject({ status: "approved", action: "delete" });
    expect(await bindings(request)).toEqual([]);
    const deletionProof = await assertDeletedSourceGraph({
      request, projectId, bindingId, requestId: deletionRequestId, previousValueId: approvedBinding.currentValueId, format: "dts",
    });
    expect(deletionProof.binding_id).toBe(bindingId);
    const sourceAfterDelete = await request.get(apiRoute(
      `/api/v1/projects/${projectId}/parameter-files/${sourceFileId}/versions/${deletionProof.current_version_id}/content`
    ), { headers: authHeadersForRole("software-user") });
    expect(sourceAfterDelete.status(), await sourceAfterDelete.text()).toBe(200);
    expect(await sourceAfterDelete.text()).toBe(source.replace("iin_max = <1000>;", "/delete-property/ iin_max;"));
    expect(createHash("sha256").update(await sourceAfterDelete.body()).digest("hex"))
      .toBe(deletionProof.after_checksum.replace(/^sha256:/, ""));
    const historicalExport = await request.get(apiRoute(
      `/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/export?projectValueId=${approvedBinding.currentValueId}`
    ), { headers: authHeadersForRole("software-user") });
    expect(historicalExport.status(), await historicalExport.text()).toBe(200);
    expect((await historicalExport.json()).item.files[0].content).toBe(source.replace("<1000>", "<1200>"));
    await page.goto("about:blank");
    await runtime.restartApi();
    expect(await bindings(request)).toEqual([]);
    await openParameters();
    await expect(page.locator(`[data-binding-id="${bindingId}"]`)).toHaveCount(0);
    await openReview("software-committer");
    await page.getByRole("tab", { name: "历史", exact: true }).click();
    await expect(page.getByRole("table", { name: "软件配置审核请求" })).toContainText("已批准");
    await recordOperationEvidence({
      operationId: "PARAM-CANONICAL-VALUE-WORKFLOW-001",
      title: "Canonical single-stage edit and delete preserve source history across restart",
      status: "passed", page, testInfo: info,
      assertions: ["ui", "api", "db", "audit"],
      api: [summarizeApiResponse(deletionResponse, {
        method: "POST", path: `/api/v2/projects/${projectId}/parameter-value-change-requests/${deletionRequestId}/review`,
        responseSummary: "Independent software approval applied the reviewed property deletion; current list stays empty after restart"
      })],
      db: [{ table: "parameter_catalog.project_parameter_bindings", predicate: `id=${bindingId}`,
        observed: "Original binding retained; applied deletion has history and audit; historical source export unchanged", rowCount: 1 }],
      audit: [{ id: deletionProof.applied_audit_ref, kind: deletionProof.audit_kind, targetId: deletionRequestId }],
      notes: "Focused canonical workflow evidence; ordinary topology, compiler, identity-mapping and publish gates remain separate."
    });
    await page.getByRole("combobox", { name: "项目", exact: true }).click();
    await page.getByRole("option", { name: /Aurora disposable/ }).click();
    await expect(page).toHaveURL(/parameter-review\?project=aurora$/);
    await expect(page.getByRole("region", { name: "软件配置审核" })).toContainText("当前没有待审核源文件请求");
  });
});

test.describe("canonical JSON deletion on a real source", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  const jsonProjectId = "canonical-json-local";
  const jsonSource = '{ "a/b": { "": 36.5, "keep": true }, "untouched": [1,2] }\n';
  let runtime: DisposablePostCutoverRuntime;
  let bindingId: string;
  let originalValueId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("Explicit disposable-runtime parent DATABASE_URL is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, {
      label: "canonical_json_workflow", apiEnv: { LOG_ANALYSIS_DETERMINISTIC: "true" },
    });
    applyDisposableRuntimeEnv(runtime);
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      await db.query(`insert into projects(id,organization_id,name,code,status)
        values ($1,$2,'Canonical JSON local','JLOCAL','initialized')`, [jsonProjectId, organizationId]);
      for (const [userId, roleId] of [
        [acceptanceCast.liuMin.userId, "software-user"],
        [acceptanceCast.sunMei.userId, "software-committer"]
      ]) {
        await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
          values ($1,$2,$3,$4,$5)`, [`json-local-${userId}`, userId, organizationId, jsonProjectId, roleId]);
      }
      // Explicit Catalog fixture setup; source registration and all product mutations use HTTP/UI.
      await installConfigurationSourceFixture(db, makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId, organizationId,
      }), { subjectId: "csub_local_json", schemaId: "wiseeff.local.settings" });
    } finally { await db.close(); }
    const headers = authHeadersForRole("admin");
    const config = await request.post(apiRoute(`/api/v1/projects/${jsonProjectId}/config-sets`), {
      headers, data: { name: "default", description: "Local canonical JSON workflow" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id as string;
    const upload = await request.post(apiRoute(`/api/v1/projects/${jsonProjectId}/parameter-files`), {
      headers, data: { fileName: "settings.json", contentBase64: Buffer.from(jsonSource).toString("base64") }
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const file = (await upload.json()).item;
    const member = await request.post(apiRoute(`/api/v1/projects/${jsonProjectId}/config-sets/${configSetId}/files`), {
      headers, data: { fileId: file.id, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const registered = await request.post(apiRoute(
      `/api/v2/projects/${jsonProjectId}/parameter-files/${file.id}/configuration-instances`
    ), {
      headers, data: {
        configSetId, fileVersionId: file.currentVersionId, configurationSchemaId: "wiseeff.local.settings",
        rootPointer: "/a~1b", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/a~1b/" }]
      }
    });
    expect(registered.status(), await registered.text()).toBe(201);
    const [binding] = (await registered.json()).items;
    bindingId = binding.id;
    originalValueId = binding.currentValueId;
    expectedApiFailures.push({ method: "POST", path: `/api/v2/projects/${jsonProjectId}/parameter-bindings/${bindingId}/drafts`, status: 400 });
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  test("deletes an escaped and empty JSON member through independent software review", async ({ page, request }, info) => {
    test.setTimeout(180_000);
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${jsonProjectId}`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    const panel = page.getByRole("region", { name: "JSON 参数", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByLabel("修改原因", { exact: true }).fill("Remove obsolete JSON member");
    await panel.getByLabel("目标值", { exact: true }).fill("not-json");
    const invalidEdit = page.waitForResponse(r => r.request().method() === "POST"
      && r.url().endsWith(`/parameter-bindings/${bindingId}/drafts`));
    await panel.getByRole("button", { name: "校验并创建草稿", exact: true }).click();
    const invalidResponse = await invalidEdit;
    expect(invalidResponse.status(), await invalidResponse.text()).toBe(400);
    await expect(panel.getByRole("alert")).toContainText("目标值未通过校验");
    await expect(page.getByRole("region", { name: "参数修改提交" })).toHaveCount(0);
    const created = page.waitForResponse(r => r.request().method() === "POST"
      && r.url().endsWith(`/parameter-bindings/${bindingId}/drafts`));
    await panel.getByRole("button", { name: "创建删除草稿", exact: true }).click();
    const draftResponse = await created;
    expect(draftResponse.status(), await draftResponse.text()).toBe(201);
    const draftId = (await draftResponse.json()).item.draftId as string;
    const persistedDrafts = await request.get(apiRoute(`/api/v2/projects/${jsonProjectId}/parameter-value-drafts`), {
      headers: authHeadersForRole("software-user")
    });
    expect(persistedDrafts.status(), await persistedDrafts.text()).toBe(200);
    expect((await persistedDrafts.json()).items).toContainEqual(expect.objectContaining({
      id: draftId, action: "delete", sourceFormat: "json"
    }));
    // Reload exercises persisted DTO hydration: deletion has no target from which to infer its format.
    await page.reload();
    const submission = page.getByRole("region", { name: "参数修改提交" });
    await expect(submission).toContainText("删除属性");
    await submission.getByLabel("软件 MDE", { exact: true }).selectOption(acceptanceCast.sunMei.userId);
    const submitted = page.waitForResponse(r => r.request().method() === "POST" && /parameter-value-drafts\/[^/]+\/submit$/.test(r.url()));
    await submission.getByRole("button", { name: /提交/ }).click();
    const submissionResponse = await submitted;
    expect(submissionResponse.ok(), await submissionResponse.text()).toBe(true);
    const requestId = (await submissionResponse.json()).item.id as string;
    const currentBeforeApproval = await request.get(apiRoute(`/api/v2/projects/${jsonProjectId}/parameter-bindings`), {
      headers: authHeadersForRole("software-user")
    });
    expect(currentBeforeApproval.status(), await currentBeforeApproval.text()).toBe(200);
    expect((await currentBeforeApproval.json()).items).toEqual([
      expect.objectContaining({ id: bindingId, currentValueId: originalValueId, effectiveValue: { kind: "json", value: 36.5 } })
    ]);
    await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=${jsonProjectId}`);
    const review = page.getByRole("region", { name: "软件配置审核" });
    await expect(review.getByLabel("固定源变更前")).toContainText('"": 36.5');
    const after = review.getByLabel("固定源变更后");
    await expect(after).not.toContainText('"":');
    await expect(after).toContainText('"keep": true');
    await page.screenshot({ path: info.outputPath("canonical-json-delete-review.png"), animations: "disabled" });
    const approved = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/${requestId}/review`));
    await review.getByRole("button", { name: "批准软件配置" }).click();
    const approvedResponse = await approved;
    expect(approvedResponse.ok(), await approvedResponse.text()).toBe(true);
    expect((await approvedResponse.json()).item).toMatchObject({ status: "approved", action: "delete", sourceFormat: "json" });
    const proof = await assertDeletedSourceGraph({
      request, projectId: jsonProjectId, bindingId, requestId, previousValueId: originalValueId, format: "json",
    });
    expect(proof.locator).toMatchObject({ rootPointer: "/a~1b", pointer: "/a~1b/", parentPointer: "/a~1b", memberKey: "" });
    await page.goto("about:blank");
    await runtime.restartApi();
    const committedSource = await request.get(apiRoute(
      `/api/v1/projects/${jsonProjectId}/parameter-files/${proof.file_id}/versions/${proof.current_version_id}/content`
    ), { headers: authHeadersForRole("software-user") });
    expect(committedSource.status(), await committedSource.text()).toBe(200);
    const committedText = await committedSource.text();
    expect(committedText).toBe('{ "a/b": {  "keep": true }, "untouched": [1,2] }\n');
    expect(createHash("sha256").update(await committedSource.body()).digest("hex"))
      .toBe(proof.after_checksum.replace(/^sha256:/, ""));
    expect(JSON.parse(committedText)).toEqual({ "a/b": { keep: true }, untouched: [1, 2] });
    expect(Object.hasOwn(JSON.parse(committedText)["a/b"], "")).toBe(false);
    const current = await request.get(apiRoute(`/api/v2/projects/${jsonProjectId}/parameter-bindings`), {
      headers: authHeadersForRole("software-user")
    });
    expect(current.status(), await current.text()).toBe(200);
    expect((await current.json()).items).toEqual([]);
    const historical = await request.get(apiRoute(
      `/api/v2/projects/${jsonProjectId}/parameter-bindings/${bindingId}/export?projectValueId=${originalValueId}`
    ), { headers: authHeadersForRole("software-user") });
    expect(historical.status(), await historical.text()).toBe(200);
    expect((await historical.json()).item.files[0].content).toBe(jsonSource);
    await signInBrowserAsRole(page, "software-user", `${runtime.frontendUrl}/parameters?project=${jsonProjectId}`);
    await expect(page.getByRole("region", { name: "DTS 参数工作台" })).toBeVisible();
    await expect(page.getByRole("region", { name: "JSON 参数", exact: true })).toHaveCount(0);
  });
});
