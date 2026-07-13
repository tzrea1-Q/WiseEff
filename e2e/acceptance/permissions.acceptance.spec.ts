import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { signInBrowserAsRoleLabel } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const databaseUrl = process.env.DATABASE_URL;
const apiAuthorization =
  process.env.VITE_WISEEFF_API_AUTHORIZATION?.trim() ||
  process.env.M5_SMOKE_AUTHORIZATION?.trim() ||
  process.env.WISEEFF_SMOKE_AUTHORIZATION?.trim();
const createdAcceptanceUsername = `chen.rui.acceptance.${Date.now()}`;
const acceptanceUserPassword = "WiseEff@2026";

function runNpmScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorDetails = result.error
      ? `child_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd()
      : "";

    throw new Error(
      [
        `npm run ${script} failed with exit code ${result.status}.`,
        stdout,
        stderr,
        errorDetails
      ].filter(Boolean).join("\n")
    );
  }
}

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
  await signInBrowserAsRoleLabel(page, roleName, page.url() || "/user-permissions");
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

async function userGovernanceDbSummary(input: { userId: string; roleId: string }) {
  return withPgClient(async (client) => {
    const result = await client.query<{ user_count: string; role_count: string; active: boolean | null }>(
      `
      select
        (select count(*)::text from users where id = $1) as user_count,
        (
          select count(*)::text
          from user_role_bindings
          where user_id = $1 and role_id = $2
        ) as role_count,
        (select is_active from users where id = $1) as active
      `,
      [input.userId, input.roleId]
    );
    const row = result.rows[0];

    return {
      table: "users,user_role_bindings",
      predicate: `userId=${input.userId}; roleId=${input.roleId}`,
      observed: `users=${row?.user_count ?? 0}; roles=${row?.role_count ?? 0}; active=${row?.active ?? "missing"}`,
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
    await signInBrowserAsRoleLabel(page, "Admin", "/user-permissions");
  });

  test("loads users, shows role/status, and gates user governance to Admin", async ({ page }, testInfo) => {
    // @acceptance PERM-GOV-001
    // @operation PERM-GOV-001
    await page.goto("/user-permissions");

    await expect(page.getByRole("region", { name: "用户权限" })).toBeVisible();
    const table = page.getByRole("table", { name: "平台用户" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Xu Yun" })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Tao Lin" })).toBeVisible();

    const liuRow = table.getByRole("row").filter({ hasText: "Liu Min" });
    await expect(liuRow.getByRole("combobox", { name: "调整 Liu Min 的角色" })).toHaveValue("software-user");
    await expect(table.getByRole("row").filter({ hasText: "Tao Lin" }).getByRole("button", { name: "启用" })).toBeVisible();

    const currentAdminRow = table.getByRole("row").filter({ hasText: "Xu Yun" });
    await expect(currentAdminRow.getByRole("combobox", { name: "调整 Xu Yun 的角色" })).toBeDisabled();
    await expect(currentAdminRow.getByRole("button", { name: "停用" })).toBeDisabled();

    const wangRole = table.getByRole("row").filter({ hasText: "Wang Jie" }).getByRole("combobox", { name: "调整 Wang Jie 的角色" });
    await wangRole.selectOption("software-committer");
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
    await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
    await expect(page.getByText("Current role: Hardware User")).toBeVisible();
    await expect(page.getByText("Required role: Admin")).toBeVisible();
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
    await page.goto("/user-permissions");

    await expect(page.getByRole("region", { name: "用户权限" })).toBeVisible();
    const table = page.getByRole("table", { name: "平台用户" });
    const wangRole = table.getByRole("row").filter({ hasText: "Wang Jie" }).getByRole("combobox", { name: "调整 Wang Jie 的角色" });

    await wangRole.selectOption("software-committer");
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
        })
      ])
    );

    await setPrototypeRole(page, "Software User");
    await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
    await expect(page.getByText("Current role: Software User")).toBeVisible();
    await expect(page.getByText("Required role: Admin")).toBeVisible();
    await expect(page.getByRole("table", { name: "平台用户" })).toHaveCount(0);

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
          responseSummary: "user-create and user-role-replace audit events visible"
        })
      ],
      db: [
        await userGovernanceDbSummary({
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
        })
      ],
      notes:
        "Admin changed a non-self user's role and created a backend-governed user through the UI. Software User was denied access to /user-permissions, and API, DB, and audit evidence confirmed durable user-governance writes."
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
