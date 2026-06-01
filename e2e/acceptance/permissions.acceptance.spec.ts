import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const databaseUrl = process.env.DATABASE_URL;
const apiAuthorization =
  process.env.VITE_WISEEFF_API_AUTHORIZATION?.trim() ||
  process.env.M5_SMOKE_AUTHORIZATION?.trim() ||
  process.env.WISEEFF_SMOKE_AUTHORIZATION?.trim();

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
  const topbar = page.locator(".topbar");
  const roleSwitcher = topbar.getByRole("combobox", { name: "Prototype role" });

  if ((await roleSwitcher.count()) === 0) {
    await topbar.getByRole("button", { name: "Open user role switcher" }).click();
  }

  await topbar.getByRole("combobox", { name: "Prototype role" }).selectOption({ label: roleName });
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
      item.kind === "user-role-change" &&
      item.action.includes(userName) &&
      (item.metadata?.newRole === roleId || item.action.includes(roleId))
  );
}

test.describe("M5.4 manual flow H - permissions and user governance", () => {
  test.beforeAll(async () => {
    await preparePermissionsAcceptanceState();
  });

  test("loads users, shows role/status, and gates user governance to Admin", async ({ page }, testInfo) => {
    // @acceptance PERM-GOV-001
    // @operation PERM-GOV-001
    await page.goto("/user-permissions");

    await expect(page.getByRole("heading", { name: "User permissions" })).toBeVisible();
    const table = page.getByRole("table", { name: "Platform users" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Xu Yun" })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Tao Lin" })).toBeVisible();

    const liuRow = table.getByRole("row").filter({ hasText: "Liu Min" });
    await expect(liuRow.getByRole("combobox", { name: "Role for Liu Min" })).toHaveValue("software-user");
    await expect(table.getByRole("row").filter({ hasText: "Tao Lin" }).getByRole("button", { name: "Enable Tao Lin" })).toBeVisible();

    const currentAdminRow = table.getByRole("row").filter({ hasText: "Xu Yun" });
    await expect(currentAdminRow.getByRole("combobox", { name: "Role for Xu Yun" })).toBeDisabled();
    await expect(currentAdminRow.getByRole("button", { name: "Disable Xu Yun" })).toBeDisabled();

    const wangRole = table.getByRole("row").filter({ hasText: "Wang Jie" }).getByRole("combobox", { name: "Role for Wang Jie" });
    await wangRole.selectOption("software-committer");
    await expect(wangRole).toHaveValue("software-committer");

    if (!(await apiExposesPermissionAudit(page, "Wang Jie", "software-committer"))) {
      testInfo.annotations.push({
        type: "product-gap",
        description:
          "User permission changes are local prototype state; /user-permissions has no visible audit timeline and the API audit endpoint does not expose this role change."
      });
    }

    await setPrototypeRole(page, "Hardware User");
    await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
    await expect(page.getByText("Current role: Hardware User")).toBeVisible();
    await expect(page.getByText("Required role: Admin")).toBeVisible();
    await expect(page.getByRole("heading", { name: "User permissions" })).toHaveCount(0);

    await setPrototypeRole(page, "Admin");
    await expect(page.getByRole("heading", { name: "User permissions" })).toBeVisible();

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

    await expect(page.getByRole("heading", { name: "User permissions" })).toBeVisible();
    const table = page.getByRole("table", { name: "Platform users" });
    const wangRole = table.getByRole("row").filter({ hasText: "Wang Jie" }).getByRole("combobox", { name: "Role for Wang Jie" });

    await wangRole.selectOption("software-committer");
    await expect(wangRole).toHaveValue("software-committer");

    await page.getByRole("button", { name: "Add user" }).click();
    const addUserDialog = page.getByRole("dialog", { name: "Add user" });
    await expect(addUserDialog).toBeVisible();
    await addUserDialog.getByLabel("Name").fill("Chen Rui");
    await addUserDialog.getByLabel("Email").fill("chen.rui.acceptance@chargelab.cn");
    await addUserDialog.getByLabel("Title").fill("Acceptance Test Engineer");
    await addUserDialog.getByLabel("Initial role").selectOption("software-user");
    await addUserDialog.getByRole("button", { name: "Create user" }).click();
    await expect(addUserDialog).not.toBeVisible();

    const chenRow = table.getByRole("row").filter({ hasText: "Chen Rui" });
    await expect(chenRow).toBeVisible();
    await expect(chenRow).toContainText("chen.rui.acceptance@chargelab.cn");
    await expect(chenRow.getByRole("combobox", { name: "Role for Chen Rui" })).toHaveValue("software-user");
    await expect(chenRow.getByRole("button", { name: "Disable Chen Rui" })).toBeVisible();

    if (!(await apiExposesPermissionAudit(page, "Chen Rui", "software-user"))) {
      testInfo.annotations.push({
        type: "product-gap",
        description:
          "PERM-USER-MGMT-001 proves local prototype UI mutation and route denial only; durable user-management mutation/audit API is not implemented or exposed."
      });
    }

    await setPrototypeRole(page, "Software User");
    await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
    await expect(page.getByText("Current role: Software User")).toBeVisible();
    await expect(page.getByText("Required role: Admin")).toBeVisible();
    await expect(page.getByRole("table", { name: "Platform users" })).toHaveCount(0);

    await recordOperationEvidence({
      operationId: "PERM-USER-MGMT-001",
      title: "admin user management ui and non admin denial",
      status: "passed",
      page,
      testInfo,
      notes:
        "Admin changed a non-self user's role and created a local prototype user in the UI. Software User was denied access to /user-permissions. Durable backend user-management mutation/audit remains annotated as a product gap when no API audit evidence is visible."
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
