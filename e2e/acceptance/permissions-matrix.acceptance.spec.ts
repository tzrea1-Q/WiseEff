import "dotenv/config";
import { expect, test } from "playwright/test";
import { signInBrowserAsRoleLabel } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const permissionsEligibilityReason = "M5.5 permissions matrix eligibility guard";

const visibleRoleExpectations = [
  { role: "Guest", canOpenDebugging: false, canOpenReview: false },
  { role: "Hardware User", canOpenDebugging: true, canOpenReview: false },
  { role: "Software User", canOpenDebugging: true, canOpenReview: false },
  { role: "Hardware Committer", canOpenDebugging: true, canOpenReview: true },
  { role: "Software Committer", canOpenDebugging: true, canOpenReview: true },
  { role: "Admin", canOpenDebugging: true, canOpenReview: true }
] as const;

async function setPrototypeRole(page: import("playwright/test").Page, roleName: string) {
  await signInBrowserAsRoleLabel(page, roleName, "/parameter-home");
}

async function cleanupPermissionsEligibilityRequests() {
  await withPgClient(async (client) => {
    const requests = await client.query<{ id: string; submission_round_id: string | null }>(
      `
      select cr.id, cr.submission_round_id
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where psi.reason = $1
      `,
      [permissionsEligibilityReason]
    );
    const requestIds = requests.rows.map((row) => row.id);
    const roundIds = Array.from(
      new Set(requests.rows.map((row) => row.submission_round_id).filter((id): id is string => Boolean(id)))
    );

    if (requestIds.length > 0) {
      await client.query("delete from parameter_review_decisions where request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_submission_items where change_request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_change_requests where id = any($1::text[])", [requestIds]);
    }

    if (roundIds.length > 0) {
      await client.query(
        `
        delete from parameter_submission_rounds
        where id = any($1::text[])
          and not exists (
            select 1 from parameter_change_requests
            where parameter_change_requests.submission_round_id = parameter_submission_rounds.id
          )
        `,
        [roundIds]
      );
    }
  });
}

async function navigateWithinApp(page: import("playwright/test").Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState(null, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test.describe("M5.5 permissions matrix browser acceptance", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  for (const expectation of visibleRoleExpectations) {
    test(`enforces visible route permissions for ${expectation.role}`, async ({ page }, testInfo) => {
      // @acceptance PERM-MATRIX-001
      // @operation PERM-MATRIX-001
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

      await recordOperationEvidence({
        operationId: "PERM-MATRIX-001",
        title: `visible route permissions for ${expectation.role}`,
        status: "passed",
        page,
        testInfo,
        notes: `${expectation.role} visibility was checked for debugging and parameter review route access.`
      });
    });
  }

  test("keeps API-backed workflow eligibility stricter than visible role inclusion", async ({ page }, testInfo) => {
    // @acceptance PERM-MATRIX-002
    // @operation PERM-MATRIX-002
    await cleanupPermissionsEligibilityRequests();

    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId: "aurora",
        items: [
          {
            parameterId: "aurora-fast-charge-current",
            targetValue: "3103",
            reason: permissionsEligibilityReason
          }
        ],
        reason: permissionsEligibilityReason,
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

    await recordOperationEvidence({
      operationId: "PERM-MATRIX-002",
      title: "api workflow eligibility stricter than visible role inclusion",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(response, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: "VALIDATION_FAILED for role-ineligible workflow assignees"
        })
      ],
      notes: "API-backed parameter submission rejected project-scoped workflow assignees that visible role inclusion alone would not permit."
    });
  });
});
