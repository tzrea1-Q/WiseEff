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
  disposablePageUrl,
  integerCellTarget,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime
} from "./helpers/semanticBindingFixture";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime
} from "./helpers/disposablePostCutoverRuntime";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 } });

const adminHeaders = () => authHeadersForRole("admin");
const databaseUrl = process.env.DATABASE_URL;
const readinessDts = `/dts-v1/;
/ {
  charger {
    compatible = "acme,power";
    iin_max = <2300>;
  };
};
`;

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

});

test.describe("project review role readiness on a canonical Catalog fixture", () => {
  let runtime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    if (!databaseUrl?.trim()) return;
    const started = await startSwappedDisposablePostCutoverRuntime(databaseUrl.trim(), {
      label: "review_readiness",
      markerPurpose: "review-readiness",
      catalog: "fixture-owned"
    });
    runtime = started.runtime;
    restoreDisposable = started.restore;
    await seedAcceptanceRoleMatrix();
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      const admin = makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId,
        organizationId: "org-chargelab",
        permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
        roles: [{ roleId: "admin", projectId: null }]
      });
      await installDriverSourceFixture(db, admin, {
        subjectId: "csub_acme_power",
        compatible: "acme,power",
        businessName: "Review readiness",
        driverName: "Acme power",
        idempotencyKey: "review-readiness-acme-power",
        reason: "PROJ-REVIEW-READINESS-001 canonical fixture"
      });
    } finally {
      await db.close();
    }
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("PROJ-REVIEW-READINESS-001: missing review roles block submit and keep staged drafts", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PROJ-REVIEW-READINESS-001
    // @operation PROJ-REVIEW-READINESS-001
    test.skip(!databaseUrl, "DATABASE_URL is required to initialize a custom project and stage drafts.");
    test.setTimeout(180_000);

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

    // Canonical Bindings exist only for registered Catalog subjects: stage the source twice
    // (initial member, then a new file version) as the canonical value workflow does.
    const configSets = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders()
    });
    expect(configSets.status(), await configSets.text()).toBe(200);
    const configSetId = ((await configSets.json()) as { items: Array<{ id: string; name: string }> }).items.find(
      (item) => item.name === "default"
    )?.id;
    expect(configSetId, "project must be created with a default config set").toBeTruthy();
    const upload = () =>
      request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
        headers: adminHeaders(),
        data: { fileName: "charger.dts", contentBase64: Buffer.from(readinessDts).toString("base64") }
      });
    const first = await upload();
    expect(first.status(), await first.text()).toBe(201);
    const member = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
      headers: adminHeaders(),
      data: { fileId: ((await first.json()) as { item: { id: string } }).item.id, role: "base", sortOrder: 0 }
    });
    expect(member.ok(), await member.text()).toBe(true);
    const second = await upload();
    expect(second.status(), await second.text()).toBe(201);

    const bindingsResponse = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
      headers: adminHeaders()
    });
    expect(bindingsResponse.status(), await bindingsResponse.text()).toBe(200);
    const bindings = ((await bindingsResponse.json()) as {
      items: Array<{ id: string }>;
    }).items;
    expect(bindings).toHaveLength(1);
    const binding = bindings[0]!;
    const baseRevisionId = await withPgClient(async (client) => {
      const revision = await client.query<{ id: string }>(
        `select id from dts_config_revisions where config_set_id = $1 order by revision_number desc limit 1`,
        [configSetId]
      );
      return revision.rows[0]?.id;
    });
    expect(baseRevisionId, "config set must have a current revision").toBeTruthy();
    const createDraft = (role: "software-user" | "admin", raw: string, reason: string) =>
      request.post(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${binding.id}/drafts`), {
        headers: authHeadersForRole(role),
        data: {
          baseRevisionId,
          targetValue: integerCellTarget(raw),
          reason
        }
      });
    const softwareDraft = await createDraft("software-user", "<2400>", `readiness software-user ${suffix}`);
    expect(softwareDraft.status(), await softwareDraft.text()).toBe(201);
    const adminDraft = await createDraft("admin", "<2500>", `readiness admin ${suffix}`);
    expect(adminDraft.status(), await adminDraft.text()).toBe(201);

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(
      page,
      "software-user",
      disposablePageUrl(runtime, `/parameters?project=${encodeURIComponent(projectId)}`)
    );
    await dismissXiaozeHint(page);
    const softwareTray = page.getByRole("region", { name: "参数修改提交" });
    await expect(softwareTray).toBeVisible({ timeout: 30_000 });
    await expect(softwareTray.getByRole("alert")).toContainText("当前项目缺少以下审核角色");
    await expect(softwareTray.getByText("请联系管理员配置项目审核角色。")).toBeVisible();
    await expect(softwareTray.getByRole("button", { name: "配置项目审核角色" })).toHaveCount(0);
    await expect(softwareTray.getByRole("button", { name: /^提交审核/ })).toBeDisabled();
    await expect(softwareTray.getByText(`readiness software-user ${suffix}`)).toBeVisible();

    await signInBrowserAsRole(
      page,
      "admin",
      disposablePageUrl(runtime, `/parameters?project=${encodeURIComponent(projectId)}`)
    );
    await dismissXiaozeHint(page);
    const adminTray = page.getByRole("region", { name: "参数修改提交" });
    await expect(adminTray).toBeVisible({ timeout: 30_000 });
    await expect(adminTray.getByRole("alert")).toContainText("当前项目缺少以下审核角色");
    await expect(adminTray.getByText(`readiness admin ${suffix}`)).toBeVisible();
    await expect(adminTray.getByRole("button", { name: /^提交审核/ })).toBeDisabled();
    await adminTray.getByRole("button", { name: "配置项目审核角色" }).click();
    await expect(page).toHaveURL(new RegExp(`/parameter-admin/projects/${projectId}/review-roles`));
    await expect(page.getByRole("heading", { name: `${projectId} 项目审核角色配置` })).toBeVisible();

    await page.goto(disposablePageUrl(runtime, `/parameters?project=${encodeURIComponent(projectId)}`));
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
