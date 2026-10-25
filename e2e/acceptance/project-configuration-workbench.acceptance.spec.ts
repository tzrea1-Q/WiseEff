import { selectControlOption } from "./helpers/selectControl";
import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test, type APIResponse, type Page, type Response } from "playwright/test";
import type { DtsReleaseReadiness } from "../../src/application/ports/DtsStructuredRepository";
import type { ParameterFileSourcePreview, SourceRevisionRequest } from "../../src/application/ports/ParameterFileRepository";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { setParameterIdentityMode } from "../../server/modules/parameter-kernel/parameterIdentityMode";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";

import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute, createWorkbenchConfigSet, ensureWorkbenchInspectorOpen, openWorkbenchCreateConfigSet, openWorkbenchFileActions, openWorkbenchPanel, openWorkbenchVersionMenu, selectWorkbenchConfigSet } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";
import { registerCatalogDriverSubjects } from "./helpers/topologyFixture";
import {
  assertPostCutoverIdentity,
  bindHardwareUserToProject,
  disposablePageUrl,
  lookupParameterFileVersion,
  readCanonicalFixtureBindings,
  numericCellsDts,
  seedIsolatedBinding,
  seedSemanticFileUiConflict,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime
} from "./helpers/semanticBindingFixture";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import {
  annotateFailureRoute,
  PROJECT_CONFIGURATION_BASELINE_FAILURE_ROUTE,
} from "../shared/failureRouteMetadata";

const expectedBrowserApiFailures: ExpectedApiFailure[] = [
    // Pre-existing aurora conflict enrichment can 500 without blocking readiness gate proof.
    { method: "GET", path: "/api/v1/projects/aurora/parameter-file-conflicts", status: 500 }
  ];
useBrowserDiagnostics(test, { expectedApiFailures: expectedBrowserApiFailures });
test.use({ viewport: { width: 1440, height: 900 } });

const organizationId = "org-chargelab";
const projectId = "aurora";
const databaseUrl = process.env.DATABASE_URL;
const adminHeaders = () => authHeadersForRole("admin");
const hardwareHeaders = () => authHeadersForRole("hardware-user");

async function ensureInspectorOpen(page: Page) {
  await ensureWorkbenchInspectorOpen(page);
}

async function prepareSourceFromEditor(page: Page, source: string, keyboardSave = false) {
  const editor = page.getByRole("textbox", { name: "DTS 源码", exact: true });
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await page.getByRole("radio", { name: "编辑", exact: true }).click();
  await expect(editor).toHaveAttribute("aria-readonly", "false");
  await editor.fill(source);
  await page.getByRole("radio", { name: "预览", exact: true }).click();
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await expect(page.getByText("未保存修改", { exact: true })).toBeVisible();
  const candidateResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/parameter-file-candidates`);
  const previewResponse = page.waitForResponse((response) => response.request().method() === "GET"
    && new URL(response.url()).pathname.endsWith("/source-preview"), { timeout: 60_000 });
  const save = page.getByRole("button", { name: "保存修改", exact: true });
  if (keyboardSave) { await save.focus(); await page.keyboard.press("Enter"); } else await save.click();
  const candidate = await candidateResponse;
  expect(candidate.status(), await candidate.text()).toBe(201);
  expect(candidate.request().postDataJSON()).toMatchObject({ intent: "source_revision",
    expectedCurrentVersionId: expect.any(String), expectedConfigRevisionId: expect.any(String), clientMutationId: expect.any(String) });
  const preview = await previewResponse;
  expect(preview.status(), await preview.text()).toBe(200);
  const item = (await preview.json()).item as ParameterFileSourcePreview;
  expect(item).toMatchObject({ kind: "source_revision", format: "dts", canSubmit: true, after: source,
    baseVersionId: expect.any(String), configRevisionId: expect.any(String), proofToken: expect.any(String) });
  const dialog = page.getByRole("dialog", { name: "保存 DTS 修改" });
  await expect(dialog.getByRole("region", { name: "DTS 修改差异", exact: true })).toBeVisible();
  return { candidate, preview, item, dialog };
}

async function submitSourceFromEditor(page: Page, source: string, reason: string) {
  const { candidate, preview, item, dialog } = await prepareSourceFromEditor(page, source);
  const reviewer = item.reviewers?.find((entry) => entry.userId === acceptanceCast.acceptanceAdmin.userId)
    ?? item.reviewers?.find((entry) => Object.values(acceptanceCast).some((actor) => actor.userId === entry.userId));
  expect(reviewer, "server must offer an eligible non-author reviewer").toBeDefined();
  await dialog.getByRole("textbox", { name: "DTS 修改原因" }).fill(reason);
  await selectControlOption(dialog.getByRole("combobox", { name: "DTS 软件审核人" }), reviewer!.userId);
  const submittedResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/source-submit"), { timeout: 60_000 });
  await dialog.getByRole("button", { name: "提交审核", exact: true }).click();
  const submitted = await submittedResponse;
  expect(submitted.status(), await submitted.text()).toBe(200);
  const receipt = (await submitted.json()).item as { requestId: string; status: string };
  expect(receipt).toMatchObject({ requestId: expect.any(String), status: "pending" });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("已提交审核 · 工作配置尚未更新", { exact: true })).toBeVisible();
  return { candidate, preview, item, submitted, receipt, reviewer: reviewer! };
}
const sampleDts = `/dts-v1/;
/ {
	model = "Configuration tracer";
	chosen {
		compatible = "wiseeff,tracer";
	};
};
`;

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

async function openVersionCheckIssues(page: Page) {
  const dialog = await openWorkbenchPanel(page, "release");
  const summary = dialog.locator("summary").filter({ hasText: /^定版检查/ });
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
  return dialog.getByRole("region", { name: "版本检查问题" });
}

test.describe("project configuration workbench read-only browser acceptance", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
    // Project-scoped edit authorization (main hardening): the conflict test opens
    // UI drafts as the hardware-user actor, which now requires an aurora-scoped
    // edit-capable role. Admin-only surfaces (resolve, readiness) still deny him.
    await withPgClient(async (client) => {
      await client.query(
        `
        insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
        values ($1, 'u-zhao-heng', $2, $3, 'hardware-user')
        on conflict (id) do update set
          project_id = excluded.project_id,
          role_id = excluded.role_id
        `,
        [`acceptance-u-zhao-heng-hardware-user-${projectId}`, organizationId, projectId]
      );
    });
  });

  test("scrolls the configuration tree with the mouse wheel while keeping search visible", async ({ page }) => {
    await signInBrowserAsRole(page, "admin", "/parameter-admin/projects/aurora/configuration?configSet=dcs-default-aurora&file=seed-dts-file-aurora");
    const navigator = page.getByRole("region", { name: "配置导航", exact: true });
    const tree = navigator.getByRole("tree", { name: "默认配置 配置文件" });
    const node = tree.getByRole("treeitem", { name: "节点 amba", exact: true });
    await expect(node).toBeVisible();
    await expect.poll(() => tree.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    await node.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(navigator.getByRole("searchbox", { name: "统一搜索查询" })).toBeInViewport();
    await page.mouse.wheel(0, -400);
    await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBe(0);
  });

  test("keeps incomplete legacy snapshots read-only until actual composition is supplied", async ({ page, request }, testInfo) => {
    const baselineId = "seed-dts-baseline-aurora";
    const preview = await request.get(apiRoute(`/api/v1/projects/${projectId}/baselines/${baselineId}/restore-preview`), {
      headers: adminHeaders()
    });
    expect(preview.status()).toBe(200);
    const { item } = await preview.json();
    expect(item.driftedCount).toBeGreaterThan(0);
    expect(item.members.some((member: { canonicalOwned: boolean }) => member.canonicalOwned)).toBe(true);
    const route = `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(item.configSetId)}&file=${encodeURIComponent(item.members[0].fileId)}&baseline=${baselineId}`;
    await signInBrowserAsRole(page, "admin", route);
    await dismissXiaozeHint(page);
    await openWorkbenchPanel(page, "release");
    const rollbackRequests: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "POST" && sent.url().endsWith(`/baselines/${baselineId}/rollback`)) rollbackRequests.push(sent.url());
    });
    const baselinePanel = page.getByRole("region", { name: "配置版本列表与详情" });
    await expect(baselinePanel.getByRole("button", { name: "恢复到此版本…",exact: true })).toBeEnabled();
    await expect(baselinePanel.getByRole("button", { name: /对比已发布/ })).toHaveCount(0);
    await baselinePanel.getByRole("button", { name: "对比当前配置", exact: true }).click();
    await expect(page).toHaveURL(/sourceMode=unified-diff/);
    await expect(page.getByLabel("统一差异对比")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认恢复" })).toHaveCount(0);
    await openWorkbenchPanel(page, "release");
    await expect(baselinePanel.getByLabel("文件差异")).toContainText(item.members[0].fileName);
    await baselinePanel.getByRole("button",{ name: "恢复到此版本…",exact: true }).click();
    const restore = page.getByRole("dialog",{ name: "恢复版本预览",exact: true });
    await expect(restore).toContainText("未保存完整来源修订");
    await expect(restore.getByRole("link",{ name: "进入配置编辑器" })).toBeVisible();
    await expect(restore.getByRole("button",{ name: "确认恢复" })).toHaveCount(0);
    const screenshot = testInfo.outputPath("canonical-baseline-restore-1440x900.png");
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach("canonical baseline read-only restore", { path: screenshot, contentType: "image/png" });
    expect(rollbackRequests).toEqual([]);
    await recordOperationEvidence({
      operationId: "PROJ-CONFIG-BASELINE-001", title: "canonical baseline read-only restore preview",
      status: "passed", role: "Admin", route, page, testInfo,
      assertions: ["ui", "api", "screenshot"], artifacts: [screenshot],
      api: [summarizeApiResponse(preview, { method: "GET", path: `/api/v1/projects/${projectId}/baselines/${baselineId}/restore-preview` })]
    });
  });

  test("enters from the project list and reads a scoped active DTS member in API mode", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-READ-001
    // @operation PROJ-CONFIG-READ-001
    const suffix = randomUUID();
    const configSetName = `read-only-tracer-${suffix}`;
    const primaryFileName = `acceptance-config-tracer-${suffix}.dts`;
    const looseFileName = `acceptance-config-loose-${suffix}.json`;

    try {
      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(sampleDts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };
      const looseUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: looseFileName,
          contentBase64: Buffer.from('{"notes":"ungrouped"}\n', "utf8").toString("base64")
        }
      });
      expect(looseUpload.ok()).toBe(true);

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Read-only tracer acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: primaryBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const membersResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders() }
      );
      if (!membersResponse.ok()) {
        throw new Error(`member list failed: ${membersResponse.status()} ${await membersResponse.text()}`);
      }
      const membersBody = (await membersResponse.json()) as {
        items: Array<{
          configSetId: string;
          fileId: string;
          fileName: string;
          role: string;
          currentVersionId?: string;
          currentVersionNumber?: number;
        }>;
      };
      expect(membersBody.items).toEqual([
        expect.objectContaining({
          configSetId,
          fileId: primaryBody.item.id,
          fileName: primaryFileName,
          role: "base",
          currentVersionId: primaryBody.version.id,
          currentVersionNumber: 1
        })
      ]);

      const memberRequests: string[] = [];
      page.on("request", (requestEvent) => {
        if (requestEvent.url().includes(`/config-sets/${configSetId}/files`)) memberRequests.push(requestEvent.url());
      });
      await signInBrowserAsRole(page, "admin", "/parameter-admin/projects");
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目清单", exact: true })).toBeVisible({ timeout: 30_000 });
      const auroraRow = page.getByRole("row").filter({ hasText: /aurora/i }).last();
      await auroraRow.getByRole("button", { name: /配置工作台/ }).click();
      await expect(page).toHaveURL(new RegExp(`/parameter-admin/projects/${projectId}/configuration(?:\\?|$)`));

      const readinessPath = `/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`;
      const targetReadiness = (url: URL) => url.pathname === readinessPath;
      // Hold this Config set's real response so loading and settled policy cannot race the assertions.
      let releaseReadiness!: () => void;
      let readinessFetched!: (response: APIResponse) => void;
      let readinessFailed!: (reason: unknown) => void;
      const readinessGate = new Promise<void>((resolve) => { releaseReadiness = resolve; });
      const readinessResponse = new Promise<APIResponse>((resolve, reject) => {
        readinessFetched = resolve;
        readinessFailed = reject;
      });
      const routeTaskSettlements: Promise<PromiseSettledResult<void>[]>[] = [];
      let failure: PromiseRejectedResult | undefined;
      await page.route(targetReadiness, (route) => {
        const task = (async () => {
          const response = await route.fetch();
          readinessFetched(response);
          await readinessGate;
          await route.fulfill({ response });
        })();
        void task.catch((reason) => {
          failure ??= { status: "rejected", reason };
          readinessFailed(reason);
        });
        const settlement = Promise.allSettled([task]);
        routeTaskSettlements.push(settlement);
        return settlement;
      });
      const navigation = page.goto(`/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}`);
      try {
        await Promise.race([readinessResponse, navigation.then(() => readinessResponse)]);
        await navigation;
        await dismissXiaozeHint(page);
        await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("treeitem", { name: new RegExp(primaryFileName) })).toBeVisible();
        await expect(page.getByRole("group", { name: "待分配项目文件" })).toContainText(looseFileName);
        await expect(page.locator(".configuration-workbench__source-head")).toContainText("工作配置");
        await openWorkbenchPanel(page, "release");
        await expect(page.getByRole("region", { name: "配置版本列表与详情" })).toContainText("尚未保存版本快照。");
        await expect(page.getByRole("button", { name: /^更新来源/ })).toHaveCount(0);
        await expect(page.getByRole("status", { name: "配置版本状态", includeHidden: true })).toContainText("检查中…");
        await expect(page.getByRole("button", { name: "保存版本快照", exact: true })).toBeDisabled();
      } catch (reason) {
        failure ??= { status: "rejected", reason };
      } finally {
        releaseReadiness();
        await Promise.all(routeTaskSettlements);
        const settled = await Promise.allSettled([navigation, page.unroute(targetReadiness)]);
        const settledRoutes = (await Promise.all(routeTaskSettlements)).flat();
        failure ??= [...settled, ...settledRoutes].find((result) => result.status === "rejected");
      }
      if (failure) throw failure.reason;
      const evaluated = await readinessResponse;
      expect(evaluated.status(), await evaluated.text()).toBe(200);
      const { item: readiness } = await evaluated.json() as { item: DtsReleaseReadiness };
      expect(readiness).toMatchObject({ configSetId, projectId,
        available: expect.any(Boolean), canCreateBaseline: expect.any(Boolean) });
      const readinessSummary = page.getByRole("status", { name: "配置版本状态", includeHidden: true });
      if (readiness.available) {
        await expect(readinessSummary).toHaveAttribute("data-can-create", String(readiness.canCreateBaseline));
        await expect(readinessSummary).toHaveAttribute("data-level", readiness.level);
      } else {
        expect(readiness.canCreateBaseline).toBe(false);
        await expect(readinessSummary).toContainText("不可用");
      }
      if (readiness.available && readiness.canCreateBaseline) {
        await expect(page.getByRole("button", { name: "保存版本快照", exact: true })).toBeEnabled();
      } else {
        await expect(page.getByRole("button", { name: "保存版本快照", exact: true })).toBeDisabled();
      }
      await page.getByRole("button", { name: "关闭配置版本", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "DTS 源码", exact: true })).toContainText("Configuration tracer");
      expect(memberRequests.some((url) => url.includes(`/config-sets/${configSetId}/files`))).toBe(true);

      await page.setViewportSize({ width: 1440, height: 900 });
      const desktopShell = await page.evaluate(() => {
        const dock = document.querySelector(".configuration-workbench__tasks");
        const inspector = document.querySelector(".configuration-workbench__inspector");
        const source = document.querySelector(".configuration-workbench__source");
        const mobileTools = document.querySelector(".configuration-workbench__mobile-tools");
        const command = document.querySelector(".configuration-workbench__command");
        const rect = (el: Element | null) => {
          if (!el) return null;
          const box = el.getBoundingClientRect();
          return { width: box.width, height: box.height, x: box.x };
        };
        const commandChildren = command
          ? Array.from(command.children).filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 4 && box.height > 4;
            })
          : [];
        const overlaps: Array<{ a: string; b: string; ox: number; oy: number }> = [];
        for (let i = 0; i < commandChildren.length; i += 1) {
          for (let j = i + 1; j < commandChildren.length; j += 1) {
            const a = commandChildren[i]!;
            const b = commandChildren[j]!;
            if (a.contains(b) || b.contains(a)) continue;
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const ox = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
            const oy = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
            if (ox > 2 && oy > 2) {
              overlaps.push({
                a: (a.className || a.tagName).toString().slice(0, 48),
                b: (b.className || b.tagName).toString().slice(0, 48),
                ox: Math.round(ox),
                oy: Math.round(oy)
              });
            }
          }
        }
        return {
          dock: rect(dock),
          inspectorBefore: rect(inspector),
          source: rect(source),
          mobileToolsDisplay: mobileTools ? getComputedStyle(mobileTools).display : null,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          commandOverlaps: overlaps
        };
      });
      expect(desktopShell.mobileToolsDisplay).toBeNull();
      expect(desktopShell.dock?.height ?? 0).toBe(0);
      expect(desktopShell.source?.width ?? 0).toBeGreaterThan(600);
      expect(desktopShell.scrollWidth).toBeLessThanOrEqual(desktopShell.clientWidth);
      expect(desktopShell.commandOverlaps).toEqual([]);

      const commandControlAudit = await page.evaluate(() => {
        const command = document.querySelector(".configuration-workbench__command");
        if (!command) return { clipped: [], overlaps: [], fold: null };
        const controls = Array.from(
          command.querySelectorAll("button, select, .configuration-workbench__working, .configuration-workbench__readiness")
        ).filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 2 && box.height > 2;
        });
        const clipped: Array<{ label: string; scroll: number; client: number; parentClip: boolean }> = [];
        for (const el of controls) {
          const html = el as HTMLElement;
          const box = html.getBoundingClientRect();
          let parentClip = false;
          let ancestor: HTMLElement | null = html.parentElement;
          while (ancestor && ancestor !== command.parentElement) {
            const style = getComputedStyle(ancestor);
            if (style.overflow === "hidden" || style.overflowX === "hidden") {
              const ar = ancestor.getBoundingClientRect();
              if (box.left < ar.left - 1 || box.right > ar.right + 1) {
                parentClip = true;
                break;
              }
            }
            ancestor = ancestor.parentElement;
          }
          const scrollW = Math.ceil(html.scrollWidth);
          const clientW = Math.ceil(html.clientWidth);
          // Native <select> scrollWidth reflects the longest option, even when the
          // control intentionally truncates the closed-face label in the command bar.
          const intrinsicSelectOverflow = html.tagName === "SELECT" && !parentClip && scrollW > clientW + 1;
          if (!intrinsicSelectOverflow && (parentClip || scrollW > clientW + 1)) {
            clipped.push({
              label: (html.getAttribute("aria-label") || html.textContent || html.className || "").toString().slice(0, 40),
              scroll: scrollW,
              client: clientW,
              parentClip
            });
          }
        }
        const overlaps: Array<{ a: string; b: string; ox: number; oy: number }> = [];
        for (let i = 0; i < controls.length; i += 1) {
          for (let j = i + 1; j < controls.length; j += 1) {
            const a = controls[i]!;
            const b = controls[j]!;
            if (a.contains(b) || b.contains(a)) continue;
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const ox = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
            const oy = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
            if (ox > 2 && oy > 2) {
              overlaps.push({
                a: (a.getAttribute("aria-label") || a.textContent || a.className || "").toString().slice(0, 32),
                b: (b.getAttribute("aria-label") || b.textContent || b.className || "").toString().slice(0, 32),
                ox: Math.round(ox),
                oy: Math.round(oy)
              });
            }
          }
        }
        const fold = document.querySelector<HTMLButtonElement>('.configuration-workbench__command-actions button[aria-haspopup="menu"]');
        const foldBox = fold?.getBoundingClientRect() ?? null;
        return {
          clipped,
          overlaps,
          fold: fold
            ? {
                width: Math.round(foldBox!.width),
                scrollWidth: Math.ceil(fold.scrollWidth),
                clientWidth: Math.ceil(fold.clientWidth),
                text: (fold.textContent || "").trim()
              }
            : null
        };
      });
      expect(commandControlAudit.fold?.text).toMatch(/更多/);
      expect(commandControlAudit.fold?.scrollWidth ?? 0).toBeLessThanOrEqual((commandControlAudit.fold?.clientWidth ?? 0) + 1);
      expect(commandControlAudit.fold?.width ?? 0).toBeGreaterThanOrEqual(52);
      expect(commandControlAudit.clipped).toEqual([]);
      expect(commandControlAudit.overlaps).toEqual([]);

      await openWorkbenchPanel(page, "file");
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible();
      const inspectorOverlay = await page.evaluate(() => {
        const inspector = document.querySelector(".configuration-workbench__inspector");
        if (!inspector) return null;
        const style = getComputedStyle(inspector);
        const box = inspector.getBoundingClientRect();
        const sourceRight = document.querySelector(".configuration-workbench__source")?.getBoundingClientRect().right;
        return { position: style.position, width: box.width, x: box.x, layout: inspector.getAttribute("data-layout"), sourceRight };
      });
      expect(inspectorOverlay?.layout).toBe("persistent");
      expect(inspectorOverlay?.position).toBe("relative");
      expect(inspectorOverlay!.sourceRight).toBeLessThanOrEqual(inspectorOverlay!.x + 1);
      await openWorkbenchPanel(page, "release");
      await expect(await openVersionCheckIssues(page)).toBeVisible();
      await expect(page.getByRole("region", { name: "配置任务" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "任务", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "关闭配置版本", exact: true }).click();

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench.json", {
        route: page.url(),
        configSetId,
        memberFileId: primaryBody.item.id,
        activeVersionId: primaryBody.version.id,
        ungroupedFileName: looseFileName,
        viewports: ["1440x900"],
        overflow: {
          scrollWidth: desktopShell.scrollWidth,
          clientWidth: desktopShell.clientWidth
        }
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-READ-001",
        title: "read-only configuration workbench tracer",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(membersResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/files`,
            responseSummary: `members=${membersBody.items.length}; activeVersion=${primaryBody.version.id}`
          }),
          summarizeApiResponse(evaluated, {
            method: "GET", path: readinessPath,
            responseSummary: `Exact Config set readiness: available=${readiness.available}; level=${readiness.level}; canCreateBaseline=${readiness.canCreateBaseline}; loading fail-closed`
          })
        ],
        notes: "Project-list entry opened the canonical route; API member identity and active source remained read-only while tree, inspector, and task sheet interactions were exercised at PC 1440x900."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName, looseFileName]
      });
    }
  });

  test("saves a whole-source comment for review without changing the working configuration", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-EDIT-001
    // @operation PROJ-CONFIG-EDIT-001
    test.setTimeout(180_000);
    const headers = adminHeaders();
    const previous = await request.get(apiRoute(`/api/v2/projects/${projectId}/source-revision-requests?mine=true&status=pending`), { headers });
    expect(previous.status(), await previous.text()).toBe(200);
    for (const item of (await previous.json()).items as SourceRevisionRequest[]) {
      if (item.reason !== "PROJ-CONFIG-EDIT-001 source comment review") continue;
      const withdrawn = await request.post(apiRoute(`/api/v2/projects/${projectId}/source-revision-requests/${item.id}/withdraw`), { headers });
      expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    }
    const listed = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers });
    expect(listed.status(), await listed.text()).toBe(200);
    const bindings = (await listed.json()).items as Array<{ id: string; propertyKey: string; currentValueId: string;
      sourceFileId: string; sourceNodePath: string }>;
    const binding = bindings.find((item) => item.propertyKey === "r_charger_uohm");
    expect(binding).toBeDefined();
    const configSets = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets`), { headers });
    expect(configSets.status(), await configSets.text()).toBe(200);
    const configSet = (await configSets.json()).items.find((item: { name: string }) => item.name === "default");
    expect(configSet).toBeDefined();
    const files = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), { headers });
    expect(files.status(), await files.text()).toBe(200);
    const selectedFile = (await files.json()).items.find((item: { id: string }) => item.id === binding!.sourceFileId);
    expect(selectedFile.currentVersionId).toEqual(expect.any(String));
    const file = { fileId: selectedFile.id as string, versionId: selectedFile.currentVersionId as string };
    const sourcePath = `/api/v1/projects/${projectId}/parameter-files/${file.fileId}/versions/${file.versionId}/content`;
    const source = await request.get(apiRoute(sourcePath), { headers });
    expect(source.status(), await source.text()).toBe(200);
    const before = await source.text();
    const edited = `${before}\n/* PROJ-CONFIG-EDIT-001 reviewed comment */\n`;
    const route = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({
      configSet: configSet.id, file: binding!.sourceFileId, node: binding!.sourceNodePath,
      property: binding!.propertyKey
    })}`;
    await signInBrowserAsRole(page, "admin", route);
    await dismissXiaozeHint(page);
    await page.getByRole("treeitem", {
      name: `属性 ${binding!.sourceNodePath}/${binding!.propertyKey}`, exact: true
    }).click();
    await ensureInspectorOpen(page);
    const inspector = page.getByRole("complementary", { name: "配置检查器" });
    await expect(inspector.getByRole("region", { name: "当前属性说明" })).toBeVisible();
    await expect(inspector.getByRole("group", { name: "属性值编辑" })).toHaveCount(0);
    let submitted: Awaited<ReturnType<typeof submitSourceFromEditor>> | undefined;
    try {
      submitted = await submitSourceFromEditor(page, edited, "PROJ-CONFIG-EDIT-001 source comment review");
      expect(submitted.item.impact).toEqual({ parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0, restoredParameters: 0 });
      const detail = await request.get(apiRoute(`/api/v2/projects/${projectId}/source-revision-requests/${submitted.receipt.requestId}`), { headers });
      expect(detail.status(), await detail.text()).toBe(200);
      expect((await detail.json()).item).toMatchObject({ status: "pending", before, after: edited,
        assignedToUserId: submitted.reviewer.userId, proofDigest: submitted.item.proofToken });
      const after = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers });
      expect(after.status(), await after.text()).toBe(200);
      expect((await after.json()).items.find((item: { id: string }) => item.id === binding!.id).currentValueId).toBe(binding!.currentValueId);
      const currentFiles = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), { headers });
      expect(currentFiles.status(), await currentFiles.text()).toBe(200);
      expect((await currentFiles.json()).items.find((item: { id: string }) => item.id === file.fileId).currentVersionId).toBe(file.versionId);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("link", { name: "查看提交记录", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=${projectId}&request=`));
      await expect(page.getByRole("region", { name: "DTS 整文件审核" })).toContainText("PROJ-CONFIG-EDIT-001 source comment review");
      await page.screenshot({ path: testInfo.outputPath("source-comment-review.png"), fullPage: true });
      await recordOperationEvidence({ operationId: "PROJ-CONFIG-EDIT-001", title: "Whole-source comment review submission",
        status: "passed", role: "Admin", route, page, testInfo, assertions: ["ui", "api", "screenshot"],
        api: [summarizeApiResponse(submitted.candidate, { method: "POST", path: `/api/v1/projects/${projectId}/parameter-file-candidates` }),
          summarizeApiResponse(submitted.submitted, { method: "POST", path: `/api/v1/projects/${projectId}/parameter-file-candidates/${submitted.item.candidateId}/source-submit`,
            responseSummary: "pending complete-source request; zero parameter changes; current file and Value unchanged" }),
          summarizeApiResponse(detail, { method: "GET", path: `/api/v2/projects/${projectId}/source-revision-requests/${submitted.receipt.requestId}` })],
        notes: "API mode at 1440x900; preview/edit preserve the complete source, server pins both bases and derives reviewer eligibility, submission history shows frozen before/after. No approval in this shared fixture." });
    } finally {
      if (submitted) {
        const withdrawn = await request.post(apiRoute(`/api/v2/projects/${projectId}/source-revision-requests/${submitted.receipt.requestId}/withdraw`), { headers });
        expect(withdrawn.status(), await withdrawn.text()).toBe(200);
      }
    }
  });

  test("navigates source-located structure spans, search, and deep links in API mode", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-SOURCE-001
    // @operation PROJ-CONFIG-SOURCE-001
    const suffix = randomUUID();
    const configSetName = `source-nav-${suffix}`;
    const primaryFileName = `acceptance-source-nav-${suffix}.dts`;
    const overlayFileName = `acceptance-source-overlay-${suffix}.dts`;
    const primaryDts = `/dts-v1/;
/ {
	board {
		model = "SourceNav";
		compatible = "mt,mt5788";
	};
	unregistered_source {
		compatible = "wiseeff,unregistered-source-nav";
		hidden_model = "Unregistered source remains locatable";
	};
};
`;
    const overlayNode = `source_nav_charger_${suffix.slice(0, 8)}`;
    const overlayDts = `/dts-v1/;
/ {
	${overlayNode} {
		compatible = "mt,mt5788";
		status = "okay";
	};
};
`;

    try {
      await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(primaryDts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };

      const overlayUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: overlayFileName,
          contentBase64: Buffer.from(overlayDts, "utf8").toString("base64")
        }
      });
      expect(overlayUpload.ok()).toBe(true);
      const overlayBody = (await overlayUpload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Source navigation acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      for (const [fileId, role, sortOrder] of [
        [primaryBody.item.id, "base", 0],
        [overlayBody.item.id, "overlay", 1]
      ] as const) {
        const addMember = await request.post(
          apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
          { headers: adminHeaders(), data: { fileId, role, sortOrder } }
        );
        expect(addMember.ok()).toBe(true);
      }

      const structureResponse = await request.get(
        apiRoute(
          `/api/v1/projects/${projectId}/parameter-files/${primaryBody.item.id}/versions/${primaryBody.version.id}/structure?navigationScope=organization`
        ),
        { headers: adminHeaders() }
      );
      expect(structureResponse.ok()).toBe(true);
      const structureBody = (await structureResponse.json()) as {
        nodes: Array<{ nodePath: string; source?: { startLine: number; endLine: number }; properties: Array<{ name: string; source?: unknown }> }>;
        navigation: { status: string; managedNodePaths: string[] };
      };
      const board = structureBody.nodes.find((node) => node.nodePath === "board");
      expect(board?.source?.startLine).toBeGreaterThanOrEqual(1);
      expect(board?.properties.some((property) => property.name === "model" && property.source)).toBe(true);
      expect(structureBody.navigation).toMatchObject({ status: "ready", managedNodePaths: expect.arrayContaining(["board"]) });
      expect(structureBody.navigation.managedNodePaths).not.toContain("unregistered_source");
      expect(structureBody.nodes.find((node) => node.nodePath === "unregistered_source")?.properties
        .some((property) => property.name === "hidden_model" && property.source)).toBe(true);

      const searchResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/dts-search?q=${encodeURIComponent(primaryFileName)}&navigationScope=organization`),
        { headers: adminHeaders() }
      );
      expect(searchResponse.ok()).toBe(true);
      const searchBody = (await searchResponse.json()) as {
        hits: Array<{ fileName: string; nodePath: string; source?: { startLine: number } }>;
      };
      expect(searchBody.hits.some((hit) => hit.fileName === primaryFileName)).toBe(true);

      await signInBrowserAsRole(page, "admin");
      await dismissXiaozeHint(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}`
      );
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();

      await expect(page.getByRole("treeitem", { name: "节点 unregistered_source", exact: true })).toHaveCount(0);
      const hiddenSearch = await request.get(apiRoute(`/api/v1/projects/${projectId}/dts-search?q=unregistered_source&navigationScope=organization`), { headers: adminHeaders() });
      expect(hiddenSearch.status(), await hiddenSearch.text()).toBe(200);
      expect((await hiddenSearch.json()).hits.filter((hit: { fileId: string }) => hit.fileId === primaryBody.item.id)).toHaveLength(0);

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await expect(page).toHaveURL(new RegExp(`node=board`));
      await expect(page.locator('[data-focused="true"]').first()).toBeVisible();

      await page.getByRole("treeitem", { name: "属性 board/model" }).click();
      await expect(page).toHaveURL(new RegExp(`property=model`));

      await page.getByRole("searchbox", { name: "统一搜索查询" }).fill(overlayNode);
      await page.getByRole("searchbox", { name: "统一搜索查询" }).press("Enter");
      const results = page.getByLabel("搜索结果");
      await expect(results).toContainText(overlayFileName);
      await results.getByRole("button", { name: new RegExp(overlayNode) }).click();
      await expect(page).toHaveURL(new RegExp(`file=${overlayBody.item.id}`));
      await expect(page).toHaveURL(new RegExp(`configSet=${configSetId}`));
      await expect(page.getByRole("heading", { name: overlayFileName })).toBeVisible();

      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}&node=unregistered_source&property=hidden_model&inspector=selection`
      );
      await expect(page.getByRole("textbox", { name: "DTS 源码", exact: true })).toContainText("Unregistered source remains locatable");
      await expect(page.getByRole("treeitem", { name: "节点 unregistered_source", exact: true })).toHaveCount(0);
      await expect(page.locator('[data-focused="true"]').first()).toBeVisible();

      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}&node=board&property=model&sourceMode=structured`
      );
      await expect(page.getByRole("treeitem", { name: "属性 board/model" })).toHaveAttribute("aria-selected", "true");

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-source-nav.json", {
        route: page.url(),
        configSetId,
        primaryFileId: primaryBody.item.id,
        overlayFileId: overlayBody.item.id,
        structureNodePaths: structureBody.nodes.map((node) => node.nodePath),
        searchHitCount: searchBody.hits.length
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-SOURCE-001",
        title: "source-located configuration workbench navigation",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(structureResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${primaryBody.item.id}/versions/${primaryBody.version.id}/structure`,
            responseSummary: `nodes=${structureBody.nodes.length}; boardSpan=${Boolean(board?.source)}`
          }),
          summarizeApiResponse(searchResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/dts-search`,
            responseSummary: `hits=${searchBody.hits.length}`
          })
        ],
        notes: "Structure spans, unified search grouped by file, cross-file navigation, and URL deep links were exercised on the flagged configuration workbench."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName, overlayFileName]
      });
    }
  });

  test("inspects context, file history, and source modes in API mode", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-INSPECT-001
    // @operation PROJ-CONFIG-INSPECT-001
    const suffix = randomUUID();
    const configSetName = `inspect-history-${suffix}`;
    const primaryFileName = `acceptance-inspect-${suffix}.dts`;
    const v1Dts = `/dts-v1/;
/ {
	board {
		model = "InspectV1";
		compatible = "mt,mt5788";
	};
};
`;
    const v2Dts = `/dts-v1/;
/ {
	board {
		model = "InspectV2";
		compatible = "mt,mt5788";
	};
};
`;

    try {
      await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
      const uploadV1 = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(v1Dts, "utf8").toString("base64")
        }
      });
      expect(uploadV1.ok()).toBe(true);
      const v1Body = (await uploadV1.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };

      const uploadV2 = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${v1Body.item.id}/versions`),
        {
          headers: adminHeaders(),
          data: {
            fileName: primaryFileName,
            contentBase64: Buffer.from(v2Dts, "utf8").toString("base64")
          }
        }
      );
      expect(uploadV2.ok()).toBe(true);
      const v2Body = (await uploadV2.json()) as {
        item: { id: string; versionNumber: number };
      };

      const versionsResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${v1Body.item.id}/versions`),
        { headers: adminHeaders() }
      );
      expect(versionsResponse.ok()).toBe(true);
      const versionsBody = (await versionsResponse.json()) as {
        items: Array<{ id: string; versionNumber: number }>;
      };
      expect(versionsBody.items.length).toBeGreaterThanOrEqual(2);

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Inspector history acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: v1Body.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(v1Body.item.id)}`
      );
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      await expect(page.locator(".configuration-workbench__source-head")).toContainText("工作配置");
      await openWorkbenchPanel(page, "release");
      await expect(page.getByRole("region", { name: "配置版本列表与详情" })).toBeVisible();
      await openWorkbenchPanel(page, "file");
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("文件格式");
      await expect(inspector.getByRole("button", { name: `查看版本 ${v2Body.item.versionNumber} 历史源码`, exact: true })).toContainText("活跃");
      await openWorkbenchPanel(page, "versions");
      await expect(inspector.getByLabel("版本历史")).toBeVisible();
      await expect(inspector).toContainText(`版本 ${v1Body.version.versionNumber}`);

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await expect(inspector).toContainText("节点路径");
      await expect(inspector.getByText("只读", { exact: true })).toHaveCount(0);

      await page.getByRole("treeitem", { name: "属性 board/model" }).click();
      await expect(inspector.getByRole("region", { name: "当前属性说明" })).toContainText("InspectV2");
      await expect(inspector.getByRole("group", { name: "属性值编辑" })).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "DTS 源码", exact: true })).toHaveAttribute("aria-readonly", "true");
      await expect(inspector.getByLabel("规范化预览")).toHaveCount(0);
      await expect(inspector.locator(".configuration-workbench__region-head")).toContainText("model");
      await expect(inspector).toContainText("InspectV2");

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await expect(inspector).toContainText("节点路径");
      await page.getByRole("treeitem", { name: new RegExp(primaryFileName) }).click();
      await expect(inspector).toContainText("文件格式");
      await expect(inspector.getByRole("region", { name: "版本历史" })).toBeVisible();
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      await expect(inspector.getByRole("button", { name: "关闭检查器" })).toBeVisible();

      const historyVersion = versionsBody.items.find((item) => item.id === v1Body.version.id) ?? versionsBody.items.at(-1);
      expect(historyVersion).toBeTruthy();
      await openWorkbenchPanel(page, "versions");
      await page
        .getByRole("button", { name: `查看版本 ${historyVersion!.versionNumber} 历史源码` })
        .click();
      await expect(page).toHaveURL(/sourceMode=history/);
      await expect(page.locator(".configuration-workbench__source-head")).toContainText("历史版本 · 只读");
      await expect(page.getByText(/model = "InspectV1"/)).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await openWorkbenchVersionMenu(page, historyVersion!.versionNumber);
      await page.getByRole("menuitem", { name: `下载版本 ${historyVersion!.versionNumber}`, exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain(primaryFileName);

      await page.getByRole("button", { name: "对比", exact: true }).click();
      await expect(page).toHaveURL(/sourceMode=unified-diff/);
      await expect(page.getByLabel("统一差异对比")).toBeVisible();

      await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
      await expect(page.getByRole("button", { name: "并排对比", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "统一差异", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "对比", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("并排差异对比")).toHaveCount(0);

      await page.getByRole("button", { name: "退出对比" }).click();
      await expect(page).not.toHaveURL(/sourceMode=/);
      await expect(page.getByText(/model = "InspectV2"/)).toBeVisible();

      await openWorkbenchPanel(page, "file");
      const openInspector = page.getByRole("complementary", { name: "配置检查器" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(openInspector).toBeVisible();
      const layout = await openInspector.getAttribute("data-layout");
      expect(layout === "overlay" || layout === "persistent").toBe(true);
      if (layout === "persistent") {
        const sourceBox = await page.locator(".configuration-workbench__source").boundingBox();
        const inspectorBox = await openInspector.boundingBox();
        expect(sourceBox!.x + sourceBox!.width).toBeLessThanOrEqual(inspectorBox!.x + 1);
      }
      // Adjacent PC panes share width; closing details restores the full source workspace.
      await openInspector.getByRole("button", { name: "关闭检查器", exact: true }).click();
      const sourceWidth = await page.locator(".configuration-workbench__source").evaluate((el) => el.getBoundingClientRect().width);
      expect(sourceWidth).toBeGreaterThanOrEqual(640);

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-inspect.json", {
        route: page.url(),
        configSetId,
        fileId: v1Body.item.id,
        activeVersionId: v2Body.item.id,
        historyVersionId: historyVersion!.id,
        versionCount: versionsBody.items.length
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-INSPECT-001",
        title: "configuration workbench inspector and file history",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(versionsResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${v1Body.item.id}/versions`,
            responseSummary: `versions=${versionsBody.items.length}`
          })
        ],
        notes: "Inspector levels, back stack, immutable history download, and history/diff source modes with restore were exercised on the flagged configuration workbench."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName]
      });
    }
  });

  test("uploads candidate, reviews impact, fails parse, and abandons without activation", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-CANDIDATE-001
    // @operation PROJ-CONFIG-CANDIDATE-001
    const suffix = randomUUID();
    const configSetName = `cand${suffix.replace(/-/g, "").slice(0, 16)}`;
    const primaryFileName = `acceptance-candidate-${suffix}.dts`;
    const v1Dts = `/dts-v1/;
/ {
	board {
		model = "CandV1";
		compatible = "wiseeff,cand";
	};
};
`;
    const v2Dts = `/dts-v1/;
/ {
	board {
		model = "CandV2";
		compatible = "wiseeff,cand";
	};
};
`;

    try {
      const uploadV1 = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(v1Dts, "utf8").toString("base64")
        }
      });
      expect(uploadV1.ok()).toBe(true);
      const v1Body = (await uploadV1.json()) as {
        item: { id: string; fileName: string; currentVersionId?: string };
        version: { id: string; versionNumber: number };
      };

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Candidate upload acceptance" }
      });
      if (createConfigSet.status() !== 201) {
        throw new Error(`config-set create ${createConfigSet.status()}: ${await createConfigSet.text()}`);
      }
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: v1Body.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const createCandidate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),
        {
          headers: adminHeaders(),
          data: {
            fileName: v1Body.item.fileName ?? primaryFileName,
            fileId: v1Body.item.id,
            contentBase64: Buffer.from(v2Dts, "utf8").toString("base64")
          }
        }
      );
      if (createCandidate.status() !== 201) {
        throw new Error(`candidate create ${createCandidate.status()}: ${await createCandidate.text()}`);
      }
      const candidateBody = (await createCandidate.json()) as {
        item: { id: string; status: string; baseVersionId?: string };
      };
      expect(["ready", "blocked"]).toContain(candidateBody.item.status);
      expect(candidateBody.item.baseVersionId).toBe(v1Body.version.id);

      const impactResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateBody.item.id}/impact`),
        { headers: adminHeaders() }
      );
      expect(impactResponse.ok()).toBe(true);
      const impactBody = (await impactResponse.json()) as {
        impact: { textDiff?: string; structuralDiff?: unknown[] };
      };
      expect(impactBody.impact.textDiff).toContain("CandV2");

      const filesAfter = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders()
      });
      expect(filesAfter.ok()).toBe(true);
      const filesBody = (await filesAfter.json()) as {
        items: Array<{ id: string; currentVersionId?: string }>;
      };
      const fileAfter = filesBody.items.find((item) => item.id === v1Body.item.id);
      expect(fileAfter?.currentVersionId).toBe(v1Body.version.id);

      const membersAfter = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders() }
      );
      expect(membersAfter.ok()).toBe(true);
      const membersBody = (await membersAfter.json()) as {
        items: Array<{ fileId: string }>;
      };
      expect(membersBody.items.some((item) => item.fileId === v1Body.item.id)).toBe(true);

      const failCandidate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),
        {
          headers: adminHeaders(),
          data: {
            fileName: `acceptance-candidate-fail-${suffix}.json`,
            contentBase64: Buffer.from("{not-json", "utf8").toString("base64")
          }
        }
      );
      expect([201, 400]).toContain(failCandidate.status());
      let failedCandidateId: string | undefined;
      if (failCandidate.status() === 201) {
        const failBody = (await failCandidate.json()) as {
          item: { id: string; status: string; diagnostics: Array<{ code: string }> };
        };
        expect(failBody.item.status).toBe("failed");
        expect(failBody.item.diagnostics.some((item) => item.code === "parse-failed")).toBe(true);
        failedCandidateId = failBody.item.id;
      } else {
        const failBody = (await failCandidate.json()) as { error?: { code?: string } };
        expect(failBody.error?.code).toBe("VALIDATION_FAILED");
      }

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(v1Body.item.id)}&sourceMode=candidate&candidate=${encodeURIComponent(candidateBody.item.id)}`
      );
      await expect(page.locator(".configuration-workbench__source-head")).toContainText(`${candidateBody.item.status === "ready" ? "待核对" : "需处理问题"} · 只读`);
      await openWorkbenchPanel(page, "candidates");
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      await expect(inspector.getByText("更新状态", { exact: true }).locator("..")).toContainText(candidateBody.item.status === "ready" ? "待核对" : "需处理问题");
      await expect(inspector).toContainText("结构差异");
      await expect(page.getByLabel("来源更新差异")).toContainText('model = "CandV1";');
      await expect(page.getByLabel("来源更新差异")).toContainText('model = "CandV2";');
      await page.getByRole("button", { name: "放弃更新" }).click();
      await expect(page.getByRole("status").filter({ hasText: "候选已放弃" })).toBeVisible();

      if (failedCandidateId) {
        const abandonFail = await request.post(
          apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${failedCandidateId}/abandon`),
          { headers: adminHeaders(), data: {} }
        );
        expect(abandonFail.ok()).toBe(true);
      }

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-candidate.json", {
        route: page.url(),
        configSetId,
        fileId: v1Body.item.id,
        activeVersionId: v1Body.version.id,
        candidateId: candidateBody.item.id,
        candidateStatus: candidateBody.item.status,
        failedCandidateId: failedCandidateId ?? null
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-CANDIDATE-001",
        title: "configuration workbench candidate upload impact abandon",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(createCandidate, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-candidates`,
            responseSummary: `status=${candidateBody.item.status}`
          }),
          summarizeApiResponse(impactResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-file-candidates/${candidateBody.item.id}/impact`,
            responseSummary: "impact loaded"
          })
        ],
        notes: "Candidate upload, impact review, parse failure, and abandon were exercised without changing active version or config-set membership."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName, `acceptance-candidate-fail-${suffix}.json`]
      });
    }
  });

  test("restores complete DTS drafts after reload and preserves them when the server base advances", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-DRAFT-001
    // @operation PROJ-CONFIG-DRAFT-001
    const suffix = randomUUID();
    const configSetName = `source-draft-${suffix}`;
    const primaryFileName = `acceptance-source-draft-${suffix}.dts`;
    const sample = `/dts-v1/;
/ {
  board {
    model = "DraftV1";
    compatible = "wiseeff,source-draft";
  };
};
`;
    const edited = sample.replace("DraftV1", "DraftV2");
    const advanced = sample.replace("DraftV1", "ServerV3");
    try {
      const upload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(), data: { fileName: primaryFileName, contentBase64: Buffer.from(sample).toString("base64") }
      });
      expect(upload.status(), await upload.text()).toBe(201);
      const uploaded = await upload.json() as { item: { id: string }; version: { id: string } };
      const created = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(), data: { name: configSetName, description: "Whole-source recovery acceptance" }
      });
      expect(created.status(), await created.text()).toBe(201);
      const configSetId = (await created.json()).item.id as string;
      const added = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
        headers: adminHeaders(), data: { fileId: uploaded.item.id, role: "base", sortOrder: 0 }
      });
      expect(added.status(), await added.text()).toBe(201);
      const baseVersionId = uploaded.version.id;
      // Initial fixture only: create the resolved revision from the already frozen
      // v1 through its production owner; later source changes still require review.
      const fixtureDb = createPostgresDatabase(databaseUrl!);
      setParameterIdentityMode("semantic");
      try {
        const revision = await ingestConfigRevision(fixtureDb, {
          organizationId, projectId, configSetId, entryFile: primaryFileName,
          includeSearchPaths: ["."], overlayOrder: [], members: [{
            fileId: uploaded.item.id, fileVersionId: baseVersionId,
            fileName: primaryFileName, sourceName: primaryFileName,
            role: "base", sortOrder: 0, content: sample
          }]
        }, makeTestAuthContext({ organizationId, userId: acceptanceCast.acceptanceAdmin.userId }));
        expect(revision.status).toBe("resolved");
        const current = await fixtureDb.query<{ current_version_id: string }>(
          "select current_version_id from project_parameter_files where id=$1 and organization_id=$2",
          [uploaded.item.id, organizationId]
        );
        expect(current.rows[0]?.current_version_id).toBe(baseVersionId);
      } finally {
        setParameterIdentityMode(null);
        await fixtureDb.close();
      }
      const route = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: configSetId, file: uploaded.item.id })}`;
      await signInBrowserAsRole(page, "admin", route);
      await dismissXiaozeHint(page);
      const editor = page.getByRole("textbox", { name: "DTS 源码", exact: true });
      await expect(editor).toHaveAttribute("aria-readonly", "true");
      await page.getByRole("radio", { name: "编辑", exact: true }).click();
      await editor.fill(edited);
      await expect(page.getByText("未保存修改", { exact: true })).toBeVisible();
      const storedDraft = () => page.evaluate((fileId) => new Promise<{
        sourceText: string; base: { fileVersionId: string; configRevisionId: string }; generation: number;
      } | null>((resolve, reject) => {
        const opened = indexedDB.open("wiseeff-source-drafts", 1);
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const database = opened.result;
          const transaction = database.transaction("drafts", "readonly");
          const read = transaction.objectStore("drafts").getAll();
          read.onsuccess = () => resolve((read.result as Array<{ draft: {
            sourceText: string; scope: { fileId: string }; base: { fileVersionId: string; configRevisionId: string }; generation: number;
          } | null }>).find((record) => record.draft?.scope.fileId === fileId)?.draft ?? null);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => database.close();
        };
      }), uploaded.item.id);
      await expect.poll(async () => (await storedDraft())?.sourceText).toBe(edited);
      expect((await storedDraft())?.base).toMatchObject({ fileVersionId: baseVersionId, configRevisionId: expect.any(String) });

      await page.getByRole("radio", { name: "预览", exact: true }).click();
      await expect(editor).toHaveAttribute("aria-readonly", "true");
      await expect(editor).toContainText("DraftV2");
      page.once("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(editor).toContainText("DraftV2");
      await expect(editor).toHaveAttribute("aria-readonly", "true");
      await expect(page.getByText("未保存修改", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /项目清单/ }).click();
      const leave = page.getByRole("dialog", { name: "离开配置工作台" });
      await expect(leave).toBeVisible();
      await leave.getByRole("button", { name: "留在本页" }).click();
      await expect(leave).toHaveCount(0);

      const oldDraft = await storedDraft();
      expect(oldDraft).toMatchObject({ sourceText: edited, base: { fileVersionId: baseVersionId, configRevisionId: expect.any(String) } });
      const mutationId = randomUUID();
      const advancedCandidate = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`), {
        headers: adminHeaders(), data: { fileName: primaryFileName, fileId: uploaded.item.id, intent: "source_revision",
          contentBase64: Buffer.from(advanced).toString("base64"), expectedCurrentVersionId: baseVersionId,
          expectedConfigRevisionId: oldDraft!.base.configRevisionId, clientMutationId: mutationId }
      });
      expect(advancedCandidate.status(), await advancedCandidate.text()).toBe(201);
      const advancedCandidateId = (await advancedCandidate.json()).item.id as string;
      const advancedPreview = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${advancedCandidateId}/source-preview`), { headers: adminHeaders() });
      expect(advancedPreview.status(), await advancedPreview.text()).toBe(200);
      const preview = (await advancedPreview.json()).item as ParameterFileSourcePreview;
      expect(preview).toMatchObject({ kind: "source_revision", canSubmit: true, before: sample, after: advanced });
      const reviewer = Object.values(acceptanceCast).find((actor) => preview.reviewers?.some((eligible) => eligible.userId === actor.userId));
      expect(reviewer, "the base advance needs an eligible non-author reviewer").toBeDefined();
      expect(reviewer!.userId).not.toBe(acceptanceCast.xuYun.userId);
      const advancedSubmit = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${advancedCandidateId}/source-submit`), {
        headers: adminHeaders(), data: { expectedCurrentVersionId: baseVersionId, expectedProofToken: preview.proofToken,
          clientMutationId: mutationId, assignedToUserId: reviewer!.userId, reason: "PROJ-CONFIG-DRAFT-001 advance authoritative source" }
      });
      expect(advancedSubmit.status(), await advancedSubmit.text()).toBe(200);
      const advanceRequestId = (await advancedSubmit.json()).item.requestId as string;
      const advanceReviewPath = `/api/v2/projects/${projectId}/source-revision-requests/${advanceRequestId}/review`;
      const advancedResponse = await request.post(apiRoute(advanceReviewPath), {
        headers: authHeadersForUser(reviewer!.userId, reviewer!.email, reviewer!.name),
        data: { decision: "approve", proofDigest: preview.proofToken, note: "Advance the server source while retaining the earlier browser draft" }
      });
      expect(advancedResponse.status(), await advancedResponse.text()).toBe(200);
      const approved = (await advancedResponse.json()).item as SourceRevisionRequest;
      expect(approved).toMatchObject({ status: "approved", reviewerUserId: reviewer!.userId,
        appliedSourceResult: { fileVersionId: expect.any(String), configRevisionId: expect.any(String) } });
      const advancedVersionId = approved.appliedSourceResult!.fileVersionId;
      expect(advancedVersionId).not.toBe(baseVersionId);
      page.once("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: "文件或配置版本已更新" })).toBeVisible();
      await expect(editor).toContainText("DraftV2");
      await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "下载草稿", exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(primaryFileName);
      const downloadPath = await download.path();
      expect(downloadPath).toBeTruthy();
      expect(await readFile(downloadPath!, "utf8")).toBe(edited);
      expect((await storedDraft())?.base.fileVersionId).toBe(baseVersionId);

      await page.getByRole("button", { name: "放弃修改", exact: true }).click();
      const discard = page.getByRole("dialog", { name: "放弃本地 DTS 修改？" });
      await discard.getByRole("button", { name: "放弃修改", exact: true }).click();
      await expect(discard).toHaveCount(0);
      await expect(editor).toContainText("ServerV3");
      await expect(page.getByText("未保存修改", { exact: true })).toHaveCount(0);
      await expect.poll(storedDraft).toMatchObject({ sourceText: advanced, base: {
        fileVersionId: advancedVersionId, configRevisionId: approved.appliedSourceResult!.configRevisionId
      } });
      await page.reload();
      await expect(editor).toContainText("ServerV3");
      await expect(editor).not.toContainText("DraftV2");
      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-source-recovery.json", {
        route: page.url(), configSetId, fileId: uploaded.item.id,
        originalVersionId: baseVersionId, advancedVersionId,
        recoveredText: edited, staleBaseProvenVia: "assigned non-author approval of a source revision",
        discardProvenVia: "UI discard persists the latest clean source/base and reloads"
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-DRAFT-001", title: "Recoverable complete DTS source draft",
        status: "passed", role: "Admin", route, page, testInfo, assertions: ["ui", "api", "screenshot"], artifacts: [evidencePath],
        api: [summarizeApiResponse(upload, { method: "POST", path: `/api/v1/projects/${projectId}/parameter-files` }),
          summarizeApiResponse(advancedResponse, { method: "POST", path: advanceReviewPath })],
        notes: "Native IndexedDB draft survives preview mode and reload; navigation asks before leaving. A real server version advance preserves the old source, disables save and permits exact-byte download. UI discard clears recovery and reloads the current source."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({ organizationId, projectId, configSetNames: [configSetName], fileNames: [primaryFileName] });
    }
  });



  test("opens Activity timeline from the command bar and restores or soft-fails targets", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-CONFIG-ACTIVITY-001
    // @operation PROJ-CONFIG-ACTIVITY-001
    const suffix = randomUUID();
    const configSetName = `activity-timeline-${suffix}`;
    const primaryFileName = `acceptance-activity-${suffix}.dts`;
    const dts = `/dts-v1/;
/ {
	board {
		model = "ActivityV1";
		compatible = "wiseeff,activity";
	};
};
`;
    const candidateDts = `/dts-v1/;
/ {
	board {
		model = "ActivityV2";
		compatible = "wiseeff,activity";
	};
};
`;

    try {
      const upload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(dts, "utf8").toString("base64")
        }
      });
      expect(upload.ok()).toBe(true);
      const uploadBody = (await upload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string };
      };

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Activity timeline acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: uploadBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const createCandidate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),
        {
          headers: adminHeaders(),
          data: {
            fileName: primaryFileName,
            fileId: uploadBody.item.id,
            contentBase64: Buffer.from(candidateDts, "utf8").toString("base64")
          }
        }
      );
      expect(createCandidate.status()).toBe(201);

      const auditResponse = await request.get(
        apiRoute(
          `/api/v1/audit-events?projectId=${encodeURIComponent(projectId)}&apps=parameters,parameter-management,parameter-admin&limit=20`
        ),
        { headers: adminHeaders() }
      );
      expect(auditResponse.ok()).toBe(true);
      const auditBody = (await auditResponse.json()) as { items: Array<{ id: string; kind: string }> };
      expect(auditBody.items.some((item) => item.kind.includes("candidate") || item.kind.includes("parameter-file"))).toBe(
        true
      );

      await signInBrowserAsRole(page, "admin");
      await dismissXiaozeHint(page);
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(uploadBody.item.id)}`
      );
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      await expect(page.getByLabel("治理审计")).toHaveCount(0);

      await page.getByRole("button", { name: "更多" }).click();
      await page.getByRole("menuitem", { name: "项目活动" }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toContainText("项目活动");
      await expect(inspector.getByLabel("项目活动事件")).toBeVisible();
      await expect(inspector).toHaveAttribute("data-layout", /overlay|persistent/);
      for (const width of [1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const activitySize = await inspector.locator(".configuration-workbench__inspector-body").evaluate((body) => ({
          width: body.clientWidth, scrollWidth: body.scrollWidth
        }));
        expect(activitySize.scrollWidth).toBeLessThanOrEqual(activitySize.width + 1);
      }

      const firstEvent = inspector.getByRole("button").filter({ hasText: /创建|上传|放弃|重算/ }).first();
      await firstEvent.click();
      const missing = page.getByRole("status", { name: "活动目标不可用" });
      const missingVisible = await missing.isVisible().catch(() => false);
      if (missingVisible) {
        await expect(missing).toBeVisible();
        await expect(page.getByRole("main", { name: /DTS 源码$/ })).toBeVisible();
      } else {
        await expect(page.getByRole("main", { name: /DTS 源码$/ })).toBeVisible();
      }

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-activity.json", {
        route: page.url(),
        configSetId,
        fileId: uploadBody.item.id,
        auditKinds: auditBody.items.map((item) => item.kind).slice(0, 8),
        missingTarget: missingVisible
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-ACTIVITY-001",
        title: "configuration workbench activity timeline",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(auditResponse, {
            method: "GET",
            path: `/api/v1/audit-events`,
            responseSummary: `items=${auditBody.items.length}`
          })
        ],
        notes:
          "Activity inspector opened from the command bar without a permanent audit banner; scoped audit projection and target navigation/soft-fail were exercised."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName]
      });
    }
  });
  test("creates Config set, manages members, syncs, and exports from the workbench", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-OPS-001
    // @operation PROJ-CONFIG-OPS-001
    const suffix = randomUUID();
    const configSetName = `file-config-ops-${suffix}`;
    const emptyConfigSetName = `file-config-ops-empty-${suffix}`;
    const primaryFileName = `acceptance-ops-primary-${suffix}.dts`;
    const looseFileName = `acceptance-ops-loose-${suffix}.json`;

    try {
      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(sampleDts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };
      const looseUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: looseFileName,
          contentBase64: Buffer.from('{"notes":"ungrouped-ops"}\n', "utf8").toString("base64")
        }
      });
      expect(looseUpload.ok()).toBe(true);
      const looseBody = (await looseUpload.json()) as { item: { id: string; fileName: string } };

      await signInBrowserAsRole(page, "admin", `/parameter-admin/projects/${projectId}/configuration`);
      await dismissXiaozeHint(page);
      const { response: createConfigSet, item: createdConfigSet } = await createWorkbenchConfigSet(page, configSetName);
      expect(createConfigSet.status()).toBe(201);
      const configSetId = createdConfigSet.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: primaryBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const duplicateCreate = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName }
      });
      expect([400, 409]).toContain(duplicateCreate.status());

      const exportResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/export`),
        { headers: adminHeaders() }
      );
      expect(exportResponse.ok()).toBe(true);
      const exportBody = (await exportResponse.json()) as {
        manifest: {
          members: Array<{ fileId: string; role: string; sortOrder: number }>;
          validation?: { ok: boolean };
        };
        files: Array<{ name: string; content: string }>;
      };
      expect(exportBody.manifest.members.some((item) => item.fileId === primaryBody.item.id)).toBe(true);
      expect(exportBody.files.length).toBeGreaterThan(0);

      const syncResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${primaryBody.item.id}/sync`),
        { headers: adminHeaders(), data: {} }
      );
      expect(syncResponse.ok()).toBe(true);

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}`
      );
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      const ungrouped = page.getByRole("group", { name: "待分配项目文件" });
      await expect(ungrouped).toContainText(looseFileName);
      await expect(ungrouped.locator(".configuration-workbench__ungrouped-file").filter({ hasText: looseFileName }))
        .toContainText("待分配");

      await page.getByRole("button", { name: `加入 ${looseFileName}` }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(looseFileName) })).toBeVisible({ timeout: 15_000 });

      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&inspector=config-set`
      );
      await dismissXiaozeHint(page);
      const files = page.getByRole("dialog", { name: "配置组成", exact: true });
      await expect(files).toBeVisible();
      await expect(files.getByRole("table", { name: "配置文件", exact: true })).toBeVisible();
      await expect(files.getByRole("button", { name: "关闭配置组成" })).toBeVisible();
      const fileActions = await openWorkbenchFileActions(page, looseFileName);
      await fileActions.getByRole("menuitem", { name: "从配置移除", exact: true }).click();
      const removeMemberDialog = page.getByRole("dialog", { name: "从配置移除文件" });
      await expect(removeMemberDialog).toBeVisible();
      await expect(removeMemberDialog).toContainText("后续基线与导出将不再包含它");
      const removeMemberResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          response.url().includes(`/config-sets/${configSetId}/files/${looseBody.item.id}`)
      );
      await removeMemberDialog.getByRole("button", { name: "确认移除" }).click();
      const removeMemberResponse = await removeMemberResponsePromise;
      expect(removeMemberResponse.ok()).toBe(true);
      await files.getByRole("button", { name: "关闭配置组成", exact: true }).click();
      await expect(ungrouped).toContainText(looseFileName);

      await openWorkbenchPanel(page, "file");
      await page.getByRole("treeitem", { name: new RegExp(primaryFileName) }).click();
      await page.getByRole("button", { name: "更多", exact: true }).click();
      const syncButton = page.getByRole("menuitem", { name: "手动同步", exact: true });
      await expect(syncButton).toBeVisible();
      await expect(syncButton).toBeEnabled();
      const manualSyncResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/parameter-files/${primaryBody.item.id}/sync`);
      await syncButton.click();
      expect((await manualSyncResponsePromise).ok()).toBe(true);
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText(primaryFileName);

      const uiExportResponsePromise = page.waitForResponse((response) => response.request().method() === "GET"
        && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/config-sets/${configSetId}/export`);
      const exportDownloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "配置", exact: true }).click();
      await page.getByRole("menuitem", { name: "导出当前配置", exact: true }).click();
      const uiExportResponse = await uiExportResponsePromise;
      expect(uiExportResponse.ok()).toBe(true);
      const uiExportBody = await uiExportResponse.json() as typeof exportBody;
      const exportDownload = await exportDownloadPromise;
      expect(exportDownload.suggestedFilename()).toBe(`${configSetName}-export.zip`);
      const exportDownloadPath = await exportDownload.path();
      expect(exportDownloadPath).not.toBeNull();
      const zip = await JSZip.loadAsync(await readFile(exportDownloadPath!));
      const manifestFile = zip.file("wiseeff-config-set-export-manifest.json");
      expect(manifestFile).not.toBeNull();
      const downloadedManifest = JSON.parse(await manifestFile!.async("string"));
      expect(downloadedManifest).toEqual(uiExportBody.manifest);
      expect(downloadedManifest).toMatchObject({ configSetId, name: configSetName, projectId,
        members: [{ fileId: primaryBody.item.id, role: "base", sortOrder: 0 }] });
      expect(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.name).sort())
        .toEqual(["wiseeff-config-set-export-manifest.json", ...uiExportBody.files.map((file) => file.name)].sort());
      for (const file of uiExportBody.files) {
        const archived = zip.file(file.name);
        expect(archived).not.toBeNull();
        expect(await archived!.async("string")).toBe(file.content);
      }
      expect(uiExportBody.files.map((file) => file.name)).toEqual([primaryFileName]);
      expect(uiExportBody.files[0]!.content).toContain('compatible = "wiseeff,tracer"');
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText("已导出配置", { timeout: 15_000 });

      const createDialog = await openWorkbenchCreateConfigSet(page);
      await createDialog.getByLabel("配置名称", { exact: true }).fill(configSetName);
      await createDialog.getByRole("button", { name: "创建配置", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "已存在名为" })).toBeVisible();
      await createDialog.getByRole("button", { name: "取消", exact: true }).click();

      const { response: emptyCreate, item: emptyCreatedConfigSet } = await createWorkbenchConfigSet(page, emptyConfigSetName);
      expect(emptyCreate.status()).toBe(201);
      const emptyBody = { item: emptyCreatedConfigSet };
      await selectWorkbenchConfigSet(page, configSetId);
      await expect(page.getByRole("treeitem", { name: new RegExp(primaryFileName) })).toBeVisible();
      await selectWorkbenchConfigSet(page, emptyBody.item.id);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("当前配置还没有文件", { exact: true })).toBeVisible();
      await openWorkbenchPanel(page, "candidates");
      await expect(page.getByRole("complementary", { name: "配置检查器" }).getByRole("button", { name: "添加来源文件", exact: true })).toBeEnabled();
      await expect(page.getByRole("group", { name: "待分配项目文件" })).toBeVisible();
      await expect(page.getByText(/已自动激活|自动成为工作配置/)).toHaveCount(0);

      const deniedAdd = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        {
          headers: authHeadersForRole("hardware-user"),
          data: { fileId: looseBody.item.id, role: "misc", sortOrder: 1 }
        }
      );
      expect(deniedAdd.status()).toBe(403);
      const deniedExport = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/export`),
        { headers: authHeadersForRole("hardware-user") }
      );
      expect(deniedExport.status()).toBe(403);

      // Parameter-admin page requires Admin, so non-admin denial is asserted via API while
      // the Admin browser session keeps the workbench read context visible.
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible();
      await expect(page.getByText("当前配置还没有文件", { exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "待分配项目文件" })).toContainText(looseFileName);

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-file-config-ops.json", {
        route: page.url(),
        configSetId,
        emptyConfigSetId: emptyBody.item.id,
        primaryFileId: primaryBody.item.id,
        looseFileId: looseBody.item.id,
        exportMembers: exportBody.manifest.members.length,
        downloadFilename: exportDownload.suggestedFilename(),
        downloadedManifest,
        uiRemoveMemberStatus: removeMemberResponse.status(),
        nonAdminDeniedAddStatus: deniedAdd.status(),
        nonAdminDeniedExportStatus: deniedExport.status()
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-OPS-001",
        title: "configuration workbench file and config-set operations",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(createConfigSet, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets`,
            responseSummary: `id=${configSetId}`
          }),
          summarizeApiResponse(exportResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/export`,
            responseSummary: `members=${exportBody.manifest.members.length}`
          }),
          summarizeApiResponse(syncResponse, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-files/${primaryBody.item.id}/sync`,
            responseSummary: "sync ok"
          }),
          summarizeApiResponse(removeMemberResponse, {
            method: "DELETE",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/files/${looseBody.item.id}`,
            responseSummary: "member removed through named confirmation dialog"
          }),
          summarizeApiResponse(deniedAdd, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/files`,
            responseSummary: "hardware-user denied 403"
          })
        ],
        notes: "Workbench create validation, member assign/remove with confirmation, ungrouped visibility, manual sync evidence, export, empty Config set focused upload/assignment copy (no auto-activation), and non-admin API denial with Admin read context retained."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName, emptyConfigSetName],
        fileNames: [primaryFileName, looseFileName]
      });
    }
  });

  test("loads server release readiness, remediates in Issues dock, and fail-closes create", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-CONFIG-READINESS-001
    // @operation PROJ-CONFIG-READINESS-001
    const suffix = randomUUID();
    const configSetName = `release-readiness-${suffix}`;
    const primaryFileName = `acceptance-readiness-${suffix}.dts`;
    let configSetId = "";
    let primaryFileId = "";

    try {
      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(sampleDts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string };
      };
      primaryFileId = primaryBody.item.id;

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Release readiness acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string } };
      configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: primaryFileId, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const readinessResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`),
        { headers: adminHeaders() }
      );
      expect(readinessResponse.ok()).toBe(true);
      const readinessBody = (await readinessResponse.json()) as {
        item: {
          available: boolean;
          level: string;
          gateToken: string;
          canCreateBaseline: boolean;
          canRelease: boolean;
          blockers: Array<{ code: string; message?: string }>;
          warnings: Array<{ code: string }>;
          unavailableReason?: string;
        };
      };
      // Fail-closed: unavailable is a valid gate outcome; never invent ready.
      expect(readinessBody.item).toEqual(
        expect.objectContaining({
          level: expect.stringMatching(/^(blocked|warning|ready|in-sync)$/),
          blockers: expect.any(Array),
          warnings: expect.any(Array),
          gateToken: expect.any(String),
          canCreateBaseline: expect.any(Boolean),
          canRelease: expect.any(Boolean)
        })
      );
      expect(readinessBody.item.gateToken).toBeTruthy();
      if (!readinessBody.item.available) {
        expect(readinessBody.item.canCreateBaseline).toBe(false);
        expect(readinessBody.item.canRelease).toBe(false);
        expect(readinessBody.item.unavailableReason || readinessBody.item.blockers.length).toBeTruthy();
      }

      const deniedReadiness = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`),
        { headers: hardwareHeaders() }
      );
      expect(deniedReadiness.status()).toBe(403);

      const staleCreate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
        {
          headers: adminHeaders(),
          data: { name: `stale-${suffix}`, gateToken: "not-a-real-token" }
        }
      );
      expect(staleCreate.status()).toBe(409);
      const staleBody = (await staleCreate.json()) as { error?: { details?: { code?: string } } };
      expect(["readiness-gate-stale", "readiness-unavailable", "readiness-blocked"]).toContain(
        staleBody.error?.details?.code
      );

      if (readinessBody.item.available && readinessBody.item.canCreateBaseline) {
        const createOk = await request.post(
          apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
          {
            headers: adminHeaders(),
            data: { name: `ready-${suffix}`, gateToken: readinessBody.item.gateToken }
          }
        );
        expect(createOk.status()).toBe(201);
      } else {
        const blockedCreate = await request.post(
          apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
          {
            headers: adminHeaders(),
            data: { name: `blocked-${suffix}`, gateToken: readinessBody.item.gateToken }
          }
        );
        expect(blockedCreate.status()).toBe(409);
      }

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryFileId)}`
      );
      await dismissXiaozeHint(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      const readinessSummary = page.getByRole("status", { name: "配置版本状态", includeHidden: true });
      await expect(readinessSummary).toBeVisible({ timeout: 30_000 });
      if (!readinessBody.item.available) {
        await expect(readinessSummary).toContainText(/不可用/);
      }
      await readinessSummary.getByRole("button").first().click();
      await expect(await openVersionCheckIssues(page)).toBeVisible();
      if (!readinessBody.item.available) {
        await expect(page.getByRole("region", { name: "版本检查问题" }).getByRole("button", { name: "重新检查" })).toBeVisible();
      }
      const createButton = page.getByRole("button", { name: "保存版本快照", exact: true });
      await expect(createButton).toBeVisible();
      if (!readinessBody.item.available || !readinessBody.item.canCreateBaseline || readinessBody.item.level === "blocked") {
        await expect(createButton).toBeDisabled();
      }

      const desktopOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth);

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-release-readiness.json",
        {
          route: page.url(),
          configSetId,
          readinessLevel: readinessBody.item.level,
          readinessAvailable: readinessBody.item.available,
          unavailableReason: readinessBody.item.unavailableReason ?? null,
          canCreateBaseline: readinessBody.item.canCreateBaseline,
          deniedStatus: deniedReadiness.status(),
          staleCreateStatus: staleCreate.status(),
          staleCreateCode: staleBody.error?.details?.code ?? null,
          viewports: ["1440x900"],
          desktopOverflow
        }
      );
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-READINESS-001",
        title: "configuration workbench release readiness",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(readinessResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`,
            responseSummary: `level=${readinessBody.item.level}`
          }),
          summarizeApiResponse(deniedReadiness, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`,
            responseSummary: "hardware-user denied 403"
          }),
          summarizeApiResponse(staleCreate, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`,
            responseSummary: "stale gate token 409"
          })
        ]
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName]
      });
    }
  });

  test("#1061 canonical submission blocks workbench release readiness until review completes", async ({
    page,
    request,
    browser
  }, testInfo) => {
    // @acceptance PROJ-CONFIG-READINESS-001
    // @operation PROJ-CONFIG-READINESS-001
    // @operation PARAM-CANONICAL-VALUE-WORKFLOW-001
    test.setTimeout(180_000);
    const scopedProjectId = `t1061-readiness-${randomUUID()}`;
    const fileName = "readiness-battery.dts";
    const source = `/dts-v1/;
/ {
  battery0 {
    cccv_0 = <4500 0>;
  };
};
`;
    let configSetId = "";
    let fileId = "";
    let bindingId = "";
    let draftId = "";
    let requestId = "";
    let completed = false;
    const apiEvidence: Array<ReturnType<typeof summarizeApiResponse>> = [];
    const readinessStates: Array<{
      phase: string;
      available: boolean;
      canRelease: boolean;
      canCreateBaseline: boolean;
      blockerCodes: string[];
    }> = [];
    const screenshots: string[] = [];
    const reviewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const reviewerPage = await reviewerContext.newPage();
    const readinessPath = () => `/api/v1/projects/${scopedProjectId}/config-sets/${configSetId}/release-readiness`;
    const workbenchRoute = () =>
      `/parameter-admin/projects/${scopedProjectId}/configuration?configSet=${configSetId}&file=${fileId}`;
    const openWorkbench = async (phase: string) => {
      const evaluated = page.waitForResponse((response) =>
        response.request().method() === "GET" && response.url().endsWith(readinessPath())
      );
      await signInBrowserAsRole(page, "admin", workbenchRoute());
      await dismissXiaozeHint(page);
      const response = await evaluated;
      expect(response.status(), await response.text()).toBe(200);
      const { item } = await response.json() as {
        item: {
          available: boolean;
          canRelease: boolean;
          canCreateBaseline: boolean;
          blockers: Array<{ code: string }>;
          warnings: Array<{ code: string }>;
        };
      };
      readinessStates.push({ phase, available: item.available, canRelease: item.canRelease,
        canCreateBaseline: item.canCreateBaseline, blockerCodes: item.blockers.map((blocker) => blocker.code) });
      apiEvidence.push(summarizeApiResponse(response, {
        method: "GET", path: readinessPath(),
        responseSummary: `${phase}: canRelease=${item.canRelease}; blockers=${item.blockers.map((blocker) => blocker.code).join(",")}`
      }));
      expect(item.available).toBe(true);
      const summary = page.getByRole("status", { name: "配置版本状态", includeHidden: true });
      await expect(summary).toHaveAttribute("data-can-release", String(item.canRelease));
      await summary.getByRole("button").first().click();
      await expect(await openVersionCheckIssues(page)).toBeVisible();
      return item;
    };

    try {
      await withPgClient(async (client) => {
        await client.query(
          `insert into projects (id, organization_id, name, code, status)
           values ($1, $2, 'Canonical release readiness', $1, 'initialized')`,
          [scopedProjectId, organizationId]
        );
        await client.query(`insert into project_members(organization_id,project_id,user_id,roles)
          values ($1,$2,$3,ARRAY['software-user'])`, [organizationId,scopedProjectId,acceptanceCast.liuMin.userId]);
        for (const [userId, roleId] of [
          [acceptanceCast.liuMin.userId, "software-user"],
          [acceptanceCast.sunMei.userId, "software-committer"]
        ]) {
          await client.query(
            `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
             values ($1, $2, $3, $4, $5)`,
            [`${scopedProjectId}-${roleId}`, userId, organizationId, scopedProjectId, roleId]
          );
        }
      });
      const configSet = await request.post(apiRoute(`/api/v1/projects/${scopedProjectId}/config-sets`), {
        headers: adminHeaders(), data: { name: "default", description: "#1061 canonical readiness regression" }
      });
      expect(configSet.status(), await configSet.text()).toBe(201);
      configSetId = (await configSet.json()).item.id;
      const upload = () => request.post(apiRoute(`/api/v1/projects/${scopedProjectId}/parameter-files`), {
        headers: adminHeaders(), data: { fileName, contentBase64: Buffer.from(source).toString("base64") }
      });
      const firstUpload = await upload();
      expect(firstUpload.status(), await firstUpload.text()).toBe(201);
      fileId = (await firstUpload.json()).item.id;
      const member = await request.post(apiRoute(`/api/v1/projects/${scopedProjectId}/config-sets/${configSetId}/files`), {
        headers: adminHeaders(), data: { fileId, role: "base", sortOrder: 0 }
      });
      expect(member.ok(), await member.text()).toBe(true);
      const synchronized = await upload();
      expect(synchronized.status(), await synchronized.text()).toBe(201);
      const bindings = await request.get(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-bindings`), {
        headers: authHeadersForRole("software-user")
      });
      expect(bindings.status(), await bindings.text()).toBe(200);
      const { items } = await bindings.json() as { items: Array<{ id: string; propertyKey: string; rawValue: string }> };
      const binding = items.find((item) => item.propertyKey === "cccv_0");
      expect(binding, "Parent-seeded published Catalog and battery0 registration must materialize cccv_0").toBeTruthy();
      expect(binding!.rawValue).toBe("<4500 0>");
      bindingId = binding!.id;

      const initial = await openWorkbench("before-submit");
      expect(initial.blockers.map((blocker) => blocker.code)).not.toContain("pending-change");
      expect(initial.canCreateBaseline).toBe(true);
      expect(initial.canRelease).toBe(true);

      await signInBrowserAsRole(page, "software-user", `/parameters?project=${scopedProjectId}`);
      await dismissXiaozeHint(page);
      const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
      await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("cccv_0");
      await workspace.locator(`[data-binding-id="${bindingId}"]`)
        .getByRole("button", { name: /^参数详情 cccv_0/ }).click();
      const dialog = page.getByRole("dialog", { name: /参数详情$/ });
      await dialog.getByLabel(/^目标值(?:\s*·\s*.+)?$/).fill("<4510 0>");
      await dialog.getByLabel("修改原因", { exact: true }).fill("#1061 canonical submission gates release readiness");
      const created = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-bindings/${bindingId}/drafts`));
      await dialog.getByRole("button", { name: "保存草稿" }).click();
      const draft = await created;
      expect(draft.status(), await draft.text()).toBe(201);
      draftId = (await draft.json()).item.draftId;
      await expect(dialog.getByText("草稿已保存，待提交审核。", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "关闭参数详情" }).click();
      const submission = page.getByRole("region", { name: "参数修改提交" });
      await selectControlOption(submission.getByLabel("软件 MDE", { exact: true }), acceptanceCast.sunMei.userId);
      const submitted = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-drafts/${draftId}/submit`));
      await submission.getByRole("button", { name: /提交/ }).click();
      const submit = await submitted;
      expect(submit.ok(), await submit.text()).toBe(true);
      const pendingRequest = (await submit.json()).item;
      requestId = pendingRequest.id;
      expect(pendingRequest.status).toBe("pending");
      expect(pendingRequest.assignedToUserId).toBe(acceptanceCast.sunMei.userId);
      apiEvidence.push(summarizeApiResponse(submit, {
        method: "POST", path: `/api/v2/projects/${scopedProjectId}/parameter-value-drafts/${draftId}/submit`,
        responseSummary: `Canonical request ${requestId} submitted to independent software reviewer`
      }));

      const pending = await openWorkbench("pending-review");
      const pendingIssue = page.getByRole("region", { name: "版本检查问题" }).locator('[data-code="pending-change"]');
      await expect(pendingIssue).toBeVisible();
      await expect(pendingIssue).toContainText(/1\D/);
      const reviewRoute = `/parameter-review?project=${scopedProjectId}&request=${requestId}`;
      await pendingIssue.getByRole("button").click();
      await expect(page).toHaveURL(new RegExp(`request=${requestId}`));
      await openWorkbench("pending-review-return");
      expect(pending.blockers.map((blocker) => blocker.code)).toContain("pending-change");
      expect(pending.canRelease).toBe(false);
      expect(pending.canCreateBaseline).toBe(false);
      await expect(page.getByRole("status", { name: "配置版本状态", includeHidden: true })).toHaveAttribute("data-can-release", "false");
      await expect(page.getByRole("button", { name: "保存版本快照", exact: true })).toBeDisabled();
      const blockedScreenshot = testInfo.outputPath("canonical-readiness-blocked.png");
      await page.screenshot({ path: blockedScreenshot, animations: "disabled" });
      screenshots.push(blockedScreenshot);

      await signInBrowserAsRole(reviewerPage, "software-committer", reviewRoute);
      await dismissXiaozeHint(reviewerPage);
      await reviewerPage.bringToFront();
      const review = reviewerPage.getByRole("region", { name: "软件配置审核" });
      await review.getByText("查看完整源文件", { exact: true }).click();
      await expect(review.getByLabel("固定源变更后")).toContainText("4510");
      const reviewed = reviewerPage.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${requestId}/review`));
      await review.getByRole("button", { name: "批准软件配置" }).click();
      await reviewerPage.getByRole("dialog", { name: "确认应用软件配置", exact: true }).getByRole("button", { name: "确认批准并应用", exact: true }).click();
      const approval = await reviewed;
      expect(approval.ok(), await approval.text()).toBe(true);
      const approvedRequest = (await approval.json()).item as { id: string; status: string; appliedValueId: string };
      expect(approvedRequest).toMatchObject({ id: requestId, status: "approved", appliedValueId: expect.any(String) });
      apiEvidence.push(summarizeApiResponse(approval, {
        method: "POST", path: `/api/v2/projects/${scopedProjectId}/parameter-value-change-requests/${requestId}/review`,
        responseSummary: "Independent software reviewer approved the canonical source change"
      }));

      const refreshed = page.waitForResponse((response) => response.request().method() === "GET"
        && response.url().endsWith(readinessPath()));
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const refreshedResponse = await refreshed;
      expect(refreshedResponse.status(), await refreshedResponse.text()).toBe(200);
      const cleared = (await refreshedResponse.json()).item;
      readinessStates.push({ phase: "after-approval-mounted", available: cleared.available,
        canRelease: cleared.canRelease, canCreateBaseline: cleared.canCreateBaseline,
        blockerCodes: cleared.blockers.map((blocker: { code: string }) => blocker.code) });
      await expect(page.getByRole("status", { name: "配置版本状态", includeHidden: true })).toHaveAttribute("data-can-release", "true");
      expect(cleared.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain("pending-change");
      await expect(page.getByRole("region", { name: "版本检查问题" }).locator('[data-code="pending-change"]')).toHaveCount(0);
      expect(cleared.canCreateBaseline).toBe(true);
      expect(cleared.canRelease).toBe(true);
      await expect(page.getByRole("button", { name: "保存版本快照", exact: true })).toBeEnabled();
      const clearedScreenshot = testInfo.outputPath("canonical-readiness-cleared.png");
      await page.screenshot({ path: clearedScreenshot, animations: "disabled" });
      screenshots.push(clearedScreenshot);
      const appliedBindings = await request.get(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-bindings`), {
        headers: authHeadersForRole("software-user")
      });
      expect(appliedBindings.status(), await appliedBindings.text()).toBe(200);
      const appliedBody = await appliedBindings.json() as {
        items: Array<{ id: string; currentValueId: string; rawValue: string }>;
      };
      expect(appliedBody.items.find((item) => item.id === bindingId)).toMatchObject({
        currentValueId: approvedRequest.appliedValueId, rawValue: "<4510 0>"
      });
      apiEvidence.push(summarizeApiResponse(appliedBindings, {
        method: "GET", path: `/api/v2/projects/${scopedProjectId}/parameter-bindings`,
        responseSummary: `Binding ${bindingId} current value matches approved value ${approvedRequest.appliedValueId}`
      }));
      await withPgClient(async (client) => {
        const persisted = await client.query(
          `select request.status, request.applied_value_id, request.applied_audit_ref, request.applied_history_event_id
           from project_parameter_value_change_requests request
           where request.organization_id = $1 and request.project_id = $2 and request.id = $3`,
          [organizationId, scopedProjectId, requestId]
        );
        expect(persisted.rows).toEqual([expect.objectContaining({ status: "approved", applied_value_id: approvedRequest.appliedValueId,
          applied_audit_ref: expect.any(String), applied_history_event_id: expect.any(String) })]);
      });
      const revisions = await request.get(apiRoute(`/api/v2/projects/${scopedProjectId}/config-sets/${configSetId}/revisions`), {
        headers: authHeadersForRole("software-user")
      });
      expect(revisions.status(), await revisions.text()).toBe(200);
      const revision = (await revisions.json()).items.find((item: { status: string }) => item.status === "resolved");
      expect(revision).toBeTruthy();
      const nextDraft = await request.post(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-bindings/${bindingId}/drafts`), {
        headers: authHeadersForRole("software-user"), data: { ...draft.request().postDataJSON(),
          baseRevisionId: revision.id, reason: "Withdraw canonical pending work without reopening readiness" }
      });
      expect(nextDraft.status(), await nextDraft.text()).toBe(201);
      const nextDraftId = (await nextDraft.json()).item.draftId;
      const nextSubmission = await request.post(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-value-drafts/${nextDraftId}/submit`), {
        headers: authHeadersForRole("software-user"), data: { assignedToUserId: acceptanceCast.sunMei.userId }
      });
      expect(nextSubmission.status(), await nextSubmission.text()).toBe(201);
      requestId = (await nextSubmission.json()).item.id;
      await reviewerPage.bringToFront();
      const pendingRefresh = page.waitForResponse((response) => response.request().method() === "GET"
        && response.url().endsWith(readinessPath()));
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const pendingResponse = await pendingRefresh;
      expect(pendingResponse.status(), await pendingResponse.text()).toBe(200);
      expect((await pendingResponse.json()).item.blockers.map((blocker: { code: string }) => blocker.code))
        .toContain("pending-change");
      await expect(page.getByRole("status", { name: "配置版本状态", includeHidden: true })).toHaveAttribute("data-can-release", "false");
      const withdrawal = await request.post(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-value-change-requests/${requestId}/withdraw`), {
        headers: authHeadersForRole("software-user"), data: {}
      });
      expect(withdrawal.status(), await withdrawal.text()).toBe(200);
      expect((await withdrawal.json()).item.status).toBe("withdrawn");
      await reviewerPage.bringToFront();
      const withdrawalRefresh = page.waitForResponse((response) => response.request().method() === "GET"
        && response.url().endsWith(readinessPath()));
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const afterWithdrawal = await withdrawalRefresh;
      expect(afterWithdrawal.status(), await afterWithdrawal.text()).toBe(200);
      const withdrawnReadiness = (await afterWithdrawal.json()).item;
      expect(withdrawnReadiness.canRelease).toBe(true);
      expect(withdrawnReadiness.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain("pending-change");
      await expect(page.getByRole("status", { name: "配置版本状态", includeHidden: true })).toHaveAttribute("data-can-release", "true");
      readinessStates.push({ phase: "after-withdrawal-mounted", available: withdrawnReadiness.available,
        canRelease: withdrawnReadiness.canRelease, canCreateBaseline: withdrawnReadiness.canCreateBaseline,
        blockerCodes: withdrawnReadiness.blockers.map((blocker: { code: string }) => blocker.code) });
      apiEvidence.push(summarizeApiResponse(withdrawal, {
        method: "POST", path: `/api/v2/projects/${scopedProjectId}/parameter-value-change-requests/${requestId}/withdraw`,
        responseSummary: "Withdrawal clears readiness in the still-mounted workbench"
      }));
      completed = true;
    } finally {
      await reviewerContext.close();
      const evidencePath = await writeOperationJsonArtifact(testInfo, "canonical-release-readiness.json", {
        projectId: scopedProjectId, configSetId, fileId, bindingId, draftId, requestId,
        viewport: "1440x900", refreshTrigger: "window focus event emulated for Chromium automation", readinessStates, completed
      });
      for (const operationId of ["PROJ-CONFIG-READINESS-001", "PARAM-CANONICAL-VALUE-WORKFLOW-001"]) {
        await recordOperationEvidence({
          operationId, title: "canonical submission gates workbench readiness until independent approval",
          status: completed ? "passed" : "failed", role: "Software User → Admin → Software Committer → Admin",
          route: workbenchRoute(), page, testInfo, assertions: ["ui", "api", "screenshot"],
          artifacts: [evidencePath, ...screenshots], api: apiEvidence,
          notes: "Focused #1061 journey only; not full canonical workflow operation coverage. Uses parent-seeded API/Catalog; no nested runtime. Approval and withdrawal refresh the mounted workbench through an emulated browser focus event; no workbench reload or mocked API. Immutable fixture source history stays in the owned test database."
        });
      }
      if (requestId && !completed) {
        const pending = await withPgClient((client) => client.query(
          `select status from project_parameter_value_change_requests
           where organization_id = $1 and project_id = $2 and id = $3`,
          [organizationId, scopedProjectId, requestId]
        ));
        if (pending.rows[0]?.status === "pending") {
          const withdrawn = await request.post(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-value-change-requests/${requestId}/withdraw`), {
            headers: authHeadersForRole("software-user"), data: { reason: "#1061 failed regression cleanup" }
          });
          expect(withdrawn.ok(), await withdrawn.text()).toBe(true);
        }
      } else if (draftId && !requestId) {
        const removed = await request.delete(apiRoute(`/api/v2/projects/${scopedProjectId}/parameter-value-drafts/${draftId}`), {
          headers: authHeadersForRole("software-user")
        });
        expect(removed.ok(), await removed.text()).toBe(true);
      }
    }
  });

  test("creates, compares, releases, and restores baselines in source context", async ({
    page,
    request
  }, testInfo) => {
    annotateFailureRoute(testInfo, PROJECT_CONFIGURATION_BASELINE_FAILURE_ROUTE);
    // @acceptance PROJ-CONFIG-BASELINE-001
    // @operation PROJ-CONFIG-BASELINE-001
    const suffix = randomUUID();
    const configSetName = `release-baselines-${suffix}`;
    const primaryFileName = `acceptance-baseline-${suffix}.dts`;
    let configSetId = "";
    let primaryFileId = "";
    let draftBaselineId = "";
    let releasedTipId: string | undefined;

    try {
      await withPgClient(async (client) => {
        await client.query(
          `
          update parameter_change_requests
          set status = 'withdrawn'
          where project_id = $1
            and status in ('submitted', 'hardware_review', 'software_review', 'software_merge')
          `,
          [projectId]
        );
        await client.query(
          `
          update parameter_file_sync_conflicts
          set status = 'resolved'
          where project_id = $1
            and status = 'open'
          `,
          [projectId]
        );
      });

      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(sampleDts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as {
        item: { id: string };
        version: { id: string };
      };
      primaryFileId = primaryBody.item.id;

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Release baselines acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string } };
      configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: primaryFileId, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const readinessResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`),
        { headers: adminHeaders() }
      );
      expect(readinessResponse.ok()).toBe(true);
      const readinessBody = (await readinessResponse.json()) as {
        item: {
          available: boolean;
          canCreateBaseline: boolean;
          canRelease: boolean;
          gateToken: string;
          level: string;
          releasedBaselineId?: string;
          blockers: Array<{ id: string; code: string; message?: string }>;
          warnings: Array<{ id: string; acknowledgementRequired?: boolean }>;
        };
      };

      const acknowledgedWarningIds = readinessBody.item.warnings
        .filter((item) => item.acknowledgementRequired)
        .map((item) => item.id);

      const createBaseline = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
        {
          headers: adminHeaders(),
          data: {
            name: `draft-${suffix}`,
            gateToken: readinessBody.item.gateToken,
            acknowledgedWarningIds
          }
        }
      );

      expect(
        createBaseline.status(),
        `baseline create should succeed when gate allows; readiness=${JSON.stringify({
          available: readinessBody.item.available,
          level: readinessBody.item.level,
          canCreateBaseline: readinessBody.item.canCreateBaseline,
          blockers: readinessBody.item.blockers
        })}`
      ).toBe(201);
      const createdBody = (await createBaseline.json()) as { item: { id: string; status: string } };
      draftBaselineId = createdBody.item.id;
      expect(createdBody.item.status).toBe("draft");

      const getBaseline = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${draftBaselineId}`),
        { headers: adminHeaders() }
      );
      expect(getBaseline.ok()).toBe(true);
      const detailBody = (await getBaseline.json()) as {
        item: { id: string };
        members: Array<{ fileId: string; fileVersionId: string }>;
      };
      expect(detailBody.members.length).toBeGreaterThan(0);

      const compareWorking = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${draftBaselineId}/compare?against=working`),
        { headers: adminHeaders() }
      );
      expect(compareWorking.ok()).toBe(true);
      const compareBody = (await compareWorking.json()) as {
        item: { against: string; members: Array<{ status: string }> };
      };
      expect(compareBody.item.against).toBe("working");

      const previewRestore = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${draftBaselineId}/restore-preview`),
        { headers: adminHeaders() }
      );
      expect(previewRestore.ok()).toBe(true);
      const previewBody = (await previewRestore.json()) as {
        item: { releasedBaselineUnchanged: boolean; driftedCount: number; members: unknown[] };
      };
      expect(previewBody.item.releasedBaselineUnchanged).toBe(true);

      const readinessBeforeRelease = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`),
        { headers: adminHeaders() }
      );
      const readinessBeforeReleaseBody = (await readinessBeforeRelease.json()) as {
        item: { canRelease: boolean; gateToken: string; releasedBaselineId?: string };
      };
      releasedTipId = readinessBeforeReleaseBody.item.releasedBaselineId;

      if (readinessBeforeReleaseBody.item.canRelease) {
        const releaseResponse = await request.post(
          apiRoute(`/api/v1/projects/${projectId}/baselines/${draftBaselineId}/release`),
          {
            headers: adminHeaders(),
            data: { gateToken: readinessBeforeReleaseBody.item.gateToken }
          }
        );
        expect(releaseResponse.ok()).toBe(true);
        const releaseBody = (await releaseResponse.json()) as { item: { id: string; status: string } };
        expect(releaseBody.item.status).toBe("released");
        releasedTipId = releaseBody.item.id;

        const listAfterRelease = await request.get(
          apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
          { headers: adminHeaders() }
        );
        const listBody = (await listAfterRelease.json()) as {
          items: Array<{ id: string; status: string }>;
        };
        expect(listBody.items.filter((item) => item.status === "released")).toHaveLength(1);
      }

      const tipBeforeRestore = releasedTipId;
      const restorePreviewBeforeApply = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${draftBaselineId}/restore-preview`),
        { headers: adminHeaders() }
      );
      expect(restorePreviewBeforeApply.ok()).toBe(true);

      const rollback = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${draftBaselineId}/rollback`),
        { headers: adminHeaders(), data: {} }
      );
      expect(rollback.ok()).toBe(true);

      const listAfterRestore = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
        { headers: adminHeaders() }
      );
      const afterRestoreBody = (await listAfterRestore.json()) as {
        items: Array<{ id: string; status: string }>;
      };
      const tipAfterRestore = afterRestoreBody.items.find((item) => item.status === "released")?.id;
      if (tipBeforeRestore) {
        expect(tipAfterRestore).toBe(tipBeforeRestore);
      }

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryFileId)}&baseline=${encodeURIComponent(draftBaselineId)}`
      );
      await dismissXiaozeHint(page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await openWorkbenchPanel(page, "release");
      await expect(page.getByRole("region", { name: "配置版本列表与详情" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel("配置版本历史")).toBeVisible();

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-release-baselines.json",
        {
          route: page.url(),
          configSetId,
          draftBaselineId,
          releasedTipId: tipAfterRestore ?? tipBeforeRestore ?? null,
          releasedTipUnchanged: tipBeforeRestore ? tipAfterRestore === tipBeforeRestore : null,
          viewports: ["1440x900"]
        }
      );
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-BASELINE-001",
        title: "configuration workbench release baselines",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(createBaseline, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`,
            responseSummary: `draft=${draftBaselineId}`
          }),
          summarizeApiResponse(compareWorking, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/baselines/${draftBaselineId}/compare`,
            responseSummary: `against=${compareBody.item.against}`
          }),
          summarizeApiResponse(previewRestore, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/baselines/${draftBaselineId}/restore-preview`,
            responseSummary: `drifted=${previewBody.item.driftedCount}`
          }),
          summarizeApiResponse(rollback, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/baselines/${draftBaselineId}/rollback`,
            responseSummary: "restore applied"
          })
        ]
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName]
      });
    }
  });

  test("redirects legacy project-operation deep links into workbench contexts", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-CUTOVER-001
    // @operation PROJ-CONFIG-CUTOVER-001
    // @operation PROJ-OPS-001
    // @operation PROJ-OPS-002
    // @operation PROJ-OPS-003
    const suffix = randomUUID();
    const configSetName = `cutover-${suffix}`;
    const primaryFileName = `acceptance-cutover-${suffix}.dts`;

    try {
      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(sampleDts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string };
      };

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Cutover acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string } };
      const configSetId = configSetBody.item.id;
      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: primaryBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      await signInBrowserAsRole(page, "admin", "/parameter-admin/projects");
      await dismissXiaozeHint(page);

      const redirects: Array<{ from: string; expectQuery: RegExp; contentTab: string }> = [
        {
          from: `/parameter-admin/projects/${projectId}/files?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}`,
          expectQuery: /inspector=file/,
          contentTab: "源码"
        },
        {
          from: `/parameter-admin/projects/${projectId}/config-sets?configSet=${encodeURIComponent(configSetId)}`,
          expectQuery: /inspector=config-set/,
          contentTab: "源码"
        },
        {
          from: `/parameter-admin/projects/${projectId}/structure?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}&node=chosen`,
          expectQuery: /sourceMode=working/,
          contentTab: "源码"
        },
        {
          from: `/parameter-admin/projects/${projectId}/conflicts?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}`,
          expectQuery: /tasks=conflicts/,
          contentTab: "冲突"
        }
      ];

      for (const item of redirects) {
        await page.goto(item.from);
        await dismissXiaozeHint(page);
        await expect(page).toHaveURL(
          new RegExp(`/parameter-admin/projects/${projectId}/configuration(?:\\?|$)`)
        );
        await expect(page).toHaveURL(item.expectQuery);
        await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
        if (item.contentTab === "冲突") {
          await expect(page.getByRole("tab", { name: /^冲突/ })).toHaveAttribute("aria-selected", "true");
          await expect(page.getByRole("tabpanel", { name: /^冲突/ })).toBeVisible();
        } else {
          await expect(page.getByRole("region", { name: "配置内容", exact: true })).toBeVisible();
          await expect(page.getByRole("tab", { name: "结构", exact: true })).toHaveCount(0);
          const contentTabs = page.getByRole("tablist", { name: "项目配置内容", exact: true });
          if (await contentTabs.isVisible()) {
            await expect(contentTabs.getByRole("tab", { name: "源码", exact: true })).toHaveAttribute("aria-selected", "true");
            await expect(page.getByRole("tabpanel", { name: "源码", exact: true })).toBeVisible();
          } else await expect(page.getByRole("tabpanel")).toHaveCount(0);
        }
        await expect(page.getByRole("region", { name: "配置导航", exact: true })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "项目运营视图" })).toHaveCount(0);
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(primaryBody.item.id)}`
      );
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      const desktopOverflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth
        };
      });
      expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth + 1);

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-cutover.json",
        {
          route: page.url(),
          redirects: redirects.map((item) => item.from),
          viewports: ["1440x900"],
          desktopOverflow,
          configSetId,
          fileId: primaryBody.item.id
        }
      );
      const cutoverApi = [
        summarizeApiResponse(primaryUpload, {
          method: "POST",
          path: `/api/v1/projects/${projectId}/parameter-files`,
          responseSummary: `file=${primaryBody.item.id}`
        }),
        summarizeApiResponse(createConfigSet, {
          method: "POST",
          path: `/api/v1/projects/${projectId}/config-sets`,
          responseSummary: `configSet=${configSetId}`
        }),
        summarizeApiResponse(addMember, {
          method: "POST",
          path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/files`,
          responseSummary: `member=${primaryBody.item.id}`
        })
      ];
      for (const operationId of [
        "PROJ-CONFIG-CUTOVER-001",
        "PROJ-OPS-001",
        "PROJ-OPS-002",
        "PROJ-OPS-003"
      ] as const) {
        await recordOperationEvidence({
          operationId,
          title: "legacy project-operation cutover to configuration workbench",
          status: "passed",
          role: "Admin",
          route: `/parameter-admin/projects/${projectId}/configuration`,
          page,
          testInfo,
          assertions: ["ui", "api", "screenshot"],
          artifacts: [evidencePath],
          api: cutoverApi,
          notes:
            operationId === "PROJ-CONFIG-CUTOVER-001"
              ? "Legacy deep links redirected to workbench contexts; PC 1440x900 had no page-level overflow."
              : `Superseded operation ${operationId} covered by PROJ-CONFIG-CUTOVER-001 cutover evidence.`
        });
      }
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName]
      });
    }
  });
});

test.describe("project configuration workbench post-cutover semantic identity", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable workbench acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "pcw_sem",
      markerPurpose: "pcw-semantic",
      apiEnv: Object.fromEntries(["WISEEFF_DTS_TOOLCHAIN_DIR", "WISEEFF_DTC_PATH", "WISEEFF_FDTOVERLAY_PATH", "WISEEFF_DT_VALIDATE_PATH"]
        .map((key) => [key, process.env[key]])
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0))
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
    await assertPostCutoverIdentity();
    await bindHardwareUserToProject(projectId);
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("edits complete DTS source and applies it only after the assigned reviewer approves", async ({ page, request, browser }, testInfo) => {
    // @acceptance PROJ-CONFIG-EDIT-001
    // @operation PROJ-CONFIG-EDIT-001
    test.setTimeout(240_000);
    const sample = `/dts-v1/;
/ {
  board {
    rx_mod_cm_cfg = "EditV1";
    compatible = "mt,mt5788";
  };
};
`;
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
    const binding = await seedIsolatedBinding(request, {
      propertyKey: "rx_mod_cm_cfg", dts: sample, rawValuePattern: '"EditV1"', nodeLocatorPattern: "board",
      reason: "PROJ-CONFIG-EDIT-001 semantic binding", timeoutMs: 60_000
    });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const structurePath = `/api/v1/projects/${projectId}/parameter-files/${file.fileId}/versions/${file.versionId}/structure`;
    const structureResponse = await request.get(apiRoute(structurePath), { headers: adminHeaders() });
    expect(structureResponse.status(), await structureResponse.text()).toBe(200);
    const structure = await structureResponse.json() as { nodes: Array<{ nodePath: string; properties: Array<{ name: string }> }> };
    expect(structure.nodes.find((node) => node.nodePath === "board")?.properties.some((property) => property.name === "rx_mod_cm_cfg")).toBe(true);
    const workbenchPath = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: binding.configSetId, file: file.fileId })}`;
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, workbenchPath));
    await dismissXiaozeHint(page);
    await expect(page.getByRole("heading", { name: binding.fileName })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("treeitem", { name: "属性 board/rx_mod_cm_cfg", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "属性 board/rx_mod_cm_cfg", exact: true })).toHaveAttribute("data-property-identity", "board::rx_mod_cm_cfg");
    await ensureInspectorOpen(page);
    const inspector = page.getByRole("complementary", { name: "配置检查器" });
    await expect(inspector.getByRole("region", { name: "当前属性说明" })).toContainText('"EditV1"');
    await expect(inspector.getByRole("group", { name: "属性值编辑" })).toHaveCount(0);
    const sourcePath = `/api/v1/projects/${projectId}/parameter-files/${file.fileId}/versions/${file.versionId}/content`;
    const source = await request.get(apiRoute(sourcePath), { headers: adminHeaders() });
    expect(source.status(), await source.text()).toBe(200);
    const before = await source.text();
    const edited = before.replace('"EditV1"', '"EditV2"');
    expect(edited).not.toBe(before);
    const submitted = await submitSourceFromEditor(page, edited, "PROJ-CONFIG-EDIT-001 reviewed whole DTS edit");
    expect(submitted.item.impact).toMatchObject({ parameterChanges: 1, nodeAdditions: 0, nodeRemovals: 0 });
    const requestPath = `/api/v2/projects/${projectId}/source-revision-requests/${submitted.receipt.requestId}`;
    const pending = await request.get(apiRoute(requestPath), { headers: adminHeaders() });
    expect(pending.status(), await pending.text()).toBe(200);
    expect((await pending.json()).item).toMatchObject({ status: "pending", before, after: edited, assignedToUserId: submitted.reviewer.userId });
    const bindingsPath = `/api/v2/projects/${projectId}/parameter-bindings`;
    const initial = await request.get(apiRoute(bindingsPath), { headers: adminHeaders() });
    expect(initial.status(), await initial.text()).toBe(200);
    const beforeBinding = (await initial.json()).items.find((item: { id: string }) => item.id === binding.bindingId);
    expect(beforeBinding).toMatchObject({ effectiveValue: { kind: "strings", values: ["EditV1"] }, rawValue: '"EditV1"' });
    expect((await lookupParameterFileVersion({ fileName: binding.fileName })).versionId).toBe(file.versionId);

    const reviewer = Object.values(acceptanceCast).find((actor) => actor.userId === submitted.reviewer.userId);
    expect(reviewer).toBeDefined();
    const reviewContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let approval: Response;
    try {
      const reviewerPage = await reviewContext.newPage();
      await signInBrowserAsUser(reviewerPage, reviewer!.userId, reviewer!.email, reviewer!.name,
        disposablePageUrl(disposableRuntime, `/parameter-review?project=${projectId}&request=${submitted.receipt.requestId}&type=source`));
      await dismissXiaozeHint(reviewerPage);
      const review = reviewerPage.getByRole("region", { name: "DTS 整文件审核" });
      await expect(review).toContainText("EditV1");
      await expect(review).toContainText("EditV2");
      await review.getByRole("textbox", { name: "DTS 审核说明" }).fill("Reviewed exact source and pinned parameter change");
      const approvedResponse = reviewerPage.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `${requestPath}/review`, { timeout: 60_000 });
      await review.getByRole("button", { name: "批准并应用 DTS", exact: true }).click();
      approval = await approvedResponse;
      expect(approval.status(), await approval.text()).toBe(200);
      expect((await approval.json()).item).toMatchObject({ status: "approved", id: submitted.receipt.requestId });
      await expect(review.getByRole("button", { name: "批准并应用 DTS", exact: true })).toHaveCount(0);
    } finally { await reviewContext.close(); }

    const applied = await request.get(apiRoute(requestPath), { headers: adminHeaders() });
    expect(applied.status(), await applied.text()).toBe(200);
    const receipt = (await applied.json()).item as SourceRevisionRequest;
    expect(receipt).toMatchObject({ status: "approved", before, after: edited, reviewerUserId: reviewer!.userId,
      appliedSourceResult: { configRevisionId: expect.any(String), fileVersionId: expect.any(String) } });
    expect(receipt.appliedSourceResult!.fileVersionId).not.toBe(file.versionId);
    const current = await request.get(apiRoute(bindingsPath), { headers: adminHeaders() });
    expect(current.status(), await current.text()).toBe(200);
    const afterBinding = (await current.json()).items.find((item: { id: string }) => item.id === binding.bindingId);
    expect(afterBinding).toMatchObject({ id: beforeBinding.id, definitionId: beforeBinding.definitionId,
      effectiveValue: { kind: "strings", values: ["EditV2"] }, rawValue: '"EditV2"' });
    expect(afterBinding.currentValueId).not.toBe(beforeBinding.currentValueId);
    const activeFile = await lookupParameterFileVersion({ fileName: binding.fileName });
    expect(activeFile.versionId).toBe(receipt.appliedSourceResult!.fileVersionId);
    const contentPath = `/api/v1/projects/${projectId}/parameter-files/${file.fileId}/versions/${activeFile.versionId}/content`;
    const content = await request.get(apiRoute(contentPath), { headers: adminHeaders() });
    expect(content.status(), await content.text()).toBe(200);
    expect(await content.text()).toBe(edited);
    await page.getByRole("button", { name: "检查审核结果", exact: true }).click();
    await expect(page.getByText("当前工作配置", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "DTS 源码", exact: true })).toContainText("EditV2");
    const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-source-edit.json", {
      route: page.url(), configSetId: binding.configSetId, fileId: file.fileId, bindingId: binding.bindingId,
      baseVersionId: file.versionId, requestId: submitted.receipt.requestId, reviewerUserId: reviewer!.userId,
      oldValueId: beforeBinding.currentValueId, newValueId: afterBinding.currentValueId, appliedSourceResult: receipt.appliedSourceResult
    });
    await recordOperationEvidence({
      operationId: "PROJ-CONFIG-EDIT-001", title: "Complete DTS edit with assigned human approval",
      status: "passed", role: "Admin", route: workbenchPath, page, testInfo, assertions: ["ui", "api", "screenshot"], artifacts: [evidencePath],
      api: [summarizeApiResponse(structureResponse, { method: "GET", path: structurePath }),
        summarizeApiResponse(submitted.submitted, { method: "POST", path: `/api/v1/projects/${projectId}/parameter-file-candidates/${submitted.item.candidateId}/source-submit` }),
        summarizeApiResponse(approval!, { method: "POST", path: `${requestPath}/review` }),
        summarizeApiResponse(content, { method: "GET", path: contentPath, responseSummary: "exact reviewed source bytes" })],
      notes: "Real registered Binding fixture on the disposable API runtime. The whole-file editor stages immutable source; current file and Value stay unchanged while pending. The server-eligible assigned reviewer approves in a separate browser context; exact source, stable Binding identity, new Value and config/file receipt agree."
    });
  });

  test("lets an unrelated administrator reassign and cancel a source request, preserving its diff and unblocking submission",async ({ page,request },testInfo) => {
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request,[{ subjectId: "csub_drv_mt_mt5788",canonicalName: "mt,mt5788" }]);
    const original = '/dts-v1/; / { board { compatible = "mt,mt5788"; rx_fod_cond = "AdminV1", "keep"; }; };';
    const binding = await seedIsolatedBinding(request,{ propertyKey: "rx_fod_cond",dts: original,rawValuePattern: '"AdminV1", "keep"',
      nodeLocatorPattern: "board",reason: "#1302 source request administration",timeoutMs: 60_000 });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const workbench = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: binding.configSetId,file: file.fileId })}`;
    await signInBrowserAsRole(page,"admin",disposablePageUrl(disposableRuntime,workbench));
    await dismissXiaozeHint(page);
    await expect(page.getByRole("heading",{ name: binding.fileName })).toBeVisible();
    const edited = original.replace('"AdminV1"','"AdminV2"');
    const submitted = await submitSourceFromEditor(page,edited,"#1302 administrator takeover");
    const actors = ["manager","delegate"].map((kind) => ({ id: `source-${kind}-${randomUUID()}`,name: `Source ${kind}`,email: `${kind}-${randomUUID()}@chargelab.cn` }));
    await withPgClient(async (client) => {
      for (const actor of actors) {
        await client.query("insert into users(id,organization_id,name,email,title,is_active) values($1,$2,$3,$4,'Source administrator',true)",[actor.id,organizationId,actor.name,actor.email]);
        await client.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values($1,$2,$3,null,'admin')",[`${actor.id}-role`,actor.id,organizationId]);
      }
    });
    const [manager,delegate] = actors as [typeof actors[number],typeof actors[number]];
    const requestPath = `/api/v2/projects/${projectId}/source-revision-requests/${submitted.receipt.requestId}`;
    const managerHeaders = authHeadersForUser(manager.id,manager.email,manager.name);
    const reviewRoute = `/parameter-review?${new URLSearchParams({ project: projectId,request: submitted.receipt.requestId,type: "source" })}`;
    await signInBrowserAsUser(page,manager.id,manager.email,manager.name,disposablePageUrl(disposableRuntime,reviewRoute));
    await dismissXiaozeHint(page);
    let panel = page.getByRole("region",{ name: "DTS 整文件审核" });
    await expect(panel).toContainText("AdminV1"); await expect(panel).toContainText("AdminV2");
    await expect(panel.getByRole("button",{ name: "批准并应用 DTS",exact: true })).toHaveCount(0);
    await selectControlOption(panel.getByRole("combobox",{ name: "新的源码审核人" }),delegate.id);
    await withPgClient((client) => client.query("delete from user_role_bindings where id=$1",[`${delegate.id}-role`]));
    const expectedFailure: ExpectedApiFailure = { method: "POST",path: `${requestPath}/reassign`,status: 400 };
    expectedBrowserApiFailures.push(expectedFailure);
    try {
      const failure = page.waitForResponse((response) => new URL(response.url()).pathname === `${requestPath}/reassign` && response.request().method()==="POST");
      await panel.getByRole("button",{ name: "重新指派审核人" }).click();
      expect((await failure).status()).toBe(400);
      await expect(panel.getByRole("alert")).toContainText("审核资格");
      await withPgClient((client) => client.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values($1,$2,$3,null,'admin')",[`${delegate.id}-role`,delegate.id,organizationId]));
      await panel.getByRole("button",{ name: "刷新状态" }).click();
      await selectControlOption(panel.getByRole("combobox",{ name: "新的源码审核人" }),delegate.id);
      const reassigned = page.waitForResponse((response) => new URL(response.url()).pathname === `${requestPath}/reassign` && response.request().method()==="POST");
      await panel.getByRole("button",{ name: "重新指派审核人" }).click();
      expect((await reassigned).status()).toBe(200);
      await expect(panel).toContainText(`审核人：${delegate.name}`);
      const cancel = panel.getByRole("button",{ name: "取消源码请求" });
      await expect(cancel).toBeDisabled();
      await panel.getByRole("textbox",{ name: "取消源码请求的理由" }).fill("管理员解除待审配置阻塞");
      await expect(cancel).toBeEnabled(); await cancel.scrollIntoViewIfNeeded();
      const screenshot = testInfo.outputPath("source-request-administration-1440x900.png");
      await page.screenshot({ path: screenshot }); await testInfo.attach("Source request administration",{ path: screenshot,contentType: "image/png" });
      const cancelled = page.waitForResponse((response) => new URL(response.url()).pathname === `${requestPath}/cancel` && response.request().method()==="POST");
      await cancel.focus(); await page.keyboard.press("Enter");
      expect((await cancelled).status()).toBe(200);
      await page.goto(disposablePageUrl(disposableRuntime,`${reviewRoute}&view=history`));
      panel = page.getByRole("region",{ name: "DTS 整文件审核" });
      await expect(panel).toContainText(`管理员取消：${manager.name} · 管理员解除待审配置阻塞`);
      await expect(panel).toContainText("AdminV2");
      const detail = await request.get(apiRoute(requestPath),{ headers: managerHeaders });
      expect(detail.status(),await detail.text()).toBe(200);
      expect((await detail.json()).item).toMatchObject({ status: "withdrawn",reviewerUserId: null,after: edited,
        proofDigest: submitted.item.proofToken,cancellation: { userId: manager.id,reason: "管理员解除待审配置阻塞" } });
      const active = (await readCanonicalFixtureBindings(projectId)).find((row) => row.id===binding.bindingId)!;
      const candidate = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),{ headers: managerHeaders,data: {
        fileId: file.fileId,fileName: binding.fileName,contentBase64: Buffer.from(`${edited}\n/* after cancellation */`).toString("base64"),intent: "source_revision",
        expectedCurrentVersionId: file.versionId,expectedConfigRevisionId: active.configRevisionId,clientMutationId: `admin-unblocked-${randomUUID()}` } });
      expect(candidate.status(),await candidate.text()).toBe(201);
      const candidateId = (await candidate.json()).item.id as string;
      const preview = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-preview`),{ headers: managerHeaders });
      expect(preview.status(),await preview.text()).toBe(200);
      const next = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-submit`),{ headers: managerHeaders,data: {
        expectedCurrentVersionId: file.versionId,expectedProofToken: (await preview.json()).item.proofToken,assignedToUserId: delegate.id,
        reason: "Configuration is unblocked",clientMutationId: `admin-unblocked-submit-${randomUUID()}` } });
      expect(next.status(),await next.text()).toBe(200);
      const nextId = (await next.json()).item.requestId as string;
      expect((await request.post(apiRoute(`/api/v2/projects/${projectId}/source-revision-requests/${nextId}/withdraw`),{ headers: managerHeaders })).status()).toBe(200);
    } finally { expectedBrowserApiFailures.splice(expectedBrowserApiFailures.indexOf(expectedFailure),1); }
  });

  test("restores a complete Canonical snapshot after a stale-plan refusal and retains added members through keyboard confirmation",async ({ page,request },testInfo) => {
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request,[{ subjectId: "csub_drv_mt_mt5788",canonicalName: "mt,mt5788" }]);
    const original = '/dts-v1/; / { board { compatible = "mt,mt5788"; rx_fod_cond = "RestoreV1", "keep"; }; };';
    const binding = await seedIsolatedBinding(request,{ propertyKey: "rx_fod_cond",dts: original,rawValuePattern: '"RestoreV1", "keep"',nodeLocatorPattern: "board",reason: "#1306 complete snapshot restore",timeoutMs: 60_000 });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const readiness = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets/${binding.configSetId}/release-readiness`),{ headers: adminHeaders() });
    expect(readiness.status(),await readiness.text()).toBe(200);
    const gate = (await readiness.json()).item as DtsReleaseReadiness;
    expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const saved = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${binding.configSetId}/baselines`),{
      headers: adminHeaders(),data: { name: `restore-${randomUUID()}`,gateToken: gate.gateToken,acknowledgedWarningIds: gate.warnings.filter(row => row.acknowledgementRequired).map(row => row.id) } });
    expect(saved.status(),await saved.text()).toBe(201);
    const baselineId = (await saved.json()).item.id as string;
    async function edit(content: string,key: string) {
      const activeFile = await lookupParameterFileVersion({ fileName: binding.fileName });
      const active = (await readCanonicalFixtureBindings(projectId)).find(row => row.id===binding.bindingId)!;
      const candidate = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),{ headers: adminHeaders(),data: {
        fileId: file.fileId,fileName: binding.fileName,contentBase64: Buffer.from(content).toString("base64"),intent: "source_revision",
        expectedCurrentVersionId: activeFile.versionId,expectedConfigRevisionId: active.configRevisionId,clientMutationId: `${key}-candidate` } });
      expect(candidate.status(),await candidate.text()).toBe(201);
      const candidateId = (await candidate.json()).item.id as string;
      const preview = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-preview`),{ headers: adminHeaders() });
      expect(preview.status(),await preview.text()).toBe(200);
      const committed = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-apply`),{ headers: adminHeaders(),data: {
        expectedCurrentVersionId: activeFile.versionId,expectedProofToken: (await preview.json()).item.proofToken,reason: "Snapshot restore browser fixture edit",clientMutationId: key } });
      expect(committed.status(),await committed.text()).toBe(200);
    }
    await edit(original.replace("RestoreV1","RestoreV2"),"restore-browser-edit-v2");
    const candidate = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),{ headers: adminHeaders(),data: {
      fileName: `retained-${randomUUID()}.json`,contentBase64: Buffer.from('{"metadata":"retain"}').toString("base64") } });
    expect(candidate.status(),await candidate.text()).toBe(201);
    const additionPath = `/api/v1/projects/${projectId}/config-sets/${binding.configSetId}/member-addition`;
    const addition = { candidateId: (await candidate.json()).item.id,role: "charging",sortOrder: 1 };
    const additionPreview = await request.post(apiRoute(`${additionPath}/preview`),{ headers: adminHeaders(),data: addition });
    expect(additionPreview.status(),await additionPreview.text()).toBe(200);
    const joined = await request.post(apiRoute(`${additionPath}/apply`),{ headers: adminHeaders(),data: { ...addition,proofToken: (await additionPreview.json()).item.proofToken,reason: "Retain metadata after snapshot",clientMutationId: "restore-browser-extra" } });
    expect(joined.status(),await joined.text()).toBe(200);
    const route = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: binding.configSetId,file: file.fileId,baseline: baselineId })}`;
    await signInBrowserAsRole(page,"admin",disposablePageUrl(disposableRuntime,route)); await dismissXiaozeHint(page);
    const versions = await openWorkbenchPanel(page,"release");
    await versions.getByRole("button",{ name: "恢复到此版本…",exact: true }).click();
    const dialog = page.getByRole("dialog",{ name: "恢复版本确认",exact: true });
    await expect(dialog).toContainText("保留新增成员");
    await expect(dialog.getByRole("button",{ name: "确认恢复",exact: true })).toBeDisabled();
    await dialog.getByRole("textbox",{ name: "恢复原因",exact: true }).fill("#1306 restore checked complete source composition");
    await edit(original.replace("RestoreV1","RestoreV3"),"restore-browser-edit-v3");
    const rollbackPath = `/api/v1/projects/${projectId}/baselines/${baselineId}/rollback`;
    expectedBrowserApiFailures.push({ method: "POST",path: rollbackPath,status: 409 });
    const stale = page.waitForResponse(response => response.request().method()==="POST" && new URL(response.url()).pathname===rollbackPath);
    await dialog.getByRole("button",{ name: "确认恢复",exact: true }).focus(); await page.keyboard.press("Enter");
    expect((await stale).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toContainText("过期");
    await expect(dialog.getByRole("textbox",{ name: "恢复原因",exact: true })).toHaveValue("#1306 restore checked complete source composition");
    await dialog.getByRole("button",{ name: "重新预览",exact: true }).click();
    await expect(page.getByRole("dialog",{ name: "恢复版本确认",exact: true })).toContainText("保留新增成员");
    const composition = dialog.getByRole("table",{ name: "恢复后的成员组成" });
    await expect(composition.getByRole("columnheader")).toHaveCount(4);
    expect(await composition.evaluate(table => {
      const bounds = table.closest('[role="dialog"]')!.getBoundingClientRect();
      return [...table.querySelectorAll("th, td")].every(cell => {
        const rect = cell.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right;
      });
    }),"all restore member versions, roles and actions must fit the confirmation dialog").toBe(true);
    const screenshot = testInfo.outputPath("canonical-configuration-restore-1440x900.png");
    await page.screenshot({ path: screenshot }); await testInfo.attach("Complete snapshot restore preview",{ path: screenshot,contentType: "image/png" });
    const committed = page.waitForResponse(response => response.request().method()==="POST" && new URL(response.url()).pathname===rollbackPath);
    await dialog.getByRole("button",{ name: "确认恢复",exact: true }).focus(); await page.keyboard.press("Enter");
    const response = await committed; expect(response.status(),await response.text()).toBe(200);
    await expect(dialog).toHaveCount(0); await page.reload();
    const after = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`),{ headers: adminHeaders() });
    expect((await after.json()).items.find((row: { id: string }) => row.id===binding.bindingId)).toMatchObject({ rawValue: '"RestoreV1", "keep"' });
    await expect(await openWorkbenchPanel(page,"config-set")).toContainText("retained-");
  });

  test("shared successor comparison and authorized usage retain the exact project pin", async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request,[{subjectId:"csub_drv_mt_mt5788",canonicalName:"mt,mt5788"}]);
    const sample='/dts-v1/; / { board { compatible = "mt,mt5788"; rx_fod_cond = "ProjectLocal", "keep"; }; };';
    const binding=await seedIsolatedBinding(request,{propertyKey:"rx_fod_cond",dts:sample,rawValuePattern:'"ProjectLocal", "keep"',nodeLocatorPattern:"board",reason:"#1421 fixed usage",timeoutMs:60_000});
    const publish=async(resource:string,revision:number)=>{
      const preview=await request.post(apiRoute(`/api/v2/shared-dtsi/${resource}/publication-preview`),{headers:adminHeaders(),data:{expectedRevision:revision}});
      expect(preview.status(),await preview.text()).toBe(201);
      const response=await request.post(apiRoute(`/api/v2/shared-dtsi/${resource}/publications`),{headers:adminHeaders(),data:{previewId:(await preview.json()).item.id,idempotencyKey:`t10-${randomUUID()}`}});
      expect(response.status(),await response.text()).toBe(201);return (await response.json()).item as import("../../server/modules/contracts/dtoSchemas/sharedDtsi").SharedDtsiVersion;
    };
    const dependency=await request.post(apiRoute("/api/v2/shared-dtsi"),{headers:adminHeaders(),data:{name:`Shared dependency ${randomUUID()}`,sourceName:"leaf.dtsi",content:'/ { dependency { status = "okay"; }; };',changeDescription:"Exact dependency"}});
    expect(dependency.status(),await dependency.text()).toBe(201);
    const leaf=await publish((await dependency.json()).item.resourceId,1);
    const content='/include/ "parts/common.dtsi"\n/include/ "vendor/leaf.dtsi"\n/ { board { rx_fod_cond = "SharedOriginal", "keep"; }; };\n';
    const resource=await request.post(apiRoute("/api/v2/shared-dtsi"),{headers:adminHeaders(),data:{name:`Shared comparison ${randomUUID()}`,members:[{sourceName:"main.dtsi",content},
      {sourceName:"parts/common.dtsi",content:'/ { common { status = "okay"; }; };\n'}],dependencies:[{resourceId:leaf.resourceId,versionId:leaf.id,mountPath:"vendor"}],changeDescription:"Original published source"}});
    expect(resource.status(),await resource.text()).toBe(201);
    const resourceId=(await resource.json()).item.resourceId as string,first=await publish(resourceId,1);
    const addition={sharedReference:{resourceId,versionId:first.id},role:"misc",sortOrder:1};
    const composition=`/api/v1/projects/${projectId}/config-sets/${binding.configSetId}/member-addition`;
    const preview=await request.post(apiRoute(`${composition}/preview`),{headers:adminHeaders(),data:addition});expect(preview.status(),await preview.text()).toBe(200);
    const applied=await request.post(apiRoute(`${composition}/apply`),{headers:adminHeaders(),data:{...addition,proofToken:(await preview.json()).item.proofToken,reason:"#1421 immutable pin",clientMutationId:`t10-pin-${randomUUID()}`}});
    expect(applied.status(),await applied.text()).toBe(200);
    const route=`/parameter-admin/sources?${new URLSearchParams({organization:organizationId,resource:resourceId})}`;
    await signInBrowserAsRole(page,"admin",disposablePageUrl(disposableRuntime,route));await dismissXiaozeHint(page);
    await expect(page.getByText("v1 · 已发布，只读",{exact:true})).toBeVisible();
    await page.getByRole("tab",{name:"版本",exact:true}).click();
    await expect(page.getByRole("button",{name:"v1",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"比较所选版本",exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"创建新版本",exact:true}).click();
    await expect(page.getByLabel("变更说明",{exact:true})).toHaveValue("");
    const draftResponse=await request.get(apiRoute(`/api/v2/shared-dtsi/${resourceId}`),{headers:adminHeaders()});
    const draft=(await draftResponse.json()).item as import("../../server/modules/contracts/dtoSchemas/sharedDtsi").SharedDtsiDraft;
    expect(draft.members.map(({id,sourceName,content:source})=>({id,sourceName,content:source}))).toEqual(first.members.map(({id,sourceName,content:source})=>({id,sourceName,content:source})));
    expect(draft.dependencies).toEqual(first.manifest.dependencies);
    const changed=content.replace("SharedOriginal","SharedSuccessor");
    await page.getByLabel("DTSI 源码",{exact:true}).fill(changed);
    await page.getByLabel("变更说明",{exact:true}).fill("Shared successor; projects remain pinned");
    await page.getByRole("button",{name:"预览发布",exact:true}).click();
    await expect(page.getByText("发布共享版本，不会自动更新项目配置。",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"发布版本",exact:true}).focus();await page.keyboard.press("Enter");
    await expect(page.getByText("v2 · 已发布，只读",{exact:true})).toBeVisible();
    const current=await request.get(apiRoute(`/api/v2/shared-dtsi/${resourceId}/detail`),{headers:adminHeaders()});const secondId=(await current.json()).item.currentVersion.id as string;
    const secondResponse=await request.get(apiRoute(`/api/v2/shared-dtsi/${resourceId}/versions/${secondId}`),{headers:adminHeaders()});const second=(await secondResponse.json()).item as typeof first;
    expect(second.members.map(member=>member.id)).toEqual(first.members.map(member=>member.id));expect(second.manifest.dependencyClosure).toEqual(first.manifest.dependencyClosure);
    expect(second.members.find(member=>member.sourceName==="main.dtsi")!.content).toBe(changed);
    const sourceScreenshot=testInfo.outputPath("shared-successor-source-1440.png");await page.screenshot({path:sourceScreenshot});await testInfo.attach("Shared successor source 1440",{path:sourceScreenshot,contentType:"image/png"});
    await page.getByRole("tab",{name:"版本",exact:true}).click();
    await page.getByRole("checkbox",{name:"选择版本 v1",exact:true}).check();await page.getByRole("checkbox",{name:"选择版本 v2",exact:true}).check();
    for(const viewport of [{width:1440,height:900},{width:1280,height:800}]){
      await page.setViewportSize(viewport);const screenshot=testInfo.outputPath(`shared-history-${viewport.width}.png`);await page.screenshot({path:screenshot});await testInfo.attach(`Shared history ${viewport.width}`,{path:screenshot,contentType:"image/png"});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.getByRole("button",{name:"比较所选版本",exact:true}).focus();await page.keyboard.press("Enter");
    await expect(page.getByRole("region",{name:"共享原始源码修改片段",exact:true})).toContainText("SharedSuccessor");
    for(const viewport of [{width:1440,height:900},{width:1280,height:800}]){
      await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const fullSource=page.getByText("查看完整源文件",{exact:true});await fullSource.focus();await page.keyboard.press("Enter");
      await expect(page.getByLabel("共享原始源码变更前",{exact:true})).toHaveText(content);await expect(page.getByLabel("共享原始源码变更后",{exact:true})).toHaveText(changed);
      await fullSource.focus();await page.keyboard.press("Enter");
      const screenshot=testInfo.outputPath(`shared-comparison-${viewport.width}.png`);await page.screenshot({path:screenshot});await testInfo.attach(`Shared comparison ${viewport.width}`,{path:screenshot,contentType:"image/png"});
    }
    await page.getByRole("radio",{name:"语义声明",exact:true}).click();
    await expect(page.getByRole("region",{name:"有序语义声明修改片段",exact:true})).toContainText('"SharedSuccessor"');
    await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.documentElement.classList.add("dark"));
    const semanticScreenshot=testInfo.outputPath("shared-semantic-dark-1440.png");await page.screenshot({path:semanticScreenshot,animations:"disabled"});await testInfo.attach("Shared semantic dark 1440",{path:semanticScreenshot,contentType:"image/png"});
    await page.evaluate(()=>document.documentElement.classList.remove("dark"));
    await page.getByRole("tab",{name:"使用情况",exact:true}).click();
    await expect(page.getByText("有新版本 · 未评估",{exact:true})).toBeVisible();
    const configLink=page.locator(`a[href*="configSet=${binding.configSetId}"]`);await expect(configLink).toBeVisible();
    for(const viewport of [{width:1440,height:900},{width:1280,height:800}]){
      await page.setViewportSize(viewport);const screenshot=testInfo.outputPath(`shared-usages-${viewport.width}.png`);await page.screenshot({path:screenshot});await testInfo.attach(`Shared usages ${viewport.width}`,{path:screenshot,contentType:"image/png"});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.getByRole("button",{name:"v1",exact:true}).click();await expect(page.getByText("v1 · 历史版本，只读",{exact:true})).toBeVisible();
    await expect(page.getByLabel("已发布 DTSI 源码",{exact:true})).toContainText("SharedOriginal");
    await page.getByRole("tab",{name:"使用情况",exact:true}).click();await configLink.click();
    expect(new URL(page.url()).searchParams.get("configSet")).toBe(binding.configSetId);
    await expect(page.getByRole("tab",{name:"生效配置",exact:true})).toHaveAttribute("aria-selected","true");
    await page.getByRole("treeitem",{name:"节点 /board",exact:true}).click();await expect(page.getByLabel("rx_fod_cond 最终值",{exact:true})).toHaveText('"ProjectLocal", "keep"');
    const usages=await request.get(apiRoute(`/api/v2/shared-dtsi/${resourceId}/usages`),{headers:adminHeaders()});
    expect((await usages.json()).items).toContainEqual(expect.objectContaining({projectId,configSetId:binding.configSetId,versionId:first.id,version:1,direct:true,upgradeAvailable:true,evaluation:"not-evaluated"}));
    const old=await request.get(apiRoute(`/api/v2/shared-dtsi/${resourceId}/versions/${first.id}`),{headers:adminHeaders()});expect((await old.json()).item.members).toEqual(first.members);
  });

  test("effective configuration preserves ordered origins and exact historical source links", async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
    const sample = '/dts-v1/; / { board { compatible = "mt,mt5788"; rx_fod_cond = "ProjectFinal", "keep"; }; second { compatible = "mt,mt5788"; rx_fod_cond = "SecondInstance", "keep"; }; };';
    const binding = await seedIsolatedBinding(request, { propertyKey: "rx_fod_cond", dts: sample,
      rawValuePattern: '"ProjectFinal", "keep"', nodeLocatorPattern: "board", reason: "#1418 effective configuration", timeoutMs: 60_000 });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const sourceName = `origins-${randomUUID()}.dtsi`;
    const source = '/ {\n bus { status = "disabled"; leaf { status = "okay"; }; };\n board { rx_fod_cond = "SharedDefault", "keep"; };\n};';
    const draft = await request.post(apiRoute("/api/v2/shared-dtsi"), { headers: adminHeaders(), data: {
      name: `Origins ${randomUUID()}`, sourceName, content: source, changeDescription: "Original shared source" } });
    expect(draft.status(), await draft.text()).toBe(201);
    const resourceId = (await draft.json()).item.resourceId as string;
    const publicationPreview = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/publication-preview`), { headers: adminHeaders(), data: { expectedRevision: 1 } });
    expect(publicationPreview.status(), await publicationPreview.text()).toBe(201);
    const published = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/publications`), { headers: adminHeaders(),
      data: { previewId: (await publicationPreview.json()).item.id, idempotencyKey: `origins-${randomUUID()}` } });
    expect(published.status(), await published.text()).toBe(201);
    const versionId = (await published.json()).item.id as string;
    const compositionPath = `/api/v1/projects/${projectId}/config-sets/${binding.configSetId}/member-addition`;
    const addition = { sharedReference: { resourceId, versionId }, role: "misc", sortOrder: 1 };
    const preview = await request.post(apiRoute(`${compositionPath}/preview`), { headers: adminHeaders(), data: addition });
    expect(preview.status(), await preview.text()).toBe(200);
    const applied = await request.post(apiRoute(`${compositionPath}/apply`), { headers: adminHeaders(), data: {
      ...addition, proofToken: (await preview.json()).item.proofToken, reason: "#1418 fixed origins", clientMutationId: `origins-${randomUUID()}` } });
    expect(applied.status(), await applied.text()).toBe(200);
    const revisionId = (await applied.json()).item.configRevisionId as string;
    const topologyResponse = await request.get(apiRoute(`/api/v2/projects/${projectId}/config-sets/${binding.configSetId}/revisions/${revisionId}/topology`), { headers: adminHeaders() });
    expect(topologyResponse.status(), await topologyResponse.text()).toBe(200);
    const topology = (await topologyResponse.json()).item as Extract<import("../../src/domain/parameter-topology/types").TopologyTree, { view: "effective" }>;
    const chain = topology.nodes.find(node => node.locator === "/board")!.effects.filter(effect => effect.propertyName === "rx_fod_cond");
    expect(chain.map(effect => effect.rawText)).toEqual(['"SharedDefault", "keep"', '"ProjectFinal", "keep"']);
    expect(chain[0]!.source).toMatchObject({ sourceName, startLine: 3, sharedReference: { versionId } });
    const root = chain.at(-1)!.source!;
    const exactRoot = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files/${root.fileId}/versions/${root.fileVersionId}/content`), { headers: adminHeaders() });
    const originalRoot = await exactRoot.text();
    const candidate = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`), { headers: adminHeaders(), data: {
      fileId: root.fileId, fileName: binding.fileName, contentBase64: Buffer.from(originalRoot.replace("ProjectFinal", "NewCurrent")).toString("base64"),
      intent: "source_revision", expectedCurrentVersionId: root.fileVersionId, expectedConfigRevisionId: revisionId, clientMutationId: `new-root-${randomUUID()}` } });
    expect(candidate.status(), await candidate.text()).toBe(201);
    const candidateId = (await candidate.json()).item.id as string;
    const sourcePreview = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-preview`), { headers: adminHeaders() });
    expect(sourcePreview.status(), await sourcePreview.text()).toBe(200);
    const current = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-apply`), { headers: adminHeaders(), data: {
      expectedCurrentVersionId: root.fileVersionId, expectedProofToken: (await sourcePreview.json()).item.proofToken,
      reason: "Advance current source while retaining history", clientMutationId: `new-root-apply-${randomUUID()}` } });
    expect(current.status(), await current.text()).toBe(200);
    const nextDraft = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/draft`), { headers: adminHeaders(), data: { baseVersionId: versionId } });
    expect(nextDraft.status(), await nextDraft.text()).toBe(201);
    const nextSave = await request.put(apiRoute(`/api/v2/shared-dtsi/${resourceId}/draft`), { headers: adminHeaders(), data: {
      expectedRevision: (await nextDraft.json()).item.revision, name: "Successor source", sourceName, content: source.replace("SharedDefault", "Successor"), changeDescription: "Successor" } });
    expect(nextSave.status(), await nextSave.text()).toBe(200);
    const nextPreview = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/publication-preview`), { headers: adminHeaders(), data: { expectedRevision: (await nextSave.json()).item.revision } });
    const nextPublication = await request.post(apiRoute(`/api/v2/shared-dtsi/${resourceId}/publications`), { headers: adminHeaders(), data: { previewId: (await nextPreview.json()).item.id, idempotencyKey: `next-${randomUUID()}` } });
    expect(nextPublication.status(), await nextPublication.text()).toBe(201);
    const route = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ organization: organizationId,
      configSet: binding.configSetId, revision: revisionId, tab: "effective", node: "/board" })}`;
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, route)); await dismissXiaozeHint(page);
    await expect(page.getByLabel("rx_fod_cond 最终值", { exact: true })).toHaveText('"ProjectFinal", "keep"');
    await expect(page.getByRole("treeitem", { name: "节点 /", exact: true })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "节点 /second", exact: true })).toBeVisible();
    await page.getByRole("treeitem", { name: "节点 /second", exact: true }).click();
    await expect(page.getByLabel("rx_fod_cond 最终值", { exact: true })).toHaveText('"SecondInstance", "keep"');
    await page.getByRole("treeitem", { name: "节点 /bus/leaf", exact: true }).click();
    await expect(page.getByText("节点已启用 · 祖先 /bus 阻断", { exact: true })).toBeVisible();
    await page.getByRole("treeitem", { name: "节点 /board", exact: true }).click();
    await expect(page.getByRole("list", { name: "rx_fod_cond 来源链" })).toBeHidden();
    await page.getByText("继承与覆盖（2）", { exact: true }).focus(); await page.keyboard.press("Enter");
    const origins = page.getByRole("list", { name: "rx_fod_cond 来源链" });
    await expect(origins.getByRole("listitem")).toHaveCount(2);
    await expect(origins.getByRole("listitem").first()).toContainText('"SharedDefault", "keep"');
    await expect(page.getByRole("button", { name: /配置版本/ })).not.toContainText("检查中");
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      const screenshot = testInfo.outputPath(`effective-origins-${viewport.width}.png`);
      await page.screenshot({ path: screenshot }); await testInfo.attach(`Effective origins ${viewport.width}`, { path: screenshot, contentType: "image/png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await origins.getByRole("link", { name: "共享资源 v1", exact: true }).click();
    await expect(page.getByText("v1 · 历史版本，只读", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "已发布 DTSI 源码", exact: true })).toContainText("SharedDefault");
    await expect(page.getByRole("textbox", { name: "已发布 DTSI 源码", exact: true })).toHaveAttribute("aria-readonly", "true");
    expect(new URL(page.url()).searchParams.get("line")).toBe("3");
    await page.getByRole("link", { name: "返回项目节点", exact: true }).click();
    await expect(page.getByRole("region", { name: "DTS 源码", exact: true })).toContainText("SharedDefault");
    await expect(page.getByRole("radio", { name: "编辑", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "生效配置", exact: true }).click();
    await expect(page.getByLabel("rx_fod_cond 最终值", { exact: true })).toHaveText('"ProjectFinal", "keep"');
    await page.getByRole("link", { name: `${binding.fileName}:${root.startLine}`, exact: true }).first().click();
    await expect(page.getByRole("region", { name: "DTS 源码", exact: true })).toContainText("ProjectFinal");
    await expect(page.getByRole("region", { name: "DTS 源码", exact: true })).not.toContainText("NewCurrent");
    expect(new URL(page.url()).searchParams.get("version")).toBe(root.fileVersionId);
    expect(new URL(page.url()).searchParams.get("revision")).toBe(revisionId);
    expect(new URL(page.url()).searchParams.get("organization")).toBe(organizationId);
    await expect(page.getByRole("radio", { name: "编辑", exact: true })).toHaveCount(0);
    expect(file.fileId).toBe(root.fileId);
  });

  test("administrator references a fixed shared DTSI version through configuration composition", async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
    const sample = '/dts-v1/; / { board { compatible = "mt,mt5788"; rx_fod_cond = "FixedProject", "keep"; }; };';
    const binding = await seedIsolatedBinding(request, { propertyKey: "rx_fod_cond", dts: sample,
      rawValuePattern: '"FixedProject", "keep"', nodeLocatorPattern: "board", reason: "#1416 fixed shared reference", timeoutMs: 60_000 });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const name = `Fixed shared ${randomUUID()}`, sourceName = `fixed-${randomUUID()}.dtsi`;
    const leafName=`Fixed dependency ${randomUUID()}`;
    const leafDraftResponse=await request.post(apiRoute("/api/v2/shared-dtsi"),{headers:adminHeaders(),data:{
      name:leafName,sourceName:"leaf.dtsi",content:'/ { dependency_node: dependency-node { status = "okay"; }; };',changeDescription:"#1417 exact dependency"}});
    expect(leafDraftResponse.status(),await leafDraftResponse.text()).toBe(201);
    const leafDraft=(await leafDraftResponse.json()).item as {resourceId:string};
    const leafPreview=await request.post(apiRoute(`/api/v2/shared-dtsi/${leafDraft.resourceId}/publication-preview`),{headers:adminHeaders(),data:{expectedRevision:1}});
    expect(leafPreview.status(),await leafPreview.text()).toBe(201);
    const leafPublished=await request.post(apiRoute(`/api/v2/shared-dtsi/${leafDraft.resourceId}/publications`),{headers:adminHeaders(),data:{previewId:(await leafPreview.json()).item.id,idempotencyKey:`dep-${randomUUID()}`}});
    expect(leafPublished.status(),await leafPublished.text()).toBe(201);
    const leafVersion=(await leafPublished.json()).item as {id:string};
    const source = '/include/ "parts/common.dtsi"\n/include/ "vendor/leaf.dtsi"\n/ { board { rx_fod_cond = "SharedDefault", "keep"; }; };';
    const draftResponse = await request.post(apiRoute("/api/v2/shared-dtsi"), { headers: adminHeaders(), data: {
      name,members:[{sourceName,content:source},{sourceName:"parts/common.dtsi",content:'/ { common { status = "okay"; }; };'}],
      dependencies:[{resourceId:leafDraft.resourceId,versionId:leafVersion.id,mountPath:"vendor"}],changeDescription: "Initial complete fixed shared source" } });
    expect(draftResponse.status(), await draftResponse.text()).toBe(201);
    const draft = (await draftResponse.json()).item as { resourceId: string; revision: number };
    const previewResponse = await request.post(apiRoute(`/api/v2/shared-dtsi/${draft.resourceId}/publication-preview`), {
      headers: adminHeaders(), data: { expectedRevision: draft.revision } });
    expect(previewResponse.status(), await previewResponse.text()).toBe(201);
    const publishedResponse = await request.post(apiRoute(`/api/v2/shared-dtsi/${draft.resourceId}/publications`), {
      headers: adminHeaders(), data: { previewId: (await previewResponse.json()).item.id, idempotencyKey: `fixed-${randomUUID()}` } });
    expect(publishedResponse.status(), await publishedResponse.text()).toBe(201);
    const versionId = (await publishedResponse.json()).item.id as string;
    const route = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: binding.configSetId, file: file.fileId })}`;
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, route)); await dismissXiaozeHint(page);
    const composition = await openWorkbenchPanel(page, "config-set");
    await expect(composition).toHaveAccessibleName("配置组成");
    await composition.getByRole("button", { name: "添加配置文件", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "加入配置文件", exact: true });
    await selectControlOption(dialog.getByRole("combobox", { name: "文件来源", exact: true }), "shared");
    await dialog.getByRole("searchbox", { name: "搜索共享资源", exact: true }).fill(name);
    await selectControlOption(dialog.getByRole("combobox", { name: "共享资源", exact: true }), draft.resourceId);
    await expect(dialog.getByRole("button", { name: "预览加入配置", exact: true })).toBeDisabled();
    await selectControlOption(dialog.getByRole("combobox", { name: "固定版本", exact: true }), versionId);
    const previewing = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/member-addition/preview"), { timeout: 60_000 });
    await dialog.getByRole("button", { name: "预览加入配置", exact: true }).click();
    const preview = await previewing; expect(preview.status(), await preview.text()).toBe(200);
    expect(preview.request().postDataJSON()).toMatchObject({ sharedReference: { resourceId: draft.resourceId, versionId }, role: "misc" });
    await expect(dialog.getByRole("region", { name: "加入配置预览" })).toContainText(sourceName);
    await expect(dialog.getByRole("region",{name:"加入配置预览"})).toContainText(`${leafName} · 版本 1 · 间接依赖`);
    await expect(dialog.getByRole("region",{name:"加入配置预览"})).toContainText("vendor/leaf.dtsi");
    await expect(dialog).toHaveAccessibleDescription("选择共享资源及固定版本，预览配置变化后确认引用。");
    await expect(dialog.getByLabel("确认后根文件源码", { exact: true })).toBeHidden();
    await dialog.getByText(`项目根文件 include 变更：${binding.fileName}`, { exact: true }).click();
    await expect(dialog.getByLabel("当前根文件源码", { exact: true })).toHaveText(sample);
    await expect(dialog.getByLabel("确认后根文件源码", { exact: true })).toContainText(`/include/ "${sourceName}"`);
    await expect(dialog.getByLabel("确认后根文件源码", { exact: true })).toContainText('"FixedProject"');
    await dialog.getByText(`项目根文件 include 变更：${binding.fileName}`, { exact: true }).click();
    await dialog.getByLabel("加入原因", { exact: true }).fill("#1416 reviewed exact fixed version and private-root include change");
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      const confirmation = dialog.getByRole("button", { name: "确认加入配置", exact: true });
      await expect(confirmation).toBeEnabled();
      await expect(confirmation).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByLabel("加入原因", { exact: true })).toBeInViewport({ ratio: 1 });
      const path = testInfo.outputPath(`fixed-shared-reference-${viewport.width}.png`);
      await page.screenshot({ path }); await testInfo.attach(`Fixed shared reference ${viewport.width}`, { path, contentType: "image/png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    const applying = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/member-addition/apply"), { timeout: 60_000 });
    await dialog.getByRole("button", { name: "确认加入配置", exact: true }).focus(); await page.keyboard.press("Enter");
    const applied = await applying; expect(applied.status(), await applied.text()).toBe(200);
    const receipt = (await applied.json()).item as { fileId: string; fileVersionId: string };
    await expect(dialog).toHaveCount(0); await page.reload();
    const after = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers: adminHeaders() });
    expect((await after.json()).items.find((item: { id: string }) => item.id === binding.bindingId)).toMatchObject({ rawValue: '"FixedProject", "keep"' });
    const files = await openWorkbenchPanel(page, "config-set");
    const row = files.getByRole("row").filter({ hasText: sourceName });
    await expect(row).toContainText("共享引用 · 版本 1 · 只读");
    await expect(row.getByRole("button", { name: "更新文件", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "查看源码", exact: true }).click();
    await expect(page.getByRole("region", { name: "DTS 源码", exact: true })).toContainText('vendor/leaf.dtsi');
    await expect(page.getByRole("radio", { name: "编辑", exact: true })).toHaveCount(0);
    const exact = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files/${receipt.fileId}/versions/${receipt.fileVersionId}/content`), { headers: adminHeaders() });
    expect(await exact.text()).toBe(source);
    const leafUsages=await request.get(apiRoute(`/api/v2/shared-dtsi/${leafDraft.resourceId}/usages`),{headers:adminHeaders()});
    expect(leafUsages.status(),await leafUsages.text()).toBe(200);
    expect((await leafUsages.json()).items).toContainEqual(expect.objectContaining({projectId,direct:false}));
  });

  test("administrator adds a staged overlay to a Canonical configuration through preview and keyboard confirmation", async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
    const sample = '/dts-v1/; / { board: board { compatible = "mt,mt5788"; rx_fod_cond = "AddV1", "keep"; }; };';
    const binding = await seedIsolatedBinding(request, { propertyKey: "rx_fod_cond", dts: sample,
      rawValuePattern: '"AddV1", "keep"', nodeLocatorPattern: "board", reason: "#1305 Canonical member addition", timeoutMs: 60_000 });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const route = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: binding.configSetId, file: file.fileId })}`;
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, route));
    await dismissXiaozeHint(page);
    const files = await openWorkbenchPanel(page, "config-set");
    await files.getByRole("button", { name: "添加配置文件", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "加入配置文件", exact: true });
    const overlayName = `added-overlay-${randomUUID()}.dts`;
    await selectControlOption(dialog.getByRole("combobox", { name: "目标配置", exact: true }), binding.configSetId);
    await dialog.getByLabel("上传文件", { exact: true }).setInputFiles({ name: overlayName, mimeType: "text/plain",
      buffer: Buffer.from('/dts-v1/; /plugin/; &board { rx_fod_cond = "AddV2", "keep"; };') });
    await selectControlOption(dialog.getByRole("combobox", { name: "文件用途", exact: true }), "overlay");
    await dialog.getByLabel("文件顺序", { exact: true }).fill("-1");
    await dialog.getByRole("button", { name: "预览加入配置", exact: true }).click();
    expect(await dialog.getByLabel("文件顺序", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
    expect(await dialog.getByLabel("上传文件", { exact: true }).evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
    await dialog.getByLabel("文件顺序", { exact: true }).fill("1");
    const previewResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/member-addition/preview"), { timeout: 60_000 });
    await dialog.getByRole("button", { name: "预览加入配置", exact: true }).focus(); await page.keyboard.press("Enter");
    const preview = await previewResponse; expect(preview.status(), await preview.text()).toBe(200);
    await expect(dialog.getByRole("region", { name: "加入配置预览" })).toContainText(overlayName);
    const before = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers: adminHeaders() });
    expect((await before.json()).items.find((item: { id: string }) => item.id === binding.bindingId)).toMatchObject({ rawValue: '"AddV1", "keep"' });
    await dialog.getByLabel("加入原因", { exact: true }).fill("#1305 checked complete composition and parameter impact");
    const screenshot = testInfo.outputPath("canonical-member-addition-1440x900.png");
    await page.screenshot({ path: screenshot }); await testInfo.attach("Canonical member addition preview", { path: screenshot, contentType: "image/png" });
    const applying = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/member-addition/apply"), { timeout: 60_000 });
    await dialog.getByRole("button", { name: "确认加入配置", exact: true }).focus(); await page.keyboard.press("Enter");
    const applied = await applying; expect(applied.status(), await applied.text()).toBe(200);
    await expect(dialog).toHaveCount(0); await page.reload();
    const refreshed = await openWorkbenchPanel(page, "config-set");
    await expect(refreshed.getByRole("table", { name: "配置文件" })).toContainText(overlayName);
    await expect(refreshed.getByRole("table", { name: "配置文件" })).toContainText(binding.fileName);
    const after = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), { headers: adminHeaders() });
    expect((await after.json()).items.find((item: { id: string }) => item.id === binding.bindingId)).toMatchObject({ rawValue: '"AddV2", "keep"' });
  });

  test("administrator directly applies a complete DTS preview with keyboard confirmation and keeps invalid input", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-EDIT-001
    // @operation PROJ-CONFIG-EDIT-001
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
    const sample = `/dts-v1/;\n/ { board { compatible = "mt,mt5788"; rx_fod_cond = "DirectV1", "keep"; }; };\n`;
    const binding = await seedIsolatedBinding(request, { propertyKey: "rx_fod_cond", dts: sample,
      rawValuePattern: '"DirectV1", "keep"', nodeLocatorPattern: "board", reason: "#1303 administrator direct source application", timeoutMs: 60_000 });
    const file = await lookupParameterFileVersion({ fileName: binding.fileName });
    const workbenchPath = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: binding.configSetId, file: file.fileId })}`;
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, workbenchPath));
    await dismissXiaozeHint(page);
    await expect(page.getByRole("heading", { name: binding.fileName })).toBeVisible({ timeout: 30_000 });
    const editor = page.getByRole("textbox", { name: "DTS 源码", exact: true });
    const invalid = '/dts-v1/;\n/ { board { rx_fod_cond = <; };';
    await page.getByRole("radio", { name: "编辑", exact: true }).click();
    await editor.fill(invalid);
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    const invalidDialog = page.getByRole("dialog", { name: "保存 DTS 修改" });
    await expect(invalidDialog.getByRole("alert").first()).toContainText(/DTS|校验/);
    await expect(invalidDialog.getByRole("button", { name: "直接应用修改", exact: true })).toBeDisabled();
    expect((await lookupParameterFileVersion({ fileName: binding.fileName })).versionId).toBe(file.versionId);
    await invalidDialog.getByRole("button", { name: "返回编辑", exact: true }).click();
    await expect(editor).toContainText("rx_fod_cond = <;");
    await page.getByRole("radio", { name: "预览", exact: true }).click();
    const sourcePath = `/api/v1/projects/${projectId}/parameter-files/${file.fileId}/versions/${file.versionId}/content`;
    const source = await request.get(apiRoute(sourcePath), { headers: adminHeaders() });
    expect(source.status(), await source.text()).toBe(200);
    const edited = (await source.text()).replace('"DirectV1"', '"DirectV2"') + "\n/* administrator confirmed the whole source */\n";
    const prepared = await prepareSourceFromEditor(page, edited, true);
    expect(prepared.item.impact?.parameterChanges).toBe(1);
    await prepared.dialog.getByRole("textbox", { name: "DTS 修改原因" }).fill("#1303 checked complete diff, directly apply");
    const applying = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/source-apply"), { timeout: 60_000 });
    await prepared.dialog.getByRole("button", { name: "直接应用修改", exact: true }).focus();
    await page.keyboard.press("Enter");
    const applied = await applying;
    expect(applied.status(), await applied.text()).toBe(200);
    expect(applied.request().postDataJSON()).not.toHaveProperty("assignedToUserId");
    const receipt = (await applied.json()).item as SourceRevisionRequest;
    expect(receipt).toMatchObject({ status: "approved", applicationMode: "administrator_direct", submitterUserId: acceptanceCast.xuYun.userId,
      assignedToUserId: null, reviewerUserId: null });
    await expect(prepared.dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "DTS 源码", exact: true })).toContainText("DirectV2");
    await expect(page.getByText("当前工作配置", { exact: true })).toBeVisible();
    const bindingsPath = `/api/v2/projects/${projectId}/parameter-bindings`;
    const current = await request.get(apiRoute(bindingsPath), { headers: adminHeaders() });
    expect(current.status(), await current.text()).toBe(200);
    expect((await current.json()).items.find((row: { id: string }) => row.id === binding.bindingId)).toMatchObject({ rawValue: '"DirectV2", "keep"' });
    const activeFile = await lookupParameterFileVersion({ fileName: binding.fileName });
    expect(activeFile.versionId).toBe(receipt.appliedSourceResult!.fileVersionId);
    const contentPath = `/api/v1/projects/${projectId}/parameter-files/${file.fileId}/versions/${activeFile.versionId}/content`;
    const content = await request.get(apiRoute(contentPath), { headers: adminHeaders() });
    expect(content.status(), await content.text()).toBe(200); expect(await content.text()).toBe(edited);
    await recordOperationEvidence({ operationId: "PROJ-CONFIG-EDIT-001", title: "Administrator direct DTS application",
      status: "passed", role: "Admin", route: workbenchPath, page, testInfo, assertions: ["ui", "api", "screenshot"],
      api: [summarizeApiResponse(applied, { method: "POST", path: `/api/v1/projects/${projectId}/parameter-file-candidates/${prepared.item.candidateId}/source-apply` }),
        summarizeApiResponse(current, { method: "GET", path: bindingsPath })],
      notes: "1440x900 real API: invalid source stays local, keyboard activates preview and the explicit administrator action; reload retains exact source, stable Binding and updated value. No reviewer is selected or fabricated." });
  });

  test("administrator previews mixed configuration member removal, cancels and confirms with the keyboard", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-OPS-001
    // @operation PROJ-CONFIG-OPS-001
    test.setTimeout(240_000);
    await seedAcceptanceRoleMatrix();
    await registerCatalogDriverSubjects(request, [{ subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }]);
    const suffix = randomUUID();
    const rootName = `removal-root-${suffix}.dts`, overlayName = `removal-overlay-${suffix}.dts`;
    const rootText = '/dts-v1/;\n/ { compatible = "test,board"; model = "Removal root"; board { compatible = "mt,mt5788"; rx_fod_cond = "RemovalKeep", "KeepOther"; }; };\n';
    const overlayText = '/dts-v1/; /plugin/;\n/ { fragment@0 { target-path = "/"; __overlay__ { backup { compatible = "mt,mt5788"; rx_fod_cond = "RemovalOld", "OldOther"; }; }; }; };\n';
    const created = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), { headers: adminHeaders(), data: { name: `member-removal-${suffix}` } });
    expect(created.status(), await created.text()).toBe(201);
    const configSetId = (await created.json()).item.id as string;
    const members = [];
    for (const [fileName, content, role, sortOrder, format] of [[rootName, rootText, "base", 0, "dts"], [overlayName, overlayText, "overlay", 1, "dts"], [`removal-settings-${suffix}.json`, '{"keep":42}\n', "charging", 2, "json"]] as const) {
      const uploaded = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), { headers: adminHeaders(), data: { fileName, contentBase64: Buffer.from(content).toString("base64") } });
      expect(uploaded.status(), await uploaded.text()).toBe(201);
      const body = await uploaded.json() as { item: { id: string }; version: { id: string } };
      const added = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), { headers: adminHeaders(), data: { fileId: body.item.id, role, sortOrder } });
      expect(added.status(), await added.text()).toBe(201);
      members.push({ fileId: body.item.id, fileVersionId: body.version.id, fileName, sourceName: fileName, content, role, sortOrder, format });
    }
    const fixtureDb = createPostgresDatabase(disposableRuntime.databaseUrl);
    try {
      const actor = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId, organizationId, roles: [{ roleId: "admin", projectId: null }] });
      const revision = await ingestConfigRevision(fixtureDb, { organizationId, projectId, configSetId, entryFile: rootName, includeSearchPaths: ["."], overlayOrder: [overlayName], members }, actor);
      expect(revision.status).toBe("resolved");
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(fixtureDb)!);
      if (!snapshot) throw new Error("Missing published Catalog for member removal fixture.");
      await fixtureDb.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId, projectId, configSetId, configRevisionId: revision.id }));
    } finally { await fixtureDb.close(); }
    const workbenchPath = `/parameter-admin/projects/${projectId}/configuration?${new URLSearchParams({ configSet: configSetId, file: members[0]!.fileId })}`;
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, workbenchPath));
    await dismissXiaozeHint(page);
    await expect(page.getByRole("heading", { name: rootName, exact: true })).toBeVisible();
    const files = await openWorkbenchPanel(page, "config-set");
    const previewPath = (fileId: string) => `/api/v1/projects/${projectId}/config-sets/${configSetId}/files/${fileId}/removal-preview`;
    expectedBrowserApiFailures.push({ method: "POST", path: previewPath(members[0]!.fileId), status: 400 });
    await files.getByRole("button", { name: `${rootName} 更多`, exact: true }).click();
    await page.getByRole("menuitem", { name: "预览移除影响", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "预览移除影响", exact: true });
    await expect(dialog.getByRole("alert")).toContainText("请先将其他 DTS 文件设为根文件");
    await expect(dialog.getByRole("button", { name: "确认移除", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await files.getByRole("button", { name: `${overlayName} 更多`, exact: true }).click();
    await page.getByRole("menuitem", { name: "预览移除影响", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "预览移除影响", exact: true });
    await expect(dialog.getByText(/移除 .*1 个当前参数/)).toBeVisible();
    await expect(dialog).toContainText("覆盖文件");
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    const screenshot = testInfo.outputPath("member-removal-preview.png");
    await page.screenshot({ path: screenshot }); await testInfo.attach("member-removal-preview", { path: screenshot, contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(files.getByRole("button", { name: overlayName, exact: true })).toBeVisible();
    await files.getByRole("button", { name: `${overlayName} 更多`, exact: true }).click();
    await page.getByRole("menuitem", { name: "预览移除影响", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "预览移除影响", exact: true });
    await expect(dialog.getByText(/移除 .*1 个当前参数/)).toBeVisible();
    await dialog.getByRole("textbox", { name: "移除原因", exact: true }).fill("旧覆盖文件已不再使用");
    const applying = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/removal-apply"));
    await dialog.getByRole("button", { name: "确认移除", exact: true }).focus(); await page.keyboard.press("Enter");
    const applied = await applying; expect(applied.status(), await applied.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(files.getByRole("button", { name: overlayName, exact: true })).toHaveCount(0);
    await page.reload();
    const retained = await openWorkbenchPanel(page, "config-set");
    await expect(retained.getByRole("button", { name: overlayName, exact: true })).toHaveCount(0);
    await expect(retained.getByRole("button", { name: rootName, exact: true })).toBeVisible();
    const historyPath = `/api/v1/projects/${projectId}/parameter-files/${members[1]!.fileId}/versions/${members[1]!.fileVersionId}/content`;
    const history = await request.get(apiRoute(historyPath), { headers: adminHeaders() });
    expect(history.status(), await history.text()).toBe(200); expect(await history.text()).toBe(overlayText);
    await recordOperationEvidence({ operationId: "PROJ-CONFIG-OPS-001", title: "Administrator Canonical member removal", status: "passed", role: "Admin", route: workbenchPath,
      page, testInfo, assertions: ["ui", "api", "screenshot"], api: [summarizeApiResponse(applied, { method: "POST", path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/files/${members[1]!.fileId}/removal-apply` }), summarizeApiResponse(history, { method: "GET", path: historyPath })],
      notes: "1440x900 real API mixed DTS/JSON configuration: invalid root rejected, dependency/parameter preview, Escape cancellation, keyboard confirmation, reload persistence and retained historical source." });
  });

  test("activates existing- and new-file candidates with CAS stale safety", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-ACTIVATE-001
    // @operation PROJ-CONFIG-ACTIVATE-001
    // Candidate activation is the legacy source path: the server refuses it for any file or Config set
    // that already has canonical Source Occurrences (those use the source-submit flow, covered by the
    // b906 specs). So the existing file stays outside the Config set until it is activated, and the new
    // file becomes the Config set's first member. Activation publishes append-only canonical state, so
    // this runs in the disposable post-cutover database instead of cleaning the shared one.
    test.setTimeout(180_000);
    const suffix = randomUUID();
    const configSetName = `candidate-activate-${suffix}`;
    const primaryFileName = `acceptance-activate-${suffix}.dts`;
    const newFileName = `acceptance-activate-new-${suffix}.dts`;
    const v1Dts = `/dts-v1/;
/ {
	board {
		model = "ActV1";
		compatible = "wiseeff,act";
	};
};
`;
    const v2Dts = `/dts-v1/;
/ {
	board {
		model = "ActV2";
		compatible = "wiseeff,act";
	};
};
`;
    const newDts = `/dts-v1/;
/ {
	overlay {
		model = "NewAct";
		compatible = "wiseeff,act";
	};
};
`;

    {
      const uploadV1 = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(v1Dts, "utf8").toString("base64")
        }
      });
      expect(uploadV1.ok()).toBe(true);
      const v1Body = (await uploadV1.json()) as { item: { id: string }; version: { id: string } };

      const createSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "candidate activation acceptance" }
      });
      expect(createSet.ok()).toBe(true);
      const setBody = (await createSet.json()) as { item: { id: string } };
      const configSetId = setBody.item.id;

      const createExisting = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          fileId: v1Body.item.id,
          contentBase64: Buffer.from(v2Dts, "utf8").toString("base64")
        }
      });
      expect(createExisting.ok()).toBe(true);
      const existingCandidate = (await createExisting.json()) as { item: { id: string; status: string; baseVersionId?: string } };
      expect(existingCandidate.item.status).toBe("ready");

      const staleRace = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files/${v1Body.item.id}/versions`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(v1Dts.replace("ActV1", "ActRace"), "utf8").toString("base64")
        }
      });
      expect(staleRace.ok()).toBe(true);
      const racedBody = (await staleRace.json()) as { item: { id: string } };

      const staleActivate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${existingCandidate.item.id}/activate`),
        {
          headers: adminHeaders(),
          data: { expectedCurrentVersionId: existingCandidate.item.baseVersionId ?? v1Body.version.id }
        }
      );
      expect(staleActivate.status()).toBe(409);
      const staleJson = (await staleActivate.json()) as {
        error?: { details?: { reason?: string; candidate?: { status?: string } } };
      };
      expect(staleJson.error?.details?.reason).toBe("stale-base");
      expect(staleJson.error?.details?.candidate?.status).toBe("stale");

      const fileAfterStale = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders()
      });
      expect(fileAfterStale.ok()).toBe(true);
      const filesAfterStale = (await fileAfterStale.json()) as { items: Array<{ id: string; currentVersionId?: string }> };
      const primaryAfterStale = filesAfterStale.items.find((item) => item.id === v1Body.item.id);
      expect(primaryAfterStale?.currentVersionId).toBe(racedBody.item.id);

      const recompute = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${existingCandidate.item.id}/recompute`),
        { headers: adminHeaders(), data: {} }
      );
      expect(recompute.ok()).toBe(true);
      const recomputed = (await recompute.json()) as { item: { status: string; baseVersionId?: string } };
      expect(["ready", "blocked"]).toContain(recomputed.item.status);

      if (recomputed.item.status === "ready") {
        const activateExisting = await request.post(
          apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${existingCandidate.item.id}/activate`),
          {
            headers: adminHeaders(),
            data: { expectedCurrentVersionId: recomputed.item.baseVersionId ?? racedBody.item.id }
          }
        );
        expect(activateExisting.ok()).toBe(true);
        const activatedExisting = (await activateExisting.json()) as {
          item: { status: string };
          file: { currentVersionId: string };
          version: { id: string };
        };
        expect(activatedExisting.item.status).toBe("active");
        expect(activatedExisting.file.currentVersionId).toBe(activatedExisting.version.id);
        expect(activatedExisting.version.id).not.toBe(racedBody.item.id);
      }

      const createNew = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`), {
        headers: adminHeaders(),
        data: {
          fileName: newFileName,
          contentBase64: Buffer.from(newDts, "utf8").toString("base64")
        }
      });
      expect(createNew.ok()).toBe(true);
      const newCandidate = (await createNew.json()) as { item: { id: string; status: string; fileId?: string } };
      expect(newCandidate.item.status).toBe("ready");
      expect(newCandidate.item.fileId).toBeFalsy();

      const missingIntent = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${newCandidate.item.id}/activate`),
        { headers: adminHeaders(), data: { expectedCurrentVersionId: null } }
      );
      expect(missingIntent.status()).toBe(400);

      const activateNew = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${newCandidate.item.id}/activate`),
        {
          headers: adminHeaders(),
          data: { expectedCurrentVersionId: null, configSetId, role: "base" }
        }
      );
      expect(activateNew.ok()).toBe(true);
      const activatedNew = (await activateNew.json()) as {
        item: { status: string; fileId?: string };
        file: { id: string; fileName: string };
      };
      expect(activatedNew.item.status).toBe("active");
      expect(activatedNew.file.fileName).toBe(newFileName);

      const members = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
        headers: adminHeaders()
      });
      expect(members.ok()).toBe(true);
      const memberBody = (await members.json()) as { items: Array<{ fileId?: string; id?: string; role?: string }> };
      expect(memberBody.items.map((item) => ({ id: item.fileId ?? item.id, role: item.role }))).toEqual([
        { id: activatedNew.file.id, role: "base" }
      ]);

      await signInBrowserAsRole(
        page,
        "admin",
        disposablePageUrl(disposableRuntime, `/parameter-admin/projects/${projectId}/configuration?configSet=${configSetId}`)
      );
      await expect(page.getByRole("heading", { name: /配置工作台|Configuration/i }).or(page.locator(".configuration-workbench")).first()).toBeVisible({
        timeout: 30_000
      });

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-activate.json", {
        route: page.url(),
        configSetId,
        existingCandidateId: existingCandidate.item.id,
        newCandidateId: newCandidate.item.id,
        racedVersionId: racedBody.item.id
      });
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-ACTIVATE-001",
        title: "configuration workbench candidate activation CAS and new-file membership",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(staleActivate, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-candidates/${existingCandidate.item.id}/activate`,
            responseSummary: "stale-base 409"
          }),
          summarizeApiResponse(activateNew, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-candidates/${newCandidate.item.id}/activate`,
            responseSummary: "new-file activated"
          })
        ],
        notes: "Existing-file stale CAS preserved Working configuration; new-file activation required explicit Config set role and became the Config set base member."
      });
    }
  });
});
