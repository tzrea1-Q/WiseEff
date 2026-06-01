import "dotenv/config";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

test.describe("M5.5 auth runtime parity", () => {
  test("loads API-mode browser current user with the local dev auth contract", async ({ page }, testInfo) => {
    // @acceptance AUTH-RUNTIME-001
    // @operation AUTH-RUNTIME-001
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
  });
});
