import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const projectId = "aurora";
const adminHeaders = () => authHeadersForRole("admin");
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
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
}

test.describe("project configuration workbench read-only browser acceptance", () => {
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
      await expect(page.getByRole("heading", { name: "项目清单" })).toBeVisible({ timeout: 30_000 });
      const auroraRow = page.getByRole("row").filter({ hasText: /aurora/i }).last();
      await auroraRow.getByRole("button", { name: /配置工作台/ }).click();
      await expect(page).toHaveURL(new RegExp(`/parameter-admin/projects/${projectId}/configuration(?:\\?|$)`));

      await page.goto(`/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}`);
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("treeitem", { name: new RegExp(primaryFileName) })).toBeVisible();
      await expect(page.getByRole("group", { name: "未编组项目文件" })).toContainText(looseFileName);
      await expect(page.getByText("工作配置", { exact: true })).toBeVisible();
      await expect(page.getByText("发布基线：尚未发布")).toBeVisible();
      await expect(page.getByRole("button", { name: "上传候选" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "创建基线" })).toBeDisabled();
      await expect(page.getByRole("main", { name: "只读 DTS 源码" })).toContainText("Configuration tracer");
      expect(memberRequests.some((url) => url.includes(`/config-sets/${configSetId}/files`))).toBe(true);

      await page.setViewportSize({ width: 1440, height: 900 });
      const desktopShell = await page.evaluate(() => {
        const dock = document.querySelector(".configuration-workbench__tasks");
        const inspector = document.querySelector(".configuration-workbench__inspector");
        const source = document.querySelector(".configuration-workbench__source");
        const mobileTools = document.querySelector(".configuration-workbench__mobile-tools");
        const rect = (el: Element | null) => {
          if (!el) return null;
          const box = el.getBoundingClientRect();
          return { width: box.width, height: box.height, x: box.x };
        };
        return {
          dock: rect(dock),
          inspectorBefore: rect(inspector),
          source: rect(source),
          mobileToolsDisplay: mobileTools ? getComputedStyle(mobileTools).display : null,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth
        };
      });
      expect(desktopShell.mobileToolsDisplay).toBeNull();
      expect(desktopShell.dock?.height).toBe(44);
      expect(desktopShell.source?.width ?? 0).toBeGreaterThan(600);
      expect(desktopShell.scrollWidth).toBeLessThanOrEqual(desktopShell.clientWidth);

      await page.getByRole("button", { name: "检查器", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible();
      const inspectorOverlay = await page.evaluate(() => {
        const inspector = document.querySelector(".configuration-workbench__inspector");
        if (!inspector) return null;
        const style = getComputedStyle(inspector);
        const box = inspector.getBoundingClientRect();
        return { position: style.position, width: box.width, x: box.x };
      });
      expect(inspectorOverlay?.position).toMatch(/absolute|fixed/);
      await page.getByRole("button", { name: "任务", exact: true }).click();
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText("没有本轮更改");
      await page.getByRole("button", { name: "任务", exact: true }).click();
      await page.getByRole("button", { name: "检查器", exact: true }).click();

      await page.setViewportSize({ width: 768, height: 1024 });
      const tabletTreeToggle = page.getByRole("button", { name: "源结构", exact: true });
      const tabletInspectorToggle = page.getByRole("button", { name: "检查器", exact: true });
      const tabletTaskToggle = page.getByRole("button", { name: "任务", exact: true });
      // Narrow viewports start with the tree sheet closed so source stays dominant.
      await expect(tabletTreeToggle).toHaveAttribute("aria-expanded", "false");
      await tabletTreeToggle.click();
      await expect(tabletTreeToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("tree", { name: new RegExp(configSetName) })).toBeVisible();
      await tabletTreeToggle.click();
      await expect(tabletTreeToggle).toHaveAttribute("aria-expanded", "false");
      await tabletInspectorToggle.click();
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible();
      await tabletTaskToggle.click();
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText("没有本轮更改");
      const tabletOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(tabletOverflow.scrollWidth).toBeLessThanOrEqual(tabletOverflow.clientWidth);
      await tabletTaskToggle.click();
      await tabletInspectorToggle.click();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "源结构", exact: true }).click();
      await expect(page.getByRole("tree", { name: new RegExp(configSetName) })).toBeVisible();
      await page.getByRole("button", { name: "源结构", exact: true }).click();
      await page.getByRole("button", { name: "检查器", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench.json", {
        route: page.url(),
        configSetId,
        memberFileId: primaryBody.item.id,
        activeVersionId: primaryBody.version.id,
        ungroupedFileName: looseFileName,
        viewports: ["1440x900", "768x1024", "390x844"],
        overflow,
        tabletOverflow
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
          })
        ],
        notes: "Project-list entry opened the canonical route; API member identity and active source remained read-only while tree, inspector, task sheet, and mobile overflow were exercised."
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
		compatible = "wiseeff,source-nav";
	};
};
`;
    const overlayNode = `source_nav_charger_${suffix.slice(0, 8)}`;
    const overlayDts = `/dts-v1/;
/ {
	${overlayNode} {
		status = "okay";
	};
};
`;

    try {
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
          `/api/v1/projects/${projectId}/parameter-files/${primaryBody.item.id}/versions/${primaryBody.version.id}/structure`
        ),
        { headers: adminHeaders() }
      );
      expect(structureResponse.ok()).toBe(true);
      const structureBody = (await structureResponse.json()) as {
        nodes: Array<{ nodePath: string; source?: { startLine: number; endLine: number }; properties: Array<{ name: string; source?: unknown }> }>;
      };
      const board = structureBody.nodes.find((node) => node.nodePath === "board");
      expect(board?.source?.startLine).toBeGreaterThanOrEqual(1);
      expect(board?.properties.some((property) => property.name === "model" && property.source)).toBe(true);

      const searchResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/dts-search?q=${encodeURIComponent(primaryFileName)}`),
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

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await expect(page).toHaveURL(new RegExp(`node=board`));
      await expect(page.locator('[data-focused="true"]').first()).toBeVisible();

      await page.getByRole("treeitem", { name: "属性 board/model" }).click();
      await expect(page).toHaveURL(new RegExp(`property=model`));

      await page.getByRole("searchbox", { name: "统一搜索查询" }).fill(overlayNode);
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      const results = page.getByLabel("搜索结果");
      await expect(results).toContainText(overlayFileName);
      await results.getByRole("button", { name: new RegExp(overlayNode) }).click();
      await expect(page).toHaveURL(new RegExp(`file=${overlayBody.item.id}`));
      await expect(page).toHaveURL(new RegExp(`configSet=${configSetId}`));
      await expect(page.getByRole("heading", { name: overlayFileName })).toBeVisible();

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
		compatible = "wiseeff,inspect";
	};
};
`;
    const v2Dts = `/dts-v1/;
/ {
	board {
		model = "InspectV2";
		compatible = "wiseeff,inspect";
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
      await expect(page.getByLabel("配置身份")).toContainText("工作配置");
      await expect(page.getByLabel("配置身份")).toContainText("候选文件版本");
      await expect(page.getByLabel("配置身份")).toContainText("发布基线");

      await page.getByRole("button", { name: "检查器" }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("文件格式");
      await expect(inspector.getByLabel("不可变版本历史")).toBeVisible();
      await expect(inspector).toContainText(`版本 ${v1Body.version.versionNumber}`);

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await expect(inspector).toContainText("节点路径");
      await expect(inspector).toContainText("只读");

      await page.getByRole("treeitem", { name: "属性 board/model" }).click();
      await expect(inspector).toContainText("属性名");
      await expect(inspector).toContainText("InspectV2");

      await page.getByRole("button", { name: "检查器返回" }).click();
      await expect(inspector).toContainText("节点路径");
      await page.getByRole("button", { name: "检查器返回" }).click();
      await expect(inspector).toContainText("文件格式");
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();

      const historyVersion = versionsBody.items.find((item) => item.id === v1Body.version.id) ?? versionsBody.items.at(-1);
      expect(historyVersion).toBeTruthy();
      await page
        .getByRole("button", { name: `查看版本 ${historyVersion!.versionNumber} 历史源码` })
        .click();
      await expect(page).toHaveURL(/sourceMode=history/);
      await expect(page.getByLabel("历史只读源码模式")).toBeVisible();
      await expect(page.getByText(/model = "InspectV1"/)).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: `下载版本 ${historyVersion!.versionNumber}` }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain(primaryFileName);

      await page.getByRole("button", { name: `统一差异版本 ${historyVersion!.versionNumber}` }).click();
      await expect(page).toHaveURL(/sourceMode=unified-diff/);
      await expect(page.getByLabel("统一差异对比")).toBeVisible();

      await page.getByRole("button", { name: "关闭检查器" }).click();
      await page.getByRole("button", { name: "并排对比", exact: true }).click();
      await expect(page).toHaveURL(/sourceMode=side-by-side/);
      await expect(page.getByLabel("并排差异对比")).toBeVisible();

      await page.getByRole("button", { name: "退出对比" }).click();
      await expect(page).not.toHaveURL(/sourceMode=/);
      await expect(page.getByText(/model = "InspectV2"/)).toBeVisible();

      await page.getByRole("button", { name: "检查器" }).click();
      const openInspector = page.getByRole("complementary", { name: "配置检查器" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(openInspector).toBeVisible();
      const layout = await openInspector.getAttribute("data-layout");
      expect(layout === "overlay" || layout === "persistent").toBe(true);
      if (layout === "persistent") {
        const sourceWidth = await page.locator(".configuration-workbench__source").evaluate((el) => el.getBoundingClientRect().width);
        expect(sourceWidth).toBeGreaterThanOrEqual(640);
      }

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
    const configSetName = `candidate-upload-${suffix}`;
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
      expect(createConfigSet.status()).toBe(201);
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
            fileName: primaryFileName,
            fileId: v1Body.item.id,
            contentBase64: Buffer.from(v2Dts, "utf8").toString("base64")
          }
        }
      );
      expect(createCandidate.status()).toBe(201);
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
      expect(failCandidate.status()).toBe(201);
      const failBody = (await failCandidate.json()) as {
        item: { id: string; status: string; diagnostics: Array<{ code: string }> };
      };
      expect(failBody.item.status).toBe("failed");
      expect(failBody.item.diagnostics.some((item) => item.code === "parse-failed")).toBe(true);

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(v1Body.item.id)}&sourceMode=candidate&candidate=${encodeURIComponent(candidateBody.item.id)}`
      );
      await expect(page.getByLabel("候选只读源码模式")).toBeVisible();
      await expect(page.getByLabel("配置身份")).toContainText(candidateBody.item.status);
      const inspectorToggle = page.getByRole("button", { name: "检查器" });
      if ((await inspectorToggle.getAttribute("aria-expanded")) !== "true") {
        await inspectorToggle.click();
      }
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("结构差异");
      await expect(inspector).toContainText("文本差异");
      await page.getByRole("button", { name: "放弃候选" }).click();
      await expect(page.getByRole("status").filter({ hasText: "候选已放弃" })).toBeVisible();

      const abandonFail = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${failBody.item.id}/abandon`),
        { headers: adminHeaders(), data: {} }
      );
      expect(abandonFail.ok()).toBe(true);

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-candidate.json", {
        route: page.url(),
        configSetId,
        fileId: v1Body.item.id,
        activeVersionId: v1Body.version.id,
        candidateId: candidateBody.item.id,
        candidateStatus: candidateBody.item.status,
        failedCandidateId: failBody.item.id
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

  test("edits a property through typed inspector, session dock, and submitStructuredEdits", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-CONFIG-EDIT-001
    // @operation PROJ-CONFIG-EDIT-001
    const suffix = randomUUID();
    const configSetName = `structured-edit-${suffix}`;
    const primaryFileName = `acceptance-structured-edit-${suffix}.dts`;
    const sample = `/dts-v1/;
/ {
	board {
		model = "EditV1";
		compatible = "wiseeff,edit";
	};
};
`;

    try {
      const upload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(sample, "utf8").toString("base64")
        }
      });
      expect(upload.ok()).toBe(true);
      const uploadBody = (await upload.json()) as {
        item: { id: string; fileName: string };
        version: { id: string; versionNumber: number };
      };

      const structureResponse = await request.get(
        apiRoute(
          `/api/v1/projects/${projectId}/parameter-files/${uploadBody.item.id}/versions/${uploadBody.version.id}/structure`
        ),
        { headers: adminHeaders() }
      );
      expect(structureResponse.ok()).toBe(true);
      const structureBody = (await structureResponse.json()) as {
        nodes: Array<{ nodePath: string; properties: Array<{ name: string; rawText: string }> }>;
      };
      const board = structureBody.nodes.find((node) => node.nodePath === "board");
      expect(board?.properties.some((property) => property.name === "model")).toBe(true);

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Structured edit acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: uploadBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      await signInBrowserAsRole(page, "admin");
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(uploadBody.item.id)}`
      );
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      await expect(page.getByLabel("只读 DTS 源码").locator('[contenteditable="true"]')).toHaveCount(0);

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await page.getByRole("treeitem", { name: "属性 board/model" }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      await expect(inspector).toContainText("可编辑");
      await expect(inspector).toContainText("变更原因");
      const stringInput = inspector.getByRole("textbox", { name: "字符串 1" });
      await expect(stringInput).toBeEnabled();
      await stringInput.fill("EditV2");

      const tasks = page.getByRole("region", { name: "配置任务" });
      await expect(tasks).toBeVisible();
      await expect(tasks).toContainText("会话变更");
      await expect(tasks.getByRole("checkbox", { name: /board\/model/ })).toBeChecked();
      await expect(page.getByRole("treeitem", { name: "属性 board/model" })).toHaveAttribute(
        "data-property-identity",
        "board::model"
      );
      await expect(page.locator('[data-session-gutter="board::model"]')).toHaveCount(1);

      await tasks.getByLabel("变更原因").fill("acceptance structured edit");
      await tasks.getByRole("button", { name: "校验所选" }).click();
      await expect(tasks.getByRole("status")).toContainText(/校验通过/);

      const submitResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/dts-structured-edits/submit") && response.request().method() === "POST"
      );
      await tasks.getByRole("button", { name: /提交所选/ }).click();
      const submitResponse = await submitResponsePromise;
      expect(submitResponse.ok()).toBe(true);
      const submitBody = (await submitResponse.json()) as {
        item: { id: string; items: Array<{ targetValue: string }> };
      };
      expect(submitBody.item.items[0]?.targetValue).toMatch(/EditV2/);
      await expect(tasks.getByRole("status").filter({ hasText: /已提交变更请求/ })).toBeVisible();

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-structured-edit.json",
        {
          route: page.url(),
          configSetId,
          fileId: uploadBody.item.id,
          versionId: uploadBody.version.id,
          submissionId: submitBody.item.id,
          targetValue: submitBody.item.items[0]?.targetValue
        }
      );
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-EDIT-001",
        title: "configuration workbench structured edit session",
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
            path: `/api/v1/projects/${projectId}/parameter-files/${uploadBody.item.id}/versions/${uploadBody.version.id}/structure`,
            responseSummary: "structure loaded"
          }),
          summarizeApiResponse(submitResponse, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/dts-structured-edits/submit`,
            responseSummary: `submission=${submitBody.item.id}`
          })
        ],
        notes:
          "Typed property edit entered the session dock with shared markers; subset validate/submit reused submitStructuredEdits while the source canvas stayed read-only."
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


});
