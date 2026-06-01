import "dotenv/config";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const visibleRoleExpectations = [
  { role: "Guest", canOpenDebugging: false, canOpenReview: false },
  { role: "Hardware User", canOpenDebugging: true, canOpenReview: false },
  { role: "Software User", canOpenDebugging: true, canOpenReview: false },
  { role: "Hardware Committer", canOpenDebugging: true, canOpenReview: true },
  { role: "Software Committer", canOpenDebugging: true, canOpenReview: true },
  { role: "Admin", canOpenDebugging: true, canOpenReview: true }
] as const;

async function setPrototypeRole(page: import("playwright/test").Page, roleName: string) {
  await page.goto("/parameter-home");
  const roleSwitcherButton = page.getByRole("button", { name: "Open user role switcher" });
  if ((await page.getByRole("combobox", { name: "Prototype role" }).count()) === 0) {
    await roleSwitcherButton.click();
  }
  await page.getByRole("combobox", { name: "Prototype role" }).selectOption({ label: roleName });
  await expect(page.getByRole("combobox", { name: "Prototype role" })).toHaveValue(roleValueByName(roleName));
}

async function navigateWithinApp(page: import("playwright/test").Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState(null, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

function roleValueByName(roleName: string) {
  return roleName.toLowerCase().replace(/\s+/g, "-");
}

test.describe("M5.5 permissions matrix browser acceptance", () => {
  for (const expectation of visibleRoleExpectations) {
    test(`enforces visible route permissions for ${expectation.role}`, async ({ page }) => {
      // @acceptance PERM-MATRIX-001
      await setPrototypeRole(page, expectation.role);

      await navigateWithinApp(page, "/debugging");
      if (expectation.canOpenDebugging) {
        await expect(page.getByRole("heading", { name: /Permission denied/i })).toHaveCount(0);
        await expect(page.locator("main, .main-content").first()).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
        await expect(page.getByText(`Current role: ${expectation.role}`)).toBeVisible();
      }

      await navigateWithinApp(page, "/parameter-review");
      if (expectation.canOpenReview) {
        await expect(page.getByRole("heading", { name: /Permission denied/i })).toHaveCount(0);
        await expect(page.locator("main, .main-content").first()).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
        await expect(page.getByText(`Current role: ${expectation.role}`)).toBeVisible();
      }
    });
  }

  test("keeps API-backed workflow eligibility stricter than visible role inclusion", async ({ page }) => {
    // @acceptance PERM-MATRIX-002
    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId: "aurora",
        items: [
          {
            parameterId: "aurora-fast-charge-current",
            targetValue: "3103",
            reason: "M5.5 permissions matrix eligibility guard"
          }
        ],
        reason: "M5.5 permissions matrix eligibility guard",
        assignees: {
          hardwareCommitterId: "u-xu-yun",
          softwareCommitterId: "u-xu-yun",
          softwareUserId: "u-xu-yun"
        }
      }
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        message: "Workflow assignee is not eligible for the requested role."
      }
    });
  });
});
