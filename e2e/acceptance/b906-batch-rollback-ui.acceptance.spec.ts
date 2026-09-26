import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../server/testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { previewCanonicalCandidate } from "../../server/modules/parameter-files/canonicalFileWorkflow";
import { submitCanonicalBatchValueChange, approveCanonicalBatchValueChange } from "../../server/modules/parameter-bindings/drafts/batchChangeService";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../../server/modules/parameter-bindings/binding/migrationAdapter";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { acceptanceCast } from "./helpers/cast";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

test.use({ viewport: { width: 1440, height: 900 } });
const before = { json: '{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n',
  dts: '/dts-v1/;\n/ { charger: device@0 { compatible = "acme,power"; iin_max = <36>; }; backup: device@1 { compatible = "acme,power"; iin_max = <36>; }; };\n' };
const after = { json: '{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n',
  dts: before.dts.replace("iin_max = <36>", "iin_max = <50>").replace("iin_max = <36>", "iin_max = <60>") };
type Format = "json" | "dts";

for (const { format, outcomeKind } of [
  { format: "json", outcomeKind: "approve" }, { format: "dts", outcomeKind: "approve" },
  { format: "json", outcomeKind: "reject" }, { format: "dts", outcomeKind: "withdraw" },
  { format: "json", outcomeKind: "drift" }
] as Array<{ format: Format; outcomeKind: "approve" | "reject" | "withdraw" | "drift" }>) {
test(`#906 B ${format} historical two-Binding rollback ${outcomeKind} through the pages`, async ({ page, request }, testInfo) => {
  test.setTimeout(420_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  const network: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (/source-batch-rollback|parameter-value-change-requests/.test(response.url())) {
      network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      label: `b906_rollback_${format}`, markerPurpose: `b906-rollback-${format}`
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
    const reviewer = makeTestAuthContext({ userId: acceptanceCast.sunMei.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review"],
      roles: [{ roleId: "software-committer", projectId: "aurora" }] });
    try {
      if (format === "json") await installConfigurationSourceFixture(db, admin, {
        subjectId: "csub_b906_rollback", schemaId: "wiseeff.b906.rollback"
      });
      else await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
        businessName: "B #906 rollback", driverName: "Acme power", idempotencyKey: "b906-rollback-dts",
        reason: "B #906 rollback UI" });
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Published Catalog fixture unavailable");
      const createSet = await request.post(api("/api/v1/projects/aurora/config-sets"), {
        headers: adminHeaders, data: { name: `B #906 ${format} rollback` }
      });
      expect(createSet.status(), await createSet.text()).toBe(201);
      const setId = (await createSet.json()).item.id as string;
      const fileName = `b906-rollback.${format}`;
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
            configurationSchemaId: "wiseeff.b906.rollback", rootPointer,
            mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: rootPointer ? "/other/limit" : "/settings/limit" }],
            invocation: createUserInvocation(admin), requestId: `b906-rollback-register-${rootPointer || "root"}`,
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
        }
      } else {
        const manifest: ConfigRevisionManifest = { organizationId: "org-chargelab", projectId: "aurora", configSetId: setId,
          entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
          members: [{ fileId, fileVersionId: uploaded.version.id, fileName, sourceName: fileName,
            role: "base", sortOrder: 0, content: before.dts }] };
        const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
        await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
          organizationId: "org-chargelab", projectId: "aurora", configSetId: setId, configRevisionId: revision.id
        }));
      }
      const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: "aurora" });
      const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
        headers: adminHeaders, data: { fileId, fileName, contentBase64: Buffer.from(after[format]).toString("base64") }
      });
      expect(candidate.status(), await candidate.text()).toBe(201);
      const candidateId = (await candidate.json()).item.id as string;
      const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: "aurora", candidateId });
      expect(preview.bindings).toHaveLength(2);
      expect(preview.bindings!.every((binding) => bindings.some((row) => row.id === binding.bindingId))).toBe(true);
      expect(await Promise.all(preview.bindings!.map((binding) =>
        loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.bindingId)))).toEqual([null, null]);
      const history = await submitCanonicalBatchValueChange(db, storage, admin, {
        projectId: "aurora", candidateId, expectedProofToken: preview.proofToken!,
        reason: "establish current history", assignedToUserId: acceptanceCast.sunMei.userId,
        invocation: createUserInvocation(admin), requestId: `b906-${format}-history`,
        refusalSink: createTrustedRefusalAuditSink(db)
      });
      expect((await db.transaction((tx) => approveCanonicalBatchValueChange(tx, storage, reviewer, catalog, {
        projectId: "aurora", requestId: history.id, batchProofDigest: history.batchProofDigest,
        invocation: createUserInvocation(reviewer), traceId: `b906-${format}-history-review`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }))).status).toBe("approved");
      const baseline = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      const activeVersion = (await db.query<{ current_version_id: string }>(
        "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
      expect(activeVersion).not.toBe(uploaded.version.id);

      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&file=${fileId}`);
      await dismissXiaozeHint(page);
      await page.getByRole("button", { name: "检查器", exact: true }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      await expect(inspector.getByLabel("不可变版本历史")).toBeVisible();
      await inspector.getByRole("button", { name: `将版本 ${uploaded.version.versionNumber} 恢复为当前` }).click();
      const dialog = page.getByRole("dialog", { name: "提交多目标历史回滚审核" });
      await expect(dialog.getByRole("list", { name: "历史回滚完整有序目标" }).getByRole("listitem")).toHaveCount(2);
      await expect(dialog).toContainText(format.toUpperCase());
      await expect(dialog).toContainText("审核通过前不会改变当前 Value、来源 pin 和活跃文件版本");
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      if (outcomeKind === "approve") await page.screenshot({
        path: testInfo.outputPath(`b906-${format}-rollback-prepare-1440x900.png`)
      });
      const afterPrepare = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      expect(afterPrepare.values).toEqual(baseline.values);
      expect(afterPrepare.pins).toEqual(baseline.pins);
      expect(afterPrepare.history).toEqual(baseline.history);
      expect(afterPrepare.versions).toEqual(baseline.versions);
      await dialog.getByRole("textbox", { name: "来源回滚原因" }).fill(`restore ${format} history`);
      const submitResponse = page.waitForResponse((response) => response.url().endsWith("/source-batch-rollback/submit"));
      await dialog.getByRole("button", { name: "提交审核" }).click();
      const submitted = await submitResponse;
      expect(submitted.status(), await submitted.text()).toBe(201);
      const receipt = (await submitted.json()).item as { requestId: string; candidateId: string; batchProofDigest: string };
      expect(receipt.batchProofDigest).toMatch(/^[0-9a-f]{64}$/);
      const replay = await request.post(api(`/api/v1/projects/aurora/parameter-files/${fileId}/source-batch-rollback/submit`), {
        headers: { ...adminHeaders, "X-Request-Id": submitted.request().headers()["x-request-id"]! },
        data: submitted.request().postDataJSON()
      });
      expect(replay.status(), await replay.text()).toBe(201);
      expect((await replay.json()).item).toMatchObject({ requestId: receipt.requestId, replayed: true });
      const pending = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      expect(pending.values).toEqual(baseline.values);
      expect(pending.pins).toEqual(baseline.pins);
      expect(pending.history).toEqual(baseline.history);
      expect(pending.versions).toEqual(baseline.versions);

      if (outcomeKind === "withdraw") {
        await page.goto(`${runtime.frontendUrl}/parameter-submissions?project=aurora&request=${receipt.requestId}`);
        const mine = page.getByRole("article", { name: "批量源文件请求详情" });
        await expect(mine).toBeVisible();
        await mine.getByRole("button", { name: "撤回我的批量提交" }).click();
        await expect(mine).toContainText("已撤回");
        await page.reload();
        await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已撤回");
        const withdrawn = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
        expect(withdrawn.values).toEqual(baseline.values);
        expect(withdrawn.pins).toEqual(baseline.pins);
        expect(withdrawn.history).toEqual(baseline.history);
        expect(withdrawn.versions).toEqual(baseline.versions);
        await page.screenshot({ path: testInfo.outputPath("b906-dts-batch-rollback-withdraw-1440x900.png") });
        expect(pageErrors).toEqual([]);
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
        const driftPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: "aurora", candidateId: driftId });
        const driftRequest = await submitCanonicalBatchValueChange(db, storage, admin, {
          projectId: "aurora", candidateId: driftId, expectedProofToken: driftPreview.proofToken!,
          reason: "advance source after rollback submit", assignedToUserId: acceptanceCast.sunMei.userId,
          invocation: createUserInvocation(admin), requestId: "b906-rollback-source-drift",
          refusalSink: createTrustedRefusalAuditSink(db)
        });
        expect((await db.transaction((tx) => approveCanonicalBatchValueChange(tx, storage, reviewer, catalog, {
          projectId: "aurora", requestId: driftRequest.id, batchProofDigest: driftRequest.batchProofDigest,
          invocation: createUserInvocation(reviewer), traceId: "b906-rollback-source-drift-review",
          refusalSink: createTrustedRefusalAuditSink(db)
        }))).status).toBe("approved");
        drifted = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      }

      await signInBrowserAsRole(page, "software-committer",
        `${runtime.frontendUrl}/parameter-review?project=aurora&request=${receipt.requestId}`);
      const detail = page.getByRole("article", { name: "批量源文件请求详情" });
      await expect(detail).toBeVisible();
      await expect(detail.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
      await expect(detail).toContainText(receipt.batchProofDigest);
      await expect(detail).toContainText(format.toUpperCase());
      await expect(detail.getByRole("region", { name: "批量固定源差异" })).toBeVisible();
      const approve = detail.getByRole("button", { name: "批准全部 2 项" });
      if (outcomeKind === "reject") {
        await detail.getByRole("button", { name: "驳回全部 2 项" }).click();
        await expect(detail).toContainText("已驳回");
      } else {
        await expect(approve).toBeEnabled();
        const reviewResponse = page.waitForResponse((response) => response.url().endsWith(`/parameter-value-change-requests/${receipt.requestId}/review`));
        await approve.click();
        expect((await reviewResponse).status()).toBe(outcomeKind === "drift" ? 409 : 200);
        await expect(detail).toContainText(outcomeKind === "drift" ? "来源或审核证明已变化" : "已批准");
      }
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" }))
        .toContainText(outcomeKind === "drift" ? "待审核" : outcomeKind === "reject" ? "已驳回" : "已批准");
      const applied = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      if (outcomeKind === "approve") {
        expect(applied.values).not.toEqual(baseline.values);
        expect(applied.pins).not.toEqual(baseline.pins);
        expect(applied.history).not.toEqual(baseline.history);
        expect(applied.versions).not.toEqual(baseline.versions);
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
        expect.stringMatching(/POST 201 .*source-batch-rollback\/prepare$/),
        expect.stringMatching(/POST 201 .*source-batch-rollback\/submit$/),
        expect.stringMatching(new RegExp(`POST ${outcomeKind === "drift" ? 409 : 200} .*parameter-value-change-requests/.*?/review$`))
      ]));
      await detail.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`b906-${format}-batch-rollback-${outcomeKind}-1440x900.png`) });
      await testInfo.attach(`b906-${format}-rollback-network`, { body: JSON.stringify(network, null, 2), contentType: "application/json" });
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
}
