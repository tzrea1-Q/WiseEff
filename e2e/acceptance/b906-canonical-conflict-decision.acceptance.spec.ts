import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../../server/modules/parameter-files/configSetService";
import { insertFileVersion } from "../../server/modules/parameter-files/repository";
import { parseDtsValue } from "../../server/modules/dts";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { createCanonicalValueDraft } from "../../server/modules/parameter-bindings/drafts/service";
import { loadOwnedProjectValueSourcePin } from "../../server/modules/parameter-bindings/values";
import { loadProjectValueById } from "../../server/modules/parameter-bindings/values/repositories";
import { loadLegacyBindingIdentity } from "../../server/modules/parameter-bindings/binding/migrationAdapter";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

const projectId = "aurora";
const organizationId = "org-chargelab";
const definitionId = "pdef_acme_power_iin_max";
const dtsSource = `/dts-v1/;\n/ {\n  charger: device@0 { compatible = "acme,power"; iin_max = <36>; };\n  backup: device@1 { compatible = "acme,power"; iin_max = <36>; };\n};\n`;

test.use({ viewport: { width: 1440, height: 900 } });

for (const [format, choice, decision] of [
  ["json", "file", "approve"], ["json", "draft", "approve"],
  ["dts", "file", "approve"], ["dts", "draft", "approve"],
  ["json", "draft", "reject"], ["dts", "file", "withdraw"],
  ["json", "file", "drift"], ["json", "draft", "stale-submit"]
] as const) {
  test(`#906 B ${decision}s one ${format.toUpperCase()} ${choice} conflict from the candidate page`, async ({ page, request }, testInfo) => {
    test.setTimeout(420_000);
    let runtime: DisposablePostCutoverRuntime | undefined;
    let restore: RestoreDisposablePostCutoverRuntime | undefined;
    let outcome: "success" | "failure" = "failure";
    const network: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/source-conflict") || response.url().includes("/conflict-decision")
        || response.url().includes("/parameter-file-conflicts/")
        || response.url().includes("/parameter-value-change-requests/")) {
        network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    try {
      const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
        label: `b906_conflict_${format}_${choice}_${decision}`, markerPurpose: "b906-conflict-ui"
      });
      runtime = started.runtime;
      restore = started.restore;
      const api = (path: string) => `${runtime!.apiUrl}${path}`;
      const db = createPostgresDatabase(runtime.databaseUrl);
      const storage = createLocalObjectStore(runtime.objectStoreRoot);
      const admin = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId, organizationId,
        permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
        roles: [{ roleId: "admin", projectId: null }] });
      const author = makeTestAuthContext({ userId: acceptanceCast.liuMin.userId, organizationId,
        permissions: ["parameter:view", "parameter:edit"], roles: [{ roleId: "software-user", projectId }] });
      const otherAuthor = makeTestAuthContext({ userId: acceptanceCast.chenNa.userId, organizationId,
        permissions: ["parameter:view", "parameter:edit", "parameter:review"],
        roles: [{ roleId: "software-committer", projectId }] });
      try {
        const set = await createConfigSet(db, admin, { projectId, name: `B #906 ${format} ${choice} conflict` });
        let fileId: string;
        let versionId: string;
        let fileName: string;
        let proposed: string;
        let selectedBindingId: string;
        let siblingBindingId: string;
        let baseValueId: string;
        if (format === "json") {
          await installConfigurationSourceFixture(db, admin, {
            subjectId: "csub_906_b_conflict_ui", schemaId: "wiseeff.906.b.conflict.ui"
          });
          fileName = "b906-conflict.json";
          const uploaded = await request.post(api(`/api/v1/projects/${projectId}/parameter-files`), {
            headers: authHeadersForRole("admin"), data: { fileName,
              contentBase64: Buffer.from('{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n').toString("base64") }
          });
          expect(uploaded.status(), await uploaded.text()).toBe(201);
          const uploadedBody = await uploaded.json() as { item: { id: string }; version: { id: string } };
          fileId = uploadedBody.item.id; versionId = uploadedBody.version.id;
          await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
          const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
          if (!catalog) throw new Error("Published Catalog unavailable");
          const first = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
            projectId, configSetId: set.id, fileId, fileVersionId: versionId,
            configurationSchemaId: "wiseeff.906.b.conflict.ui", rootPointer: "",
            mappings: [{ definitionId, pointer: "/settings/limit" }],
            invocation: createUserInvocation(admin), requestId: "b906-register-first",
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
          const second = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
            projectId, configSetId: set.id, fileId, fileVersionId: versionId,
            configurationSchemaId: "wiseeff.906.b.conflict.ui", rootPointer: "/other",
            mappings: [{ definitionId, pointer: "/other/limit" }],
            invocation: createUserInvocation(admin), requestId: "b906-register-second",
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
          selectedBindingId = first.bindings[0]!.id;
          siblingBindingId = second.bindings[0]!.id;
          baseValueId = first.bindings[0]!.currentValueId;
          proposed = '{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n';
        } else {
          await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
            businessName: "B #906 DTS conflict", driverName: "Acme power",
            idempotencyKey: "b906-conflict-driver", reason: "B #906 conflict UI" });
          fileName = "b906-conflict.dts";
          const uploaded = await request.post(api(`/api/v1/projects/${projectId}/parameter-files`), {
            headers: authHeadersForRole("admin"), data: { fileName,
              contentBase64: Buffer.from(dtsSource).toString("base64") }
          });
          expect(uploaded.status(), await uploaded.text()).toBe(201);
          const uploadedBody = await uploaded.json() as { item: { id: string }; version: { id: string } };
          fileId = uploadedBody.item.id; versionId = uploadedBody.version.id;
          await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
          const manifest: ConfigRevisionManifest = { organizationId, projectId, configSetId: set.id,
            entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
            members: [{ fileId, fileVersionId: versionId, fileName, sourceName: fileName,
              role: "base", sortOrder: 0, content: dtsSource }] };
          const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
          const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
          if (!catalog) throw new Error("Published Catalog unavailable");
          await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
            organizationId, projectId, configSetId: set.id, configRevisionId: revision.id
          }));
          proposed = dtsSource.replace("iin_max = <36>", "iin_max = <50>").replace("iin_max = <36>", "iin_max = <60>");
        }
        const candidateResponse = await request.post(api(`/api/v1/projects/${projectId}/parameter-file-candidates`), {
          headers: authHeadersForRole("admin"), data: { fileId, fileName, contentBase64: Buffer.from(proposed).toString("base64") }
        });
        expect(candidateResponse.status(), await candidateResponse.text()).toBe(201);
        const candidateId = (await candidateResponse.json()).item.id as string;
        if (format === "dts") {
          const previewResponse = await request.get(api(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-preview`), {
            headers: authHeadersForRole("admin")
          });
          expect(previewResponse.status(), await previewResponse.text()).toBe(200);
          const bindings = ((await previewResponse.json()).item.bindings ?? []) as Array<{
            bindingId: string; baseCurrentValueId: string; afterText: string }>;
          const selected = bindings.find((binding) => binding.afterText === "<50>");
          const sibling = bindings.find((binding) => binding.afterText === "<60>");
          if (!selected || !sibling) throw new Error("DTS candidate targets unavailable");
          selectedBindingId = selected.bindingId;
          siblingBindingId = sibling.bindingId;
          baseValueId = selected.baseCurrentValueId;
        }
        expect(await Promise.all([selectedBindingId!, siblingBindingId!].map((bindingId) =>
          loadLegacyBindingIdentity(getRootPostgresPool(db)!, bindingId)))).toEqual([null, null]);
        const pin = await loadOwnedProjectValueSourcePin(db, { organizationId, projectId,
          bindingId: selectedBindingId!, projectValueId: baseValueId! });
        if (!pin) throw new Error("Selected canonical source pin missing");
        const draft = await createCanonicalValueDraft(db, author, { projectId, bindingId: selectedBindingId!,
          ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "99" } }
            : { targetValue: parseDtsValue("iin_max", "<99>").value }),
          reason: "界面草稿", baseRevisionId: pin.configRevisionId, baseCurrentValueId: baseValueId!
        }, { objectStore: storage, invocation: createUserInvocation(author), requestId: "b906-ui-draft",
          refusalSink: createTrustedRefusalAuditSink(db) });
        const siblingRow = (await db.query<{ current_value_id: string }>(
          "select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [siblingBindingId!])).rows[0]!;
        const siblingPin = await loadOwnedProjectValueSourcePin(db, { organizationId, projectId,
          bindingId: siblingBindingId!, projectValueId: siblingRow.current_value_id });
        if (!siblingPin) throw new Error("Sibling source pin missing");
        const otherDraft = await createCanonicalValueDraft(db, otherAuthor, { projectId, bindingId: siblingBindingId!,
          ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "88" } }
            : { targetValue: parseDtsValue("iin_max", "<88>").value }),
          reason: "其他作者草稿", baseRevisionId: siblingPin.configRevisionId,
          baseCurrentValueId: siblingRow.current_value_id
        }, { objectStore: storage, invocation: createUserInvocation(otherAuthor), requestId: "b906-other-draft",
          refusalSink: createTrustedRefusalAuditSink(db) });
        const state = async () => (await db.query<{
          bindings: Array<{ id: string; current: string }>; values: string[]; pins: string[];
          history: string[]; versions: string[]; fileVersion: string;
        }>(`select
          (select coalesce(jsonb_agg(jsonb_build_object('id',id,'current',current_value_id) order by id),'[]'::jsonb)
             from parameter_catalog.project_parameter_bindings where id=any($1::text[])) as bindings,
          (select coalesce(array_agg(id order by id),'{}') from parameter_catalog.project_parameter_values
             where binding_id=any($1::text[])) as values,
          (select coalesce(array_agg(id order by id),'{}') from parameter_catalog.project_value_source_pins
             where binding_id=any($1::text[])) as pins,
          (select coalesce(array_agg(id order by id),'{}') from parameter_catalog.binding_history_events
             where binding_id=any($1::text[])) as history,
          (select coalesce(array_agg(id order by id),'{}') from project_parameter_file_versions
             where file_id=$2) as versions,
          (select current_version_id from project_parameter_files where id=$2) as "fileVersion"`,
          [[selectedBindingId!, siblingBindingId!], fileId])).rows[0]!;
        const beforeState = await state();
        const before = (await db.query<{ id: string; current_value_id: string }>(
          "select id,current_value_id from parameter_catalog.project_parameter_bindings where id=any($1::text[]) order by id",
          [[selectedBindingId!, siblingBindingId!]])).rows;
        await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/${projectId}/configuration?configSet=${set.id}&file=${fileId}&sourceMode=candidate&candidate=${candidateId}`);
        await dismissXiaozeHint(page);
        await expect(page.getByRole("heading", { name: fileName })).toBeVisible();
        const inspector = page.getByRole("complementary", { name: "配置检查器" });
        const toggle = page.getByRole("button", { name: "检查器", exact: true });
        if (!(await inspector.isVisible())) await toggle.click();
        const conflict = page.getByRole("region", { name: "canonical 来源冲突单项决策" });
        await expect(conflict).toBeVisible();
        await expect(conflict).toContainText(draft.id, { timeout: 30_000 });
        await expect(conflict).toContainText(acceptanceCast.liuMin.userId);
        await expect(conflict).toContainText(otherDraft.id);
        const selectedGroup = conflict.getByRole("group", { name: new RegExp(selectedBindingId!) });
        await expect(selectedGroup.getByRole("radio", { name: /使用文件值/ })).toBeEnabled();
        await expect(selectedGroup.getByRole("radio", { name: /保留界面草稿值/ })).toBeEnabled();
        await conflict.getByRole("heading", { name: "来源冲突：一次选择一项" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`b906-${format}-conflict-candidate-1440x900.png`) });
        await selectedGroup.getByRole("radio", { name: choice === "file" ? /使用文件值/ : /保留界面草稿值/ }).focus();
        await page.keyboard.press("Space");
        await expect(selectedGroup.getByRole("radio", { name: choice === "file" ? /使用文件值/ : /保留界面草稿值/ })).toBeChecked();
        await page.screenshot({ path: testInfo.outputPath(`b906-${format}-${choice}-selection-1440x900.png`) });
        const selectedDigest = await conflict.getByText("选中证明", { exact: false }).locator("code").textContent();
        await conflict.getByRole("textbox", { name: "决策理由" }).fill(`${format} ${choice} 页面决策`);
        await conflict.getByRole("combobox", { name: "指定软件审核人" }).selectOption(acceptanceCast.sunMei.userId);
        if (decision === "stale-submit") {
          const old = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(
            "select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
            [versionId])).rows[0]!;
          const driftVersionId = randomUUID();
          await insertFileVersion(db, { id: driftVersionId, fileId, storageKey: old.storage_key,
            checksum: old.checksum, sizeBytes: old.size_bytes, parsedIndex: old.parsed_index as Record<string, unknown>,
            origin: "upload", createdByUserId: acceptanceCast.xuYun.userId });
          await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [fileId, driftVersionId]);
        }
        const submitted = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith(`/parameter-file-candidates/${candidateId}/source-conflict-submit`));
        await conflict.getByRole("button", { name: "提交所选一项人工审核" }).click();
        const submitResponse = await submitted;
        expect(submitResponse.request().postDataJSON()).toMatchObject({
          selectedBindingId, selectedDraftId: draft.id, choice,
          expectedDecisionProofDigest: selectedDigest,
          assignedToUserId: acceptanceCast.sunMei.userId
        });
        expect(network.filter((entry) => entry.includes("/parameter-file-conflicts/"))).toHaveLength(0);
        if (decision === "stale-submit") {
          expect(submitResponse.status()).toBe(409);
          await expect(conflict.getByRole("alert")).toContainText("来源或选择证明已过期（409）");
          expect((await db.query("select id from project_parameter_value_change_requests where reason=$1",
            [`${format} ${choice} 页面决策`])).rows).toHaveLength(0);
          expect((await state()).bindings).toEqual(beforeState.bindings);
          await testInfo.attach("json-stale-submit-network.txt", {
            body: Buffer.from(network.join("\n")), contentType: "text/plain"
          });
          outcome = "success";
          return;
        }
        expect(submitResponse.status(), await submitResponse.text()).toBe(201);
        const requestId = (await submitResponse.json()).item.requestId as string;
        await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=${projectId}&request=${requestId}`));
        await expect(page.getByRole("article", { name: "源文件请求详情" })).toContainText(`${format} ${choice} 页面决策`);
        const replay = await request.post(api(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/source-conflict-submit`), {
          headers: authHeadersForRole("admin"), data: submitResponse.request().postDataJSON()
        });
        expect(replay.status(), await replay.text()).toBe(201);
        expect((await replay.json()).item).toMatchObject({ requestId, replayed: true });
        const requestPath = `/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}`;
        const hiddenDetail = await request.get(api(`${requestPath}/conflict-decision`), { headers: authHeadersForRole("software-user") });
        const hiddenReview = await request.post(api(`${requestPath}/review`), {
          headers: authHeadersForRole("software-user"), data: { decision: "reject" }
        });
        expect(hiddenDetail.status()).toBe(404);
        expect(hiddenReview.status()).toBe(404);
        if (decision === "withdraw") {
          const mine = page.getByRole("article", { name: "源文件请求详情" });
          const withdrawn = page.waitForResponse((response) => response.request().method() === "POST"
            && response.url().endsWith(`${requestPath}/withdraw`));
          await mine.getByRole("button", { name: "撤回我的提交" }).click();
          expect((await withdrawn).status()).toBe(200);
          await page.reload();
          await expect(page.getByRole("article", { name: "源文件请求详情" })).toContainText("已撤回");
        } else {
          await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=${projectId}&request=${requestId}`);
          const detail = page.getByRole("article", { name: "源文件请求详情" });
          const decisionRegion = detail.getByRole("region", { name: "冻结的单项来源冲突决策" });
          await expect(decisionRegion).toContainText(choice === "file" ? "文件值" : "界面草稿值");
          await expect(detail.getByRole("button", { name: "批准软件配置" })).toBeEnabled();
          await decisionRegion.scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`b906-${format}-${decision}-review-1440x900.png`) });
          if (decision === "drift") {
            const old = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(
              "select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
              [versionId])).rows[0]!;
            const driftVersionId = randomUUID();
            await insertFileVersion(db, { id: driftVersionId, fileId, storageKey: old.storage_key,
              checksum: old.checksum, sizeBytes: old.size_bytes, parsedIndex: old.parsed_index as Record<string, unknown>,
              origin: "upload", createdByUserId: acceptanceCast.xuYun.userId });
            await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [fileId, driftVersionId]);
          }
          const reviewed = page.waitForResponse((response) => response.request().method() === "POST"
            && response.url().endsWith(`${requestPath}/review`));
          await detail.getByRole("button", { name: decision === "reject" ? "驳回" : "批准软件配置" }).click();
          expect((await reviewed).status()).toBe(decision === "drift" ? 409 : 200);
          if (decision === "drift") {
            await expect(page.getByRole("alert").filter({ hasText: "来源或决策证明已过期（409）" })).toBeVisible();
            await expect(detail.getByRole("button", { name: "批准软件配置" })).toHaveCount(0);
            const priorDetailReads = network.filter((entry) => entry.endsWith("/conflict-decision")).length;
            const priorDiffReads = network.filter((entry) => entry.endsWith("/source-diff")).length;
            await detail.getByRole("button", { name: "刷新冲突请求与来源" }).click();
            await expect.poll(() => network.filter((entry) => entry.endsWith("/conflict-decision")).length).toBeGreaterThan(priorDetailReads);
            await expect.poll(() => network.filter((entry) => entry.endsWith("/source-diff")).length).toBeGreaterThan(priorDiffReads);
            await expect(page.getByRole("article", { name: "源文件请求详情" })).toContainText("待审核");
          } else {
            await page.reload();
            await expect(page.getByRole("article", { name: "源文件请求详情" }))
              .toContainText(decision === "approve" ? "已批准" : "已驳回");
          }
        }
        const after = (await db.query<{ id: string; current_value_id: string }>(
          "select id,current_value_id from parameter_catalog.project_parameter_bindings where id=any($1::text[]) order by id",
          [[selectedBindingId!, siblingBindingId!]])).rows;
        expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
        const afterState = await state();
        if (decision === "approve") {
          expect(after.every((row, index) => row.current_value_id !== before[index]!.current_value_id)).toBe(true);
          expect(afterState.values).toHaveLength(beforeState.values.length + 2);
          expect(afterState.pins).toHaveLength(beforeState.pins.length + 2);
          expect(afterState.history).toHaveLength(beforeState.history.length + 2);
          expect(afterState.versions).toHaveLength(beforeState.versions.length + 1);
          expect(afterState.fileVersion).not.toBe(beforeState.fileVersion);
          const selectedAfter = after.find((row) => row.id === selectedBindingId!)!;
          const siblingAfter = after.find((row) => row.id === siblingBindingId!)!;
          const siblingBefore = before.find((row) => row.id === siblingBindingId!)!;
          expect((await loadProjectValueById(asValueClient(db), selectedAfter.current_value_id))?.value)
            .toEqual(choice === "file" ? 50 : 99);
          expect((await loadProjectValueById(asValueClient(db), siblingAfter.current_value_id))?.value)
            .toEqual((await loadProjectValueById(asValueClient(db), siblingBefore.current_value_id))?.value);
          const pins = await Promise.all(after.map((row) => loadOwnedProjectValueSourcePin(db, {
            organizationId, projectId, bindingId: row.id, projectValueId: row.current_value_id
          })));
          expect(pins.every((pin) => pin?.fileVersionId === afterState.fileVersion)).toBe(true);
        } else {
          expect(after).toEqual(before);
          expect(afterState.values).toEqual(beforeState.values);
          expect(afterState.pins).toEqual(beforeState.pins);
          expect(afterState.history).toEqual(beforeState.history);
          expect(afterState.versions).toHaveLength(beforeState.versions.length + (decision === "drift" ? 1 : 0));
        }
        const savedDraft = await db.query("select id from project_parameter_value_drafts where id=$1", [draft.id]);
        expect(savedDraft.rows).toHaveLength(1);
        const savedOtherDraft = await db.query("select id from project_parameter_value_drafts where id=$1", [otherDraft.id]);
        expect(savedOtherDraft.rows).toHaveLength(1);
        const status = await db.query<{ status: string }>(
          "select status from project_parameter_value_change_requests where id=$1", [requestId]);
        expect(status.rows[0]?.status).toBe(decision === "drift" ? "pending" :
          decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "withdrawn");
        expect(errors).toEqual([]);
        expect(network.some((entry) => entry.startsWith("GET 200") && entry.endsWith("/source-conflicts"))).toBe(true);
        expect(network.some((entry) => entry.startsWith("POST 201") && entry.endsWith("/source-conflict-submit"))).toBe(true);
        if (decision !== "withdraw") expect(network.some((entry) => entry.startsWith("GET 200") && entry.endsWith("/conflict-decision"))).toBe(true);
        await testInfo.attach(`${format}-${choice}-${decision}-network.txt`, { body: Buffer.from(network.join("\n")), contentType: "text/plain" });
        outcome = "success";
      } finally { await db.close(); }
    } finally { await restore?.(outcome); }
  });
}
