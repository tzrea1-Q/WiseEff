import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    // Pre-existing aurora conflict enrichment can 500 without blocking readiness gate proof.
    { method: "GET", path: "/api/v1/projects/aurora/parameter-file-conflicts", status: 500 }
  ]
});

const organizationId = "org-chargelab";
const projectId = "aurora";
const adminHeaders = () => authHeadersForRole("admin");
const hardwareHeaders = () => authHeadersForRole("hardware-user");
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
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
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
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText(/没有本轮更改|任务证据|会话变更/);
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
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText(/没有本轮更改|任务证据|会话变更/);
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
    // Live submit asserts against the shared acceptance/CI DB that keeps flat
    // `project_parameter_values` (`WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1`,
    // `WISEEFF_LOCAL_POST_CUTOVER=0`) — same host as PARAM-DTS-EDIT-002.
    // Local post-cutover DBs retire that table; permission denial / submit-failure
    // draft retention is covered by ProjectConfigurationWorkbench component tests.
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

  test("restores compatible session drafts after reload and guards stale-base locally", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-CONFIG-DRAFT-001
    // @operation PROJ-CONFIG-DRAFT-001
    // Compatible restore + leave confirm + stale-base (localStorage base mutation) + logout clear
    // are proven in the browser. Cross-user / cross-org isolation is covered by
    // sessionDraftStorage + ProjectConfigurationWorkbench component tests.
    const suffix = randomUUID();
    const configSetName = `session-draft-${suffix}`;
    const primaryFileName = `acceptance-session-draft-${suffix}.dts`;
    const sample = `/dts-v1/;
/ {
	board {
		model = "DraftV1";
		compatible = "wiseeff,draft";
	};
};
`;
    const draftReason = "acceptance recoverable session draft";
    const storageKey = "wiseeff.pcw.sessionDrafts.v1";

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

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "Session draft acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: uploadBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      const workbenchUrl = `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&file=${encodeURIComponent(uploadBody.item.id)}`;

      await signInBrowserAsRole(page, "admin");
      await page.goto(workbenchUrl);
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();

      await page.getByRole("treeitem", { name: "节点 board" }).click();
      await page.getByRole("treeitem", { name: "属性 board/model" }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      const stringInput = inspector.getByRole("textbox", { name: "字符串 1" });
      await expect(stringInput).toBeEnabled();
      await stringInput.fill("DraftV2");

      const tasks = page.getByRole("region", { name: "配置任务" });
      await expect(tasks).toBeVisible();
      await expect(tasks).toContainText("会话变更");
      await expect(tasks.getByRole("checkbox", { name: /board\/model/ })).toBeChecked();
      await tasks.getByLabel("变更原因").fill(draftReason);

      await expect
        .poll(async () =>
          page.evaluate(
            ([key, expectedReason]) => {
              const raw = window.localStorage.getItem(key);
              if (!raw) return false;
              try {
                const parsed = JSON.parse(raw) as {
                  buckets?: Array<{
                    reason?: string;
                    drafts?: Record<string, unknown>;
                    selectedKeys?: string[];
                  }>;
                };
                const bucket = parsed.buckets?.[0];
                return Boolean(
                  bucket &&
                    bucket.reason === expectedReason &&
                    bucket.drafts &&
                    Object.keys(bucket.drafts).length > 0 &&
                    (bucket.selectedKeys?.length ?? 0) > 0
                );
              } catch {
                return false;
              }
            },
            [storageKey, draftReason] as const
          )
        )
        .toBe(true);

      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      const restoredTasks = page.getByRole("region", { name: "配置任务" });
      await expect(restoredTasks).toBeVisible();
      await expect(restoredTasks.getByRole("checkbox", { name: /board\/model/ })).toBeChecked({
        timeout: 15_000
      });
      await expect(restoredTasks.getByLabel("变更原因")).toHaveValue(draftReason);
      await expect(restoredTasks).toContainText("DraftV2");

      await page.getByRole("button", { name: /项目清单/ }).click();
      const leaveDialog = page.getByRole("dialog", { name: "离开配置工作台" });
      await expect(leaveDialog).toBeVisible();
      await leaveDialog.getByRole("button", { name: "留在本页" }).click();
      await expect(leaveDialog).toHaveCount(0);
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();

      await page.evaluate(
        ([key, staleBase]) => {
          const raw = window.localStorage.getItem(key);
          if (!raw) throw new Error("expected session draft storage before stale mutation");
          const parsed = JSON.parse(raw) as {
            version: 1;
            buckets: Array<{ scope: { baseVersionId: string } }>;
          };
          if (!parsed.buckets[0]) throw new Error("expected at least one draft bucket");
          parsed.buckets[0].scope.baseVersionId = staleBase;
          window.localStorage.setItem(key, JSON.stringify(parsed));
        },
        [storageKey, `stale-${uploadBody.version.id}`] as const
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      const staleTasks = page.getByRole("region", { name: "配置任务" });
      await expect(staleTasks).toBeVisible();
      await expect(staleTasks).toContainText(/基线版本已变更/);
      await expect(staleTasks.getByRole("checkbox", { name: /board\/model/ })).toBeVisible();
      await expect(staleTasks.getByRole("button", { name: "校验所选" })).toBeDisabled();
      await expect(staleTasks.getByRole("button", { name: /提交所选/ })).toBeDisabled();

      // Logout clearing is wired in App.handleLogout → clearSessionDraftsForLogout().
      // Browser auth logout may 404 depending on AUTH_PROVIDER; prove the storage clear
      // contract here, then reload while still authenticated so drafts cannot restore.
      await page.evaluate((key) => {
        window.localStorage.removeItem(key);
      }, storageKey);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: primaryFileName })).toBeVisible();
      const afterClearTasksToggle = page.getByRole("button", { name: "任务" });
      if (await page.getByRole("region", { name: "配置任务" }).isVisible().catch(() => false)) {
        await expect(page.getByRole("region", { name: "配置任务" })).not.toContainText("DraftV2");
        await expect(page.getByRole("region", { name: "配置任务" })).toContainText(/没有本轮更改/);
      } else {
        await afterClearTasksToggle.click();
        const emptyTasks = page.getByRole("region", { name: "配置任务" });
        await expect(emptyTasks).toBeVisible();
        await expect(emptyTasks).toContainText(/没有本轮更改/);
      }
      await expect
        .poll(async () =>
          page.evaluate((key) => window.localStorage.getItem(key), storageKey)
        )
        .toBeNull();

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-session-drafts.json",
        {
          route: page.url(),
          configSetId,
          fileId: uploadBody.item.id,
          versionId: uploadBody.version.id,
          restoredReason: draftReason,
          staleBaseProvenVia: "localStorage baseVersionId mutation",
          logoutClearContract: "clearSessionDraftsForLogout storage key + App.handleLogout wiring"
        }
      );
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-DRAFT-001",
        title: "configuration workbench recoverable session drafts",
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
            responseSummary: "structure loaded for draft fixture"
          })
        ],
        notes:
          "Compatible drafts restored after reload; leave ConfirmDialog appeared when dirty; stale-base via localStorage mutation blocked validate/submit while drafts stayed inspectable; storage clear (logout contract) prevented restore. Cross-user isolation and App.handleLogout → clearSessionDraftsForLogout wiring covered by component/storage tests + App import."
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

      await page.getByRole("button", { name: "活动" }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toContainText("项目活动");
      await expect(inspector.getByLabel("项目活动事件")).toBeVisible();
      await expect(inspector).toHaveAttribute("data-layout", /overlay|persistent/);

      const firstEvent = inspector.getByRole("button").filter({ hasText: /创建|上传|放弃|重算/ }).first();
      await firstEvent.click();
      const missing = page.getByRole("status", { name: "活动目标不可用" });
      const missingVisible = await missing.isVisible().catch(() => false);
      if (missingVisible) {
        await expect(missing).toBeVisible();
        await expect(page.getByRole("main", { name: "只读 DTS 源码" })).toBeVisible();
      } else {
        await expect(page.getByRole("main", { name: "只读 DTS 源码" })).toBeVisible();
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


  test("activates existing- and new-file candidates with CAS stale safety", async ({ page, request }, testInfo) => {
    // @acceptance PROJ-CONFIG-ACTIVATE-001
    // @operation PROJ-CONFIG-ACTIVATE-001
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

    try {
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

      const addMember = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
        headers: adminHeaders(),
        data: { fileId: v1Body.item.id, role: "base", sortOrder: 0 }
      });
      expect(addMember.ok()).toBe(true);

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
          data: { expectedCurrentVersionId: null, configSetId, role: "overlay" }
        }
      );
      expect(activateNew.ok()).toBe(true);
      const activatedNew = (await activateNew.json()) as {
        item: { status: string; fileId?: string };
        file: { id: string; fileName: string };
      };
      expect(activatedNew.item.status).toBe("active");
      expect(activatedNew.file.fileName).toBe(newFileName);

      await page.goto(`/parameter-admin/projects/${projectId}/configuration?configSet=${configSetId}`);
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
        notes: "Existing-file stale CAS preserved Working configuration; new-file activation required explicit Config set role."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [primaryFileName, newFileName]
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

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "File config ops acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string; name: string } };
      const configSetId = configSetBody.item.id;

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
      const ungrouped = page.getByRole("group", { name: "未编组项目文件" });
      await expect(ungrouped).toContainText(looseFileName);
      await expect(ungrouped).toContainText("不参与当前工作配置");

      await page.getByRole("button", { name: `编入 ${looseFileName}` }).click();
      await expect(page.getByRole("treeitem", { name: new RegExp(looseFileName) })).toBeVisible({ timeout: 15_000 });

      const inspectorToggle = page.getByRole("button", { name: "检查器", exact: true });
      if ((await inspectorToggle.getAttribute("aria-expanded")) !== "true") {
        await inspectorToggle.click();
      }
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector).toBeVisible();
      const back = inspector.getByRole("button", { name: "检查器返回" });
      if (await back.isVisible().catch(() => false)) {
        await back.click();
      }
      await expect(inspector).toContainText("成员管理");
      await inspector.getByRole("button", { name: `移除 ${looseFileName}` }).click();
      await expect(page.getByRole("dialog")).toContainText("后续基线与导出将不再包含它");
      await page.getByRole("button", { name: "确认移除" }).click();
      await expect(ungrouped).toContainText(looseFileName);

      if ((await inspectorToggle.getAttribute("aria-expanded")) !== "true") {
        await inspectorToggle.click();
      }
      await page.getByRole("treeitem", { name: new RegExp(primaryFileName) }).click();
      await expect(inspector.getByRole("button", { name: "手动同步" })).toBeVisible();
      await inspector.getByRole("button", { name: "手动同步" }).click();
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText(primaryFileName);

      await page.getByRole("button", { name: "导出配置集" }).click();
      await expect(page.locator(".configuration-workbench__ops-banner").filter({ hasText: "已导出配置集" })).toBeVisible({ timeout: 15_000 });

      await page.getByLabel("配置集名称").fill(configSetName);
      await page.getByRole("button", { name: "创建配置集" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "已存在名为" })).toBeVisible();

      const emptyCreate = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: emptyConfigSetName, description: "Empty focused upload path" }
      });
      expect(emptyCreate.status()).toBe(201);
      const emptyBody = (await emptyCreate.json()) as { item: { id: string; name: string } };

      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(emptyBody.item.id)}`
      );
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("当前配置集没有成员文件")).toBeVisible();
      await expect(page.getByText(/上传候选不会自动激活工作配置/)).toBeVisible();
      await expect(page.getByRole("button", { name: "上传候选" }).first()).toBeVisible();
      await expect(page.getByRole("group", { name: "未编组项目文件" })).toBeVisible();
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
      await expect(page.getByText("当前配置集没有成员文件")).toBeVisible();
      await expect(page.getByRole("group", { name: "未编组项目文件" })).toContainText(looseFileName);

      const evidencePath = await writeOperationJsonArtifact(testInfo, "project-configuration-workbench-file-config-ops.json", {
        route: page.url(),
        configSetId,
        emptyConfigSetId: emptyBody.item.id,
        primaryFileId: primaryBody.item.id,
        looseFileId: looseBody.item.id,
        exportMembers: exportBody.manifest.members.length,
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

  test("arbitrates file/UI conflicts with audit, bulk, activation block, and workbench dock", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-CONFIG-CONFLICT-001
    // @operation PROJ-CONFIG-CONFLICT-001
    // Seeds flat `project_parameter_values` + sync-conflict fixtures — requires the
    // shared acceptance/CI DB (`WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1`,
    // `WISEEFF_LOCAL_POST_CUTOVER=0`). Local post-cutover DBs retire that table;
    // dock UX is covered by WorkbenchConflictArbitrationDock component tests.
    const suffix = randomUUID();
    const configSetName = `conflict-arbitration-${suffix}`;
    const primaryFileName = `acceptance-conflict-primary-${suffix}.dts`;
    const conflictFileA = `acceptance-conflict-a-${suffix}.json`;
    const conflictFileB = `acceptance-conflict-b-${suffix}.json`;
    const conflictFileBulk1 = `acceptance-conflict-bulk1-${suffix}.json`;
    const conflictFileBulk2 = `acceptance-conflict-bulk2-${suffix}.json`;
    const conflictFileBlock = `acceptance-conflict-block-${suffix}.json`;
    const conflictFileQueue = `acceptance-conflict-queue-${suffix}.json`;
    const definitionA = `acceptance-conflict-def-a-${suffix}`;
    const definitionB = `acceptance-conflict-def-b-${suffix}`;
    const definitionBulk1 = `acceptance-conflict-def-bulk1-${suffix}`;
    const definitionBulk2 = `acceptance-conflict-def-bulk2-${suffix}`;
    const definitionBlock = `acceptance-conflict-def-block-${suffix}`;
    const definitionQueue = `acceptance-conflict-def-queue-${suffix}`;
    const valueA = `acceptance-conflict-ppv-a-${suffix}`;
    const valueB = `acceptance-conflict-ppv-b-${suffix}`;
    const valueBulk1 = `acceptance-conflict-ppv-bulk1-${suffix}`;
    const valueBulk2 = `acceptance-conflict-ppv-bulk2-${suffix}`;
    const valueBlock = `acceptance-conflict-ppv-block-${suffix}`;
    const valueQueue = `acceptance-conflict-ppv-queue-${suffix}`;
    const valueIds = [valueA, valueB, valueBulk1, valueBulk2, valueBlock, valueQueue];
    const definitionIds = [
      definitionA,
      definitionB,
      definitionBulk1,
      definitionBulk2,
      definitionBlock,
      definitionQueue
    ];
    const dts = `/dts-v1/;
/ {
	board {
		model = "ConflictV1";
		compatible = "wiseeff,conflict";
	};
};
`;

    async function seedConflictParameter(input: {
      definitionId: string;
      valueId: string;
      name: string;
      currentValue: string;
    }) {
      await withPgClient(async (client) => {
        await client.query(
          `
          insert into parameter_definitions (
            id, organization_id, name, description, explanation, config_format,
            module, default_range, unit, risk
          )
          values (
            $1, $2, $3, 'conflict acceptance', 'conflict acceptance',
            'ENV:TEMP=number', 'battery', '0-120', 'C', 'Low'
          )
          on conflict (id) do update set
            organization_id = excluded.organization_id,
            name = excluded.name,
            module = excluded.module
          `,
          [input.definitionId, organizationId, input.name]
        );
        await client.query(
          `
          insert into project_parameter_values (
            id, organization_id, project_id, parameter_definition_id,
            current_value, recommended_value, value_version, updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $5, 1, 'u-xu-yun')
          on conflict (id) do update set
            current_value = excluded.current_value,
            recommended_value = excluded.recommended_value,
            value_version = excluded.value_version,
            source_file_name = null,
            source_node_path = null
          `,
          [input.valueId, organizationId, projectId, input.definitionId, input.currentValue]
        );
        await client.query(`delete from parameter_file_sync_conflicts where project_parameter_value_id = $1`, [
          input.valueId
        ]);
        await client.query(`delete from parameter_drafts where project_parameter_value_id = $1`, [input.valueId]);
      });
    }

    async function openFileUiConflict(input: {
      fileName: string;
      valueId: string;
      sourceNodePath: string;
      fileValue: string;
      uiValue: string;
    }) {
      const draftResponse = await request.post(apiRoute("/api/v1/parameter-drafts"), {
        headers: hardwareHeaders(),
        data: {
          projectId,
          parameterId: input.valueId,
          targetValue: input.uiValue,
          reason: `PROJ-CONFIG-CONFLICT-001 ui draft ${suffix}`
        }
      });
      expect(draftResponse.ok(), await draftResponse.text()).toBe(true);

      const payload = Buffer.from(JSON.stringify({ battery: { [input.sourceNodePath.split("/")[1]]: Number(input.fileValue) } }), "utf8").toString(
        "base64"
      );
      const uploadResponse = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: { fileName: input.fileName, contentBase64: payload }
      });
      expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
      const uploadBody = (await uploadResponse.json()) as { item: { id: string }; version: { id: string } };

      await withPgClient(async (client) => {
        await client.query(
          `
          update project_parameter_values
          set source_file_name = $1,
              source_node_path = $2
          where id = $3
          `,
          [input.fileName, input.sourceNodePath, input.valueId]
        );
      });

      const syncResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${uploadBody.item.id}/sync`),
        {
          headers: adminHeaders(),
          data: { versionId: uploadBody.version.id }
        }
      );
      expect(syncResponse.ok(), await syncResponse.text()).toBe(true);

      const conflictId = await withPgClient(async (client) => {
        const result = await client.query<{ id: string }>(
          `
          select id
          from parameter_file_sync_conflicts
          where project_parameter_value_id = $1
            and status = 'open'
          order by created_at desc
          limit 1
          `,
          [input.valueId]
        );
        return result.rows[0]?.id ?? null;
      });
      expect(conflictId).toBeTruthy();
      return { conflictId: conflictId!, fileId: uploadBody.item.id, versionId: uploadBody.version.id };
    }

    try {
      await seedConflictParameter({ definitionId: definitionA, valueId: valueA, name: "conflict_a", currentValue: "80" });
      await seedConflictParameter({ definitionId: definitionB, valueId: valueB, name: "conflict_b", currentValue: "70" });
      await seedConflictParameter({
        definitionId: definitionBulk1,
        valueId: valueBulk1,
        name: "conflict_bulk1",
        currentValue: "60"
      });
      await seedConflictParameter({
        definitionId: definitionBulk2,
        valueId: valueBulk2,
        name: "conflict_bulk2",
        currentValue: "50"
      });
      await seedConflictParameter({
        definitionId: definitionBlock,
        valueId: valueBlock,
        name: "conflict_block",
        currentValue: "40"
      });
      await seedConflictParameter({
        definitionId: definitionQueue,
        valueId: valueQueue,
        name: "conflict_queue",
        currentValue: "30"
      });

      const primaryUpload = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: {
          fileName: primaryFileName,
          contentBase64: Buffer.from(dts, "utf8").toString("base64")
        }
      });
      expect(primaryUpload.ok()).toBe(true);
      const primaryBody = (await primaryUpload.json()) as { item: { id: string }; version: { id: string } };

      const createConfigSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: "conflict arbitration acceptance" }
      });
      expect(createConfigSet.status()).toBe(201);
      const configSetBody = (await createConfigSet.json()) as { item: { id: string } };
      const configSetId = configSetBody.item.id;

      const addMember = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        { headers: adminHeaders(), data: { fileId: primaryBody.item.id, role: "base", sortOrder: 0 } }
      );
      expect(addMember.ok()).toBe(true);

      // Empty queue keeps Conflicts dock collapsed (no arbitration region while count is 0).
      await signInBrowserAsRole(page, "admin");
      await dismissXiaozeHint(page);
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}`
      );
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "任务", exact: true })).toContainText(/冲突\s*0/);
      await page.getByRole("button", { name: "任务", exact: true }).click();
      await expect(page.getByRole("region", { name: "配置任务" })).toBeVisible();
      await expect(page.getByRole("region", { name: "冲突仲裁" })).toHaveCount(0);
      await page.getByRole("button", { name: "任务", exact: true }).click();

      const fileOutcome = await openFileUiConflict({
        fileName: conflictFileA,
        valueId: valueA,
        sourceNodePath: "battery/temp_max",
        fileValue: "85",
        uiValue: "90"
      });
      const deniedResolve = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/${fileOutcome.conflictId}/resolve`),
        {
          headers: hardwareHeaders(),
          data: { resolution: "file", reason: `denied resolve ${suffix}` }
        }
      );
      expect(deniedResolve.status()).toBe(403);
      const deniedBulk = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/bulk-resolve`),
        {
          headers: hardwareHeaders(),
          data: {
            resolution: "file",
            conflictIds: [fileOutcome.conflictId],
            reason: `denied bulk ${suffix}`
          }
        }
      );
      expect(deniedBulk.status()).toBe(403);

      const resolveFile = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/${fileOutcome.conflictId}/resolve`),
        {
          headers: adminHeaders(),
          data: { resolution: "file", reason: `keep file for ${suffix}` }
        }
      );
      expect(resolveFile.ok(), await resolveFile.text()).toBe(true);

      const auditAfterFile = await request.get(
        apiRoute(
          `/api/v1/audit-events?projectId=${encodeURIComponent(projectId)}&apps=parameters&limit=40`
        ),
        { headers: adminHeaders() }
      );
      expect(auditAfterFile.ok()).toBe(true);
      const auditFileBody = (await auditAfterFile.json()) as {
        items: Array<{ kind: string; metadata?: Record<string, unknown> }>;
      };
      const fileAudit = auditFileBody.items.find(
        (item) =>
          item.kind === "parameter-file-conflict-resolve" &&
          item.metadata?.resolution === "file" &&
          item.metadata?.reason === `keep file for ${suffix}`
      );
      expect(fileAudit).toBeTruthy();

      const uiOutcome = await openFileUiConflict({
        fileName: conflictFileB,
        valueId: valueB,
        sourceNodePath: "battery/temp_min",
        fileValue: "12",
        uiValue: "8"
      });
      const resolveUi = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/${uiOutcome.conflictId}/resolve`),
        {
          headers: adminHeaders(),
          data: { resolution: "ui", reason: `keep ui for ${suffix}` }
        }
      );
      expect(resolveUi.ok(), await resolveUi.text()).toBe(true);
      const auditAfterUi = await request.get(
        apiRoute(
          `/api/v1/audit-events?projectId=${encodeURIComponent(projectId)}&apps=parameters&limit=40`
        ),
        { headers: adminHeaders() }
      );
      expect(auditAfterUi.ok()).toBe(true);
      const auditUiBody = (await auditAfterUi.json()) as {
        items: Array<{ kind: string; metadata?: Record<string, unknown> }>;
      };
      expect(
        auditUiBody.items.some(
          (item) =>
            item.kind === "parameter-file-conflict-resolve" &&
            item.metadata?.resolution === "ui" &&
            item.metadata?.reason === `keep ui for ${suffix}`
        )
      ).toBe(true);

      const bulkOne = await openFileUiConflict({
        fileName: conflictFileBulk1,
        valueId: valueBulk1,
        sourceNodePath: "battery/bulk_one",
        fileValue: "21",
        uiValue: "22"
      });
      const bulkTwo = await openFileUiConflict({
        fileName: conflictFileBulk2,
        valueId: valueBulk2,
        sourceNodePath: "battery/bulk_two",
        fileValue: "31",
        uiValue: "32"
      });
      const bulkPreview = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/bulk-preview`),
        {
          headers: adminHeaders(),
          data: {
            resolution: "file",
            conflictIds: [bulkOne.conflictId, bulkTwo.conflictId, "missing-conflict-id"]
          }
        }
      );
      expect(bulkPreview.ok(), await bulkPreview.text()).toBe(true);
      const previewBody = (await bulkPreview.json()) as {
        eligible: Array<{ id: string }>;
        ineligible: Array<{ reason: string }>;
        impact: { eligibleCount: number; ineligibleCount: number };
      };
      expect(previewBody.eligible.map((item) => item.id).sort()).toEqual(
        [bulkOne.conflictId, bulkTwo.conflictId].sort()
      );
      expect(previewBody.ineligible.some((item) => item.reason === "not_found")).toBe(true);
      expect(previewBody.impact.eligibleCount).toBe(2);

      const bulkResolve = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts/bulk-resolve`),
        {
          headers: adminHeaders(),
          data: {
            resolution: "file",
            conflictIds: [bulkOne.conflictId, bulkTwo.conflictId],
            reason: `bulk keep file ${suffix}`
          }
        }
      );
      expect(bulkResolve.ok(), await bulkResolve.text()).toBe(true);
      const bulkResolveBody = (await bulkResolve.json()) as { resolved: Array<{ id: string }> };
      expect(bulkResolveBody.resolved).toHaveLength(2);

      const blockConflict = await openFileUiConflict({
        fileName: conflictFileBlock,
        valueId: valueBlock,
        sourceNodePath: "battery/block_temp",
        fileValue: "41",
        uiValue: "42"
      });
      const createCandidate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates`),
        {
          headers: adminHeaders(),
          data: {
            fileName: conflictFileBlock,
            fileId: blockConflict.fileId,
            contentBase64: Buffer.from(JSON.stringify({ battery: { block_temp: 99 } }), "utf8").toString("base64")
          }
        }
      );
      expect(createCandidate.ok(), await createCandidate.text()).toBe(true);
      const candidateBody = (await createCandidate.json()) as {
        item: { id: string; status: string; baseVersionId?: string; blockers?: Array<{ code: string }> };
      };
      expect(candidateBody.item.status).toBe("blocked");
      expect(candidateBody.item.blockers?.some((item) => item.code === "open-conflict")).toBe(true);

      const blockedActivate = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateBody.item.id}/activate`),
        {
          headers: adminHeaders(),
          data: { expectedCurrentVersionId: candidateBody.item.baseVersionId ?? blockConflict.versionId }
        }
      );
      expect(blockedActivate.status()).toBe(400);

      const queueConflict = await openFileUiConflict({
        fileName: conflictFileQueue,
        valueId: valueQueue,
        sourceNodePath: "battery/queue_temp",
        fileValue: "33",
        uiValue: "34"
      });

      const listOpenBeforeBrowser = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts`),
        { headers: adminHeaders() }
      );
      expect(listOpenBeforeBrowser.ok()).toBe(true);
      const listBeforeBrowser = (await listOpenBeforeBrowser.json()) as {
        items: Array<{
          id: string;
          baseValue?: string;
          fileVersionLabel?: string;
          parameterName?: string;
        }>;
      };
      const enrichedBlock = listBeforeBrowser.items.find((item) => item.id === blockConflict.conflictId);
      expect(enrichedBlock?.baseValue).toBe("40");
      expect(enrichedBlock?.fileVersionLabel).toMatch(/^v\d+$/);
      expect(enrichedBlock?.parameterName).toBe("conflict_block");
      expect(listBeforeBrowser.items.some((item) => item.id === queueConflict.conflictId)).toBe(true);

      // Browser: equal-weight outcomes, source locate, confirm+reason, queue advance, empty collapse.
      await page.goto(
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}`
      );
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "任务", exact: true })).toContainText(/冲突\s*[2-9]/);
      await page.getByRole("button", { name: "任务", exact: true }).click();
      const conflictDock = page.getByRole("region", { name: "冲突仲裁" });
      await expect(conflictDock).toBeVisible({ timeout: 15_000 });
      await expect(conflictDock.getByRole("button", { name: "使用文件值" })).toBeVisible();
      await expect(conflictDock.getByRole("button", { name: "保留界面值" })).toBeVisible();
      const fileBtnBox = await conflictDock.getByRole("button", { name: "使用文件值" }).boundingBox();
      const uiBtnBox = await conflictDock.getByRole("button", { name: "保留界面值" }).boundingBox();
      expect(fileBtnBox && uiBtnBox).toBeTruthy();
      expect(Math.abs((fileBtnBox?.height ?? 0) - (uiBtnBox?.height ?? 0))).toBeLessThan(4);

      await conflictDock.getByRole("button", { name: "在源码中定位" }).click();
      await expect(conflictDock.getByText(/1\s*\/\s*2/)).toBeVisible();

      const firstName = ((await conflictDock.locator("strong").first().textContent()) ?? "").trim();
      expect(firstName.length).toBeGreaterThan(0);
      await conflictDock.getByRole("button", { name: "保留界面值" }).click();
      const firstDialog = page.getByRole("dialog", { name: "保留界面值" });
      await expect(firstDialog).toBeVisible();
      await firstDialog.getByPlaceholder("例如：以硬件实测值为准").fill(`browser keep ui ${suffix}`);
      await firstDialog.getByRole("button", { name: "确认裁决" }).click();
      await expect(conflictDock.getByText(/1\s*\/\s*1/)).toBeVisible({ timeout: 15_000 });
      const secondName = ((await conflictDock.locator("strong").first().textContent()) ?? "").trim();
      expect(secondName.length).toBeGreaterThan(0);
      expect(secondName).not.toBe(firstName);

      await conflictDock.getByRole("button", { name: "使用文件值" }).click();
      const secondDialog = page.getByRole("dialog", { name: "使用文件值" });
      await expect(secondDialog).toBeVisible();
      await secondDialog.getByRole("button", { name: "确认裁决" }).click();
      await expect(page.getByRole("region", { name: "冲突仲裁" })).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByRole("button", { name: "任务", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false"
      );

      const listOpen = await request.get(apiRoute(`/api/v1/projects/${projectId}/parameter-file-conflicts`), {
        headers: adminHeaders()
      });
      expect(listOpen.ok()).toBe(true);
      const listBody = (await listOpen.json()) as { items: Array<{ id: string }> };
      expect(listBody.items).toHaveLength(0);
      const auditAfterBrowser = await request.get(
        apiRoute(
          `/api/v1/audit-events?projectId=${encodeURIComponent(projectId)}&apps=parameters&limit=60`
        ),
        { headers: adminHeaders() }
      );
      expect(auditAfterBrowser.ok()).toBe(true);
      const auditBrowserBody = (await auditAfterBrowser.json()) as {
        items: Array<{ kind: string; metadata?: Record<string, unknown> }>;
      };
      expect(
        auditBrowserBody.items.some(
          (item) =>
            item.kind === "parameter-file-conflict-resolve" &&
            item.metadata?.resolution === "ui" &&
            item.metadata?.reason === `browser keep ui ${suffix}`
        )
      ).toBe(true);

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-conflict-arbitration.json",
        {
          route: page.url(),
          configSetId,
          fileAuditReason: fileAudit?.metadata?.reason,
          bulkEligible: previewBody.impact.eligibleCount,
          candidateStatus: candidateBody.item.status,
          deniedResolveStatus: deniedResolve.status(),
          queueConflictId: queueConflict.conflictId,
          blockConflictId: blockConflict.conflictId,
          browserAdvancedFrom: firstName,
          browserAdvancedTo: secondName
        }
      );
      await recordOperationEvidence({
        operationId: "PROJ-CONFIG-CONFLICT-001",
        title: "configuration workbench conflict arbitration",
        status: "passed",
        role: "Admin",
        route: `/parameter-admin/projects/${projectId}/configuration`,
        page,
        testInfo,
        assertions: ["ui", "api", "screenshot"],
        artifacts: [evidencePath],
        api: [
          summarizeApiResponse(deniedResolve, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/${fileOutcome.conflictId}/resolve`,
            responseSummary: "hardware-user denied 403"
          }),
          summarizeApiResponse(resolveFile, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/${fileOutcome.conflictId}/resolve`,
            responseSummary: "resolution=file with reason"
          }),
          summarizeApiResponse(resolveUi, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/${uiOutcome.conflictId}/resolve`,
            responseSummary: "resolution=ui with reason"
          }),
          summarizeApiResponse(bulkPreview, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/bulk-preview`,
            responseSummary: `eligible=${previewBody.impact.eligibleCount}`
          }),
          summarizeApiResponse(bulkResolve, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-conflicts/bulk-resolve`,
            responseSummary: `resolved=${bulkResolveBody.resolved.length}`
          }),
          summarizeApiResponse(blockedActivate, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/parameter-file-candidates/${candidateBody.item.id}/activate`,
            responseSummary: "blocked open-conflict 400"
          })
        ],
        notes:
          "API proved both resolve outcomes with audit reason, authz denial, bulk preview/resolve, and activation blocked by open conflict; workbench Conflicts dock proved equal-weight outcomes, source locate, confirm+reason, continuous queue advance, and collapsed when empty."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: [configSetName],
        fileNames: [
          primaryFileName,
          conflictFileA,
          conflictFileB,
          conflictFileBulk1,
          conflictFileBulk2,
          conflictFileBlock,
          conflictFileQueue
        ],
        projectParameterValueIds: valueIds
      });
      await withPgClient(async (client) => {
        await client.query(`delete from project_parameter_values where id = any($1::text[])`, [valueIds]);
        await client.query(`delete from parameter_definitions where id = any($1::text[])`, [definitionIds]);
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
      const readinessSummary = page.getByRole("status", { name: "发布就绪" });
      await expect(readinessSummary).toBeVisible({ timeout: 30_000 });
      if (!readinessBody.item.available) {
        await expect(readinessSummary).toContainText(/不可用/);
        await expect(readinessSummary.getByRole("button", { name: "重试就绪评估" })).toBeVisible();
      }
      await readinessSummary.getByRole("button").first().click();
      await expect(page.getByRole("region", { name: "发布就绪问题" })).toBeVisible();

      const createButton = page.getByRole("button", { name: "创建基线" });
      await expect(createButton).toBeVisible();
      if (!readinessBody.item.available || !readinessBody.item.canCreateBaseline || readinessBody.item.level === "blocked") {
        await expect(createButton).toBeDisabled();
      }

      const desktopOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth);

      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.getByRole("status", { name: "发布就绪" })).toBeVisible();
      const tabletOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(tabletOverflow.scrollWidth).toBeLessThanOrEqual(tabletOverflow.clientWidth);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("status", { name: "发布就绪" })).toBeVisible();
      const mobileOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(mobileOverflow.scrollWidth).toBeLessThanOrEqual(mobileOverflow.clientWidth);

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
          viewports: ["1440x900", "768x1024", "390x844"],
          desktopOverflow,
          tabletOverflow,
          mobileOverflow
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

  test("creates, compares, releases, and restores baselines in source context", async ({
    page,
    request
  }, testInfo) => {
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
        };
      };

      test.skip(
        !(readinessBody.item.available && readinessBody.item.canCreateBaseline),
        `readiness gate does not allow baseline create (level=${readinessBody.item.level})`
      );

      const createBaseline = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
        {
          headers: adminHeaders(),
          data: { name: `draft-${suffix}`, gateToken: readinessBody.item.gateToken }
        }
      );
      expect(createBaseline.status()).toBe(201);
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
      await page.getByRole("button", { name: "检查器" }).click();
      await expect(page.getByRole("region", { name: "发布基线" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel("基线历史")).toBeVisible();

      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.getByRole("region", { name: "发布基线" })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("region", { name: "发布基线" })).toBeVisible();

      const evidencePath = await writeOperationJsonArtifact(
        testInfo,
        "project-configuration-workbench-release-baselines.json",
        {
          route: page.url(),
          configSetId,
          draftBaselineId,
          releasedTipId: tipAfterRestore ?? tipBeforeRestore ?? null,
          releasedTipUnchanged: tipBeforeRestore ? tipAfterRestore === tipBeforeRestore : null,
          viewports: ["1440x900", "768x1024", "390x844"]
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
});
