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
      await expect(page.getByRole("button", { name: "上传候选" })).toBeDisabled();
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
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText("本阶段为只读查看");
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
      await expect(page.getByRole("region", { name: "配置任务" })).toContainText("本阶段为只读查看");
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

});
