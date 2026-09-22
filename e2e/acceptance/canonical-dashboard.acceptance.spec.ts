import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type APIRequestContext } from "playwright/test";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime
} from "./helpers/disposablePostCutoverRuntime";
import {
  captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime
} from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

test.describe("canonical dashboard lifecycle on a real API", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  const projectId = "canonical-dashboard-local";
  const organizationId = "org-chargelab";
  let runtime: DisposablePostCutoverRuntime;
  let bindingId: string;
  let releaseId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("Explicit disposable-runtime parent DATABASE_URL is required");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, {
      label: "issue900_dashboard", apiEnv: { LOG_ANALYSIS_DETERMINISTIC: "true" }
    });
    applyDisposableRuntimeEnv(runtime);
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      await db.query(`insert into projects(id,organization_id,name,code,status)
        values ($1,$2,'Canonical dashboard local','DHLOCAL','initialized')`, [projectId, organizationId]);
      await db.query(`insert into projects(id,organization_id,name,code,status)
        values ('dashboard-private',$1,'Private dashboard project','DHPRIVATE','initialized')`, [organizationId]);
      await db.query(`insert into organizations(id,name) values ('dashboard-foreign-org','Foreign dashboard tenant')`);
      await db.query(`insert into projects(id,organization_id,name,code,status)
        values ('dashboard-foreign','dashboard-foreign-org','Foreign dashboard project','DHFOREIGN','initialized')`);
      for (const [userId, roleId] of [
        [acceptanceCast.liuMin.userId, "software-user"],
        [acceptanceCast.sunMei.userId, "software-committer"]
      ]) {
        await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
          values ($1,$2,$3,$4,$5)`, [`dashboard-${userId}`, userId, organizationId, projectId, roleId]);
      }
      // Explicit local fixture installation. All lifecycle mutations below use the real HTTP owners.
      await installConfigurationSourceFixture(db, makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId, organizationId
      }), { subjectId: "csub_dashboard_json", schemaId: "wiseeff.dashboard.settings" });
    } finally { await db.close(); }
    const headers = authHeadersForRole("admin");
    const config = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers, data: { name: "default", description: "Dashboard lifecycle evidence" }
    });
    expect(config.status(), await config.text()).toBe(201);
    const configSetId = (await config.json()).item.id as string;
    const upload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
      headers, data: { fileName: "settings.json", contentBase64: Buffer.from('{"settings":{"value":36.5},"untouched":true}\n').toString("base64") }
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const file = (await upload.json()).item;
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
      headers, data: { fileId: file.id, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const registered = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-files/${file.id}/configuration-instances`), {
      headers, data: {
        configSetId, fileVersionId: file.currentVersionId, configurationSchemaId: "wiseeff.dashboard.settings",
        rootPointer: "/settings", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/settings/value" }]
      }
    });
    expect(registered.status(), await registered.text()).toBe(201);
    bindingId = (await registered.json()).items[0].id;
    releaseId = (await exported(request)).catalogReleaseId;
    const proofDb = createPostgresDatabase(runtime.databaseUrl);
    try {
      expect((await proofDb.query(`select id from project_parameter_bindings where project_id=$1`, [projectId])).rows).toEqual([]);
      expect((await proofDb.query(`select id from parameter_submission_rounds where project_id=$1`, [projectId])).rows).toEqual([]);
    } finally { await proofDb.close(); }
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  async function exported(request: APIRequestContext) {
    const response = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/export`), {
      headers: authHeadersForRole("software-user")
    });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).item;
  }

  async function assertCounts(request: APIRequestContext, active: number, drafts: number, review: number) {
    const listed = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers: authHeadersForRole("software-user") });
    expect(listed.status(), await listed.text()).toBe(200);
    expect((await listed.json()).items).toHaveLength(active);
    const draftList = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-value-drafts`), { headers: authHeadersForRole("software-user") });
    expect(draftList.status(), await draftList.text()).toBe(200);
    expect((await draftList.json()).items).toHaveLength(drafts);
    const reviewList = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-value-change-requests?status=pending`), {
      headers: authHeadersForRole("software-committer")
    });
    expect(reviewList.status(), await reviewList.text()).toBe(200);
    expect((await reviewList.json()).items).toHaveLength(review);
    for (const role of ["software-user", "software-committer"] as const) {
      const response = await request.get(apiRoute(`/api/v1/parameters/dashboard/summary?projectId=${projectId}&window=30d&perspectiveRoleId=${role}`), {
        headers: authHeadersForRole(role)
      });
      expect(response.status(), await response.text()).toBe(200);
      const summary = (await response.json()).item;
      expect(summary.kpis.totalParameters).toBe(active);
      expect(summary.kpis.totalBindings).toBe(active);
      expect(summary.kpis.totalDefinitions).toBe(active);
      expect(summary.kpis.highRiskParameters).toBeNull();
      expect(summary.kpis.riskAvailability).toBe("unavailable");
      expect(summary.workbenchSignals.myDrafts).toBe(role === "software-user" ? drafts : 0);
      expect(summary.workbenchSignals.reviewQueue).toBe(role === "software-committer" ? review : 0);
      expect(summary.workbenchSignals.waitingMerge).toBe(0);
      expect(summary.workbenchSignals.returnedChanges).toBe(0);
    }
  }

  async function createDraft(request: APIRequestContext, action: "set" | "delete") {
    const current = await exported(request);
    const response = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${bindingId}/drafts`), {
      headers: authHeadersForRole("software-user"),
      data: { baseRevisionId: current.configRevisionId, action, reason: "Dashboard lifecycle verification",
        ...(action === "set" ? { sourceTarget: { format: "json", sourceText: "38" } } : {}) }
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).item.draftId as string;
  }

  async function submit(request: APIRequestContext, draftId: string, key: string) {
    const response = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-value-drafts/${draftId}/submit`), {
      headers: { ...authHeadersForRole("software-user"), "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": key },
      data: { assignedToUserId: acceptanceCast.sunMei.userId }
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).item.id as string;
  }

  async function review(request: APIRequestContext, requestId: string, decision: "approve" | "reject") {
    const response = await request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}/review`), {
      headers: { ...authHeadersForRole("software-committer"), "X-WiseEff-Catalog-Release": releaseId, "Idempotency-Key": `${requestId}-${decision}` },
      data: { decision, reason: "Dashboard review verification" }
    });
    expect(response.ok(), await response.text()).toBe(true);
  }

  test("counts active bindings and follows draft, rejection, approval and deletion", async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const openHome = async (role: "software-user" | "software-committer") => {
      await signInBrowserAsRole(page, role, `${runtime.frontendUrl}/parameter-home`);
      const dismiss = page.getByRole("button", { name: "不再提示" });
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
      await page.getByRole("combobox", { name: "项目范围", exact: true }).click();
      await page.getByRole("option", { name: "Canonical dashboard local", exact: true }).click();
      await expect(page.getByRole("region", { name: "参数管理首页" })).toBeVisible();
    };
    for (const endpoint of ["summary", "hotspots"]) {
      const denied = await request.get(apiRoute(`/api/v1/parameters/dashboard/${endpoint}?projectId=dashboard-private`), {
        headers: authHeadersForRole("software-user")
      });
      expect(denied.status(), await denied.text()).toBe(403);
      const foreign = await request.get(apiRoute(`/api/v1/parameters/dashboard/${endpoint}?projectId=dashboard-foreign`), {
        headers: authHeadersForRole("admin")
      });
      expect(foreign.status(), await foreign.text()).toBe(404);
    }
    await assertCounts(request, 1, 0, 0);
    const draftId = await createDraft(request, "set");
    await assertCounts(request, 1, 1, 0);
    await openHome("software-user");
    await expect(page.locator('[data-kpi="openItemCount"] dd')).toHaveText("1");
    await page.screenshot({ path: info.outputPath("canonical-dashboard-draft.png"), animations: "disabled" });
    await page.getByRole("button", { name: /继续未提交的参数草稿/ }).click();
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${projectId}$`));
    await page.getByRole("tab", { name: /JSON 参数/ }).click();
    await expect(page.getByRole("region", { name: "JSON 参数", exact: true })).toBeVisible();
    const firstRequest = await submit(request, draftId, "dashboard-submit-first");
    await assertCounts(request, 1, 0, 1);
    await openHome("software-committer");
    await expect(page.locator('[data-kpi="openItemCount"] dd')).toHaveText("1");
    await page.screenshot({ path: info.outputPath("canonical-dashboard-pending.png"), animations: "disabled" });
    await page.getByRole("combobox", { name: "项目范围", exact: true }).click();
    await page.getByRole("option", { name: "全部项目", exact: true }).click();
    await expect(page.locator('[data-kpi="openItemCount"] dd')).toHaveText("1");
    await page.getByRole("button", { name: /处理待审阅参数变更/ }).click();
    const projectChoice = page.getByRole("dialog", { name: "选择要查看的项目" });
    await expect(projectChoice).toBeVisible();
    await expect(projectChoice.getByRole("button", { name: "Private dashboard project", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("canonical-dashboard-project-choice.png"), animations: "disabled" });
    const chosenProject = projectChoice.getByRole("button", { name: "Canonical dashboard local", exact: true });
    await chosenProject.focus();
    await chosenProject.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/parameter-review\\?project=${projectId}$`));
    await expect(page.getByRole("region", { name: "软件配置审核", exact: true })).toBeVisible();
    await review(request, firstRequest, "reject");
    await assertCounts(request, 1, 1, 0);
    await openHome("software-user");
    await expect(page.locator('[data-kpi="openItemCount"] dd')).toHaveText("1");
    await expect(page.getByRole("button", { name: /补充被退回的参数修改/ })).toHaveCount(0);
    const secondRequest = await submit(request, draftId, "dashboard-submit-again");
    await assertCounts(request, 1, 0, 1);
    await review(request, secondRequest, "approve");
    await assertCounts(request, 1, 0, 0);
    for (const dimension of ["project", "module", "parameter"]) {
      const hotspots = await request.get(apiRoute(`/api/v1/parameters/dashboard/hotspots?projectId=${projectId}&window=30d&dimension=${dimension}`), {
        headers: authHeadersForRole("software-user")
      });
      expect(hotspots.status(), await hotspots.text()).toBe(200);
      expect((await hotspots.json()).items).toHaveLength(1);
    }

    await openHome("software-user");
    await page.getByText("整体", { exact: true }).click();
    await expect(page.locator('[data-kpi="totalBindings"] dd')).toHaveText("1");
    await expect(page.locator('[data-kpi="totalDefinitions"] dd')).toHaveText("1");
    await expect(page.locator('[data-kpi="highRiskParameters"] dd')).toHaveText("不可用");
    const editEntry = page.getByRole("button", { name: "打开 修改参数", exact: true });
    await expect(editEntry.locator("em b")).toHaveText("1");
    await page.screenshot({ path: info.outputPath("canonical-dashboard-active.png"), animations: "disabled" });
    await editEntry.click();
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${projectId}$`));
    await page.goBack();
    await page.getByRole("button", { name: /查看热区所在项目：DHLOCAL/ }).click();
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${projectId}$`));
    await page.getByRole("tab", { name: /JSON 参数/ }).click();
    await expect(page.getByRole("region", { name: "JSON 参数", exact: true })).toBeVisible();
    await page.goBack();
    await page.getByRole("radio", { name: "热榜", exact: true }).click();
    await page.getByRole("button", { name: "展开热区 #1 DHLOCAL", exact: true }).click();
    await expect(page.getByRole("region", { name: "DHLOCAL 热榜详情", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("canonical-dashboard-hotspots.png"), animations: "disabled" });
    await page.getByRole("radio", { name: "概览", exact: true }).click();

    const deletionDraft = await createDraft(request, "delete");
    await assertCounts(request, 1, 1, 0);
    const deletionRequest = await submit(request, deletionDraft, "dashboard-delete-submit");
    await assertCounts(request, 1, 0, 1);
    await review(request, deletionRequest, "approve");
    await assertCounts(request, 0, 0, 0);
    await page.reload();
    await expect(page.getByRole("region", { name: "参数管理首页" })).toBeVisible();
    await page.getByRole("combobox", { name: "项目范围", exact: true }).click();
    await page.getByRole("option", { name: "Canonical dashboard local", exact: true }).click();
    await page.getByText("整体", { exact: true }).click();
    await expect(page.locator('[data-kpi="totalBindings"] dd')).toHaveText("0");
    await expect(page.getByRole("button", { name: "打开 修改参数", exact: true }).locator("em b")).toHaveText("0");
    await expect(page.locator('[data-kpi="totalDefinitions"] dd')).toHaveText("0");
    await expect(page.locator('[data-kpi="highRiskParameters"] dd')).toHaveText("不可用");
    await page.screenshot({ path: info.outputPath("canonical-dashboard-deleted.png"), animations: "disabled" });
    await page.goto("about:blank");
    await runtime.restartApi();
    await assertCounts(request, 0, 0, 0);
  });
});
