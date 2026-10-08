import "./helpers/loadAcceptanceEnvironment";
import { readdir } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../server/testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../../server/modules/parameter-bindings/binding/migrationAdapter";
import { createCanonicalValueDraft } from "../../server/modules/parameter-bindings/drafts/service";
import { parseDtsValue } from "../../server/modules/dts";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { acceptanceCast } from "./helpers/cast";
import { startSwappedDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

for (const format of ["json", "dts"] as const) {
for (const firstChoice of ["draft", "file"] as const) {
for (const stalePreview of firstChoice === "draft" ? [false, true] : [false]) {
  test(`#906 B ${format} mixed manual sync selects ${firstChoice} and file${stalePreview ? " with stale preview" : ""} through real API`, async ({ page, request }, testInfo) => {
    test.setTimeout(420_000);
    const source = format === "json"
      ? '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n'
      : '/dts-v1/;\n/ { first: device@0 { compatible = "acme,power"; iin_max = <10>; }; second: device@1 { compatible = "acme,power"; iin_max = <20>; }; third: device@2 { compatible = "acme,power"; iin_max = <30>; }; };\n';
    const uploadBytes = format === "json"
      ? '{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n'
      : source.replace("iin_max = <10>", "iin_max = <50>").replace("iin_max = <20>", "iin_max = <60>");
    const network: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (/source-manual-sync|source-conflicts|parameter-value-change-requests/.test(response.url())) {
        network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    let outcome: "success" | "failure" = "failure";
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      label: `b906_mixed_${format}_${firstChoice}${stalePreview ? "_stale" : ""}`,
      markerPurpose: `b906-mixed-${format}-${firstChoice}${stalePreview ? "-stale" : ""}`
    });
    const runtime = started.runtime;
    const db = createPostgresDatabase(runtime.databaseUrl);
    const storage = createLocalObjectStore(runtime.objectStoreRoot);
    const admin = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }] });
    const otherAuthor = makeTestAuthContext({ userId: acceptanceCast.liuMin.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit"],
      roles: [{ roleId: "software-user", projectId: "aurora" }] });
    const secondAuthor = makeTestAuthContext({ userId: acceptanceCast.sunMei.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit"],
      roles: [{ roleId: "software-user", projectId: "aurora" }] });
    try {
      if (format === "json") await installConfigurationSourceFixture(db, admin, {
        subjectId: "csub_b906_mixed", schemaId: "wiseeff.b906.mixed"
      });
      else await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
        businessName: "B #906 mixed", driverName: "Acme power", idempotencyKey: "b906-mixed-dts",
        reason: "B #906 mixed UI" });
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Published Catalog fixture unavailable");
      const api = (path: string) => `${runtime.apiUrl}${path}`;
      const adminHeaders = authHeadersForRole("admin");
      const setResponse = await request.post(api("/api/v1/projects/aurora/config-sets"), {
        headers: adminHeaders, data: { name: `B #906 ${format} mixed` }
      });
      expect(setResponse.status(), await setResponse.text()).toBe(201);
      const setId = (await setResponse.json()).item.id as string;
      const fileName = `b906-mixed.${format}`;
      const fileResponse = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
        headers: adminHeaders, data: { fileName, contentBase64: Buffer.from(source).toString("base64") }
      });
      expect(fileResponse.status(), await fileResponse.text()).toBe(201);
      const uploaded = await fileResponse.json() as { item: { id: string }; version: { id: string } };
      const fileId = uploaded.item.id;
      const added = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
        headers: adminHeaders, data: { fileId, role: "base", sortOrder: 0 }
      });
      expect(added.ok(), await added.text()).toBe(true);
      if (format === "json") {
        for (const [ordinal, key] of ["first", "second", "third"].entries()) {
          await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
            projectId: "aurora", configSetId: setId, fileId, fileVersionId: uploaded.version.id,
            configurationSchemaId: "wiseeff.b906.mixed", rootPointer: `/${key}`,
            mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: `/${key}/limit` }],
            invocation: createUserInvocation(admin), requestId: `b906-mixed-register-${ordinal}`,
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
        }
      } else {
        const manifest: ConfigRevisionManifest = { organizationId: "org-chargelab", projectId: "aurora", configSetId: setId,
          entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
          members: [{ fileId, fileVersionId: uploaded.version.id, fileName, sourceName: fileName,
            role: "base", sortOrder: 0, content: source }] };
        const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
        await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
          organizationId: "org-chargelab", projectId: "aurora", configSetId: setId, configRevisionId: revision.id
        }));
      }
      const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: "aurora" });
      expect(bindings).toHaveLength(3);
      expect(await Promise.all(bindings.map((binding) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.id))))
        .toEqual([null, null, null]);
      const withValues = await Promise.all(bindings.map(async (binding) => ({ binding,
        value: (await db.query<{ value: unknown }>(`select value from parameter_catalog.project_parameter_values where id=$1`,
          [binding.currentValueId])).rows[0]?.value
      })));
      const first = withValues.find((entry) => entry.value === 10)?.binding;
      const sibling = withValues.find((entry) => entry.value === 30)?.binding;
      if (!first || !sibling) throw new Error("Three canonical source baselines are incomplete");
      for (const [binding, value] of [[first, 88], [sibling, 77]] as const) {
        const base = (await db.query<{ config_revision_id: string }>(
          `select config_revision_id from parameter_catalog.project_parameter_values where id=$1`,
          [binding.currentValueId])).rows[0]!;
        await createCanonicalValueDraft(db, otherAuthor, { projectId: "aurora", bindingId: binding.id,
          ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: String(value) } }
            : { targetValue: parseDtsValue("iin_max", `<${value}>`).value }),
          reason: "Other author work", baseRevisionId: base.config_revision_id,
          baseCurrentValueId: binding.currentValueId
        }, { objectStore: storage, invocation: createUserInvocation(otherAuthor),
          requestId: `b906-mixed-draft-${value}`, refusalSink: createTrustedRefusalAuditSink(db) });
      }
      const firstRevision = (await db.query<{ config_revision_id: string }>(
        `select config_revision_id from parameter_catalog.project_parameter_values where id=$1`,
        [first.currentValueId])).rows[0]!.config_revision_id;
      await createCanonicalValueDraft(db, secondAuthor, { projectId: "aurora", bindingId: first.id,
        ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "99" } }
          : { targetValue: parseDtsValue("iin_max", "<99>").value }),
        reason: "Second author work", baseRevisionId: firstRevision,
        baseCurrentValueId: first.currentValueId
      }, { objectStore: storage, invocation: createUserInvocation(secondAuthor),
        requestId: "b906-mixed-second-author", refusalSink: createTrustedRefusalAuditSink(db) });
      const baseline = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&file=${fileId}`);
      await dismissXiaozeHint(page);
      await page.getByRole("button", { name: "检查器", exact: true }).click();
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      const openDialog = inspector.getByRole("button", { name: "上传来源并预览批量候选" });
      await openDialog.click();
      const dialog = page.getByRole("dialog", { name: `上传 ${format.toUpperCase()} 来源并准备审核` });
      if (format === "json" && firstChoice === "draft" && !stalePreview) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(openDialog).toBeFocused();
        await openDialog.click();
      }
      await dialog.getByLabel(/选择来源文件/).setInputFiles({ name: fileName,
        mimeType: format === "json" ? "application/json" : "text/plain", buffer: Buffer.from(uploadBytes) });
      const preparing = page.waitForResponse((response) => response.url().endsWith("/source-manual-sync/prepare"));
      const discovering = page.waitForResponse((response) => response.url().endsWith("/source-conflicts"));
      await dialog.getByRole("button", { name: "预览有序目标与证明" }).click();
      const preparedResponse = await preparing;
      expect(preparedResponse.status(), await preparedResponse.text()).toBe(201);
      const discoveredResponse = await discovering;
      expect(discoveredResponse.status(), await discoveredResponse.text()).toBe(200);
      const discovered = await discoveredResponse.json() as { items: Array<{ selectedBindingId: string;
        selectedDraftId: string; authorUserId: string; choices: {
          file: { decisionProofDigest: string }; draft: { decisionProofDigest: string }
        } }> };
      expect(discovered.items.filter((item) => item.selectedBindingId === first.id)).toHaveLength(2);
      const selectedDraft = discovered.items.find((item) => item.selectedBindingId === first.id
        && item.authorUserId === otherAuthor.user.id)!;
      const prepared = (await preparedResponse.json()).item as { candidateId: string; targets: Array<{ bindingId: string }> };
      expect(prepared.targets).toHaveLength(2);
      await expect(dialog.getByRole("list", { name: "手动同步完整有序目标" }).getByRole("listitem")).toHaveCount(2);
      const firstRow = dialog.getByRole("list", { name: "手动同步完整有序目标" }).getByRole("listitem")
        .filter({ hasText: first.id });
      const firstFile = firstRow.getByRole("radio", { name: /采用文件值/ });
      await firstFile.focus();
      if (firstChoice === "draft") {
        await firstRow.getByRole("radio", { name: new RegExp(`采用界面草稿 ${selectedDraft.selectedDraftId}`) }).focus();
      }
      await page.keyboard.press("Space");
      const otherRow = dialog.getByRole("list", { name: "手动同步完整有序目标" }).getByRole("listitem")
        .filter({ hasNotText: first.id });
      await otherRow.getByRole("radio", { name: /采用文件值/ }).check();
      await dialog.getByRole("textbox", { name: "修改原因" }).fill("Mixed file and draft source review");
      await page.screenshot({ path: testInfo.outputPath(`b906-${format}-${firstChoice}${stalePreview ? "-stale" : ""}-prepare-1440x900.png`) });
      if (stalePreview) {
        const changed = await request.post(api(`/api/v2/projects/aurora/parameter-bindings/${first.id}/drafts`), {
          headers: authHeadersForRole("software-user"),
          data: { baseRevisionId: firstRevision, reason: "Author revised the choice",
            ...(format === "json" ? { sourceTarget: { format: "json", sourceText: "89" } }
              : { targetValue: parseDtsValue("iin_max", "<89>").value }) }
        });
        expect(changed.status(), await changed.text()).toBe(201);
        expect((await changed.json()).item.draftId).toBe(selectedDraft.selectedDraftId);
      }
      const beforeSubmit = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      const objectsBeforeSubmit = (await readdir(runtime.objectStoreRoot, { recursive: true })).sort();
      const candidatesBeforeSubmit = (await db.query<{ count: string }>(
        `select count(*)::text as count from project_parameter_file_candidates where project_id=$1`,
        ["aurora"])).rows[0]!.count;
      const submitting = page.waitForResponse((response) => response.url().endsWith("/parameter-value-change-requests/batches")
        && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "一次提交全部 2 项审核" }).click();
      const submitted = await submitting;
      expect(submitted.request().postDataJSON().targetDecisions).toEqual(prepared.targets.map((target) => ({
        bindingId: target.bindingId, choice: target.bindingId === first.id ? firstChoice : "file",
        ...(target.bindingId === first.id && firstChoice === "draft" ? { draftId: selectedDraft.selectedDraftId } : {}),
        ...(target.bindingId === first.id ? { expectedConflictProofs: discovered.items
          .filter((item) => item.selectedBindingId === target.bindingId).map((item) => ({
            draftId: item.selectedDraftId,
            decisionProofDigest: firstChoice === "draft" && item.selectedDraftId === selectedDraft.selectedDraftId
              ? item.choices.draft.decisionProofDigest : item.choices.file.decisionProofDigest
          })) } : {})
      })));
      if (stalePreview) {
        expect(submitted.status(), await submitted.text()).toBe(409);
        expect((await submitted.json()).error.details.reason).toBe("canonical-batch-conflict-proof-stale");
        await expect(dialog.getByRole("alert")).toContainText("竞争草稿或选择证明已变化");
        expect(await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" }))
          .toEqual(beforeSubmit);
        expect((await readdir(runtime.objectStoreRoot, { recursive: true })).sort()).toEqual(objectsBeforeSubmit);
        expect((await db.query<{ count: string }>(
          `select count(*)::text as count from project_parameter_file_candidates where project_id=$1`,
          ["aurora"])).rows[0]!.count).toBe(candidatesBeforeSubmit);
        expect((await db.query<{ count: string }>(
          `select count(*)::text as count from project_parameter_value_change_requests where project_id=$1 and status='pending'`,
          ["aurora"])).rows[0]!.count).toBe("0");
        await testInfo.attach(`b906-${format}-stale-network`, { body: JSON.stringify(network, null, 2),
          contentType: "application/json" });
        await page.screenshot({ path: testInfo.outputPath(`b906-${format}-stale-409-1440x900.png`) });
        expect(errors).toEqual([]);
        outcome = "success";
        return;
      }
      expect(submitted.status(), await submitted.text()).toBe(201);
      expect(preparedResponse.request().headers()["x-request-id"]).not.toBe(submitted.request().headers()["x-request-id"]);
      const receipt = (await submitted.json()).item as { id: string; candidateId: string;
        uploadCandidateId: string; batchProofDigest: string; draftImpactDigest: string; decisionProofDigest: string };
      expect(receipt.candidateId === prepared.candidateId).toBe(firstChoice === "file");
      expect(receipt.uploadCandidateId).toBe(firstChoice === "draft" ? prepared.candidateId : null);
      const pending = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      expect(pending.values).toEqual(baseline.values);
      expect(pending.pins).toEqual(baseline.pins);
      expect(pending.history).toEqual(baseline.history);
      expect(pending.versions).toEqual(baseline.versions);
      const replay = await request.post(api("/api/v2/projects/aurora/parameter-value-change-requests/batches"), {
        headers: { ...adminHeaders, "X-Request-Id": submitted.request().headers()["x-request-id"]! },
        data: submitted.request().postDataJSON()
      });
      expect(replay.status(), await replay.text()).toBe(201);
      expect((await replay.json()).item.id).toBe(receipt.id);
      await signInBrowserAsRole(page, "software-committer",
        `${runtime.frontendUrl}/parameter-review?project=aurora&request=${receipt.id}`);
      const detail = page.getByRole("article", { name: "批量源文件请求详情" });
      await expect(detail).toContainText("兄弟 Binding · 结构性 re-pin");
      await expect(detail).toContainText("未选中，保留并预计过期");
      if (firstChoice === "draft") await expect(detail.getByLabel("批量原上传来源"))
        .toContainText(format === "json" ? "50" : "<50>");
      await expect(detail.getByLabel("批量固定源变更后"))
        .toContainText(format === "json" ? (firstChoice === "draft" ? "88" : "50")
          : (firstChoice === "draft" ? "<88>" : "<50>"));
      const approve = detail.getByRole("button", { name: "批准全部 2 项" });
      await expect(approve).toBeEnabled();
      const reviewing = page.waitForResponse((response) => response.url().endsWith(`/parameter-value-change-requests/${receipt.id}/review`));
      await approve.click();
      expect((await reviewing).status()).toBe(200);
      await expect(detail).toContainText("已批准");
      const applied = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
      expect(applied.values).toHaveLength(baseline.values.length + 3);
      expect(applied.pins).toHaveLength(baseline.pins.length + 3);
      expect(applied.history).toHaveLength(baseline.history.length + 3);
      expect(applied.versions).toHaveLength(baseline.versions.length + 1);
      expect(applied.drafts).toEqual(baseline.drafts);
      const values = (await db.query<{ value: number }>(`select value.value
        from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.id=any($1::text[])`, [bindings.map((binding) => binding.id)])).rows.map((row) => row.value);
      expect(values.sort((a, b) => a - b)).toEqual([30, firstChoice === "draft" ? 88 : 50, 60].sort((a, b) => a - b));
      expect(errors).toEqual([]);
      expect(network).toEqual(expect.arrayContaining([
        expect.stringMatching(/GET 200 .*source-conflicts$/),
        expect.stringMatching(/POST 201 .*source-manual-sync\/prepare$/),
        expect.stringMatching(/POST 201 .*parameter-value-change-requests\/batches$/),
        expect.stringMatching(/POST 200 .*parameter-value-change-requests\/.*\/review$/)
      ]));
      await page.screenshot({ path: testInfo.outputPath(`b906-${format}-${firstChoice}-approved-1440x900.png`) });
      await testInfo.attach(`b906-${format}-${firstChoice}-network`, { body: JSON.stringify(network, null, 2), contentType: "application/json" });
      outcome = "success";
    } finally {
      await db.close();
      await started.restore(outcome);
    }
  });
}
}
}
