import "dotenv/config";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

test.describe("parameter-home production dashboard", () => {
  test("loads summary and hotspots APIs and renders in-page dashboard controls", async ({ page }, testInfo) => {
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
    await expect(page.getByText("热榜")).toBeVisible();
    await page.getByRole("radio", { name: /热榜/ }).first().click();
    await expect(page.getByRole("group", { name: "时间窗口" }).first()).toBeVisible();
    await expect(page.getByRole("group", { name: "热榜维度" }).first()).toBeVisible();

    await page.getByRole("radio", { name: "近 7 天" }).first().click();
    await expect(page.getByRole("radio", { name: "近 7 天" }).first()).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".parameter-home__panel-subtitle")).toContainText("近 7 天");

    await page.getByRole("radio", { name: "模块榜" }).first().click();
    await expect(page.getByRole("radio", { name: "模块榜" }).first()).toHaveAttribute("aria-checked", "true");

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
      notes: "Dashboard summary/hotspots APIs returned data and /parameter-home rendered time-window and hotspot-dimension controls."
    });
  });
});
