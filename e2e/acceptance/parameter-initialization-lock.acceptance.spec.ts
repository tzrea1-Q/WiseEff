import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { defaultWorkflowAssignees } from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test, {
  expectedApiFailures: [{ method: "GET", path: "/api/v2/projects", status: 404 }]
});
test.use({ viewport: { width: 1440, height: 900 } });

const adminHeaders = () => authHeadersForRole("admin");

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

test.describe("project parameter initialization lock", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  test("PARAM-INIT-LOCK-001: non-initialized projects cannot submit ordinary change rounds", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-INIT-LOCK-001
    // @operation PARAM-INIT-LOCK-001
    test.setTimeout(120_000);
    const suffix = randomUUID().slice(0, 8);
    const projectId = `t32lock-${suffix}`;
    const created = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
      headers: adminHeaders(),
      data: {
        id: projectId,
        name: `Lock ${suffix}`,
        code: `L${suffix.slice(0, 6).toUpperCase()}`
      }
    });
    expect(created.status(), await created.text()).toBe(201);

    const submitted = await request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: adminHeaders(),
      data: {
        projectId,
        items: [
          {
            draftId: `lock-draft-${suffix}`,
            projectParameterBindingId: `lock-binding-${suffix}`,
            parameterSpecId: `lock-spec-${suffix}`,
            action: "set",
            targetValue: "<1>",
            reason: `PARAM-INIT-LOCK-001 ${suffix}`
          }
        ],
        reason: `PARAM-INIT-LOCK-001 ${suffix}`,
        assignees: defaultWorkflowAssignees
      }
    });
    expect(submitted.status(), await submitted.text()).toBe(409);
    expect(await submitted.text()).toMatch(/initialization/i);

    const initialization = await request.get(
      apiRoute(`/api/v1/parameters/projects/${projectId}/initialization`),
      { headers: adminHeaders() }
    );
    expect(initialization.ok(), await initialization.text()).toBe(true);
    expect(((await initialization.json()) as { status?: string }).status).toBe("not_initialized");

    await page.setViewportSize({ width: 1440, height: 900 });
    for (const role of ["admin", "software-user"] as const) {
      const initializationLoaded = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.url().includes(`/api/v1/parameters/projects/${projectId}/initialization`)
      );
      await signInBrowserAsRole(page, role, `/parameters?project=${encodeURIComponent(projectId)}`);
      await dismissXiaozeHint(page);
      await initializationLoaded.catch(() => undefined);
      await expect(page.getByText("初始化待审阅")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("该项目可查看，初始化通过前暂不可提交普通参数变更。")).toBeVisible();
      await expect(page.getByRole("button", { name: /^提交审核/ })).toHaveCount(0);
    }

    await recordOperationEvidence({
      operationId: "PARAM-INIT-LOCK-001",
      title: "Non-initialized projects show the init lock and refuse ordinary submission rounds",
      status: "passed",
      role: "Software User, Admin",
      route: `/parameters?project=${projectId}`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(created, {
          method: "POST",
          path: "/api/v1/parameters/admin/projects"
        }),
        summarizeApiResponse(submitted, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: "409 initialization lock"
        })
      ]
    });
  });
});
