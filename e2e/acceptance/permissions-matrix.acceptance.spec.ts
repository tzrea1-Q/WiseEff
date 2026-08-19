import "dotenv/config";
import { expect, test } from "playwright/test";
import { signInBrowserAsRoleLabel, signInBrowserAsUser, authHeadersForRole, authHeadersForUser } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { acceptanceAdminOnlyUser, seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import {
  createBindingDraftViaApi,
  integerCellTarget,
  seedIsolatedNumericCellBinding,
  startSwappedDisposablePostCutoverRuntime
} from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);

const permissionsEligibilityReason = "M5.5 permissions matrix eligibility guard";

const visibleRoleExpectations = [
  { role: "Guest", uiRoleLabel: "访客", canOpenDebugging: false, canOpenReview: false, canOpenPlatformConsole: false },
  { role: "Hardware User", uiRoleLabel: "硬件开发", canOpenDebugging: true, canOpenReview: false, canOpenPlatformConsole: false },
  { role: "Software User", uiRoleLabel: "软件开发", canOpenDebugging: true, canOpenReview: true, canOpenPlatformConsole: false },
  { role: "Hardware Committer", uiRoleLabel: "硬件MDE", canOpenDebugging: true, canOpenReview: true, canOpenPlatformConsole: false },
  { role: "Software Committer", uiRoleLabel: "软件MDE", canOpenDebugging: true, canOpenReview: true, canOpenPlatformConsole: false },
  { role: "Admin", uiRoleLabel: "管理员", canOpenDebugging: true, canOpenReview: true, canOpenPlatformConsole: false },
  { role: "Platform Super Admin", uiRoleLabel: "平台超级管理员", canOpenDebugging: true, canOpenReview: true, canOpenPlatformConsole: true }
] as const;

async function setPrototypeRole(page: import("playwright/test").Page, roleName: string) {
  // seed-m0 binds platform-admin on u-xu-yun; matrix Admin must stay org-admin-only.
  if (roleName === "Admin") {
    await signInBrowserAsUser(
      page,
      acceptanceAdminOnlyUser.userId,
      acceptanceAdminOnlyUser.email,
      acceptanceAdminOnlyUser.name,
      "/parameter-home"
    );
    return;
  }
  await signInBrowserAsRoleLabel(page, roleName, "/parameter-home");
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
        await expect(page.getByRole("heading", { name: /无权访问该页面/i })).toHaveCount(0);
        await expect(page.locator("main, .main-content").first()).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
        await expect(page.getByText(`当前角色：${expectation.uiRoleLabel}`)).toBeVisible();
      }

      await navigateWithinApp(page, "/parameter-review");
      if (expectation.canOpenReview) {
        await expect(page.getByRole("heading", { name: /无权访问该页面/i })).toHaveCount(0);
        await expect(page.locator("main, .main-content").first()).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
        await expect(page.getByText(`当前角色：${expectation.uiRoleLabel}`)).toBeVisible();
      }

      await navigateWithinApp(page, "/platform-console");
      // @acceptance PLAT-ROLE-001
      // @operation PLAT-ROLE-001
      if (expectation.canOpenPlatformConsole) {
        await expect(page.getByRole("heading", { name: /无权访问该页面/i })).toHaveCount(0);
        // The shell TopBar owns the page title; the console body is the labelled region.
        await expect(page.getByRole("region", { name: "平台控制台" })).toBeVisible();
      } else {
        // Org Admin must not inherit Platform Super Admin via dual role bindings on u-xu-yun.
        await expect(page.getByRole("region", { name: "平台控制台" })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
        await expect(page.getByText(`当前角色：${expectation.uiRoleLabel}`)).toBeVisible();
      }

      await recordOperationEvidence({
        operationId: "PERM-MATRIX-001",
        title: `visible route permissions for ${expectation.role}`,
        status: "passed",
        page,
        testInfo,
        notes: `${expectation.role} visibility was checked for debugging, parameter review, and platform console route access.`
      });

      if (expectation.role === "Platform Super Admin" || expectation.role === "Admin") {
        await recordOperationEvidence({
          operationId: "PLAT-ROLE-001",
          title: `platform console access for ${expectation.role}`,
          status: "passed",
          page,
          testInfo,
          notes: expectation.canOpenPlatformConsole
            ? "Platform Super Admin can open /platform-console."
            : "Org Admin is denied on /platform-console."
        });
      }
    });
  }

  test("hides platform-admin grant control from organization Admin", async ({ page }, testInfo) => {
    // @acceptance PLAT-ROLE-002
    // @operation PLAT-ROLE-002
    await setPrototypeRole(page, "Admin");
    await navigateWithinApp(page, "/organization/members");
    await expect(page.getByRole("heading", { name: /无权访问该页面/i })).toHaveCount(0);

    // Existing platform-admin users may still be *labeled* 平台超级管理员 in the table/filter.
    // The grant surface is create-user + role assignment for non-platform-admin users.
    await page.getByRole("button", { name: "添加用户" }).click();
    const addUserDialog = page.getByRole("dialog", { name: "添加用户" });
    await expect(addUserDialog).toBeVisible();
    await expect(addUserDialog.getByRole("option", { name: "平台超级管理员" })).toHaveCount(0);
    await addUserDialog.getByRole("button", { name: "取消" }).click();

    // The accounts table is a paginated DataTable (10 rows per page); narrow via
    // the search filter so Zhao Heng's row is on the visible page.
    await page.getByRole("search", { name: "用户筛选" }).getByLabel("搜索").fill("Zhao Heng");
    const assignableSelect = page.getByLabel("调整 Zhao Heng 的角色");
    await expect(assignableSelect).toBeVisible();
    await expect(assignableSelect.getByRole("option", { name: "平台超级管理员" })).toHaveCount(0);

    const grantResponse = await page.request.put(apiRoute(`/api/v1/users/${acceptanceAdminOnlyUser.userId}/roles`), {
      headers: authHeadersForUser(
        acceptanceAdminOnlyUser.userId,
        acceptanceAdminOnlyUser.email,
        acceptanceAdminOnlyUser.name
      ),
      data: {
        roles: [{ projectId: null, roleId: "platform-admin" }]
      }
    });
    expect(grantResponse.status()).toBe(403);

    await recordOperationEvidence({
      operationId: "PLAT-ROLE-002",
      title: "org Admin cannot grant platform-admin",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(grantResponse, {
          method: "PUT",
          path: `/api/v1/users/${acceptanceAdminOnlyUser.userId}/roles`,
          responseSummary: "org Admin self-grant of platform-admin rejected with 403"
        })
      ],
      notes:
        "Create-user and non-platform-admin role selects omit 平台超级管理员 for org Admin; replaceUserRoles API returns 403."
    });
  });

  test("keeps platform-admin user listing scoped to the home organization", async ({ page }, testInfo) => {
    // @acceptance PLAT-ROLE-003
    // @operation PLAT-ROLE-003
    await setPrototypeRole(page, "Platform Super Admin");
    const usersResponse = await page.request.get(apiRoute("/api/v1/users"), {
      headers: authHeadersForRole("platform-admin")
    });
    expect(usersResponse.status()).toBe(200);
    const payload = (await usersResponse.json()) as { items?: Array<{ id: string; organizationId?: string }> };
    const items = payload.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    // Platform admin must not receive a cross-tenant dump; every returned user is in the seeded ChargeLab org.
    for (const item of items) {
      expect(item.id).not.toMatch(/^foreign-org-/);
    }

    await recordOperationEvidence({
      operationId: "PLAT-ROLE-003",
      title: "platform-admin users stay home-org scoped",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(usersResponse, {
          method: "GET",
          path: "/api/v1/users",
          responseSummary: `listed ${items.length} users without foreign-org prefix`
        })
      ],
      notes: "Platform Super Admin /api/v1/users listing remains bounded to the home organization."
    });
  });
});

test.describe("permissions matrix post-cutover API eligibility", () => {
  let restoreDisposable: (() => Promise<void>) | undefined;
  const databaseUrl = process.env.DATABASE_URL;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable permissions-matrix acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "perm_matrix",
      markerPurpose: "perm-matrix"
    });
    restoreDisposable = started.restore;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await restoreDisposable?.();
  });

  test("keeps API-backed workflow eligibility stricter than visible role inclusion", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PERM-MATRIX-002
    // @operation PERM-MATRIX-002
    test.setTimeout(180_000);
    const binding = await seedIsolatedNumericCellBinding(request, {
      propertyKey: "iin_max",
      cellValue: 2400,
      reason: `${permissionsEligibilityReason} binding`
    });
    const created = await createBindingDraftViaApi(request, {
      binding,
      targetValue: integerCellTarget("3103"),
      reason: permissionsEligibilityReason
    });
    expect(created.status, created.bodyText).toBe(201);
    expect(created.draft).toBeTruthy();

    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: authHeadersForRole("admin"),
      data: {
        projectId: "aurora",
        items: [
          {
            draftId: created.draft!.draftId,
            projectParameterBindingId: created.draft!.projectParameterBindingId,
            parameterSpecId: created.draft!.parameterSpecId,
            action: created.draft!.action,
            targetValue: created.draft!.rawText,
            reason: created.draft!.reason
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
      notes:
        "Typed binding-draft submit on disposable post-cutover identity rejected project-scoped workflow assignees that visible role inclusion alone would not permit (TD-079)."
    });
  });
});
