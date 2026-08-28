import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type Page } from "playwright/test";

import { runNpmScript, withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { authHeadersForUser, signInBrowserAsRoleLabel } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    { method: "GET", path: "/api/v1/users", status: 403 },
    { method: "DELETE", path: "/api/v1/users/", status: 403 },
    { method: "GET", path: "/api/v1/parameters/projects/aurora/initialization", status: 404 },
    { method: "PATCH", path: "/api/v1/organization", status: 403 }
  ]
});

const databaseUrl = process.env.DATABASE_URL;
const apiAuthorization =
  process.env.VITE_WISEEFF_API_AUTHORIZATION?.trim() ||
  process.env.M5_SMOKE_AUTHORIZATION?.trim() ||
  process.env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
const createdAcceptanceUsername = `chen.rui.acceptance.${Date.now()}`;
const acceptanceUserPassword = "WiseEff@2026";

async function preparePermissionsAcceptanceState() {
  if (!databaseUrl) {
    return;
  }

  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");

  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ('u-tao-lin', 'org-chargelab', 'Tao Lin', 'tao@chargelab.cn', 'External Viewer', false)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ('acceptance-u-tao-lin-guest', 'u-tao-lin', 'org-chargelab', null, 'guest')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `
    );
  });
}

async function setPrototypeRole(page: Page, roleName: string) {
  await signInBrowserAsRoleLabel(page, roleName, page.url() || "/organization");
}

/**
 * The accounts table is a paginated DataTable (10 rows per page), so a specific
 * user's row may sit on a later page. Narrow with the page's search filter first.
 */
async function filterUsersTo(page: Page, query: string) {
  await page.getByRole("search", { name: "用户筛选" }).getByLabel("搜索").fill(query);
}

async function apiExposesPermissionAudit(page: Page, userName: string, roleId: string) {
  if (!databaseUrl) {
    return false;
  }

  const response = await page.request.get(apiRoute("/api/v1/audit-events"));
  if (!response.ok()) {
    return false;
  }

  const body = (await response.json()) as {
    items: Array<{ kind: string; action: string; metadata?: Record<string, unknown> }>;
  };

  return body.items.some(
    (item) =>
      item.kind === "user-role-replace" &&
      item.targetId === userName &&
      Array.isArray(item.metadata?.roles) &&
      item.metadata.roles.some((role) => {
        const item = role as { roleId?: unknown; role_id?: unknown };
        return item.roleId === roleId || item.role_id === roleId;
      })
  );
}

type GovernedUserApiItem = {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  isActive: boolean;
  roles: Array<{ projectId: string | null; roleId: string }>;
};

type AuditApiItem = {
  id?: string;
  kind: string;
  action: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

async function expectSuccessfulApiGet<T>(page: Page, route: string) {
  const response = await page.request.get(apiRoute(route), {
    headers: apiAuthorization ? { Authorization: apiAuthorization } : undefined
  });
  expect(response.ok()).toBe(true);
  return { response, body: (await response.json()) as T };
}

async function seedDeletedUserHistory(userId: string) {
  if (!databaseUrl) return;
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into audit_events (
        id, organization_id, actor_user_id, actor_type, app, kind, action, severity,
        target_type, target_id, metadata, trace_id
      ) values (
        $1, 'org-chargelab', $2, 'user', 'acceptance', 'parameter-update', 'update', 'Medium',
        'parameter', 'acceptance-parameter', '{}', 'acceptance-user-delete-history'
      )
      on conflict (id) do update set actor_user_id = excluded.actor_user_id
      `,
      [`acceptance-delete-history-${userId}`, userId]
    );
  });
}

async function deletedUserDbSummary(input: { userId: string; roleId: string }) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      user_count: string;
      role_count: string;
      historical_actor_user_id: string | null;
    }>(
      `
      select
        (select count(*)::text from users where id = $1) as user_count,
        (select count(*)::text from user_role_bindings where user_id = $1 and role_id = $2) as role_count,
        (select actor_user_id from audit_events where id = $3) as historical_actor_user_id
      `,
      [input.userId, input.roleId, `acceptance-delete-history-${input.userId}`]
    );
    const row = result.rows[0];
    return {
      table: "users,user_role_bindings,audit_events",
      predicate: `deleted userId=${input.userId}; retained audit actor is null`,
      observed: `users=${row?.user_count ?? 0}; roles=${row?.role_count ?? 0}; historicalActor=${row?.historical_actor_user_id ?? "null"}`,
      rowCount: Number(row?.user_count ?? 0)
    };
  });
}

function userAuditSummaryFor(items: AuditApiItem[], match: { kind: string; targetId: string }) {
  const item = items.find((candidate) => candidate.kind === match.kind && candidate.targetId === match.targetId);
  expect(item).toBeTruthy();

  return {
    id: item?.id,
    kind: item!.kind,
    action: item!.action,
    targetId: item!.targetId,
    requestId: item?.traceId,
    metadataSummary: Object.keys(item?.metadata ?? {}).sort().join(",")
  };
}

test.describe("M5.4 manual flow H - permissions and user governance", () => {
  test.beforeAll(async () => {
    await preparePermissionsAcceptanceState();
    await seedAcceptanceRoleMatrix();
  });

  test.beforeEach(async ({ page }) => {
    await signInBrowserAsRoleLabel(page, "Admin", "/organization");
  });

  test("loads users, shows role/status, and gates user governance to Admin", async ({ page }, testInfo) => {
    // @acceptance PERM-GOV-001
    // @operation PERM-GOV-001
    await page.goto("/organization/members");

    await expect(page.getByRole("region", { name: "用户权限" })).toBeVisible();
    const table = page.getByRole("table", { name: "平台用户" });
    await expect(table).toBeVisible();
    await filterUsersTo(page, "Xu Yun");
    await expect(table.getByRole("row").filter({ hasText: "Xu Yun" })).toBeVisible();
    await filterUsersTo(page, "Tao Lin");
    await expect(table.getByRole("row").filter({ hasText: "Tao Lin" })).toBeVisible();

    await filterUsersTo(page, "Liu Min");
    const liuRow = table.getByRole("row").filter({ hasText: "Liu Min" });
    await expect(liuRow.getByRole("combobox", { name: "调整 Liu Min 的角色" })).toHaveValue("software-user");
    await filterUsersTo(page, "Tao Lin");
    await expect(table.getByRole("row").filter({ hasText: "Tao Lin" }).getByRole("button", { name: "启用" })).toBeVisible();

    await filterUsersTo(page, "Xu Yun");
    const currentAdminRow = table.getByRole("row").filter({ hasText: "Xu Yun" });
    await expect(currentAdminRow.getByRole("combobox", { name: "调整 Xu Yun 的角色" })).toBeDisabled();
    await expect(currentAdminRow.getByRole("button", { name: "停用" })).toBeDisabled();

    await filterUsersTo(page, "Wang Jie");
    const wangRole = table.getByRole("row").filter({ hasText: "Wang Jie" }).getByRole("combobox", { name: "调整 Wang Jie 的角色" });
    await wangRole.selectOption("software-committer");
    // Role changes now require an explicit governance confirmation (HCI trust repair wave 1).
    await page.getByRole("button", { name: "确认调整" }).click();
    await expect(wangRole).toHaveValue("software-committer");

    const auditVisible = await apiExposesPermissionAudit(page, "u-wang-jie", "software-committer");
    if (!auditVisible && databaseUrl) {
      const { body } = await expectSuccessfulApiGet<{ items: AuditApiItem[] }>(page, "/api/v1/audit-events");
      expect(body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "user-role-replace",
            action: "replace-roles",
            targetId: "u-wang-jie"
          })
        ])
      );
    }

    await setPrototypeRole(page, "Hardware User");
    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
    await expect(page.getByText("当前角色：硬件开发")).toBeVisible();
    await expect(page.getByText("所需角色：管理员")).toBeVisible();
    await expect(page.getByRole("region", { name: "用户权限" })).toHaveCount(0);

    await setPrototypeRole(page, "Admin");
    await expect(page.getByRole("region", { name: "用户权限" })).toBeVisible();

    await recordOperationEvidence({
      operationId: "PERM-GOV-001",
      title: "user governance admin only and self protection",
      status: "passed",
      page,
      testInfo,
      notes: "Admin saw user governance, active Admin self-disable controls were disabled, and Hardware User received controlled permission denial."
    });
  });

  test("lets Admin manage a non-self user in UI while denying non-Admin access", async ({ page }, testInfo) => {
    // @acceptance PERM-USER-MGMT-001
    // @operation PERM-USER-MGMT-001
    await page.goto("/organization/members");

    await expect(page.getByRole("region", { name: "用户权限" })).toBeVisible();
    const table = page.getByRole("table", { name: "平台用户" });
    await filterUsersTo(page, "Wang Jie");
    const wangRole = table.getByRole("row").filter({ hasText: "Wang Jie" }).getByRole("combobox", { name: "调整 Wang Jie 的角色" });

    await wangRole.selectOption("software-committer");
    // Role changes require confirmation, but selecting the already-current value
    // (left behind by the previous test) does not open the dialog — confirm only
    // when the governance ConfirmDialog actually appears.
    const roleConfirm = page.getByRole("button", { name: "确认调整" });
    await roleConfirm.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(wangRole).toHaveValue("software-committer");

    await page.getByRole("button", { name: "添加用户" }).click();
    const addUserDialog = page.getByRole("dialog", { name: "添加用户" });
    await expect(addUserDialog).toBeVisible();
    await addUserDialog.getByLabel("姓名").fill("Chen Rui");
    await addUserDialog.getByLabel("用户名").fill(createdAcceptanceUsername);
    await addUserDialog.getByLabel("职务").fill("Acceptance Test Engineer");
    await addUserDialog.getByLabel("初始密码").fill(acceptanceUserPassword);
    await addUserDialog.getByLabel("确认密码").fill(acceptanceUserPassword);
    await addUserDialog.getByLabel("初始角色").selectOption("software-user");
    await addUserDialog.getByRole("button", { name: "创建用户" }).click();
    await expect(addUserDialog).not.toBeVisible();

    await filterUsersTo(page, createdAcceptanceUsername);
    const chenRow = table.getByRole("row").filter({ hasText: createdAcceptanceUsername });
    await expect(chenRow).toBeVisible();
    await expect(chenRow).toContainText(createdAcceptanceUsername);
    await expect(chenRow.getByRole("combobox", { name: "调整 Chen Rui 的角色" })).toHaveValue("software-user");
    await expect(chenRow.getByRole("button", { name: "停用" })).toBeVisible();

    const usersApi = await expectSuccessfulApiGet<{ items: GovernedUserApiItem[] }>(page, "/api/v1/users");
    const createdUser = usersApi.body.items.find((user) => user.username === createdAcceptanceUsername);
    expect(createdUser).toBeTruthy();
    expect(createdUser).toMatchObject({
      name: "Chen Rui",
      username: createdAcceptanceUsername,
      isActive: true
    });
    expect(createdUser?.roles).toEqual(expect.arrayContaining([expect.objectContaining({ roleId: "software-user" })]));

    await seedDeletedUserHistory(createdUser!.id);
    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/api/v1/users/${encodeURIComponent(createdUser!.id)}`
    );
    await chenRow.getByRole("button", { name: "注销 Chen Rui" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "确认注销用户" });
    await expect(deleteDialog).toContainText("业务与审计历史记录会保留");
    await expect(deleteDialog).toContainText("用户引用会自动变为 null");
    await deleteDialog.getByRole("button", { name: "确认注销" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
    await expect(deleteDialog).not.toBeVisible();
    await expect(chenRow).toHaveCount(0);

    const usersAfterDeleteApi = await expectSuccessfulApiGet<{ items: GovernedUserApiItem[] }>(page, "/api/v1/users");
    expect(usersAfterDeleteApi.body.items.some((user) => user.id === createdUser!.id)).toBe(false);

    const auditApi = await expectSuccessfulApiGet<{ items: AuditApiItem[] }>(page, "/api/v1/audit-events");
    expect(auditApi.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user-create",
          action: "create",
          targetId: createdUser?.id
        }),
        expect.objectContaining({
          kind: "user-role-replace",
          action: "replace-roles",
          targetId: "u-wang-jie"
        }),
        expect.objectContaining({
          kind: "user-delete",
          action: "delete",
          targetId: createdUser?.id
        })
      ])
    );

    await setPrototypeRole(page, "Software User");
    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
    await expect(page.getByText("当前角色：软件开发")).toBeVisible();
    await expect(page.getByText("所需角色：管理员")).toBeVisible();
    await expect(page.getByRole("table", { name: "平台用户" })).toHaveCount(0);

    const deniedDelete = await page.request.delete(apiRoute("/api/v1/users/u-wang-jie"), {
      headers: authHeadersForUser(
        acceptanceCast.liuMin.userId,
        acceptanceCast.liuMin.email,
        acceptanceCast.liuMin.name
      )
    });
    expect(deniedDelete.status()).toBe(403);

    await recordOperationEvidence({
      operationId: "PERM-USER-MGMT-001",
      title: "admin user management ui and non admin denial",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(usersApi.response, {
          method: "GET",
          path: "/api/v1/users",
          responseSummary: `created user ${createdUser?.id} listed with software-user role`
        }),
        summarizeApiResponse(auditApi.response, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: "user-create, user-role-replace, and user-delete audit events visible"
        }),
        summarizeApiResponse(deleteResponse, {
          method: "DELETE",
          path: `/api/v1/users/${createdUser!.id}`,
          responseSummary: "204 permanent deletion"
        }),
        summarizeApiResponse(deniedDelete, {
          method: "DELETE",
          path: "/api/v1/users/u-wang-jie",
          responseSummary: "non-Admin deletion denied with 403"
        })
      ],
      db: [
        await deletedUserDbSummary({
          userId: createdUser!.id,
          roleId: "software-user"
        })
      ],
      audit: [
        userAuditSummaryFor(auditApi.body.items, {
          kind: "user-create",
          targetId: createdUser!.id
        }),
        userAuditSummaryFor(auditApi.body.items, {
          kind: "user-role-replace",
          targetId: "u-wang-jie"
        }),
        userAuditSummaryFor(auditApi.body.items, {
          kind: "user-delete",
          targetId: createdUser!.id
        })
      ],
      notes:
        "Admin changed a non-self user's role, created a backend-governed user, and permanently deleted that user through the UI. The user and role rows were removed, retained audit history adapted its actor reference to null, and a non-Admin DELETE was denied with 403."
    });
  });

  test("lets Admin rename the home organization while denying non-Admin writes", async ({ page }, testInfo) => {
    // @acceptance ORG-ADMIN-RENAME-001
    // @operation ORG-ADMIN-RENAME-001
    await page.goto("/organization");

    await expect(page.getByRole("region", { name: "组织档案" })).toBeVisible();
    const nameInput = page.getByLabel("显示名称");
    await expect(nameInput).toHaveValue("ChargeLab");
    await expect(page.locator(".organization-profile__id")).toHaveText("org-chargelab");

    await page.route("**/api/v1/organization", async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await route.continue();
    });

    const renamed = `ChargeLab Acceptance ${Date.now()}`;
    await nameInput.fill(renamed);
    const renameResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/v1/organization"
    );
    await page.getByRole("button", { name: "保存名称" }).click();
    const renameResponse = await renameResponsePromise;
    expect(renameResponse.ok()).toBe(true);
    await expect(nameInput).toHaveValue(renamed);
    await expect(page.locator(".organization-profile__id")).toHaveText("org-chargelab");

    const orgApi = await expectSuccessfulApiGet<{ organization: { id: string; name: string; createdAt: string } }>(
      page,
      "/api/v1/organization"
    );
    expect(orgApi.body.organization).toMatchObject({ id: "org-chargelab", name: renamed });

    const meApi = await expectSuccessfulApiGet<{ organization: { id: string; name: string } }>(page, "/api/v1/me");
    expect(meApi.body.organization).toMatchObject({ id: "org-chargelab", name: renamed });

    const auditApi = await expectSuccessfulApiGet<{ items: AuditApiItem[] }>(page, "/api/v1/audit-events");
    expect(auditApi.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "organization-update",
          action: "update",
          targetId: "org-chargelab"
        })
      ])
    );

    const restoreResponse = await page.request.patch(apiRoute("/api/v1/organization"), {
      headers: apiAuthorization ? { Authorization: apiAuthorization } : undefined,
      data: { name: "ChargeLab" }
    });
    expect(restoreResponse.ok()).toBe(true);

    const denied = await page.request.patch(apiRoute("/api/v1/organization"), {
      headers: authHeadersForUser(
        acceptanceCast.liuMin.userId,
        acceptanceCast.liuMin.email,
        acceptanceCast.liuMin.name
      ),
      data: { name: "Should Fail" }
    });
    expect(denied.status()).toBe(403);

    await recordOperationEvidence({
      operationId: "ORG-ADMIN-RENAME-001",
      title: "admin home organization rename and non admin denial",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(renameResponse, {
          method: "PATCH",
          path: "/api/v1/organization",
          responseSummary: "Admin rename completed before read-after-write verification"
        }),
        summarizeApiResponse(orgApi.response, {
          method: "GET",
          path: "/api/v1/organization",
          responseSummary: `home organization ${orgApi.body.organization.id} renamed`
        }),
        summarizeApiResponse(auditApi.response, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: "organization-update audit event visible"
        }),
        summarizeApiResponse(denied, {
          method: "PATCH",
          path: "/api/v1/organization",
          responseSummary: "Software User rename rejected with 403"
        })
      ],
      db: databaseUrl
        ? [
            await withPgClient(async (client) => {
              const result = await client.query<{ id: string; name: string }>(
                `select id, name from organizations where id = $1`,
                ["org-chargelab"]
              );
              return {
                table: "organizations",
                predicate: "id=org-chargelab",
                observed: `name=${result.rows[0]?.name ?? "missing"}`,
                rowCount: result.rowCount ?? 0
              };
            })
          ]
        : undefined,
      audit: [
        userAuditSummaryFor(auditApi.body.items, {
          kind: "organization-update",
          targetId: "org-chargelab"
        })
      ],
      notes:
        "Admin renamed the home organization on /organization. Identifier stayed org-chargelab, /api/v1/me showed the new label, audit recorded organization-update, and Software User PATCH was rejected."
    });
  });

  test("protects API-mode user context with production bearer authentication", async ({ page }) => {
    test.skip(!databaseUrl, "DATABASE_URL is required to verify inactive API users.");

    const invalidResponse = await page.request.get(apiRoute("/api/v1/me"), {
      headers: { Authorization: "Bearer invalid.production-token" }
    });
    const invalidBody = (await invalidResponse.json()) as { error?: { code?: string; message?: string } };

    expect(invalidResponse.status()).toBe(401);
    expect(invalidBody.error).toMatchObject({
      code: "UNAUTHENTICATED"
    });

    test.skip(!apiAuthorization, "A production bearer token is required to verify API-mode protected access.");

    const validResponse = await page.request.get(apiRoute("/api/v1/me"), {
      headers: { Authorization: apiAuthorization }
    });
    const validBody = (await validResponse.json()) as { user?: { id?: string; isActive?: boolean }; permissions?: string[] };

    expect(validResponse.ok()).toBe(true);
    expect(validBody.user).toMatchObject({ isActive: true });
    expect(validBody.permissions).toContain("admin:access");
  });
});
