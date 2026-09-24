import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { freezeCanonicalCandidateBatchSnapshotInTransaction, previewCanonicalCandidate } from "../../server/modules/parameter-files/canonicalFileWorkflow";
import { submitCanonicalBatchValueChange } from "../../server/modules/parameter-bindings/drafts/batchChangeService";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

test.use({ viewport: { width: 1440, height: 900 } });

test("B #906 reviewer reads and approves a real canonical JSON batch by exact request ID", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      label: "b906_ui", markerPurpose: "b906-batch-review"
    });
    runtime = started.runtime;
    restore = started.restore;
    const api = (path: string) => `${runtime!.apiUrl}${path}`;
    const adminHeaders = authHeadersForRole("admin");
    const reviewerHeaders = authHeadersForRole("software-committer");
    const db = createPostgresDatabase(runtime.databaseUrl);
    const storage = createLocalObjectStore(runtime.objectStoreRoot);
    const admin = makeTestAuthContext({
      userId: acceptanceCast.xuYun.userId,
      organizationId: "org-chargelab",
      permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }]
    });
    try {
      await installConfigurationSourceFixture(db, admin, {
        subjectId: "csub_b906_ui", schemaId: "wiseeff.b906.ui"
      });
      const createSet = await request.post(api("/api/v1/projects/aurora/config-sets"), {
        headers: adminHeaders, data: { name: "B #906 review" }
      });
      expect(createSet.ok(), await createSet.text()).toBe(true);
      const setId = (await createSet.json()).item.id as string;
      const fileName = "b906-review.json";
      const upload = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
        headers: adminHeaders,
        data: { fileName, contentBase64: Buffer.from('{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n').toString("base64") }
      });
      expect(upload.ok(), await upload.text()).toBe(true);
      const uploaded = await upload.json() as { item: { id: string }; version: { id: string } };
      const add = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
        headers: adminHeaders, data: { fileId: uploaded.item.id, role: "base", sortOrder: 0 }
      });
      expect(add.ok(), await add.text()).toBe(true);
      for (const rootPointer of ["", "/other"]) {
        const register = await request.post(api(`/api/v2/projects/aurora/parameter-files/${uploaded.item.id}/configuration-instances`), {
          headers: adminHeaders,
          data: {
            configSetId: setId, fileVersionId: uploaded.version.id,
            configurationSchemaId: "wiseeff.b906.ui", rootPointer,
            mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: rootPointer ? "/other/limit" : "/settings/limit" }]
          }
        });
        expect(register.ok(), await register.text()).toBe(true);
      }
      const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
        headers: adminHeaders,
        data: {
          fileId: uploaded.item.id, fileName,
          contentBase64: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n').toString("base64")
        }
      });
      expect(candidate.ok(), await candidate.text()).toBe(true);
      const candidateId = (await candidate.json()).item.id as string;

      // #929 has no production HTTP batch-submit route. Seed the real C service
      // against this isolated DB; the browser and approval still use real HTTP.
      const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: "aurora", candidateId });
      const proof = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
        projectId: "aurora", candidateId, expectedProofToken: preview.proofToken!
      }));
      const pending = await submitCanonicalBatchValueChange(db, storage, admin, {
        projectId: "aurora", candidateId, expectedProofToken: proof.proofToken,
        reason: "同批次审核两项设置", assignedToUserId: acceptanceCast.sunMei.userId,
        invocation: createUserInvocation(admin), requestId: "b906-review-submit",
        refusalSink: createTrustedRefusalAuditSink(db)
      });
      expect(pending.targets).toHaveLength(2);
      const olderCandidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
        headers: adminHeaders,
        data: {
          fileId: uploaded.item.id, fileName,
          contentBase64: Buffer.from('{ "settings": { "limit": 70 }, "other": { "limit": 80 } }\n').toString("base64")
        }
      });
      expect(olderCandidate.ok(), await olderCandidate.text()).toBe(true);
      const olderCandidateId = (await olderCandidate.json()).item.id as string;
      const olderPreview = await previewCanonicalCandidate(db, storage, admin, {
        projectId: "aurora", candidateId: olderCandidateId
      });
      const olderProof = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
        projectId: "aurora", candidateId: olderCandidateId, expectedProofToken: olderPreview.proofToken!
      }));
      const staleAfterApproval = await submitCanonicalBatchValueChange(db, storage, admin, {
        projectId: "aurora", candidateId: olderCandidateId, expectedProofToken: olderProof.proofToken,
        reason: "过期来源拒绝路径", assignedToUserId: acceptanceCast.sunMei.userId,
        invocation: createUserInvocation(admin), requestId: "b906-stale-submit",
        refusalSink: createTrustedRefusalAuditSink(db)
      });

      const reviewPath = `/api/v2/projects/aurora/parameter-value-change-requests/${pending.id}`;
      const forbidden = await request.get(api(`${reviewPath}/batch`), {
        headers: authHeadersForRole("software-user")
      });
      expect(forbidden.status()).toBe(403);
      const reviewerRead = await request.get(api(`${reviewPath}/batch`), { headers: reviewerHeaders });
      expect(reviewerRead.ok(), await reviewerRead.text()).toBe(true);
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      await signInBrowserAsRole(page, "software-committer",
        `${runtime.frontendUrl}/parameter-review?project=aurora&request=${pending.id}`);
      const detail = page.getByRole("article", { name: "JSON 批量源文件请求详情" });
      await expect(detail).toBeVisible();
      await expect(detail.getByText("同批次审核两项设置")).toBeVisible();
      await expect(detail.getByText(acceptanceCast.sunMei.userId)).toBeVisible();
      await expect(detail.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
      await expect.poll(async () => Promise.all([1, 2].map(async (ordinal) =>
        (await detail.getByLabel(`目标 ${ordinal} 来源变更前`).textContent())?.trim()
      ))).toEqual(expect.arrayContaining(["36.5", "48"]));
      expect(await Promise.all([1, 2].map(async (ordinal) =>
        (await detail.getByLabel(`目标 ${ordinal} 来源变更后`).textContent())?.trim()
      ))).toEqual(expect.arrayContaining(["50", "60"]));
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
      await detail.getByRole("button", { name: "批准全部 2 项" }).click();
      await expect(detail).toContainText("已批准");
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toHaveCount(0);
      const approved = await request.get(api(`${reviewPath}/batch`), { headers: reviewerHeaders });
      expect(approved.ok(), await approved.text()).toBe(true);
      const approvedItem = (await approved.json()).item as typeof pending;
      expect(approvedItem.targets).toHaveLength(2);
      expect(approvedItem.targets.every((target) => Boolean(target.appliedValueId && target.appliedHistoryEventId))).toBe(true);
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 批量源文件请求详情" })).toContainText("已批准");
      await expect(page.getByRole("region", { name: "批量固定源差异" })).toBeVisible();
      expect(browserErrors).toEqual([]);
      await detail.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("b906-batch-review-1440x900.png") });
      await page.goto(`${runtime.frontendUrl}/parameter-review?project=aurora&request=${staleAfterApproval.id}`);
      const staleDetail = page.getByRole("article", { name: "JSON 批量源文件请求详情" });
      await expect(staleDetail.getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
      await staleDetail.getByRole("button", { name: "批准全部 2 项" }).click();
      await expect(staleDetail.getByText(/来源或审核证明已变化/)).toBeVisible();
      await expect(staleDetail.getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
      const staleRead = await request.get(api(`/api/v2/projects/aurora/parameter-value-change-requests/${staleAfterApproval.id}/batch`), {
        headers: reviewerHeaders
      });
      expect(staleRead.ok(), await staleRead.text()).toBe(true);
      expect((await staleRead.json()).item.status).toBe("pending");
      await staleDetail.getByText(/来源或审核证明已变化/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("b906-batch-stale-refusal-1440x900.png") });
      outcome = "success";
    } finally {
      await db.close();
    }
  } finally {
    await restore?.(outcome);
  }
});
