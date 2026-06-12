import "dotenv/config";
import { expect, test } from "playwright/test";
import { installBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

test.describe("M5.5 auth runtime parity", () => {
  test("loads API-mode browser current user with the local dev auth contract", async ({ page }, testInfo) => {
    // @acceptance AUTH-RUNTIME-001
    // @operation AUTH-RUNTIME-001
    const diagnostics = installBrowserDiagnostics(page, testInfo);
    const meResponse = await page.request.get(apiRoute("/api/v1/me"), {
      headers: smokeHeaders()
    });
    expect(meResponse.ok()).toBe(true);

    await page.goto("/parameters?project=aurora");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/Unauthorized|UNAUTHENTICATED|VALIDATION_FAILED/i)).toHaveCount(0);

    await recordOperationEvidence({
      operationId: "AUTH-RUNTIME-001",
      title: "API mode browser auth runtime parity",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(meResponse, {
          method: "GET",
          path: "/api/v1/me",
          responseSummary: "smoke auth accepted for current user"
        })
      ],
      notes: "/api/v1/me accepted smoke auth and the API-mode page loaded without auth errors."
    });

    diagnostics.assertNoBrowserDiagnosticsFailures();
  });

  test("shows API unavailable state instead of demo data when a required domain fails", async ({ page }, testInfo) => {
    // @acceptance API-STRICT-001
    // @operation API-STRICT-001
    const diagnostics = installBrowserDiagnostics(page, testInfo, {
      expectedApiFailures: [{ method: "GET", path: "/api/v1/projects", status: 503 }]
    });
    const simulatedProjectsResponse = {
      status: 503,
      headers: {
        "content-type": "application/json",
        "x-request-id": "acceptance-api-strict-projects"
      },
      body: JSON.stringify({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Simulated project API outage for API strict-mode acceptance."
        }
      })
    };

    await page.route("**/api/v1/projects", async (route) => {
      await route.fulfill(simulatedProjectsResponse);
    });

    await page.goto("/parameters");

    await expect(page.getByRole("alert")).toContainText(/参数 API|不可用|重试/);
    await expect(page.getByText(/Aurora|Nebula|Atlas|aurora|charging_thermal_trace|ChargeLab_X01|battery_pack_temp/)).toHaveCount(0);
    await expect(page.getByText("已保留本地演示数据")).toHaveCount(0);

    await recordOperationEvidence({
      operationId: "API-STRICT-001",
      title: "API mode required-domain outage blocks demo fallback",
      status: "passed",
      page,
      testInfo,
      api: [
        {
          method: "GET",
          path: "/api/v1/projects",
          status: simulatedProjectsResponse.status,
          requestId: simulatedProjectsResponse.headers["x-request-id"],
          responseSummary: "Simulated required-domain outage returned 503 and the UI rendered API unavailable state without demo rows."
        }
      ],
      notes: "The parameters route rendered a strict API unavailable state and did not display seeded demo business data."
    });

    diagnostics.assertNoBrowserDiagnosticsFailures();
  });
});
