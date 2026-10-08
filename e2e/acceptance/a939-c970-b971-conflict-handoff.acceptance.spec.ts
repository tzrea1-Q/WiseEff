import "./helpers/loadAcceptanceEnvironment";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { previewCanonicalCandidate } from "../../server/modules/parameter-files/canonicalFileWorkflow";
import { submitCanonicalBatchValueChange, approveCanonicalBatchValueChange } from "../../server/modules/parameter-bindings/drafts/batchChangeService";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { createCanonicalValueDraft } from "../../server/modules/parameter-bindings/drafts/service";
import { parseDtsValue } from "../../server/modules/dts";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { acceptanceCast } from "./helpers/cast";
import { startSwappedDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

const source = {
  json: '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n',
  dts: '/dts-v1/;\n/ { first: device@0 { compatible = "acme,power"; iin_max = <10>; }; second: device@1 { compatible = "acme,power"; iin_max = <20>; }; third: device@2 { compatible = "acme,power"; iin_max = <30>; }; };\n'
};
const changed = {
  json: '{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n',
  dts: source.dts.replace("iin_max = <10>", "iin_max = <50>").replace("iin_max = <20>", "iin_max = <60>")
};

async function objectInventory(root: string) {
  const names = (await readdir(root, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => {
    try { return [name, createHash("sha256").update(await readFile(`${root}/${name}`)).digest("hex")]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EISDIR") return [name, "directory"]; throw error; }
  }));
}

for (const format of ["json", "dts"] as const) {
  for (const workflow of ["manual", "rollback"] as const) {
    test(`#939 C970→B971 ${format} ${workflow} blocks real ineligible drafts and resumes`, async ({ page, request }, testInfo) => {
      test.setTimeout(420_000);
      let outcome: "success" | "failure" = "failure";
      const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
        label: `a939_${format}_${workflow}_ineligible`, markerPurpose: `a939-${format}-${workflow}-ineligible`
      });
      const runtime = started.runtime;
      const db = createPostgresDatabase(runtime.databaseUrl);
      const storage = createLocalObjectStore(runtime.objectStoreRoot);
      const api = (path: string) => `${runtime.apiUrl}${path}`;
      const adminHeaders = authHeadersForRole("admin");
      const authorHeaders = authHeadersForRole("software-user");
      const admin = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId,
        organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
        roles: [{ roleId: "admin", projectId: null }] });
      const author = makeTestAuthContext({ userId: acceptanceCast.liuMin.userId,
        organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit"],
        roles: [{ roleId: "software-user", projectId: "aurora" }] });
      const reviewer = makeTestAuthContext({ userId: acceptanceCast.sunMei.userId,
        organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review"],
        roles: [{ roleId: "software-committer", projectId: "aurora" }] });
      const network: string[] = [];
      page.on("response", (response) => {
        if (/source-manual-sync|source-batch-rollback|source-conflicts|parameter-value-change-requests/.test(response.url())) {
          network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
        }
      });
      try {
        if (format === "json") await installConfigurationSourceFixture(db, admin, {
          subjectId: "csub_a939_conflicts", schemaId: "wiseeff.a939.conflicts"
        });
        else await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
          businessName: "A #939 conflict handoff", driverName: "Acme power",
          idempotencyKey: `a939-${workflow}-driver`, reason: "Joint browser acceptance" });
        const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
        if (!catalog) throw new Error("Published Catalog fixture unavailable");
        const set = await request.post(api("/api/v1/projects/aurora/config-sets"), {
          headers: adminHeaders, data: { name: `A #939 ${format} ${workflow} handoff` }
        });
        expect(set.status(), await set.text()).toBe(201);
        const setId = (await set.json()).item.id as string;
        const fileName = `a939-handoff.${format}`;
        const uploaded = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
          headers: adminHeaders, data: { fileName, contentBase64: Buffer.from(source[format]).toString("base64") }
        });
        expect(uploaded.status(), await uploaded.text()).toBe(201);
        const file = (await uploaded.json()) as { item: { id: string }; version: { id: string; versionNumber: number } };
        const fileId = file.item.id;
        const linked = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
          headers: adminHeaders, data: { fileId, role: "base", sortOrder: 0 }
        });
        expect(linked.ok(), await linked.text()).toBe(true);
        if (format === "json") {
          for (const [index, key] of ["first", "second", "third"].entries()) {
            await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
              projectId: "aurora", configSetId: setId, fileId, fileVersionId: file.version.id,
              configurationSchemaId: "wiseeff.a939.conflicts", rootPointer: `/${key}`,
              mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: `/${key}/limit` }],
              invocation: createUserInvocation(admin), requestId: `a939-register-${workflow}-${index}`,
              refusalSink: createTrustedRefusalAuditSink(db)
            }));
          }
        } else {
          const manifest: ConfigRevisionManifest = { organizationId: "org-chargelab", projectId: "aurora",
            configSetId: setId, entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
            members: [{ fileId, fileVersionId: file.version.id, fileName, sourceName: fileName,
              role: "base", sortOrder: 0, content: source.dts }] };
          const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
          await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
            organizationId: "org-chargelab", projectId: "aurora", configSetId: setId, configRevisionId: revision.id
          }));
        }
        if (workflow === "rollback") {
          const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
            headers: adminHeaders, data: { fileId, fileName,
              contentBase64: Buffer.from(changed[format]).toString("base64") }
          });
          expect(candidate.status(), await candidate.text()).toBe(201);
          const candidateId = (await candidate.json()).item.id as string;
          const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: "aurora", candidateId });
          const history = await submitCanonicalBatchValueChange(db, storage, admin, {
            projectId: "aurora", candidateId, expectedProofToken: preview.proofToken!,
            reason: "establish rollback history", assignedToUserId: acceptanceCast.sunMei.userId,
            invocation: createUserInvocation(admin), requestId: `a939-${format}-history`,
            refusalSink: createTrustedRefusalAuditSink(db)
          });
          expect((await db.transaction((tx) => approveCanonicalBatchValueChange(tx, storage, reviewer, catalog, {
            projectId: "aurora", requestId: history.id, batchProofDigest: history.batchProofDigest,
            invocation: createUserInvocation(reviewer), traceId: `a939-${format}-history-review`,
            refusalSink: createTrustedRefusalAuditSink(db)
          }))).status).toBe("approved");
        }
        const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: "aurora" });
        expect(bindings).toHaveLength(3);
        const entries = await Promise.all(bindings.map(async (binding) => ({ binding,
          value: (await db.query<{ value: number }>(
            "select value from parameter_catalog.project_parameter_values where id=$1",
            [binding.currentValueId])).rows[0]!.value
        })));
        const first = entries.find((entry) => entry.value === (workflow === "rollback" ? 50 : 10))!.binding;
        const second = entries.find((entry) => entry.value === (workflow === "rollback" ? 60 : 20))!.binding;
        const sibling = entries.find((entry) => entry.value === 30)!.binding;
        const makeDraft = async (binding: typeof first, value: number) => {
          const base = (await db.query<{ config_revision_id: string }>(
            "select config_revision_id from parameter_catalog.project_parameter_values where id=$1",
            [binding.currentValueId])).rows[0]!;
          return createCanonicalValueDraft(db, author, { projectId: "aurora", bindingId: binding.id,
            ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: String(value) } }
              : { targetValue: parseDtsValue("iin_max", `<${value}>`).value }),
            reason: "Joint ineligible draft proof", baseRevisionId: base.config_revision_id,
            baseCurrentValueId: binding.currentValueId
          }, { objectStore: storage, invocation: createUserInvocation(author),
            requestId: `a939-${format}-${workflow}-draft-${value}`,
            refusalSink: createTrustedRefusalAuditSink(db) });
        };
        const unprepared = await makeDraft(first, 88);
        const pending = await makeDraft(second, 77);
        const untouched = await makeDraft(sibling, 99);
        const artifact = (await db.query<{ candidate_id: string; candidate_base_digest: string;
          candidate_proposed_digest: string; candidate_diff_digest: string;
          candidate_member_manifest: unknown; candidate_binding_manifest: unknown }>(`
          select candidate_id,candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,
            candidate_member_manifest,candidate_binding_manifest
            from project_parameter_value_drafts where id=$1`, [unprepared.id])).rows[0]!;
        await db.query(`update project_parameter_value_drafts set candidate_id=null,
          candidate_base_digest=null,candidate_proposed_digest=null,candidate_diff_digest=null,
          candidate_member_manifest=null,candidate_binding_manifest=null where id=$1`, [unprepared.id]);
        const single = await request.post(api(`/api/v2/projects/aurora/parameter-value-drafts/${pending.id}/submit`), {
          headers: authorHeaders, data: { assignedToUserId: acceptanceCast.sunMei.userId }
        });
        expect(single.status(), await single.text()).toBe(201);
        const singleId = (await single.json()).item.id as string;

        await signInBrowserAsRole(page, "admin",
          `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&file=${fileId}`);
        await dismissXiaozeHint(page);
        await page.getByRole("button", { name: "检查器", exact: true }).click();
        const inspector = page.getByRole("complementary", { name: "配置检查器" });
        let dialog;
        if (workflow === "manual") {
          await inspector.getByRole("button", { name: "上传来源并预览批量候选" }).click();
          dialog = page.getByRole("dialog", { name: `上传 ${format.toUpperCase()} 来源并准备审核` });
          await dialog.getByLabel(/选择来源文件/).setInputFiles({ name: fileName,
            mimeType: format === "json" ? "application/json" : "text/plain",
            buffer: Buffer.from(changed[format]) });
        } else {
          dialog = page.getByRole("dialog", { name: "提交多目标历史回滚审核" });
        }
        const firstPrepare = page.waitForResponse((response) => response.url().endsWith(
          workflow === "manual" ? "/source-manual-sync/prepare" : "/source-batch-rollback/prepare"));
        const firstConflicts = page.waitForResponse((response) => response.url().endsWith("/source-conflicts"));
        if (workflow === "manual") await dialog.getByRole("button", { name: "预览有序目标与证明" }).click();
        else await inspector.getByRole("button", { name: `将版本 ${file.version.versionNumber} 恢复为当前` }).click();
        expect((await firstPrepare).status()).toBe(201);
        const blockedResponse = await firstConflicts;
        expect(blockedResponse.status()).toBe(200);
        const blocked = await blockedResponse.json() as { items: unknown[];
          ineligible: Array<{ selectedDraftId: string; reason: string }> };
        expect(blocked.items).toEqual([]);
        expect(blocked.ineligible).toEqual(expect.arrayContaining([
          expect.objectContaining({ selectedDraftId: unprepared.id, reason: "selected-draft-source-proof-missing" }),
          expect.objectContaining({ selectedDraftId: pending.id, reason: "selected-draft-pending" })
        ]));
        await expect(dialog).toContainText(unprepared.id);
        await expect(dialog).toContainText(pending.id);
        await expect(dialog.getByRole("alert").filter({ hasText: workflow === "manual"
          ? "未取得可验证的选择证明" : "不可处理" })).toContainText(
          workflow === "manual" ? "未取得可验证的选择证明" : "不可处理"
        );
        await dialog.getByRole("textbox", { name: workflow === "manual" ? "修改原因" : "来源回滚原因" })
          .fill("A joint conflict handoff proof");
        await expect(dialog.getByRole("button", { name: workflow === "manual" ? /一次提交全部/ : "提交审核" })).toBeDisabled();
        const blockedState = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        const blockedObjects = await objectInventory(runtime.objectStoreRoot);
        expect(network.some((entry) => /POST .*parameter-value-change-requests\/batches$/.test(entry)
          || /POST .*source-batch-rollback\/submit$/.test(entry))).toBe(false);
        await page.screenshot({ path: testInfo.outputPath(`a939-${format}-${workflow}-ineligible-1440x900.png`) });
        expect(await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" }))
          .toEqual(blockedState);
        expect(await objectInventory(runtime.objectStoreRoot)).toEqual(blockedObjects);

        await db.query(`update project_parameter_value_drafts set candidate_id=$2,
          candidate_base_digest=$3,candidate_proposed_digest=$4,candidate_diff_digest=$5,
          candidate_member_manifest=$6,candidate_binding_manifest=$7 where id=$1`,
        [unprepared.id, artifact.candidate_id, artifact.candidate_base_digest,
          artifact.candidate_proposed_digest, artifact.candidate_diff_digest,
          JSON.stringify(artifact.candidate_member_manifest), JSON.stringify(artifact.candidate_binding_manifest)]);
        const withdrawn = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${singleId}/withdraw`), {
          headers: authorHeaders
        });
        expect(withdrawn.status(), await withdrawn.text()).toBe(200);
        const nextPrepare = page.waitForResponse((response) => response.url().endsWith(
          workflow === "manual" ? "/source-manual-sync/prepare" : "/source-batch-rollback/prepare"));
        const nextConflicts = page.waitForResponse((response) => response.url().endsWith("/source-conflicts"));
        if (workflow === "manual") {
          await dialog.getByLabel(/选择来源文件/).setInputFiles({ name: fileName,
            mimeType: format === "json" ? "application/json" : "text/plain",
            buffer: Buffer.from(changed[format]) });
          await dialog.getByRole("button", { name: "预览有序目标与证明" }).click();
        } else await dialog.getByRole("button", { name: "重新预览历史目标与证明" }).click();
        expect((await nextPrepare).status()).toBe(201);
        const readyResponse = await nextConflicts;
        expect(readyResponse.status()).toBe(200);
        const ready = await readyResponse.json() as { items: Array<{ selectedDraftId: string }>;
          ineligible: Array<{ selectedDraftId: string; reason: string }> };
        expect(ready.ineligible).toEqual([]);
        expect(ready.items.map((item) => item.selectedDraftId).sort()).toEqual([unprepared.id, pending.id].sort());
        if (workflow === "manual") {
          for (const row of await dialog.getByRole("list", { name: "手动同步完整有序目标" }).getByRole("listitem").all()) {
            await row.getByRole("radio", { name: /采用文件值/ }).check();
          }
          await dialog.getByRole("textbox", { name: "修改原因" }).fill("A joint proof recovery");
        } else {
          for (const box of await dialog.getByRole("checkbox", { name: /确认此目标采用历史文件值/ }).all()) {
            await box.check();
          }
          await dialog.getByRole("textbox", { name: "来源回滚原因" }).fill("A joint rollback proof recovery");
        }
        const submitButton = dialog.getByRole("button", { name: workflow === "manual" ? /一次提交全部/ : "提交审核" });
        await expect(submitButton).toBeEnabled();
        const beforeSubmit = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        const submitting = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith(workflow === "manual" ? "/parameter-value-change-requests/batches"
            : "/source-batch-rollback/submit"));
        await submitButton.click();
        const submitted = await submitting;
        expect(submitted.status(), await submitted.text()).toBe(201);
        const body = submitted.request().postDataJSON();
        expect(body.targetDecisions).toHaveLength(2);
        expect(body.targetDecisions.every((decision: { choice: string; expectedConflictProofs: unknown[] }) =>
          decision.choice === "file" && decision.expectedConflictProofs.length === 1)).toBe(true);
        const receipt = (await submitted.json()).item as { id?: string; requestId?: string; candidateId: string;
          batchProofDigest: string };
        const requestId = receipt.id ?? receipt.requestId!;
        const afterSubmit = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        expect(afterSubmit.values).toEqual(beforeSubmit.values);
        expect(afterSubmit.pins).toEqual(beforeSubmit.pins);
        expect(afterSubmit.history).toEqual(beforeSubmit.history);
        expect(afterSubmit.versions).toEqual(beforeSubmit.versions);
        const linkedConflicts = await request.get(api(
          `/api/v1/projects/aurora/parameter-file-candidates/${receipt.candidateId}/source-conflicts`),
        { headers: adminHeaders });
        expect(linkedConflicts.status(), await linkedConflicts.text()).toBe(200);
        const linkedConflictBody = await linkedConflicts.json() as { items: unknown[]; ineligible: unknown[] };
        expect(linkedConflictBody.ineligible).toEqual([]);
        const countBeforeReplay = (await db.query<{ count: string }>(
          "select count(*)::text as count from project_parameter_value_change_requests where project_id='aurora' and request_kind='batch'"
        )).rows[0]!.count;
        const stateBeforeReplay = await captureConfigurationSourceState(db,
          { organizationId: "org-chargelab", projectId: "aurora" });
        const objectsBeforeReplay = await objectInventory(runtime.objectStoreRoot);
        const replay = await request.post(submitted.url(), {
          headers: { ...adminHeaders, "X-Request-Id": submitted.request().headers()["x-request-id"]! }, data: body
        });
        expect(replay.status(), await replay.text()).toBe(201);
        expect((await replay.json()).item).toMatchObject(workflow === "manual" ? { id: requestId } : { requestId });
        expect((await db.query<{ count: string }>(
          "select count(*)::text as count from project_parameter_value_change_requests where project_id='aurora' and request_kind='batch'"
        )).rows[0]!.count).toBe(countBeforeReplay);
        expect(await captureConfigurationSourceState(db,
          { organizationId: "org-chargelab", projectId: "aurora" })).toEqual(stateBeforeReplay);
        expect(await objectInventory(runtime.objectStoreRoot)).toEqual(objectsBeforeReplay);
        const impact = (await db.query<{ batch_draft_impact: Array<{ bindingId: string; role: string;
          drafts: Array<{ draftId: string }> }> }>(
          "select batch_draft_impact from project_parameter_value_change_requests where id=$1", [requestId]
        )).rows[0]!.batch_draft_impact;
        expect(impact.find((entry) => entry.bindingId === sibling.id)).toMatchObject({ role: "sibling" });
        expect(impact.flatMap((entry) => entry.drafts.map((draft) => draft.draftId)).sort())
          .toEqual([unprepared.id, pending.id, untouched.id].sort());

        await signInBrowserAsRole(page, "software-committer",
          `${runtime.frontendUrl}/parameter-review?project=aurora&request=${requestId}`);
        const detail = page.getByRole("article", { name: "批量源文件请求详情" });
        await expect(detail).toContainText("兄弟 Binding · 结构性 re-pin");
        const reviewing = page.waitForResponse((response) => response.url().endsWith(
          `/parameter-value-change-requests/${requestId}/review`));
        await detail.getByRole("button", { name: "批准全部 2 项" }).click();
        expect((await reviewing).status()).toBe(200);
        await expect(detail).toContainText("已批准");
        const applied = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        expect(applied.values).toHaveLength(beforeSubmit.values.length + 3);
        expect(applied.pins).toHaveLength(beforeSubmit.pins.length + 3);
        expect(applied.history).toHaveLength(beforeSubmit.history.length + 3);
        expect(applied.versions).toHaveLength(beforeSubmit.versions.length + 1);
        expect(applied.drafts).toEqual(beforeSubmit.drafts);
        await page.screenshot({ path: testInfo.outputPath(`a939-${format}-${workflow}-approved-1440x900.png`) });
        await testInfo.attach(`a939-${format}-${workflow}-network`, {
          body: JSON.stringify(network, null, 2), contentType: "application/json"
        });
        outcome = "success";
      } finally {
        await db.close();
        await started.restore(outcome);
      }
    });
  }
}
