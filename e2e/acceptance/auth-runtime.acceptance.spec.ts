import "dotenv/config";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

test.describe("M5.5 auth runtime parity", () => {
  test("loads API-mode browser current user with the local dev auth contract", async ({ page }) => {
    // @acceptance AUTH-RUNTIME-001
    const meResponse = await page.request.get(apiRoute("/api/v1/me"), {
      headers: smokeHeaders()
    });
    expect(meResponse.ok()).toBe(true);

    await page.goto("/parameters?project=aurora");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/Unauthorized|UNAUTHENTICATED|VALIDATION_FAILED/i)).toHaveCount(0);
  });
});
