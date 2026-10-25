import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import { authHeadersForRole, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import { startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo, type DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";
import { captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime } from "./helpers/semanticBindingFixture";

const failures: ExpectedApiFailure[] = [];
useBrowserDiagnostics(test, { expectedApiFailures: failures });
test.use({ viewport: { width: 1440, height: 900 } });
const environment = captureProcessEnvForDisposableRuntime(), organizationId = "org-chargelab";
const SOURCE = "copy-source-1430", SOURCE_NAME = "完整配置复制来源", TARGET = "copy-target-1430", TARGET_NAME = "独立完整配置目标";
const JSON_SOURCE = '{ "retained": [1,2], "private": true }\r\n';
let runtime: DisposablePostCutoverRuntime, configSetId: string, sourceBindingId: string;
type Binding = { id: string; rawValue: string };

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  if (!environment.databaseUrl) throw new Error("Explicit isolated database is required");
  runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, { catalog: "fixture-owned", label: "shared_project_copy", apiEnv: { LOG_ANALYSIS_DETERMINISTIC: "true" } });
  applyDisposableRuntimeEnv(runtime); await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin"), db = createPostgresDatabase(runtime.databaseUrl);
  const auth = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId, organizationId, roles: [{ roleId: "admin", projectId: null }] });
  try {
    await installDriverSourceFixture(db, auth, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Copy source configuration",
      driverName: "Copy current defaults", idempotencyKey: "project-copy-catalog", reason: "#1430 complete independent copy" });
    const created = await request.post(apiRoute("/api/v1/parameters/admin/projects"), { headers, data: { id: SOURCE, name: SOURCE_NAME, code: "COPY-SOURCE" } });
    expect(created.status(), await created.text()).toBe(201);
    const path = `/api/v1/parameters/projects/${SOURCE}/initialization`;
    const saved = await request.put(apiRoute(`${path}/draft`), { headers, data: { projectName: SOURCE_NAME, projectCode: "COPY-SOURCE", ownerUserId: auth.user.id,
      sourceProjectIds: [], primarySourceProjectId: null, supplementSourceProjectIds: [], selectedModuleIds: [], selectedRisks: [], selectedSourceBindingIds: [], bindingSnapshots: [], emptyLibrary: true, notes: "Normal empty initialization" } });
    expect(saved.status(), await saved.text()).toBe(200);
    const submitted = await request.post(apiRoute(`${path}/submit`), { headers, data: {} }); expect(submitted.status(), await submitted.text()).toBe(201);
    const approved = await request.post(apiRoute(`/api/v1/parameters/admin/initialization-reviews/${(await submitted.json()).item.id}/approve`), { headers, data: {} });
    expect(approved.status(), await approved.text()).toBe(200);
    const config = await request.post(apiRoute(`/api/v1/projects/${SOURCE}/config-sets`), { headers, data: { name: "Board and settings" } });
    expect(config.status(), await config.text()).toBe(201); configSetId = (await config.json()).item.id;
    const members = [];
    for (const [index, file] of [{ fileName: "board.dts", content: '/dts-v1/;\r\n/include/ "private.dtsi"\r\n/ { model = "Copied original"; };\r\n', format: "dts" as const, role: "base" as const },
      { fileName: "private.dtsi", content: '/ { local { status = "disabled"; }; };\r\n', format: "dts" as const, role: "include" as const },
      { fileName: "mixed.json", content: JSON_SOURCE, format: "json" as const, role: "thermal" as const }].entries()) {
      const uploaded = await request.post(apiRoute(`/api/v1/projects/${SOURCE}/parameter-files`), { headers, data: { fileName: file.fileName, contentBase64: Buffer.from(file.content).toString("base64") } });
      expect(uploaded.status(), await uploaded.text()).toBe(201); const result = await uploaded.json();
      const added = await request.post(apiRoute(`/api/v1/projects/${SOURCE}/config-sets/${configSetId}/files`), { headers,
        data: { fileId: result.item.id, role: file.role === "include" ? "misc" : file.role, sortOrder: index } });
      expect(added.status(), await added.text()).toBe(201);
      members.push({ ...file, sourceName: file.fileName, fileId: result.item.id, fileVersionId: result.version.id, sortOrder: index });
    }
    const revision = await ingestConfigRevision(db, { organizationId, projectId: SOURCE, configSetId,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [], members }, auth); expect(revision.status).toBe("resolved");
  } finally { await db.close(); }
  const draft = await request.post(apiRoute("/api/v2/shared-dtsi"), { headers, data: { name: "Copy fixed defaults", sourceName: "defaults.dtsi",
    content: '/ { charger { compatible = "acme,power"; iin_max = <42>; }; };\n', changeDescription: "Full independent project copy" } });
  expect(draft.status(), await draft.text()).toBe(201); const resourceId = (await draft.json()).item.resourceId;
  const preview = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/publication-preview`), { headers, data: { expectedRevision: 1 } });
  expect(preview.status(), await preview.text()).toBe(201);
  const published = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/publications`), { headers, data: { previewId: (await preview.json()).item.id, idempotencyKey: "copy-browser-fixed" } });
  expect(published.status(), await published.text()).toBe(201);
  const addition = { sharedReference: { resourceId, versionId: (await published.json()).item.id, mountPath: "vendor/defaults" }, role: "misc", sortOrder: 3 };
  const addPath = `/api/v1/projects/${SOURCE}/config-sets/${configSetId}/member-addition`;
  const addPreview = await request.post(apiRoute(`${addPath}/preview`), { headers, data: addition }); expect(addPreview.status(), await addPreview.text()).toBe(200);
  const added = await request.post(apiRoute(`${addPath}/apply`), { headers, data: { ...addition, proofToken: (await addPreview.json()).item.proofToken, reason: "Copy fixed source", clientMutationId: "copy-browser-pin" } });
  expect(added.status(), await added.text()).toBe(200);
  const values = await request.get(apiRoute(`/api/v2/projects/${SOURCE}/parameter-bindings`), { headers }); expect(values.status()).toBe(200);
  sourceBindingId = (await values.json()).items.find((row: Binding) => row.rawValue === "<42>").id;
});
test.afterAll(async ({}, info) => { test.setTimeout(60_000); try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); } finally { restoreProcessEnvFromDisposableRuntime(environment); } });

test("chooses the source project, previews a private full copy, submits for independent approval and reads actual target sources", async ({ page, request }, info) => {
  test.setTimeout(180_000); const headers = authHeadersForRole("admin");
  await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameters?project=${SOURCE}`); await dismissXiaozeHint(page);
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "新项目参数初始化", exact: true });
  await wizard.getByLabel("项目名称", { exact: true }).fill(TARGET_NAME); await wizard.getByLabel("项目代号", { exact: true }).fill(TARGET.toUpperCase());
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await wizard.getByLabel("完整配置独立复制", { exact: true }).focus(); await page.keyboard.press("Space");
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(wizard).toContainText("请选择至少一个来源项目，或选择从零开始。");
  await page.screenshot({ path: info.outputPath("copy-no-source-1440.png"), fullPage: true });
  await wizard.getByLabel(SOURCE_NAME, { exact: true }).check();
  const copyPath = `/api/v1/parameters/projects/${TARGET}/initialization/copy-preview`;
  failures.push({ method: "POST", path: copyPath, status: 409 });
  await page.route(`**${copyPath}`, route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "来源已变化，请重新预览。" } }) }), { times: 1 });
  await wizard.getByRole("button", { name: "下一步", exact: true }).click(); await expect(wizard).toContainText("来源已变化，请重新预览。");
  await expect(wizard.getByLabel(SOURCE_NAME, { exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath("copy-preview-error-1440.png"), fullPage: true });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${copyPath}`, async route => { await gate; await route.continue(); }, { times: 1 });
  const previewResponse = page.waitForResponse(response => response.url().endsWith(copyPath) && response.status() === 200);
  await wizard.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(wizard.getByRole("button", { name: "加载中…", exact: true })).toBeDisabled();
  await expect(wizard.getByLabel("完整配置独立复制", { exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("copy-preview-loading-1440.png"), fullPage: true }); release();
  const preview = await previewResponse; expect(preview.status()).toBe(200); const snapshot = await preview.json();
  await expect(wizard.getByRole("table", { name: "完整配置复制预览", exact: true })).toContainText("vendor/defaults/defaults.dtsi");
  await expect(wizard).toContainText("固定私有副本");
  const rootLink = wizard.getByRole("link", { name: "board.dts", exact: true }); const rootHref = await rootLink.getAttribute("href");
  const rootPin = snapshot.configSnapshots[0].members.find((row: { sourceName: string }) => row.sourceName === "board.dts");
  expect(rootHref).toContain(`file=${rootPin.fileId}`); expect(rootHref).toContain(`version=${rootPin.fileVersionId}`); expect(rootHref).toContain("sourceMode=history");
  const popup = page.waitForEvent("popup"); await rootLink.click(); const sourcePage = await popup;
  await expect(sourcePage.getByRole("textbox", { name: "DTS 源码", exact: true })).toHaveAttribute("aria-readonly", "true"); await sourcePage.close();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(wizard.getByRole("button", { name: "下一步", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`copy-preview-${viewport.width}.png`), fullPage: true });
  }
  await wizard.getByRole("button", { name: "下一步", exact: true }).focus(); await page.keyboard.press("Enter");
  const submitted = page.waitForResponse(response => response.url().endsWith(`/api/v1/parameters/projects/${TARGET}/initialization/submit`));
  await wizard.getByRole("button", { name: "提交初始化审阅", exact: true }).focus(); await page.keyboard.press("Enter");
  const submission = await submitted; expect(submission.status(), await submission.text()).toBe(201); const reviewId = (await submission.json()).item.id;
  await expect(wizard).not.toBeVisible();
  await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-review?project=${TARGET}`);
  await page.locator(`[data-review-row-id="${reviewId}"]`).getByRole("button", { name: /提交详情$/ }).click();
  let detail = page.getByRole("complementary", { name: "审阅详情", exact: true });
  await expect(detail.getByRole("button", { name: "通过初始化", exact: true })).toBeDisabled();
  await expect(detail).toContainText("另一位管理员"); await page.screenshot({ path: info.outputPath("copy-review-self-readonly-1280.png"), fullPage: true });
  const reviewer = acceptanceCast.acceptanceAdmin;
  await signInBrowserAsUser(page, reviewer.userId, reviewer.email, reviewer.name, `${runtime.frontendUrl}/parameter-review?project=${TARGET}`);
  await page.locator(`[data-review-row-id="${reviewId}"]`).getByRole("button", { name: /提交详情$/ }).click();
  detail = page.getByRole("complementary", { name: "审阅详情", exact: true });
  await expect(detail.getByRole("table", { name: "完整配置复制预览", exact: true })).toContainText("mixed.json");
  await page.screenshot({ path: info.outputPath("copy-review-independent-1280.png"), fullPage: true });
  await detail.getByRole("button", { name: "通过初始化", exact: true }).focus(); await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "确认通过初始化", exact: true }); await expect(confirmation).toContainText("固定私有副本");
  const approval = page.waitForResponse(response => response.url().endsWith(`/initialization-reviews/${reviewId}/approve`));
  await confirmation.getByRole("button", { name: "确认通过", exact: true }).focus(); await page.keyboard.press("Enter");
  const approved = await approval; expect(approved.status(), await approved.text()).toBe(200);
  const targetValues = await request.get(apiRoute(`/api/v2/projects/${TARGET}/parameter-bindings`), { headers }); expect(targetValues.status()).toBe(200);
  const targetBinding = (await targetValues.json()).items.find((row: Binding) => row.rawValue === "<42>"); expect(targetBinding.id).not.toBe(sourceBindingId);
  const exported = await request.get(apiRoute(`/api/v2/projects/${TARGET}/parameter-bindings/${targetBinding.id}/export`), { headers }); expect(exported.status(), await exported.text()).toBe(200);
  const manifest = (await exported.json()).item.manifest;
  const targetSource = await request.get(apiRoute(`/api/v1/projects/${TARGET}/config-sets/${manifest.configSetId}/export`), { headers }); expect(targetSource.status(), await targetSource.text()).toBe(200);
  const copied = await targetSource.json(); expect(copied.files).toContainEqual(expect.objectContaining({ name: "mixed.json", content: JSON_SOURCE }));
  const targetFiles = await request.get(apiRoute(`/api/v1/projects/${TARGET}/config-sets/${manifest.configSetId}/files`), { headers });
  const files = (await targetFiles.json()).items; expect(files.every((row: { sharedReference?: unknown }) => !row.sharedReference)).toBe(true);
  const targetRoot = files.find((row: { fileName: string }) => row.fileName === "board.dts"); expect(targetRoot.fileId).not.toBe(rootPin.fileId);
  await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/${TARGET}/configuration?configSet=${manifest.configSetId}&file=${targetRoot.fileId}`);
  await expect(page.getByRole("textbox", { name: "DTS 源码", exact: true })).toContainText("Copied original");
  await expect(page.getByRole("radio", { name: "编辑", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: info.outputPath("copy-target-source-1440.png"), fullPage: true });
  await page.goto(`${runtime.frontendUrl}/parameters?project=${TARGET}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("row").filter({ hasText: "iin_max" })).toContainText("42");
  await page.screenshot({ path: info.outputPath("copy-target-effective-1440.png"), fullPage: true });
  const sourceValues = await request.get(apiRoute(`/api/v2/projects/${SOURCE}/parameter-bindings`), { headers });
  expect((await sourceValues.json()).items).toContainEqual(expect.objectContaining({ id: sourceBindingId, rawValue: "<42>" }));
});
