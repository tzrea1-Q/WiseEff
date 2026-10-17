import { selectControlOption } from "./helpers/selectControl";
import "./helpers/loadAcceptanceEnvironment";
import { openWorkbenchPanel } from "./helpers/runtime";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { insertFileVersion } from "../../server/modules/parameter-files/repository";
import type { ParsedIndex } from "../../server/modules/parameter-files/types";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
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
    if (/source-preview|source-conflicts|parameter-value-change-requests/.test(response.url())) {
      network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      catalog: "fixture-owned",
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
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('b906-other-software-reviewer',$1,'org-chargelab','aurora','software-committer')`,
      [acceptanceCast.chenNa.userId]);

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
        await openWorkbenchPanel(page, "candidates");
        const inspector = page.getByRole("complementary", { name: "配置检查器" });
        const dialog = inspector.getByRole("region", { name: "提交 JSON 批量来源审核" });
        if (reason === "浏览器批量批准") {
          await dialog.getByRole("textbox", { name: "修改原因" }).focus();
          await expect(dialog.getByRole("textbox", { name: "修改原因" })).toBeFocused();
          await inspector.getByRole("button", { name: "关闭检查器" }).press("Enter");
          await expect(inspector).toHaveCount(0);
          await openWorkbenchPanel(page, "candidates");
          await expect(dialog).toBeVisible();
        }
        const targetRows = dialog.getByRole("list", { name: "提交前批量目标" }).getByRole("listitem");
        await expect(targetRows).toHaveCount(2);
        await expect(targetRows.filter({ hasText: /36\.5\s*→\s*50/ })).toHaveCount(1);
        await expect(targetRows.filter({ hasText: /48\s*→\s*60/ })).toHaveCount(1);
        await dialog.getByRole("textbox", { name: "修改原因" }).fill(reason);
        await expect(dialog.getByRole("combobox", { name: "指定软件审核人" })).toContainText("选择软件审核人");
        await expect(dialog.getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "");
        await selectControlOption(dialog.getByRole("combobox", { name: "指定软件审核人" }), acceptanceCast.sunMei.userId);
        if (reason === "浏览器批量批准") {
          await expect.poll(() => dialog.evaluate((node) => node.getAnimations().every((animation) => animation.playState === "finished"))).toBe(true);
          await page.screenshot({ path: testInfo.outputPath("b906-batch-submit-dialog-1440x900.png") });
        }
        const submitted = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/api/v2/projects/aurora/parameter-value-change-requests/batches"));
        await dialog.getByRole("button", { name: "提交 2 项审核" }).click();
        const response = await submitted;
        expect(response.status(), await response.text()).toBe(201);
        const item = (await response.json()).item as { id: string; status: string; batchProofDigest: string;
          targets: Array<{ ordinal: number; bindingId: string; appliedValueId: string | null }> };
        expect(item.status).toBe("pending");
        expect(item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
        expect(item.batchProofDigest).toMatch(/^[0-9a-f]{64}$/);
        await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=aurora&request=${item.id}`));
        await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText(reason);
        return item;
      };

      const approvedFixture = await setup("approved");
      const approved = await submitFromPage(approvedFixture, "浏览器批量批准");
      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${approvedFixture.setId}&file=${approvedFixture.fileId}&sourceMode=candidate&candidate=${approvedFixture.candidateId}`);
      await dismissXiaozeHint(page);
      const pendingInspector = page.getByRole("complementary", { name: "配置检查器" });
      const expectCandidateReceipt = async (status: "pending" | "approved") => {
        await expect(pendingInspector).toContainText(`审核状态：${status === "pending" ? "待审核" : "已通过"} · 批量`);
        await pendingInspector.getByText("溯源信息", { exact: true }).click();
        await expect.poll(async () => JSON.parse((await pendingInspector.getByLabel("完整溯源数据").textContent())!)["完整来源预览"]?.request)
          .toMatchObject({ id: approved.id, status, kind: "batch" });
      };
      await openWorkbenchPanel(page, "candidates");
      await expectCandidateReceipt("pending");
      await expect(pendingInspector.getByRole("button", { name: "提交 2 项审核" })).toHaveCount(0);
      await page.reload();
      await openWorkbenchPanel(page, "candidates");
      await expectCandidateReceipt("pending");
      await expect(pendingInspector.getByRole("button", { name: "提交 2 项审核" })).toHaveCount(0);
      const otherReviewerHeaders = authHeadersForUser(
        acceptanceCast.chenNa.userId, acceptanceCast.chenNa.email, acceptanceCast.chenNa.name
      );
      const otherReviewerQueue = await request.get(api("/api/v2/projects/aurora/parameter-value-change-requests/batches?status=pending"), {
        headers: otherReviewerHeaders
      });
      expect(otherReviewerQueue.status()).toBe(200);
      expect((await otherReviewerQueue.json()).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: approved.id })]));
      const unauthorized = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${approved.id}/review`), {
        headers: authHeadersForRole("software-user"),
        data: { decision: "reject", batchProofDigest: approved.batchProofDigest }
      });
      const otherReviewerReject = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${approved.id}/review`), {
        headers: otherReviewerHeaders,
        data: { decision: "reject", batchProofDigest: approved.batchProofDigest }
      });
      expect(unauthorized.status()).toBe(404);
      expect(otherReviewerReject.status()).toBe(404);
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora`);
      const queue = page.getByRole("table", { name: "审阅队列", exact: true });
      await expect(queue.getByRole("row").filter({ hasText: "浏览器批量批准" })).toBeVisible();
      await queue.locator(`[data-review-row-id="${approved.id}"]`).getByRole("button", { name: /查看 .+ 提交详情$/ }).click();
      const detail = page.getByRole("article", { name: "批量源文件请求详情" });
      await detail.getByText("溯源信息", { exact: true }).click();
      await expect(detail.getByLabel("完整溯源数据")).toBeVisible();
      await expect.poll(async () => JSON.parse((await detail.getByLabel("完整溯源数据").textContent())!)["批量证明摘要"]).toBe(approved.batchProofDigest);
      await expect(detail.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
      const approvalResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${approved.id}/review`));
      await detail.getByRole("button", { name: "批准全部 2 项" }).click();
      await page.getByRole("dialog", { name: "确认批准整批变更", exact: true }).getByRole("button", { name: "确认批准并应用", exact: true }).click();
      expect((await approvalResponse).status()).toBe(200);
      await expect(detail).toContainText("已批准");
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已批准");
      await page.screenshot({ path: testInfo.outputPath("b906-batch-approved-1440x900.png") });
      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${approvedFixture.setId}&file=${approvedFixture.fileId}&sourceMode=candidate&candidate=${approvedFixture.candidateId}`);
      await dismissXiaozeHint(page);
      await openWorkbenchPanel(page, "candidates");
      await expectCandidateReceipt("approved");
      await expect(pendingInspector.getByRole("button", { name: "提交 2 项审核" })).toHaveCount(0);

      const rejectedFixture = await setup("rejected");
      const rejected = await submitFromPage(rejectedFixture, "浏览器批量驳回");
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora`);
      await queue.locator(`[data-review-row-id="${rejected.id}"]`).getByRole("button", { name: /查看 .+ 提交详情$/ }).click();
      const rejectResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${rejected.id}/review`));
      await detail.getByRole("button", { name: "驳回全部 2 项" }).click();
      const rejectDialog = page.getByRole("dialog", { name: /^驳回「/ });
      await expect(rejectDialog.getByRole("button", { name: "确认驳回" })).toBeDisabled();
      await rejectDialog.getByLabel("驳回原因", { exact: true }).fill("JSON 批量变更需要补充依据");
      await rejectDialog.getByRole("button", { name: "确认驳回" }).click();
      expect((await rejectResponse).status()).toBe(200);
      await expect(detail).toContainText("已驳回");
      const terminalConflicts = await request.get(api(`/api/v1/projects/aurora/parameter-file-candidates/${rejectedFixture.candidateId}/source-conflicts`),
        { headers: adminHeaders });
      expect(terminalConflicts.status()).toBe(200);
      expect(await terminalConflicts.json()).toMatchObject({ request: { id: rejected.id,
        status: "rejected", kind: "batch" }, items: [] });
      const resubmitted = await submitFromPage(rejectedFixture, "浏览器批量终态重提");
      expect(resubmitted.id).not.toBe(rejected.id);

      const withdrawnFixture = await setup("withdrawn");
      const withdrawn = await submitFromPage(withdrawnFixture, "浏览器批量撤回");
      const withdrawResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${withdrawn.id}/withdraw`));
      await detail.getByRole("button", { name: "撤回我的批量提交" }).click();
      await page.getByRole("dialog", { name: "确认撤回提交", exact: true }).getByRole("button", { name: "撤回提交", exact: true }).click();
      expect((await withdrawResponse).status()).toBe(200);
      await expect(detail).toContainText("已撤回");
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已撤回");

      const staleFixture = await setup("stale");
      const stale = await submitFromPage(staleFixture, "浏览器批量来源漂移");
      const oldVersion = (await db.query<{ version_number: number; storage_key: string; checksum: string; size_bytes: number; parsed_index: ParsedIndex }>(
        "select version_number,storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
        [staleFixture.versionId])).rows[0]!;
      const driftVersionId = randomUUID();
      await insertFileVersion(db, { id: driftVersionId, fileId: staleFixture.fileId, versionNumber: oldVersion.version_number + 1,
        storageKey: oldVersion.storage_key, checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
        parsedIndex: oldVersion.parsed_index, origin: "upload",
        createdByUserId: acceptanceCast.xuYun.userId });
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [staleFixture.fileId, driftVersionId]);
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora&request=${stale.id}`);
      const conflictResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${stale.id}/review`));
      await detail.getByRole("button", { name: "批准全部 2 项" }).click();
      await page.getByRole("dialog", { name: "确认批准整批变更", exact: true }).getByRole("button", { name: "确认批准并应用", exact: true }).click();
      expect((await conflictResponse).status()).toBe(409);
      await expect(detail.getByText(/来源或审核证明已变化/)).toBeVisible();
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
      await detail.getByText(/来源或审核证明已变化/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("b906-batch-stale-1440x900.png") });
      expect(browserErrors).toEqual([]);
      expect(network.filter((entry) => entry.startsWith("POST 201") && entry.endsWith("/batches"))).toHaveLength(5);
      expect(network.some((entry) => entry.startsWith("GET 200") && entry.endsWith(`/${rejectedFixture.candidateId}/source-conflicts`))).toBe(true);
      expect(network.some((entry) => entry.startsWith("POST 409") && entry.endsWith(`/${stale.id}/review`))).toBe(true);
      await testInfo.attach("batch-http-network.txt", { body: Buffer.from(network.join("\n")), contentType: "text/plain" });
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
