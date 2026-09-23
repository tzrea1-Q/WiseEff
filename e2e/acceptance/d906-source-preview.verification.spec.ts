import { expect, test } from "playwright/test";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

test.use({ viewport: { width: 1440, height: 900 } });

test("D #906 real API JSON batch source preview stays read-only", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, { label: "d906_ui", markerPurpose: "d906-source-preview" });
    runtime = started.runtime;
    restore = started.restore;
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      await installConfigurationSourceFixture(db, makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId,
        organizationId: "org-chargelab",
        permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
        roles: [{ roleId: "admin", projectId: null }]
      }), { subjectId: "csub_d906_ui", schemaId: "wiseeff.d906.ui" });
    } finally {
      await db.close();
    }

    const api = (path: string) => `${runtime!.apiUrl}${path}`;
    const headers = authHeadersForRole("admin");
    const createSet = await request.post(api("/api/v1/projects/aurora/config-sets"), { headers, data: { name: "D #906 source preview" } });
    expect(createSet.ok(), await createSet.text()).toBe(true);
    const setId = (await createSet.json()).item.id as string;
    const fileName = "d906-preview.json";
    const source = '{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n';
    const upload = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
      headers, data: { fileName, contentBase64: Buffer.from(source).toString("base64") }
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const uploaded = await upload.json() as { item: { id: string }; version: { id: string } };
    const add = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
      headers, data: { fileId: uploaded.item.id, role: "base", sortOrder: 0 }
    });
    expect(add.ok(), await add.text()).toBe(true);
    for (const rootPointer of ["", "/other"]) {
      const register = await request.post(api(`/api/v2/projects/aurora/parameter-files/${uploaded.item.id}/configuration-instances`), {
        headers,
        data: {
          configSetId: setId,
          fileVersionId: uploaded.version.id,
          configurationSchemaId: "wiseeff.d906.ui",
          rootPointer,
          mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: rootPointer ? "/other/limit" : "/settings/limit" }]
        }
      });
      expect(register.ok(), await register.text()).toBe(true);
    }
    const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
      headers,
      data: {
        fileId: uploaded.item.id,
        fileName,
        contentBase64: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n').toString("base64")
      }
    });
    expect(candidate.ok(), await candidate.text()).toBe(true);
    const candidateId = (await candidate.json()).item.id as string;
    const previewResponse = await request.get(api(`/api/v1/projects/aurora/parameter-file-candidates/${candidateId}/source-preview`), { headers });
    expect(previewResponse.ok(), await previewResponse.text()).toBe(true);
    const preview = (await previewResponse.json()).item as { canSubmit: boolean; reason: string; bindings: unknown[]; baseDigest: string; proposedDigest: string };
    expect(preview).toMatchObject({ canSubmit: false, reason: "canonical-batch-writer-unavailable" });
    expect(preview.bindings).toHaveLength(2);
    expect(preview.baseDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.proposedDigest).toMatch(/^[0-9a-f]{64}$/);

    const pageErrors: string[] = [];
    const apiFailures: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(runtime!.apiUrl) && response.status() >= 400) {
        apiFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&file=${uploaded.item.id}&sourceMode=candidate&candidate=${candidateId}`);
    await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible();
    const toggle = page.getByRole("button", { name: "检查器", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const inspector = page.getByRole("complementary", { name: "配置检查器" });
    await expect(inspector).toContainText("2 个参数绑定的只读差异证明");
    await expect(inspector.getByRole("list", { name: "来源变更目标" }).getByRole("listitem")).toHaveCount(2);
    await expect(inspector).toContainText("36.5 → 50");
    await expect(inspector).toContainText("48 → 60");
    await expect(inspector.getByRole("button", { name: "提交来源变更审核" })).toBeDisabled();
    const proofSummary = inspector.getByText("完整字节摘要与来源身份", { exact: true });
    const proofDetails = proofSummary.locator("..");
    await proofSummary.focus();
    await page.keyboard.press("Enter");
    await expect(proofDetails).toHaveAttribute("open", "");
    await expect(proofDetails).toContainText(preview.baseDigest);
    await page.keyboard.press("Enter");
    await expect(proofDetails).not.toHaveAttribute("open", "");
    expect(pageErrors).toEqual([]);
    expect(apiFailures).toEqual([]);
    await inspector.getByRole("list", { name: "来源变更目标" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("d906-source-preview-1440x900.png") });
    outcome = "success";
  } finally {
    await restore?.(outcome);
  }
});
