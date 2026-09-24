import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { insertFileVersion } from "../../server/modules/parameter-files/repository";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

test.use({ viewport: { width: 1440, height: 900 } });

test("#906 B creates and reviews canonical JSON batches from the page over real HTTP", async ({ page, request }, testInfo) => {
  test.setTimeout(360_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  const browserErrors: string[] = [];
  const network: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/parameter-value-change-requests")) {
      network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      label: "b906_batch_submit_ui", markerPurpose: "b906-batch-submit"
    });
    runtime = started.runtime;
    restore = started.restore;
    const api = (path: string) => `${runtime!.apiUrl}${path}`;
    const adminHeaders = authHeadersForRole("admin");
    const reviewerHeaders = authHeadersForRole("software-committer");
    const db = createPostgresDatabase(runtime.databaseUrl);
    try {
      await installConfigurationSourceFixture(db, makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId, organizationId: "org-chargelab",
        permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
        roles: [{ roleId: "admin", projectId: null }]
      }), { subjectId: "csub_b906_batch_submit_ui", schemaId: "wiseeff.b906.batch.submit.ui" });

      const setup = async (suffix: string) => {
        const createSet = await request.post(api("/api/v1/projects/aurora/config-sets"), {
          headers: adminHeaders, data: { name: `B #906 batch ${suffix}` }
        });
        expect(createSet.ok(), await createSet.text()).toBe(true);
        const setId = (await createSet.json()).item.id as string;
        const fileName = `b906-batch-${suffix}.json`;
        const upload = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
          headers: adminHeaders, data: { fileName,
            contentBase64: Buffer.from('{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n').toString("base64") }
        });
        expect(upload.ok(), await upload.text()).toBe(true);
        const uploaded = await upload.json() as { item: { id: string }; version: { id: string } };
        const add = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
          headers: adminHeaders, data: { fileId: uploaded.item.id, role: "base", sortOrder: 0 }
        });
        expect(add.ok(), await add.text()).toBe(true);
        for (const rootPointer of ["", "/other"]) {
          const register = await request.post(api(`/api/v2/projects/aurora/parameter-files/${uploaded.item.id}/configuration-instances`), {
            headers: adminHeaders, data: { configSetId: setId, fileVersionId: uploaded.version.id,
              configurationSchemaId: "wiseeff.b906.batch.submit.ui", rootPointer,
              mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: rootPointer ? "/other/limit" : "/settings/limit" }] }
          });
          expect(register.ok(), await register.text()).toBe(true);
        }
        const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
          headers: adminHeaders, data: { fileId: uploaded.item.id, fileName,
            contentBase64: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n').toString("base64") }
        });
        expect(candidate.ok(), await candidate.text()).toBe(true);
        return { setId, fileId: uploaded.item.id, versionId: uploaded.version.id,
          candidateId: (await candidate.json()).item.id as string };
      };

      const submitFromPage = async (fixture: Awaited<ReturnType<typeof setup>>, reason: string) => {
        await signInBrowserAsRole(page, "admin", `${runtime!.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${fixture.setId}&file=${fixture.fileId}&sourceMode=candidate&candidate=${fixture.candidateId}`);
        await dismissXiaozeHint(page);
        const toggle = page.getByRole("button", { name: "检查器", exact: true });
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        const inspector = page.getByRole("complementary", { name: "配置检查器" });
        await expect(inspector.getByRole("list", { name: "来源变更目标" }).getByRole("listitem")).toHaveCount(2);
        await inspector.getByRole("button", { name: "提交 JSON 批量审核" }).click();
        const dialog = page.getByRole("dialog", { name: "提交 JSON 批量来源审核" });
        if (reason === "浏览器批量批准") {
          await page.keyboard.press("Tab");
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          await inspector.getByRole("button", { name: "提交 JSON 批量审核" }).click();
        }
        await expect(dialog.getByRole("list", { name: "提交前批量目标" }).getByRole("listitem")).toHaveCount(2);
        await dialog.getByRole("textbox", { name: "修改原因" }).fill(reason);
        await dialog.getByRole("combobox", { name: "指定软件审核人" }).selectOption(acceptanceCast.sunMei.userId);
        if (reason === "浏览器批量批准") {
          await expect.poll(() => dialog.evaluate((node) => node.getAnimations().every((animation) => animation.playState === "finished"))).toBe(true);
          await page.screenshot({ path: testInfo.outputPath("b906-batch-submit-dialog-1440x900.png") });
        }
        const submitted = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/api/v2/projects/aurora/parameter-value-change-requests/batches"));
        await dialog.getByRole("button", { name: "一次提交全部 2 项" }).click();
        const response = await submitted;
        expect(response.status(), await response.text()).toBe(201);
        const item = (await response.json()).item as { id: string; status: string; batchProofDigest: string;
          targets: Array<{ ordinal: number; bindingId: string; appliedValueId: string | null }> };
        expect(item.status).toBe("pending");
        expect(item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
        expect(item.batchProofDigest).toMatch(/^[0-9a-f]{64}$/);
        await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=aurora&request=${item.id}`));
        await expect(page.getByRole("article", { name: "JSON 批量源文件请求详情" })).toContainText(reason);
        return item;
      };

      const approvedFixture = await setup("approved");
      const approved = await submitFromPage(approvedFixture, "浏览器批量批准");
      const unauthorized = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${approved.id}/review`), {
        headers: authHeadersForRole("software-user"),
        data: { decision: "reject", batchProofDigest: approved.batchProofDigest }
      });
      expect([403, 404]).toContain(unauthorized.status());
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora`);
      const queue = page.getByRole("table", { name: "软件配置审核请求" });
      await expect(queue.getByRole("row").filter({ hasText: "浏览器批量批准" })).toBeVisible();
      await queue.getByRole("row").filter({ hasText: "浏览器批量批准" }).getByRole("button", { name: "查看批量请求" }).click();
      const detail = page.getByRole("article", { name: "JSON 批量源文件请求详情" });
      await expect(detail.getByText(approved.batchProofDigest)).toBeVisible();
      await expect(detail.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
      const approvalResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${approved.id}/review`));
      await detail.getByRole("button", { name: "批准全部 2 项" }).click();
      expect((await approvalResponse).status()).toBe(200);
      await expect(detail).toContainText("已批准");
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 批量源文件请求详情" })).toContainText("已批准");
      await page.screenshot({ path: testInfo.outputPath("b906-batch-approved-1440x900.png") });

      const rejectedFixture = await setup("rejected");
      const rejected = await submitFromPage(rejectedFixture, "浏览器批量驳回");
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora`);
      await queue.getByRole("row").filter({ hasText: "浏览器批量驳回" }).getByRole("button", { name: "查看批量请求" }).click();
      const rejectResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${rejected.id}/review`));
      await detail.getByRole("button", { name: "驳回全部 2 项" }).click();
      expect((await rejectResponse).status()).toBe(200);
      await expect(detail).toContainText("已驳回");

      const withdrawnFixture = await setup("withdrawn");
      const withdrawn = await submitFromPage(withdrawnFixture, "浏览器批量撤回");
      const withdrawResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${withdrawn.id}/withdraw`));
      await detail.getByRole("button", { name: "撤回我的批量提交" }).click();
      expect((await withdrawResponse).status()).toBe(200);
      await expect(detail).toContainText("已撤回");
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 批量源文件请求详情" })).toContainText("已撤回");

      const staleFixture = await setup("stale");
      const stale = await submitFromPage(staleFixture, "浏览器批量来源漂移");
      const oldVersion = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(
        "select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
        [staleFixture.versionId])).rows[0]!;
      const driftVersionId = randomUUID();
      await insertFileVersion(db, { id: driftVersionId, fileId: staleFixture.fileId,
        storageKey: oldVersion.storage_key, checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
        parsedIndex: oldVersion.parsed_index as Record<string, unknown>, origin: "upload",
        createdByUserId: acceptanceCast.xuYun.userId });
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [staleFixture.fileId, driftVersionId]);
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora&request=${stale.id}`);
      const conflictResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${stale.id}/review`));
      await detail.getByRole("button", { name: "批准全部 2 项" }).click();
      expect((await conflictResponse).status()).toBe(409);
      await expect(detail.getByText(/来源或审核证明已变化/)).toBeVisible();
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
      await detail.getByText(/来源或审核证明已变化/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("b906-batch-stale-1440x900.png") });
      expect(browserErrors).toEqual([]);
      expect(network.filter((entry) => entry.startsWith("POST 201") && entry.endsWith("/batches"))).toHaveLength(4);
      expect(network.some((entry) => entry.startsWith("POST 409") && entry.endsWith(`/${stale.id}/review`))).toBe(true);
      await testInfo.attach("batch-http-network.txt", { body: Buffer.from(network.join("\n")), contentType: "text/plain" });
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
