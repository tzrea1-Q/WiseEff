import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { dismissXiaozeToggleHint, prepareInteractionSurface } from "./helpers/interactionSurface";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

test.describe("parameter-home production dashboard", () => {
  test("loads summary and hotspots APIs and renders in-page dashboard controls", {
    tag: ["@ci-smoke"]
  }, async ({ page }, testInfo) => {
    // @acceptance PARAM-HOME-001
    // @operation PARAM-HOME-001
    const summaryResponse = await page.request.get(apiRoute("/api/v1/parameters/dashboard/summary?window=30d"), {
      headers: smokeHeaders()
    });
    const hotspotsResponse = await page.request.get(
      apiRoute("/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project"),
      { headers: smokeHeaders() }
    );

    expect(summaryResponse.ok()).toBe(true);
    expect(hotspotsResponse.ok()).toBe(true);

    const summaryBody = (await summaryResponse.json()) as { item?: { windowLabel?: string } };
    const hotspotsBody = (await hotspotsResponse.json()) as { items?: unknown[] };
    expect(summaryBody.item?.windowLabel).toBeTruthy();
    expect(Array.isArray(hotspotsBody.items)).toBe(true);

    await page.goto("/parameter-home");
    await expect(page.getByRole("main", { name: "参数管理首页" })).toBeVisible();
    await dismissXiaozeToggleHint(page);
    await prepareInteractionSurface(page);
    await expect(page.getByText("热榜")).toBeVisible();
    await page.getByRole("radio", { name: /热榜/ }).first().click();
    await expect(page.getByRole("group", { name: "时间窗口" }).first()).toBeVisible();
    await expect(page.getByRole("group", { name: "热榜维度" }).first()).toBeVisible();

    await page.getByRole("radio", { name: "近 7 天" }).first().click();
    await expect(page.getByRole("radio", { name: "近 7 天" }).first()).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".parameter-home__panel-subtitle")).toContainText("近 7 天");

    await page.getByRole("radio", { name: "模块榜" }).first().click();
    await expect(page.getByRole("radio", { name: "模块榜" }).first()).toHaveAttribute("aria-checked", "true");

    await page.getByRole("radio", { name: "项目榜" }).first().click();
    await page.getByRole("button", { name: /展开热区 #1 / }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => page.locator(".sidebar").evaluate((sidebar) => sidebar.getBoundingClientRect().right))
      .toBeLessThanOrEqual(0);

    const mobileFabOverlapsLastHotspot = await page.evaluate(() => {
      const fab = document.querySelector<HTMLElement>('button[aria-label="打开小泽"]');
      const hotspotRows = Array.from(
        document.querySelectorAll<HTMLElement>('[aria-label^="展开热区"], [aria-label^="收起热区"]')
      );
      const lastHotspot = hotspotRows.at(-1);
      if (!fab || !lastHotspot) {
        return true;
      }

      const fabRect = fab.getBoundingClientRect();
      const hotspotRect = lastHotspot.getBoundingClientRect();
      return !(
        fabRect.right <= hotspotRect.left ||
        fabRect.left >= hotspotRect.right ||
        fabRect.bottom <= hotspotRect.top ||
        fabRect.top >= hotspotRect.bottom
      );
    });

    expect(mobileFabOverlapsLastHotspot).toBe(false);

    await recordOperationEvidence({
      operationId: "PARAM-HOME-001",
      title: "parameter-home dashboard APIs and in-page controls",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(summaryResponse, {
          method: "GET",
          path: "/api/v1/parameters/dashboard/summary",
          responseSummary: `windowLabel=${summaryBody.item?.windowLabel ?? "unknown"}`
        }),
        summarizeApiResponse(hotspotsResponse, {
          method: "GET",
          path: "/api/v1/parameters/dashboard/hotspots",
          responseSummary: `items=${hotspotsBody.items?.length ?? 0}`
        })
      ],
      notes:
        "Dashboard summary/hotspots APIs returned data; /parameter-home rendered time-window and hotspot-dimension controls; the expanded mobile leaderboard remained unobstructed by the Xiaoze launcher."
    });
  });
});
