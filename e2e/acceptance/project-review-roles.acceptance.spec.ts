import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { acceptanceCast } from "./helpers/cast";
import {
  createBindingDraftViaApi,
  integerCellTarget,
  numericCellDts,
  seedIsolatedBinding
} from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 } });

const adminHeaders = () => authHeadersForRole("admin");
const databaseUrl = process.env.DATABASE_URL;

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

test.describe("project review role configuration", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  test("PROJ-REVIEW-ROLES-001: Admin deep-links, searches, and confirms a project review role", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-REVIEW-ROLES-001
    // @operation PROJ-REVIEW-ROLES-001
    const suffix = randomUUID().slice(0, 8);
    const projectId = `proj-review-${suffix}`;
    const created = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
      headers: adminHeaders(),
      data: {
        id: projectId,
        name: `Review ${suffix}`,
        code: `R${suffix.slice(0, 6).toUpperCase()}`
      }
    });
    expect(created.status(), await created.text()).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(
      page,
      "admin",
      `/parameter-admin/projects/${encodeURIComponent(projectId)}/review-roles`
    );
    await dismissXiaozeHint(page);

    await expect(page.getByRole("heading", { name: `${projectId} 项目审核角色配置` })).toBeVisible({
      timeout: 30_000
    });
    await expect(page.getByRole("alert")).toContainText("审核职责未就绪");
    await expect(page.getByText("硬件 MDE 池")).toBeVisible();

    const search = page.getByRole("searchbox", { name: "搜索成员" });
    await search.fill(acceptanceCast.wangJie.name);
    const hardwareCheckbox = page.getByRole("checkbox", {
      name: `为 ${acceptanceCast.wangJie.name} 配置 硬件 MDE`
    });
    await expect(hardwareCheckbox).toBeVisible();
    await hardwareCheckbox.check();
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByRole("dialog", { name: "确认更新项目审核角色" })).toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/v1/projects/${projectId}/workflow-role-bindings/`)
    );
    await page.getByRole("button", { name: "确认保存" }).click();
    const saveResponse = await saved;
    expect(saveResponse.ok(), await saveResponse.text()).toBe(true);
    await expect(page.getByText("1 人就绪")).toBeVisible();

    await recordOperationEvidence({
      operationId: "PROJ-REVIEW-ROLES-001",
      title: "Admin configures a project review role from the deep-linked page",
      status: "passed",
      role: "Admin",
      route: `/parameter-admin/projects/${projectId}/review-roles`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(created, {
          method: "POST",
          path: "/api/v1/parameters/admin/projects"
        }),
        summarizeApiResponse(saveResponse, {
          method: "PUT",
          path: `/api/v1/projects/${projectId}/workflow-role-bindings`
        })
      ]
    });
  });

  test("PROJ-REVIEW-READINESS-001: missing review roles block submit and keep staged drafts", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-REVIEW-READINESS-001
    // @operation PROJ-REVIEW-READINESS-001
    test.skip(!databaseUrl, "DATABASE_URL is required to initialize a custom project and stage drafts.");
    test.setTimeout(120_000);

    const suffix = randomUUID().slice(0, 8);
    const projectId = `t32ready-${suffix}`;
    const created = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
      headers: adminHeaders(),
      data: {
        id: projectId,
        name: `Ready ${suffix}`,
        code: `Y${suffix.slice(0, 6).toUpperCase()}`
      }
    });
    expect(created.status(), await created.text()).toBe(201);
    await markProjectInitialized(projectId);

    const binding = await seedIsolatedBinding(request, {
      projectId,
      configSetName: "default",
      propertyKey: "iin_max",
      dts: numericCellDts("iin_max", 2300),
      rawValuePattern: "^<2300>$",
      nodeLocatorPattern: "td079_cell",
      reason: `PROJ-REVIEW-READINESS-001 ${suffix}`
    });
    const softwareDraft = await createBindingDraftViaApi(request, {
      binding,
      targetValue: integerCellTarget("<2400>"),
      reason: `readiness software-user ${suffix}`,
      role: "software-user"
    });
    expect(softwareDraft.status, softwareDraft.bodyText).toBe(201);
    const adminDraft = await createBindingDraftViaApi(request, {
      binding,
      targetValue: integerCellTarget("<2500>"),
      reason: `readiness admin ${suffix}`,
      role: "admin"
    });
    expect(adminDraft.status, adminDraft.bodyText).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(page, "software-user", `/parameters?project=${encodeURIComponent(projectId)}`);
    await dismissXiaozeHint(page);
    const softwareTray = page.getByRole("region", { name: "参数修改提交" });
    await expect(softwareTray).toBeVisible({ timeout: 30_000 });
    await expect(softwareTray.getByRole("alert")).toContainText("当前项目缺少以下审核角色");
    await expect(softwareTray.getByText("请联系管理员配置项目审核角色。")).toBeVisible();
    await expect(softwareTray.getByRole("button", { name: "配置项目审核角色" })).toHaveCount(0);
    await expect(softwareTray.getByRole("button", { name: /^提交审核/ })).toBeDisabled();
    await expect(softwareTray.getByText(`readiness software-user ${suffix}`)).toBeVisible();

    await signInBrowserAsRole(page, "admin", `/parameters?project=${encodeURIComponent(projectId)}`);
    await dismissXiaozeHint(page);
    const adminTray = page.getByRole("region", { name: "参数修改提交" });
    await expect(adminTray).toBeVisible({ timeout: 30_000 });
    await expect(adminTray.getByRole("alert")).toContainText("当前项目缺少以下审核角色");
    await expect(adminTray.getByText(`readiness admin ${suffix}`)).toBeVisible();
    await expect(adminTray.getByRole("button", { name: /^提交审核/ })).toBeDisabled();
    await adminTray.getByRole("button", { name: "配置项目审核角色" }).click();
    await expect(page).toHaveURL(new RegExp(`/parameter-admin/projects/${projectId}/review-roles`));
    await expect(page.getByRole("heading", { name: `${projectId} 项目审核角色配置` })).toBeVisible();

    await page.goto(`/parameters?project=${encodeURIComponent(projectId)}`);
    await dismissXiaozeHint(page);
    await expect(page.getByRole("region", { name: "参数修改提交" })).toContainText(
      `readiness admin ${suffix}`,
      { timeout: 30_000 }
    );

    await recordOperationEvidence({
      operationId: "PROJ-REVIEW-READINESS-001",
      title: "Missing review roles block submission, keep staged drafts, and expose Admin configuration",
      status: "passed",
      role: "Software User, Admin",
      route: `/parameters?project=${projectId}`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(created, {
          method: "POST",
          path: "/api/v1/parameters/admin/projects"
        })
      ]
    });
  });
});

async function markProjectInitialized(projectId: string) {
  await withPgClient(async (client) => {
    const updated = await client.query(
      `
      update projects
      set initialization_status = 'initialized'
      where id = $1
      `,
      [projectId]
    );
    expect(updated.rowCount, `project ${projectId} must exist to mark initialized`).toBe(1);
  });
}
