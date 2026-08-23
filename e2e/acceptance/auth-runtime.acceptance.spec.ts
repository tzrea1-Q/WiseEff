import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

test.describe("M5.5 auth runtime parity", () => {
  test("loads API-mode browser current user with the local dev auth contract", {
    tag: ["@ci-smoke"]
  }, async ({ page }, testInfo) => {
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

  test("AUTH-LOCAL-PASSWORD-001: change current password from the profile dialog", async ({ page }) => {
    // @acceptance-planned AUTH-LOCAL-PASSWORD-001
    // @operation-planned AUTH-LOCAL-PASSWORD-001
    test.skip(
      true,
      "Pending: shared acceptance still injects HMAC smoke and does not exercise the local login form or profile password dialog. Unit coverage is in App.test.tsx / authClient.test.ts / localAuth.test.ts."
    );
    void page;
  });

  test("AUTH-LOCAL-ADMIN-RESET-001: Admin resets a member password", async ({ page }) => {
    // @acceptance-planned AUTH-LOCAL-ADMIN-RESET-001
    // @operation-planned AUTH-LOCAL-ADMIN-RESET-001
    test.skip(
      true,
      "Pending: shared acceptance still injects HMAC smoke and does not exercise local-account password reset on /organization/members. Unit coverage is in UserPermissionsPage.test.tsx / userGovernanceClient.test.ts / users service tests."
    );
    void page;
  });

  test("AUTH-LOCAL-SELF-REGISTER-001: hide Register when self-registration is disabled", async ({ page }) => {
    // @acceptance-planned AUTH-LOCAL-SELF-REGISTER-001
    // @operation-planned AUTH-LOCAL-SELF-REGISTER-001
    test.skip(
      true,
      "Pending: shared acceptance still injects HMAC smoke and does not load the unauthenticated local auth screen. Unit coverage is in App.test.tsx / localAuth.test.ts."
    );
    void page;
  });

  test("AUTH-LOCAL-BOOTSTRAP-HINT-001: show bootstrap hint when no local Admin exists", async ({ page }) => {
    // @acceptance-planned AUTH-LOCAL-BOOTSTRAP-HINT-001
    // @operation-planned AUTH-LOCAL-BOOTSTRAP-HINT-001
    test.skip(
      true,
      "Pending: shared acceptance still injects HMAC smoke and does not load the unauthenticated local auth screen. Unit coverage is in App.test.tsx."
    );
    void page;
  });
});
