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
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

useBrowserDiagnostics(test);

const adminHeaders = () => authHeadersForRole("admin");

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

test.describe("parameter-admin project list", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  test("preserves DataTable behavior, URL history, and responsive contracts", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-ADMIN-003
    // @operation PARAM-ADMIN-003
    const suffix = randomUUID().slice(0, 8);
    const queryLabel = `T${suffix.slice(0, 5)}`;
    const projectIds: string[] = [];
    const screenshotPaths: string[] = [];

    try {
      for (let index = 1; index <= 12; index += 1) {
        const ordinal = String(index).padStart(2, "0");
        const id = `td112-${suffix}-${ordinal}`;
        const response = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
          headers: adminHeaders(),
          data: {
            id,
            name: `${queryLabel}-${ordinal}`,
            code: `T${suffix.slice(0, 5)}${ordinal}`
          }
        });
        expect(response.status()).toBe(201);
        projectIds.push(id);
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await signInBrowserAsRole(page, "admin", "/parameter-admin/projects");
      await dismissXiaozeHint(page);
      await expect(page.getByRole("heading", { name: "项目清单" })).toBeVisible({ timeout: 30_000 });

      const search = page.getByRole("searchbox", { name: "搜索项目" });
      await search.fill(queryLabel);
      await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(queryLabel)}`));
      await expect(page.getByText("第 1 / 2 页 · 共 12 条")).toBeVisible();

      await page.getByRole("button", { name: "筛选状态" }).click();
      await page.getByRole("checkbox", { name: "未初始化" }).check();
      await expect(page).toHaveURL(/status=not_initialized/);
      await page.getByRole("button", { name: "筛选状态" }).click();

      const nameHeader = page.getByRole("columnheader", { name: /项目名称/ });
      await nameHeader.getByRole("button", { name: /项目名称/ }).click();
      await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
      await expect(page).toHaveURL(/sort=name-desc/);

      await page.reload();
      await dismissXiaozeHint(page);
      await expect(search).toHaveValue(queryLabel);
      await expect(page.getByRole("button", { name: "筛选状态" })).toContainText("1");
      await expect(nameHeader).toHaveAttribute("aria-sort", "descending");

      await page.getByRole("button", { name: "筛选状态" }).click();
      await page.getByRole("checkbox", { name: "未初始化" }).uncheck();
      await expect(page).not.toHaveURL(/status=not_initialized/);
      await page.getByRole("button", { name: "筛选状态" }).click();
      await page.goBack();
      await expect(page.getByRole("button", { name: "筛选状态" })).toContainText("1");
      await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
      await page.goForward();
      await expect(page.getByRole("button", { name: "筛选状态" })).not.toContainText("1");

      await page.evaluate(([q]) => {
        window.history.replaceState(null, "", `/parameter-admin/projects?q=${encodeURIComponent(q)}&status=not_initialized&sort=name-asc`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, [queryLabel] as const);
      await expect(search).toHaveValue(queryLabel);
      await expect(page.getByRole("button", { name: "筛选状态" })).toContainText("1");
      await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

      const desktopLayout = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>(".project-admin-library-table .horizontal-drag-scroll-rail");
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          railVisible: rail ? !rail.hidden && getComputedStyle(rail).display !== "none" : false
        };
      });
      expect(desktopLayout.pageOverflow).toBeLessThanOrEqual(1);
      expect(desktopLayout.railVisible).toBe(false);
      const desktopScreenshot = testInfo.outputPath("parameter-admin-projects-1440.png");
      await page.screenshot({ path: desktopScreenshot, fullPage: true });
      screenshotPaths.push(desktopScreenshot);

      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.locator(".project-admin-library-table .horizontal-drag-scroll-rail")).toBeVisible();
      const tabletLayout = await page.evaluate(() => {
        const scrollport = document.querySelector<HTMLElement>(".project-admin-library-table .data-table-scroll");
        const table = scrollport?.querySelector("table");
        const rail = document.querySelector<HTMLElement>(".project-admin-library-table .horizontal-drag-scroll-rail");
        return {
          tableWidth: table?.getBoundingClientRect().width ?? 0,
          railHeight: rail?.getBoundingClientRect().height ?? 0,
          railVisible: rail ? !rail.hidden && getComputedStyle(rail).display !== "none" : false,
          scrollable: scrollport ? scrollport.scrollWidth > scrollport.clientWidth : false,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      expect(tabletLayout.tableWidth).toBeGreaterThanOrEqual(1080);
      expect(tabletLayout.railHeight).toBe(16);
      expect(tabletLayout.railVisible).toBe(true);
      expect(tabletLayout.scrollable).toBe(true);
      expect(tabletLayout.pageOverflow).toBeLessThanOrEqual(1);
      const tabletScreenshot = testInfo.outputPath("parameter-admin-projects-768.png");
      await page.screenshot({ path: tabletScreenshot, fullPage: true });
      screenshotPaths.push(tabletScreenshot);

      await page.setViewportSize({ width: 390, height: 844 });
      const firstRow = page.locator(".project-admin-library-grid tbody tr").first();
      await expect(firstRow).toBeVisible();
      const mobileLayout = await firstRow.evaluate((row) => {
        const cells = Array.from(row.querySelectorAll<HTMLElement>("td"));
        const rail = document.querySelector<HTMLElement>(".project-admin-library-table .horizontal-drag-scroll-rail");
        return {
          labels: cells.map((cell) => cell.dataset.label),
          visibleCells: cells.filter((cell) => getComputedStyle(cell).display !== "none").length,
          railDisplay: rail ? getComputedStyle(rail).display : null,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      expect(mobileLayout.labels).toEqual([
        "项目名称",
        "项目代号",
        "状态",
        "冲突",
        "基线",
        "模块",
        "参数",
        "最近更新",
        "操作"
      ]);
      expect(mobileLayout.visibleCells).toBe(9);
      expect(mobileLayout.railDisplay).toBe("none");
      expect(mobileLayout.pageOverflow).toBeLessThanOrEqual(1);
      await expect(firstRow.getByRole("button", { name: /配置工作台/ })).toBeVisible();

      await firstRow.getByRole("button", { name: /编辑/ }).click();
      await expect(page.getByRole("dialog", { name: "编辑项目详情" })).toBeVisible();
      await page.getByRole("dialog", { name: "编辑项目详情" }).getByRole("button", { name: "取消" }).click();
      await firstRow.getByRole("button", { name: /删除/ }).click();
      await expect(page.getByRole("dialog", { name: /删除项目/ })).toBeVisible();
      await page.getByRole("dialog", { name: /删除项目/ }).getByRole("button", { name: "取消" }).click();
      await expect(page).toHaveURL(/\/parameter-admin\/projects\?/);

      const listUrl = page.url();
      await firstRow.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/parameter-admin\/projects\/td112-[^/]+\/configuration(?:\?|$)/);
      await page.goto(listUrl);
      await expect(page.getByRole("heading", { name: "项目清单" })).toBeVisible();

      await page.getByRole("button", { name: "下一页" }).click();
      await expect(page.getByText("第 2 / 2 页 · 共 12 条")).toBeVisible();

      const mobileScreenshot = testInfo.outputPath("parameter-admin-projects-390.png");
      await page.screenshot({ path: mobileScreenshot, fullPage: true });
      screenshotPaths.push(mobileScreenshot);
      for (const screenshotPath of screenshotPaths) {
        await testInfo.attach(screenshotPath.split("/").at(-1) ?? "responsive-screenshot", {
          path: screenshotPath,
          contentType: "image/png"
        });
      }

      const layoutArtifact = await writeOperationJsonArtifact(testInfo, "parameter-admin-projects-layout.json", {
        desktop: desktopLayout,
        tablet: tabletLayout,
        mobile: mobileLayout,
        history: { reload: true, popstate: true, back: true, forward: true }
      });
      const listResponse = await request.get(apiRoute("/api/v1/parameters/admin/projects"), {
        headers: adminHeaders()
      });
      expect(listResponse.ok()).toBe(true);

      await recordOperationEvidence({
        operationId: "PARAM-ADMIN-003",
        title: "project Admin DataTable URL history and responsive behavior",
        status: "passed",
        role: "Admin",
        route: "/parameter-admin/projects",
        page,
        testInfo,
        artifacts: [...screenshotPaths, layoutArtifact],
        api: [
          summarizeApiResponse(listResponse, {
            method: "GET",
            path: "/api/v1/parameters/admin/projects",
            responseSummary: `seededProjects=${projectIds.length}`
          })
        ],
        notes:
          "Verified search/status/sort URL writes; reload, popstate, Back, and Forward restoration; >10 pagination; keyboard row entry; isolated edit/delete actions; and 390/768/1440 layout contracts."
      });
    } finally {
      for (const projectId of projectIds.reverse()) {
        await request.delete(apiRoute(`/api/v1/parameters/admin/projects/${encodeURIComponent(projectId)}`), {
          headers: adminHeaders()
        });
      }
    }
  });
});
