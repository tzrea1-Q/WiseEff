import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { createPostgresDatabase } from "../../server/shared/database/client";
import { seedCanonicalParameterFixture, type CanonicalParameterFixture } from "../../server/modules/agent/testing/canonicalParameterFixture";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { authHeadersForUser, signInBrowserAsUser } from "./helpers/bearerAuth";
import { apiRoute } from "./helpers/runtime";
import { startDisposablePostCutoverRuntime, disposableRuntimeOutcomeFromTestInfo, type DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";
import { captureProcessEnvForDisposableRuntime, applyDisposableRuntimeEnv, restoreProcessEnvFromDisposableRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("#904 canonical related log reanalysis", () => {
  const environment = captureProcessEnvForDisposableRuntime();
  let runtime: DisposablePostCutoverRuntime;
  let fixture: CanonicalParameterFixture;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    if (!environment.databaseUrl) throw new Error("An explicit dedicated PostgreSQL lane is required.");
    runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, {
      catalog: "fixture-owned",
      label: "log904_related",
      apiEnv: { LOG_ANALYSIS_DETERMINISTIC: "true" }
    });
    applyDisposableRuntimeEnv(runtime);
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      fixture = await seedCanonicalParameterFixture(db, createLocalObjectStore(runtime.objectStoreRoot));
      await db.query(
        `insert into user_role_bindings (id,user_id,organization_id,project_id,role_id)
         values ('log904-editor-analyzer',$1,$2,null,'admin')`,
        [fixture.editorAuth.user.id, fixture.organizationId]
      );
    } finally {
      await db.close();
    }
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try { await runtime?.dispose(disposableRuntimeOutcomeFromTestInfo(info)); }
    finally { restoreProcessEnvFromDisposableRuntime(environment); }
  });

  test("real API upload, page rerun, and exact Binding navigation", async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const actor = fixture.editorAuth.user;
    const headers = authHeadersForUser(actor.id, "issue904-editor@example.com", actor.name, fixture.organizationId);
    const upload = await request.post(apiRoute("/api/v1/log-files"), {
      headers,
      data: {
        fileName: "log904-canonical.log",
        contentType: "text/plain",
        contentBase64: Buffer.from("2026-09-29T12:00:00Z INFO device ready\n").toString("base64"),
        relatedParameterPin: {
          kind: "canonical-pin",
          projectId: fixture.projectId,
          bindingId: fixture.bindingId,
          definitionId: fixture.definitionId,
          definitionRevisionId: fixture.definitionRevisionId
        }
      }
    });
    expect(upload.status(), await upload.text()).toBe(201);
    const created = (await upload.json()) as { log: { id: string; relatedParameterProjectId?: string }; job: { id: string } };
    expect(created.log.relatedParameterProjectId).toBe(fixture.projectId);
    await expect.poll(async () => {
      const response = await request.get(apiRoute(`/api/v1/jobs/${created.job.id}`), { headers });
      return ((await response.json()) as { item: { status: string } }).item.status;
    }, { timeout: 60_000 }).toBe("complete");

    const network: Array<{ method: string; path: string; status: number }> = [];
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/api/v1/")) network.push({ method: response.request().method(), path, status: response.status() });
    });
    await signInBrowserAsUser(
      page, actor.id, "issue904-editor@example.com", actor.name,
      `${runtime.frontendUrl}/logs?logId=${encodeURIComponent(created.log.id)}`, fixture.organizationId
    );
    await expect(page.getByRole("button", { name: "重新分析" })).toBeVisible();
    const rerunResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().includes(`/api/v1/logs/${created.log.id}/rerun`)
    );
    await page.getByRole("button", { name: "重新分析" }).click();
    const rerun = await rerunResponse;
    expect(rerun.status(), await rerun.text()).toBe(200);
    const rerunBody = (await rerun.json()) as { job: { id: string } };
    await expect.poll(async () => {
      const response = await request.get(apiRoute(`/api/v1/jobs/${rerunBody.job.id}`), { headers });
      return ((await response.json()) as { item: { status: string } }).item.status;
    }, { timeout: 60_000 }).toBe("complete");
    await expect(page.getByRole("button", { name: "查看关联参数" })).toBeEnabled();
    await page.getByRole("button", { name: "查看关联参数" }).click();
    await expect(page).toHaveURL(new RegExp(`/parameters\\?.*project=${fixture.projectId}.*bindingId=${fixture.bindingId}`));
    await expect(page.locator(`[data-binding-id="${fixture.bindingId}"]`)).toBeVisible();
    await page.screenshot({ path: info.outputPath("log904-binding-navigation.png"), fullPage: true });
    await info.attach("log904-network.json", { body: JSON.stringify(network, null, 2), contentType: "application/json" });
  });
});
