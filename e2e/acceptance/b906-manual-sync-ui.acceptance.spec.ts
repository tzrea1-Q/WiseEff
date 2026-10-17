import "./helpers/loadAcceptanceEnvironment";
import { openWorkbenchPanel } from "./helpers/runtime";
import { selectControlOption } from "./helpers/selectControl";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../server/testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, readCanonicalBindingChangeHistory, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../../server/modules/parameter-bindings/binding/migrationAdapter";
import { loadOwnedProjectValueSourcePin } from "../../server/modules/parameter-bindings/values";
import { loadProjectValueById } from "../../server/modules/parameter-bindings/values/repositories";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { acceptanceCast } from "./helpers/cast";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, summarizeApiResponse, writeOperationJsonArtifact } from "./helpers/operationEvidence";

test.use({ viewport: { width: 1440, height: 900 } });
const before = { json: '{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n',
  dts: '/dts-v1/;\n/ { charger: device@0 { compatible = "acme,power"; iin_max = <36>; }; backup: device@1 { compatible = "acme,power"; iin_max = <36>; }; };\n' };
const after = { json: '{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n',
  dts: before.dts.replace("iin_max = <36>", "iin_max = <50>").replace("iin_max = <36>", "iin_max = <60>") };
type Format = "json" | "dts";

// @acceptance PARAM-FILE-ADMIN-001
// @operation PARAM-FILE-SYNC-001
for (const { format, outcomeKind } of [
  { format: "json", outcomeKind: "approve" }, { format: "dts", outcomeKind: "approve" },
  { format: "json", outcomeKind: "reject" }, { format: "dts", outcomeKind: "withdraw" },
  { format: "json", outcomeKind: "drift" }, { format: "json", outcomeKind: "refresh" }
] as Array<{ format: Format; outcomeKind: "approve" | "reject" | "withdraw" | "drift" | "refresh" }>) {
test(`#906 B ${format} manual source sync ${outcomeKind} through the pages`, async ({ page, request }, testInfo) => {
  test.setTimeout(420_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  const network: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (/parameter-file-candidates|source-manual-sync|parameter-value-change-requests/.test(response.url())
      || (outcomeKind === "refresh" && /source-workflow/.test(response.url()))) {
      network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      catalog: "fixture-owned",
      label: `b906_manual_${format}`, markerPurpose: `b906-manual-${format}`
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
      if (format === "json") await installConfigurationSourceFixture(db, admin, {
        subjectId: "csub_b906_manual", schemaId: "wiseeff.b906.manual"
      });
      else await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
        businessName: "B #906 manual sync", driverName: "Acme power", idempotencyKey: "b906-manual-dts",
        reason: "B #906 manual sync UI" });
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Published Catalog fixture unavailable");
      const createSet = await request.post(api("/api/v1/projects/aurora/config-sets"), {
        headers: adminHeaders, data: { name: `B #906 ${format} manual sync` }
      });
      expect(createSet.status(), await createSet.text()).toBe(201);
      const setId = (await createSet.json()).item.id as string;
      let alternateSetId = "";
      if (outcomeKind === "refresh") {
        const alternate = await request.post(api("/api/v1/projects/aurora/config-sets"), {
          headers: adminHeaders, data: { name: "B #906 background refresh trigger" }
        });
        expect(alternate.status(), await alternate.text()).toBe(201);
        alternateSetId = (await alternate.json()).item.id as string;
      }
      const fileName = `b906-manual.${format}`;
      const upload = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
        headers: adminHeaders, data: { fileName, contentBase64: Buffer.from(before[format]).toString("base64") }
      });
      expect(upload.status(), await upload.text()).toBe(201);
      const uploaded = await upload.json() as { item: { id: string }; version: { id: string; versionNumber: number } };
      const fileId = uploaded.item.id;
      const add = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
        headers: adminHeaders, data: { fileId, role: "base", sortOrder: 0 }
      });
      expect(add.ok(), await add.text()).toBe(true);
      if (format === "json") {
        for (const rootPointer of ["", "/other"]) {
          await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
            projectId: "aurora", configSetId: setId, fileId, fileVersionId: uploaded.version.id,
            configurationSchemaId: "wiseeff.b906.manual", rootPointer,
            mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: rootPointer ? "/other/limit" : "/settings/limit" }],
            invocation: createUserInvocation(admin), requestId: `b906-manual-register-${rootPointer || "root"}`,
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
        }
      } else {
        const manifest: ConfigRevisionManifest = { organizationId: "org-chargelab", projectId: "aurora", configSetId: setId,
          entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
          members: [{ fileId, fileVersionId: uploaded.version.id, fileName, sourceName: fileName,
            role: "base", sortOrder: 0, content: before.dts }] };
        const revision = await ingestConfigRevision(db, manifest, admin);
        await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
          organizationId: "org-chargelab", projectId: "aurora", configSetId: setId, configRevisionId: revision.id
        }));
      }
      const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: "aurora" });
      const baseline = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      const activeVersion = uploaded.version.id;

      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&file=${fileId}`);
      await dismissXiaozeHint(page);
      await openWorkbenchPanel(page, "file");
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "来源一致性校验", exact: true })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "手动同步", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await openWorkbenchPanel(page, "candidates");
      const dialog = inspector.getByRole("region", { name: `提交 ${format.toUpperCase()} 批量来源审核` });
      const uploadSource = async (buffer: Buffer) => {
        const choosing = page.waitForEvent("filechooser");
        await inspector.getByRole("button", { name: "上传新文件", exact: true }).click();
        await (await choosing).setFiles({ name: fileName,
          mimeType: format === "json" ? "application/json" : "text/plain", buffer });
      };
      const legacyPrepareChecks: ReturnType<typeof summarizeApiResponse>[] = [];
      let unchangedCandidateId: string | undefined;
      if (outcomeKind === "approve") {
        await uploadSource(Buffer.alloc(2 * 1024 * 1024 + 1));
        await expect(inspector.getByRole("alert")).toContainText("不超过 2 MiB");
        await expect(dialog).toHaveCount(0);
        expect(network.filter((entry) => entry.startsWith("POST "))).toEqual([]);
        const unchangedResponse = page.waitForResponse((response) => response.url().endsWith("/parameter-file-candidates")
          && response.request().method() === "POST");
        await uploadSource(Buffer.from(before[format]));
        const unchanged = await unchangedResponse;
        expect(unchanged.status(), await unchanged.text()).toBe(201);
        const unchangedId = (await unchanged.json()).item.id as string;
        unchangedCandidateId = unchangedId;
        expect(unchangedCandidateId).toBeTruthy();
        const unchangedPreview = await request.get(api(`/api/v1/projects/aurora/parameter-file-candidates/${unchangedId}/source-preview`), { headers: adminHeaders });
        expect(unchangedPreview.status(), await unchangedPreview.text()).toBe(200);
        const unchangedProof = (await unchangedPreview.json()).item as { canSubmit: boolean; cohortProofToken: string };
        expect(unchangedProof.canSubmit).toBe(false);
        await expect(inspector).toContainText("单参数变更校验");
        await expect(dialog).toHaveCount(0);
        // The retired preparation endpoint remains an independent API contract, not the UI upload path.
        const refused = await request.post(api(`/api/v1/projects/aurora/parameter-files/${fileId}/source-manual-sync/prepare`), {
          headers: { ...adminHeaders, "X-Request-Id": `b906-legacy-unchanged-${format}` },
          data: { contentBase64: Buffer.from(before[format]).toString("base64"), expectedCurrentVersionId: activeVersion,
            expectedWorkflowProofToken: unchangedProof.cohortProofToken }
        });
        expect(refused.status(), await refused.text()).toBe(409);
        expect((await refused.json()).error.details.reason).toBe("candidate-changed-unbound-or-non-target-bytes");
        legacyPrepareChecks.push(summarizeApiResponse(refused, { method: "POST", path: `/api/v1/projects/aurora/parameter-files/${fileId}/source-manual-sync/prepare`, responseSummary: "Independent API: unchanged source refused" }));
      }
      const prepareResponse = page.waitForResponse((response) => response.url().endsWith("/parameter-file-candidates")
        && response.request().method() === "POST");
      await uploadSource(Buffer.from(after[format]));
      const preparation = await prepareResponse;
      expect(preparation.status(), await preparation.text()).toBe(201);
      const createdCandidateId = (await preparation.json()).item.id as string;
      expect(createdCandidateId).toBeTruthy();
      const sourcePreviewResponse = await request.get(api(`/api/v1/projects/aurora/parameter-file-candidates/${createdCandidateId}/source-preview`), { headers: adminHeaders });
      expect(sourcePreviewResponse.status(), await sourcePreviewResponse.text()).toBe(200);
      const sourcePreview = (await sourcePreviewResponse.json()).item as { candidateId: string; cohortProofToken: string;
        proofToken: string; bindings: Array<{ bindingId: string; beforeText: string; afterText?: string }> };
      const prepared = { ...sourcePreview, targets: sourcePreview.bindings };
      expect(prepared.candidateId).toBe(createdCandidateId);
      if (outcomeKind === "approve") {
        expect(createdCandidateId).not.toBe(unchangedCandidateId);
        expect(network.filter((entry) => entry.startsWith("POST 201") && entry.endsWith("/parameter-file-candidates"))).toHaveLength(2);
        expect(network.filter((entry) => entry.endsWith("/source-manual-sync/prepare"))).toHaveLength(0);
        const legacyBody = { contentBase64: Buffer.from(after[format]).toString("base64"), expectedCurrentVersionId: activeVersion,
          expectedWorkflowProofToken: prepared.cohortProofToken };
        const legacyHeaders = { ...adminHeaders, "X-Request-Id": `b906-legacy-prepare-${format}` };
        const legacyPrepared = await request.post(api(`/api/v1/projects/aurora/parameter-files/${fileId}/source-manual-sync/prepare`), { headers: legacyHeaders, data: legacyBody });
        expect(legacyPrepared.status(), await legacyPrepared.text()).toBe(201);
        const legacyCandidateId = (await legacyPrepared.json()).item.candidateId as string;
        expect(legacyCandidateId).not.toBe(createdCandidateId);
        const legacyReplay = await request.post(api(`/api/v1/projects/aurora/parameter-files/${fileId}/source-manual-sync/prepare`), { headers: legacyHeaders, data: legacyBody });
        expect(legacyReplay.status(), await legacyReplay.text()).toBe(201);
        expect((await legacyReplay.json()).item).toMatchObject({ candidateId: legacyCandidateId, replayed: true });
        legacyPrepareChecks.push(summarizeApiResponse(legacyPrepared, { method: "POST", path: `/api/v1/projects/aurora/parameter-files/${fileId}/source-manual-sync/prepare`, responseSummary: `Independent API preparation candidateId=${legacyCandidateId}` }),
          summarizeApiResponse(legacyReplay, { method: "POST", path: `/api/v1/projects/aurora/parameter-files/${fileId}/source-manual-sync/prepare`, responseSummary: "Independent API: same preparation key replays the same candidate" }));
      }
      expect(prepared.targets).toHaveLength(2);
      expect(prepared.targets.every((target) => bindings.some((binding) => binding.id === target.bindingId))).toBe(true);
      expect(await Promise.all(prepared.targets.map((target) =>
        loadLegacyBindingIdentity(getRootPostgresPool(db)!, target.bindingId)))).toEqual([null, null]);
      const targetRows = dialog.getByRole("list", { name: "提交前批量目标" }).getByRole("listitem");
      await expect(targetRows).toHaveCount(2);
      for (const [index, target] of prepared.targets.entries()) {
        await expect(targetRows.nth(index)).toContainText(target.beforeText);
        await expect(targetRows.nth(index)).toContainText(target.afterText!);
      }
      await expect(dialog).toContainText(format.toUpperCase());
      await expect(dialog).toContainText("审核通过后整批应用");
      await dialog.getByRole("textbox", { name: "修改原因" }).focus();
      await expect(dialog.getByRole("textbox", { name: "修改原因" })).toBeFocused();
      await dialog.getByRole("textbox", { name: "修改原因" }).fill(`upload ${format} source`);
      await selectControlOption(dialog.getByRole("combobox", { name: "指定软件审核人" }), acceptanceCast.sunMei.userId);
      if (outcomeKind === "approve") await page.screenshot({
        path: testInfo.outputPath(`b906-${format}-manual-prepare-1440x900.png`)
      });
      const afterPrepare = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      const recordEvidence = async () => {
        const finalState = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        const artifact = await writeOperationJsonArtifact(testInfo, "manual-sync-proof.json", {
          format, outcomeKind, prepared, baseline, afterPrepare, finalState, network, legacyPrepareChecks
        });
        await recordOperationEvidence({
          operationId: "PARAM-FILE-SYNC-001",
          title: testInfo.title,
          status: "passed",
          page, testInfo,
          role: outcomeKind === "refresh" || outcomeKind === "withdraw" ? "Admin" : "Admin, Software Committer",
          route: page.url(),
          assertions: ["ui", "api", "db"],
          artifacts: [artifact],
          api: [summarizeApiResponse(preparation, {
            method: "POST", path: "/api/v1/projects/aurora/parameter-file-candidates",
            responseSummary: `candidateId=${prepared.candidateId}; source-preview proof read separately; outcome=${outcomeKind}`
          }), summarizeApiResponse(sourcePreviewResponse, { method: "GET", path: `/api/v1/projects/aurora/parameter-file-candidates/${prepared.candidateId}/source-preview`,
            responseSummary: `bindings=${prepared.targets.length}` }), ...legacyPrepareChecks],
          db: [{ table: "parameter_catalog.project_parameter_bindings", predicate: `id in (${prepared.targets.map((target) => target.bindingId).join(", ")})`,
            rowCount: prepared.targets.length,
            observed: JSON.stringify({ before: baseline.bindings, afterPrepare: afterPrepare.bindings, after: finalState.bindings }) }]
        });
      };
      expect(afterPrepare.values).toEqual(baseline.values);
      expect(afterPrepare.pins).toEqual(baseline.pins);
      expect(afterPrepare.history).toEqual(baseline.history);
      expect(afterPrepare.versions).toEqual(baseline.versions);
      if (outcomeKind === "refresh") {
        const advancedText = after.json.replace("50", "70").replace("60", "80");
        const advancedCandidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
          headers: adminHeaders, data: { fileId, fileName, contentBase64: Buffer.from(advancedText).toString("base64") }
        });
        expect(advancedCandidate.status(), await advancedCandidate.text()).toBe(201);
        const advancedId = (await advancedCandidate.json()).item.id as string;
        const advancedPreview = await request.get(api(`/api/v1/projects/aurora/parameter-file-candidates/${advancedId}/source-preview`), {
          headers: adminHeaders
        });
        expect(advancedPreview.status(), await advancedPreview.text()).toBe(200);
        const advancedProof = (await advancedPreview.json()).item as { proofToken: string };
        const advancedSubmit = await request.post(api("/api/v2/projects/aurora/parameter-value-change-requests/batches"), {
          headers: { ...adminHeaders, "X-Request-Id": "b906-manual-background-refresh" },
          data: { candidateId: advancedId, expectedProofToken: advancedProof.proofToken,
            reason: "advance source while source update pane stays open", assignedToUserId: acceptanceCast.sunMei.userId }
        });
        expect(advancedSubmit.status(), await advancedSubmit.text()).toBe(201);
        const advancedRequest = (await advancedSubmit.json()).item as { id: string; batchProofDigest: string };
        const advancedReview = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${advancedRequest.id}/review`), {
          headers: reviewerHeaders, data: { decision: "approve", batchProofDigest: advancedRequest.batchProofDigest }
        });
        expect(advancedReview.status(), await advancedReview.text()).toBe(200);
        const newVersionId = (await db.query<{ current_version_id: string }>(
          "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
        expect(newVersionId).not.toBe(activeVersion);
        const switchSet = async (id: string) => page.evaluate((configSetId) => {
          const next = new URL(window.location.href);
          next.searchParams.set("configSet", configSetId);
          history.pushState(null, "", next);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, id);
        await switchSet(alternateSetId);
        await expect(dialog).toBeVisible();
        let releaseRefresh!: () => void;
        const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
        await page.route(`**/parameter-files/${fileId}/source-workflow`, async (route) => {
          await gate;
          await route.continue();
        });
        const refreshed = page.waitForResponse((response) => response.url().endsWith(`/parameter-files/${fileId}/source-workflow`)
          && response.status() === 200);
        await switchSet(setId);
        await expect(dialog.getByRole("button", { name: "提交 2 项审核" })).toBeDisabled();
        await expect(dialog).toContainText(fileName);
        await expect(inspector.getByRole("button", { name: "上传新文件", exact: true })).toBeEnabled();
        await expect(dialog.getByRole("textbox", { name: "修改原因" })).toHaveValue(`upload ${format} source`);
        await expect(targetRows).toHaveCount(2);
        releaseRefresh();
        const refreshedResponse = await refreshed;
        expect((await refreshedResponse.json()).item.proofToken).not.toBe(prepared.cohortProofToken);
        await expect(dialog.getByRole("alert")).toContainText("文件版本或来源证明已变化");
        await expect(dialog.getByRole("button", { name: "提交 2 项审核" })).toBeDisabled();
        await expect(dialog).toContainText(fileName);
        await expect(inspector.getByRole("button", { name: "上传新文件", exact: true })).toBeEnabled();
        await expect(dialog.getByRole("textbox", { name: "修改原因" })).toHaveValue(`upload ${format} source`);
        await expect(targetRows).toHaveCount(2);
        expect(network.filter((entry) => entry.startsWith("POST ") && entry.endsWith("/parameter-value-change-requests/batches"))).toHaveLength(0);
        await dialog.getByRole("alert").scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("b906-json-manual-background-refresh-alert-1440x900.png") });
        await targetRows.first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("b906-json-manual-background-refresh-1440x900.png") });
        await testInfo.attach("b906-json-manual-background-refresh-network", { body: JSON.stringify(network, null, 2),
          contentType: "application/json" });
        expect(pageErrors).toEqual([]);
        await recordEvidence();
        outcome = "success";
        return;
      }
      const submitResponse = page.waitForResponse((response) => response.url().endsWith("/parameter-value-change-requests/batches")
        && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "提交 2 项审核" }).click();
      const submitted = await submitResponse;
      expect(submitted.status(), await submitted.text()).toBe(201);
      const receipt = (await submitted.json()).item as { id: string; candidateId: string; batchProofDigest: string };
      expect(receipt.batchProofDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.candidateId).toBe(prepared.candidateId);
      const frozenCandidate = (await db.query<{ diff_digest: string }>(
        "select diff_digest from project_parameter_file_candidates where id=$1", [prepared.candidateId])).rows[0]!;
      expect(receipt.batchProofDigest).toBe(frozenCandidate.diff_digest);
      expect(submitted.request().postDataJSON().targetDecisions).toEqual(prepared.targets.map((target) => ({
        bindingId: target.bindingId, choice: "file", expectedConflictProofs: []
      })));
      const replay = await request.post(api("/api/v2/projects/aurora/parameter-value-change-requests/batches"), {
        headers: { ...adminHeaders, "X-Request-Id": submitted.request().headers()["x-request-id"]! },
        data: submitted.request().postDataJSON()
      });
      expect(replay.status(), await replay.text()).toBe(201);
      expect((await replay.json()).item.id).toBe(receipt.id);
      const pending = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      expect(pending.values).toEqual(baseline.values);
      expect(pending.pins).toEqual(baseline.pins);
      expect(pending.history).toEqual(baseline.history);
      expect(pending.versions).toEqual(baseline.versions);

      if (outcomeKind === "withdraw") {
        await page.goto(`${runtime.frontendUrl}/parameter-submissions?project=aurora&request=${receipt.id}`);
        const mine = page.getByRole("article", { name: "批量源文件请求详情" });
        await expect(mine).toBeVisible();
        await mine.getByRole("button", { name: "撤回我的批量提交" }).click();
        await page.getByRole("dialog", { name: "确认撤回提交", exact: true }).getByRole("button", { name: "撤回提交", exact: true }).click();
        await expect(mine).toContainText("已撤回");
        await page.reload();
        await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已撤回");
        const withdrawn = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        expect(withdrawn.values).toEqual(baseline.values);
        expect(withdrawn.pins).toEqual(baseline.pins);
        expect(withdrawn.history).toEqual(baseline.history);
        expect(withdrawn.versions).toEqual(baseline.versions);
        await page.screenshot({ path: testInfo.outputPath("b906-dts-manual-withdraw-1440x900.png") });
        expect(pageErrors).toEqual([]);
        await recordEvidence();
        outcome = "success";
        return;
      }

      let drifted: typeof baseline | null = null;
      if (outcomeKind === "drift") {
        const driftText = after.json.replace("50", "70").replace("60", "80");
        const driftCandidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
          headers: adminHeaders, data: { fileId, fileName, contentBase64: Buffer.from(driftText).toString("base64") }
        });
        expect(driftCandidate.status(), await driftCandidate.text()).toBe(201);
        const driftId = (await driftCandidate.json()).item.id as string;
        const driftPreview = await request.get(api(`/api/v1/projects/aurora/parameter-file-candidates/${driftId}/source-preview`), {
          headers: adminHeaders
        });
        expect(driftPreview.status(), await driftPreview.text()).toBe(200);
        const driftProof = (await driftPreview.json()).item as { proofToken: string };
        const driftSubmit = await request.post(api("/api/v2/projects/aurora/parameter-value-change-requests/batches"), {
          headers: { ...adminHeaders, "X-Request-Id": "b906-manual-source-drift" },
          data: { candidateId: driftId, expectedProofToken: driftProof.proofToken,
            reason: "advance source after manual sync submit", assignedToUserId: acceptanceCast.sunMei.userId }
        });
        expect(driftSubmit.status(), await driftSubmit.text()).toBe(201);
        const driftRequest = (await driftSubmit.json()).item as { id: string; batchProofDigest: string };
        const driftReview = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${driftRequest.id}/review`), {
          headers: reviewerHeaders, data: { decision: "approve", batchProofDigest: driftRequest.batchProofDigest }
        });
        expect(driftReview.status(), await driftReview.text()).toBe(200);
        drifted = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      }

      await signInBrowserAsRole(page, "software-committer",
        `${runtime.frontendUrl}/parameter-review?project=aurora&request=${receipt.id}`);
      const detail = page.getByRole("article", { name: "批量源文件请求详情" });
      await expect(detail).toBeVisible();
      await expect(detail.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
      await detail.getByText("溯源信息", { exact: true }).click();
      await expect(detail).toContainText(receipt.batchProofDigest);
      await expect.poll(async () => JSON.parse((await detail.getByLabel("完整溯源数据").textContent())!)["来源元数据"]?.format).toBe(format);
      await detail.getByText("查看源文件差异", { exact: true }).click();
      await expect(detail.getByRole("region", { name: "批量固定源差异" })).toBeVisible();
      const approve = detail.getByRole("button", { name: "批准全部 2 项" });
      if (outcomeKind === "reject") {
        await detail.getByRole("button", { name: "驳回全部 2 项" }).click();
        const rejectDialog = page.getByRole("dialog", { name: /^驳回「/ });
        await expect(rejectDialog.getByRole("button", { name: "确认驳回" })).toBeDisabled();
        await rejectDialog.getByLabel("驳回原因", { exact: true }).fill("手动同步需要补充依据");
        await rejectDialog.getByRole("button", { name: "确认驳回" }).click();
        await expect(detail).toContainText("已驳回");
      } else {
        await expect(approve).toBeEnabled();
        const reviewResponse = page.waitForResponse((response) => response.url().endsWith(`/parameter-value-change-requests/${receipt.id}/review`));
        await approve.click();
        await page.getByRole("dialog", { name: "确认批准整批变更", exact: true }).getByRole("button", { name: "确认批准并应用", exact: true }).click();
        expect((await reviewResponse).status()).toBe(outcomeKind === "drift" ? 409 : 200);
        await expect(detail).toContainText(outcomeKind === "drift" ? "来源或审核证明已变化" : "已批准");
      }
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" }))
        .toContainText(outcomeKind === "drift" ? "待审核" : outcomeKind === "reject" ? "已驳回" : "已批准");
      const applied = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      if (outcomeKind === "approve") {
        expect(applied.values).toHaveLength(baseline.values.length + 2);
        expect(applied.pins).toHaveLength(baseline.pins.length + 2);
        expect(applied.history).toHaveLength(baseline.history.length + 2);
        expect(applied.versions).toHaveLength(baseline.versions.length + 1);
        const appliedVersionId = applied.files.find((file) => file.id === fileId)!.currentVersionId!;
        const values = [];
        for (const target of prepared.targets) {
          const currentValueId = applied.bindings.find((binding) => binding.id === target.bindingId)!.currentValueId;
          const value = await loadProjectValueById(asValueClient(db), currentValueId);
          const pin = await loadOwnedProjectValueSourcePin(db, { organizationId: "org-chargelab",
            projectId: "aurora", bindingId: target.bindingId, projectValueId: currentValueId });
          expect(pin?.fileVersionId).toBe(appliedVersionId);
          expect(pin?.configRevisionId).toBe(value?.config_revision_id);
          const history = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!, {
            organizationId: "org-chargelab", projectId: "aurora", bindingId: target.bindingId });
          expect(history?.some((event) => event.newCurrentValueId === currentValueId)).toBe(true);
          values.push(value?.value);
        }
        expect(values.sort()).toEqual([50, 60]);
      } else {
        expect(applied.values).toEqual(drifted?.values ?? baseline.values);
        expect(applied.pins).toEqual(drifted?.pins ?? baseline.pins);
        expect(applied.history).toEqual(drifted?.history ?? baseline.history);
        expect(applied.versions).toEqual(drifted?.versions ?? baseline.versions);
      }
      const now = (await db.query<{ current_version_id: string }>(
        "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
      if (outcomeKind === "approve" || outcomeKind === "drift") expect(now).not.toBe(activeVersion);
      else expect(now).toBe(activeVersion);
      expect(pageErrors).toEqual([]);
      expect(network).toEqual(expect.arrayContaining([
        expect.stringMatching(/POST 201 .*parameter-file-candidates$/),
        expect.stringMatching(/GET 200 .*source-preview$/),
        expect.stringMatching(/POST 201 .*parameter-value-change-requests\/batches$/),
        expect.stringMatching(new RegExp(`POST ${outcomeKind === "drift" ? 409 : 200} .*parameter-value-change-requests/.*?/review$`))
      ]));
      await detail.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`b906-${format}-manual-${outcomeKind}-1440x900.png`) });
      await testInfo.attach(`b906-${format}-manual-network`, { body: JSON.stringify(network, null, 2), contentType: "application/json" });
      await recordEvidence();
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
}
