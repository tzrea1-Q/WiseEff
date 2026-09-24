import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { insertFileVersion } from "../../server/modules/parameter-files/repository";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { addConfigSetFile } from "../../server/modules/parameter-files/configSetService";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

test.use({ viewport: { width: 1440, height: 900 } });

test("#906 B submits JSON member removal through UI and reviews complete frozen cohort through real API", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      label: "b906_member_ui", markerPurpose: "b906-member-review"
    });
    runtime = started.runtime;
    restore = started.restore;
    const api = (path: string) => `${runtime!.apiUrl}${path}`;
    const adminHeaders = authHeadersForRole("admin");
    const reviewerHeaders = authHeadersForRole("software-committer");
    const db = createPostgresDatabase(runtime.databaseUrl);
    const storage = createLocalObjectStore(runtime.objectStoreRoot);
    const admin = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }] });
    try {
      await installConfigurationSourceFixture(db, admin, { subjectId: "csub_b906_member_ui", schemaId: "wiseeff.b906.member.ui" });
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('b906-member-other-reviewer',$1,'org-chargelab','aurora','software-committer')`,
      [acceptanceCast.chenNa.userId]);
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!snapshot) throw new Error("Published catalog unavailable");
      const setup = async (suffix: string) => {
        const created = await request.post(api("/api/v1/projects/aurora/config-sets"), {
          headers: adminHeaders, data: { name: `B #906 ${suffix}` }
        });
        expect(created.ok(), await created.text()).toBe(true);
        const id = (await created.json()).item.id as string;
        const files = [];
        for (const [ordinal, name] of ["removed", "survivor"].entries()) {
          const fileName = `b906-${suffix}-${name}.json`;
          const uploaded = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
            headers: adminHeaders, data: { fileName,
              contentBase64: Buffer.from(`{\"limit\":${ordinal ? 48 : 36}}\n`).toString("base64") }
          });
          expect(uploaded.ok(), await uploaded.text()).toBe(true);
          const file = await uploaded.json() as { item: { id: string }; version: { id: string } };
          await addConfigSetFile(db, admin, { configSetId: id, fileId: file.item.id,
            role: ordinal ? "overlay" : "base", sortOrder: ordinal });
          files.push({ name: fileName, id: file.item.id, versionId: file.version.id });
        }
        for (const file of files) {
          await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
            projectId: "aurora", configSetId: id, fileId: file.id, fileVersionId: file.versionId,
            configurationSchemaId: "wiseeff.b906.member.ui", rootPointer: "",
            mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
            invocation: createUserInvocation(admin), requestId: `register:${file.id}`,
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
        }
        return { id, removed: files[0]!, survivor: files[1]! };
      };
      const reviewed = await setup("reviewed");
      const stale = await setup("stale");

      const submitFromPage = async (set: Awaited<ReturnType<typeof setup>>, reason: string) => {
        await signInBrowserAsRole(page, "admin", `${runtime!.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${set.id}&inspector=config-set`);
        await dismissXiaozeHint(page);
        const inspector = page.getByRole("complementary", { name: "配置检查器" });
        await expect(inspector.getByRole("button", { name: `移除 ${set.removed.name}` })).toBeVisible();
        await expect(inspector.getByRole("button", { name: `移除 ${set.removed.name}` })).toBeEnabled();
        await inspector.getByRole("button", { name: `移除 ${set.removed.name}` }).click();
        const dialog = page.getByRole("dialog", { name: "提交 JSON 成员删除审核" });
        await expect(dialog.getByRole("list", { name: "提交前成员概览" }).getByRole("listitem")).toHaveCount(2);
        await dialog.getByRole("textbox", { name: "修改原因" }).fill(reason);
        await dialog.getByRole("combobox", { name: "指定软件审核人" }).selectOption(acceptanceCast.sunMei.userId);
        const submitted = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/api/v2/projects/aurora/parameter-value-change-requests/member-removals"));
        await dialog.getByRole("button", { name: "提交冻结证明审核" }).click();
        const response = await submitted;
        expect(response.status(), await response.text()).toBe(201);
        const item = (await response.json()).item as { id: string; proofDigest: string; status: string;
          frozenProof: { members: unknown[]; cohort: unknown[] } };
        expect(item.frozenProof.members).toHaveLength(2);
        expect(item.frozenProof.cohort).toHaveLength(2);
        await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=aurora&memberRequest=${item.id}`));
        await expect(page.getByRole("article", { name: "JSON 成员删除请求详情" })).toContainText(reason);
        return item;
      };

      const rejected = await submitFromPage(reviewed, "浏览器驳回路径");
      const otherReviewerHeaders = authHeadersForUser(
        acceptanceCast.chenNa.userId, acceptanceCast.chenNa.email, acceptanceCast.chenNa.name
      );
      const hidden = await request.get(api(`/api/v2/projects/aurora/parameter-value-change-requests/${rejected.id}/member-removal`), {
        headers: authHeadersForRole("software-user")
      });
      const otherReviewerRead = await request.get(api(`/api/v2/projects/aurora/parameter-value-change-requests/${rejected.id}/member-removal`), {
        headers: otherReviewerHeaders
      });
      expect(hidden.status()).toBe(404);
      expect(otherReviewerRead.status()).toBe(404);
      const nonAssigneeReject = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${rejected.id}/review`), {
        headers: authHeadersForRole("software-user"),
        data: { decision: "reject", memberProofDigest: rejected.proofDigest }
      });
      const otherReviewerReject = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${rejected.id}/review`), {
        headers: otherReviewerHeaders,
        data: { decision: "reject", memberProofDigest: rejected.proofDigest }
      });
      const hiddenWithoutProof = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${rejected.id}/review`), {
        headers: authHeadersForRole("software-user"), data: { decision: "reject" }
      });
      const reviewerWithoutProof = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${rejected.id}/review`), {
        headers: reviewerHeaders, data: { decision: "reject" }
      });
      expect(nonAssigneeReject.status()).toBe(404);
      expect(otherReviewerReject.status()).toBe(404);
      expect(hiddenWithoutProof.status()).toBe(404);
      expect(reviewerWithoutProof.status()).toBe(400);
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora`);
      const row = page.getByRole("table", { name: "成员删除请求列表" }).getByRole("button", { name: reviewed.removed.name });
      await expect(row).toBeVisible();
      await row.click();
      const detail = page.getByRole("article", { name: "JSON 成员删除请求详情" });
      await expect(detail.getByRole("list", { name: "冻结成员列表" }).getByRole("listitem")).toHaveCount(2);
      await expect(detail.getByRole("list", { name: "冻结 Binding cohort" }).getByRole("listitem")).toHaveCount(2);
      await expect(detail).toContainText(reviewed.survivor.name);
      const rejectedResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${rejected.id}/review`));
      await detail.getByRole("button", { name: "驳回成员删除" }).click();
      expect((await rejectedResponse).status()).toBe(200);
      await expect(detail).toContainText("已驳回");
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 成员删除请求详情" })).toContainText("已驳回");

      const withdrawn = await submitFromPage(reviewed, "浏览器撤回路径");
      const withdrawResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${withdrawn.id}/withdraw`));
      await page.getByRole("button", { name: "撤回成员删除" }).click();
      expect((await withdrawResponse).status()).toBe(200);
      await expect(page.getByRole("article", { name: "JSON 成员删除请求详情" })).toContainText("已撤回");

      const staleRequest = await submitFromPage(stale, "浏览器来源漂移路径");
      const oldVersion = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(
        "select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
        [stale.removed.versionId])).rows[0]!;
      const driftVersionId = randomUUID();
      await insertFileVersion(db, { id: driftVersionId, fileId: stale.removed.id,
        storageKey: oldVersion.storage_key, checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
        parsedIndex: oldVersion.parsed_index as Record<string, unknown>, origin: "upload",
        createdByUserId: acceptanceCast.xuYun.userId });
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [stale.removed.id, driftVersionId]);
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora&memberRequest=${staleRequest.id}`);
      const staleDetail = page.getByRole("article", { name: "JSON 成员删除请求详情" });
      await expect(staleDetail.getByRole("button", { name: "批准成员删除" })).toBeVisible();
      const conflictResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${staleRequest.id}/review`));
      await staleDetail.getByRole("button", { name: "批准成员删除" }).click();
      expect((await conflictResponse).status()).toBe(409);
      await expect(page.getByText(/来源过期或请求冲突（409）/)).toBeVisible();
      await expect(staleDetail).toContainText("待审核");
      await expect(staleDetail.getByRole("button", { name: "批准成员删除" })).toHaveCount(0);
      expect((await db.query<{ status: string }>(
        "select status from project_parameter_value_change_requests where id=$1", [staleRequest.id]
      )).rows[0]!.status).toBe("pending");
      expect((await db.query<{ count: number }>(`select count(*)::int as count
        from parameter_catalog.project_source_member_tombstones where file_id=$1`,
      [stale.removed.id])).rows[0]!.count).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("b906-member-stale-1440x900.png") });

      const approved = await submitFromPage(reviewed, "浏览器批准路径");
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora&memberRequest=${approved.id}`);
      const approveDetail = page.getByRole("article", { name: "JSON 成员删除请求详情" });
      const approvalResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${approved.id}/review`));
      await approveDetail.getByRole("button", { name: "批准成员删除" }).click();
      expect((await approvalResponse).status()).toBe(200);
      await expect(approveDetail).toContainText("后继修订");
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 成员删除请求详情" })).toContainText("已批准");
      await page.screenshot({ path: testInfo.outputPath("b906-member-approved-1440x900.png") });
      const approvedRead = await request.get(api(`/api/v2/projects/aurora/parameter-value-change-requests/${approved.id}/member-removal`), {
        headers: reviewerHeaders
      });
      expect(approvedRead.ok()).toBe(true);
      expect((await approvedRead.json()).item.appliedSourceResult.tombstoneId).toBeTruthy();
      expect(browserErrors).toEqual([]);
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
