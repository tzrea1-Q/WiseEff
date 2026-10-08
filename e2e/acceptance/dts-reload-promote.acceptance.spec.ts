import "./helpers/loadAcceptanceEnvironment";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  startCanonicalReloadRun,
  startCanonicalReloadRuntime,
  type CanonicalReloadRuntime
} from "./helpers/canonicalReloadRuntime";
import { withPgClient } from "./helpers/database";
import { disposableRuntimeOutcomeFromTestInfo } from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";

useBrowserDiagnostics(test);
test.use({ viewport: { width: 1440, height: 900 } });

const databaseUrl = process.env.DATABASE_URL?.trim() || "";
const debugValue = "<1200>";

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

/**
 * Starts a real canonical reload run (exact Binding, Source Pin and compiled overlay) and
 * settles it at the terminal status under test. Deployment itself is covered by the
 * fake-bridge and controlled-device specs; this spec starts at the promote step.
 */
async function startSettledReloadRun(
  request: APIRequestContext,
  fixture: CanonicalReloadRuntime,
  status: "verified" | "unverifiable"
) {
  const run = await startCanonicalReloadRun(request, fixture, debugValue);
  expect(run.status).toBe("validated");
  await withPgClient(async (client) => {
    const updated = await client.query("update dts_reload_runs set status=$2 where id=$1", [run.id, status]);
    expect(updated.rowCount).toBe(1);
  });
  return run.id;
}

async function countOpenChangeRequests(bindingId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from project_parameter_value_change_requests
      where binding_id = $1
        and status in ('pending')
      `,
      [bindingId]
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function clearOpenDrafts(projectId: string) {
  await withPgClient(async (client) => {
    await client.query("delete from project_parameter_value_drafts where project_id = $1", [projectId]);
  });
}

test.describe("DTS reload promote-to-drafts", () => {
  test.skip(!databaseUrl, "DATABASE_URL is required to run against a disposable canonical runtime.");

  let canonical: CanonicalReloadRuntime;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    canonical = await startCanonicalReloadRuntime(request, "dts_reload_promote");
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try {
      await canonical?.runtime.dispose(disposableRuntimeOutcomeFromTestInfo(info));
    } finally {
      canonical?.restoreProcessEnv();
    }
  });

  test.beforeEach(async () => {
    await clearOpenDrafts(canonical.projectId);
  });

  test("DTS-RELOAD-PROMOTE-001: promote a verified ordinary run into parameter drafts", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance DTS-RELOAD-PROMOTE-001
    // @operation DTS-RELOAD-PROMOTE-001
    test.setTimeout(120_000);
    const binding = { projectId: canonical.projectId, bindingId: canonical.bindingId };
    const runId = await startSettledReloadRun(request, canonical, "verified");
    const requestsBefore = await countOpenChangeRequests(binding.bindingId);

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(
      page,
      "admin",
      `${canonical.runtime.frontendUrl}/dts-reload?runId=${encodeURIComponent(runId)}`
    );
    await dismissXiaozeHint(page);
    const promote = page.getByRole("button", { name: "晋升为草稿" });
    await expect(promote).toBeVisible({ timeout: 30_000 });
    const promoted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/dts-reload/runs/${runId}/promote-to-drafts`)
    );
    await promote.click();
    const promoteResponse = await promoted;
    expect(promoteResponse.ok(), await promoteResponse.text()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${binding.projectId}`), {
      timeout: 30_000
    });
    await expect(page.getByRole("region", { name: "参数修改提交" })).toBeVisible();
    await expect(page.getByRole("region", { name: "参数修改提交" })).toContainText(debugValue.replace(/[<>]/g, ""));

    const drafts = await request.get(
      apiRoute(`/api/v2/projects/${binding.projectId}/parameter-value-drafts`),
      { headers: authHeadersForRole("admin") }
    );
    expect(drafts.ok(), await drafts.text()).toBe(true);
    const draftBody = (await drafts.json()) as { items?: Array<{ bindingId?: string; targetValue?: string }> };
    expect(draftBody.items?.some((item) => item.bindingId === binding.bindingId)).toBe(true);
    const requestsAfter = await countOpenChangeRequests(binding.bindingId);
    expect(requestsAfter).toBe(requestsBefore);

    await recordOperationEvidence({
      operationId: "DTS-RELOAD-PROMOTE-001",
      title: "Verified ordinary reload run promotes stored debug values into drafts without a change request",
      status: "passed",
      role: "Admin",
      route: `/dts-reload?runId=${runId}`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(promoteResponse, {
          method: "POST",
          path: `/api/v1/dts-reload/runs/${runId}/promote-to-drafts`
        }),
        summarizeApiResponse(drafts, {
          method: "GET",
          path: `/api/v2/projects/${binding.projectId}/parameter-value-drafts`
        })
      ]
    });
  });

  test("DTS-RELOAD-PROMOTE-001: unverifiable ordinary run requires acknowledgement before promote", async ({
    page,
    request
  }) => {
    // @acceptance DTS-RELOAD-PROMOTE-001
    // @operation DTS-RELOAD-PROMOTE-001
    test.setTimeout(120_000);
    const binding = { projectId: canonical.projectId, bindingId: canonical.bindingId };
    const runId = await startSettledReloadRun(request, canonical, "unverifiable");

    await page.setViewportSize({ width: 1440, height: 900 });
    await signInBrowserAsRole(
      page,
      "admin",
      `${canonical.runtime.frontendUrl}/dts-reload?runId=${encodeURIComponent(runId)}`
    );
    await dismissXiaozeHint(page);
    await page.getByRole("button", { name: "晋升为草稿" }).click();
    const dialog = page.getByRole("dialog", { name: "确认晋升不可验证的运行" });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "晋升为草稿" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    const promoted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/dts-reload/runs/${runId}/promote-to-drafts`)
    );
    await confirm.click();
    const promoteResponse = await promoted;
    expect(promoteResponse.ok(), await promoteResponse.text()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${binding.projectId}`), {
      timeout: 30_000
    });
  });
});
