import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { parseDtsValue } from "../../server/modules/dts";
import { insertFileVersion } from "../../server/modules/parameter-files/repository";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../../server/modules/parameter-bindings/binding/migrationAdapter";
import { previewCanonicalCandidate } from "../../server/modules/parameter-files/canonicalFileWorkflow";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { startSwappedDisposablePostCutoverRuntime, type RestoreDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";

const source = `/dts-v1/;\n/ {\n  charger: device@0 { compatible = "acme,power"; iin_max = <36>; };\n  backup: device@1 { compatible = "acme,power"; iin_max = <36>; };\n  spare: device@2 { compatible = "acme,power"; iin_max = <36>; };\n};\n`;
const proposed = source.replace("iin_max = <36>", "iin_max = <77>")
  .replace("iin_max = <36>", "iin_max = <77>");

test.use({ viewport: { width: 1440, height: 900 } });

test("#906 B submits and reviews canonical-only DTS batches through the page", async ({ page, request }, testInfo) => {
  test.setTimeout(420_000);
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
      label: "b906_dts_batch_ui", markerPurpose: "b906-dts-batch"
    });
    runtime = started.runtime;
    restore = started.restore;
    const api = (path: string) => `${runtime!.apiUrl}${path}`;
    const adminHeaders = authHeadersForRole("admin");
    const db = createPostgresDatabase(runtime.databaseUrl);
    const storage = createLocalObjectStore(runtime.objectStoreRoot);
    const admin = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }] });
    try {
      await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
        businessName: "B #906 DTS batch", driverName: "Acme power", idempotencyKey: "b906-dts-ui",
        reason: "B #906 DTS visible flow" });
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Published Catalog fixture unavailable");

      const setup = async (suffix: string) => {
        const created = await request.post(api("/api/v1/projects/aurora/config-sets"), {
          headers: adminHeaders, data: { name: `B #906 DTS ${suffix}` }
        });
        expect(created.ok(), await created.text()).toBe(true);
        const setId = (await created.json()).item.id as string;
        const fileName = `b906-${suffix}.dts`;
        const uploaded = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
          headers: adminHeaders, data: { fileName, contentBase64: Buffer.from(source).toString("base64") }
        });
        expect(uploaded.ok(), await uploaded.text()).toBe(true);
        const file = await uploaded.json() as { item: { id: string }; version: { id: string } };
        const added = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
          headers: adminHeaders, data: { fileId: file.item.id, role: "base", sortOrder: 0 }
        });
        expect(added.ok(), await added.text()).toBe(true);
        const manifest: ConfigRevisionManifest = { organizationId: "org-chargelab", projectId: "aurora",
          configSetId: setId, entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
          members: [{ fileId: file.item.id, fileVersionId: file.version.id, fileName,
            sourceName: fileName, role: "base", sortOrder: 0, content: source }] };
        const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
        await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
          { organizationId: "org-chargelab", projectId: "aurora", configSetId: setId, configRevisionId: revision.id }));
        const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
          headers: adminHeaders, data: { fileId: file.item.id, fileName,
            contentBase64: Buffer.from(proposed).toString("base64") }
        });
        expect(candidate.ok(), await candidate.text()).toBe(true);
        const candidateId = (await candidate.json()).item.id as string;
        const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: "aurora", candidateId });
        expect(preview).toMatchObject({ kind: "canonical", format: "dts", candidateId });
        expect(preview.bindings).toHaveLength(2);
        expect(preview.proofToken).toBeTruthy();
        expect(await Promise.all(preview.bindings!.map((binding) =>
          loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.bindingId)))).toEqual([null, null]);
        return { setId, fileId: file.item.id, versionId: file.version.id, candidateId, preview };
      };
      type Fixture = Awaited<ReturnType<typeof setup>>;
      const state = async (fixture: Fixture) => {
        const ids = fixture.preview.bindings!.map((binding) => binding.bindingId);
        return (await db.query<{
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
        [ids, fixture.fileId])).rows[0]!;
      };
      const submitFromPage = async (fixture: Fixture, reason: string) => {
        await signInBrowserAsRole(page, "admin", `${runtime!.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${fixture.setId}&file=${fixture.fileId}&sourceMode=candidate&candidate=${fixture.candidateId}`);
        await dismissXiaozeHint(page);
        const toggle = page.getByRole("button", { name: "检查器", exact: true });
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        const inspector = page.getByRole("complementary", { name: "配置检查器" });
        await expect(inspector.getByRole("list", { name: "来源变更目标" }).getByRole("listitem")).toHaveCount(2);
        const open = inspector.getByRole("button", { name: "提交 DTS 批量审核" });
        await expect(open).toBeEnabled();
        await open.click();
        const dialog = page.getByRole("dialog", { name: "提交 DTS 批量来源审核" });
        if (reason === "DTS 浏览器批准") {
          await page.keyboard.press("Tab");
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          await open.click();
        }
        await expect(dialog.getByRole("list", { name: "提交前批量目标" }).getByRole("listitem")).toHaveCount(2);
        await dialog.getByRole("textbox", { name: "修改原因" }).fill(reason);
        await dialog.getByRole("combobox", { name: "指定软件审核人" }).selectOption(acceptanceCast.sunMei.userId);
        if (reason === "DTS 浏览器批准") {
          await expect.poll(() => dialog.evaluate((node) => node.getAnimations().every((animation) => animation.playState === "finished"))).toBe(true);
          await page.screenshot({ path: testInfo.outputPath("b906-dts-submit-1440x900.png") });
        }
        const submitted = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/api/v2/projects/aurora/parameter-value-change-requests/batches"));
        await dialog.getByRole("button", { name: "一次提交全部 2 项" }).click();
        const response = await submitted;
        expect(response.status(), await response.text()).toBe(201);
        const item = (await response.json()).item as { id: string; status: string; batchProofDigest: string;
          cohortCount: number;
          targets: Array<{ ordinal: number; bindingId: string; sourcePinId: string; action: string;
            targetText: string | null; appliedValueId: string | null }> };
        expect(item.status).toBe("pending");
        expect(item.batchProofDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(item.cohortCount).toBe(3);
        expect(item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
        expect(item.targets.map((target) => [target.bindingId, target.sourcePinId, target.action, target.targetText]))
          .toEqual(fixture.preview.bindings!.map((binding) =>
            [binding.bindingId, binding.sourcePinId, binding.action, binding.afterText ?? null]));
        await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=aurora&request=${item.id}`));
        const mine = page.getByRole("article", { name: "批量源文件请求详情" });
        await expect(mine).toContainText(reason);
        await expect(mine.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
        await mine.getByRole("button", { name: "刷新批量请求与来源" }).click();
        await expect(mine).toContainText(item.batchProofDigest);
        return item;
      };
      const reviewFromQueue = async (reason: string) => {
        await signInBrowserAsRole(page, "software-committer", `${runtime!.frontendUrl}/parameter-review?project=aurora`);
        const row = page.getByRole("table", { name: "软件配置审核请求" }).getByRole("row").filter({ hasText: reason });
        await expect(row).toBeVisible();
        await row.getByRole("button", { name: "查看批量请求" }).click();
        const detail = page.getByRole("article", { name: "批量源文件请求详情" });
        await expect(detail.getByRole("list", { name: "批量审核目标" }).getByRole("listitem")).toHaveCount(2);
        await expect(detail.getByText("DTS", { exact: true })).toBeVisible();
        return detail;
      };

      const approvedFixture = await setup("approved");
      const beforeApproval = await state(approvedFixture);
      const approved = await submitFromPage(approvedFixture, "DTS 浏览器批准");
      const detail = await reviewFromQueue("DTS 浏览器批准");
      await expect(detail.getByText(approved.batchProofDigest)).toBeVisible();
      await expect(detail.getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath("b906-dts-review-1440x900.png") });
      const approvalResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${approved.id}/review`));
      await detail.getByRole("button", { name: "批准全部 2 项" }).click();
      expect((await approvalResponse).status()).toBe(200);
      await expect(detail).toContainText("已批准");
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已批准");
      const afterApproval = await state(approvedFixture);
      expect(afterApproval.values).toHaveLength(beforeApproval.values.length + 2);
      expect(afterApproval.pins).toHaveLength(beforeApproval.pins.length + 2);
      expect(afterApproval.history).toHaveLength(beforeApproval.history.length + 2);
      expect(afterApproval.versions).toHaveLength(beforeApproval.versions.length + 1);
      expect(afterApproval.fileVersion).not.toBe(beforeApproval.fileVersion);
      const applied = await db.query<{
        ordinal: number; target_text: string; target_value: unknown; applied_value_id: string;
        current_value_id: string; applied_history_event_id: string; history_request_id: string;
        applied_source_pin_id: string; pin_value_id: string; applied_file_version_id: string;
        pin_file_version_id: string; current_version_id: string;
        value_config_revision_id: string; pin_config_revision_id: string;
      }>(`select target.ordinal,target.target_text,target.target_value,target.applied_value_id,
          binding.current_value_id,target.applied_history_event_id,
          history.applied_request_id as history_request_id,target.applied_source_pin_id,
          pin.project_value_id as pin_value_id,target.applied_file_version_id,
          pin.file_version_id as pin_file_version_id,file.current_version_id,
          value.config_revision_id as value_config_revision_id,
          pin.config_revision_id as pin_config_revision_id
        from project_parameter_value_change_targets target
        join parameter_catalog.project_parameter_bindings binding on binding.id=target.binding_id
        join parameter_catalog.project_parameter_values value on value.id=target.applied_value_id
        join parameter_catalog.project_value_source_pins pin on pin.id=target.applied_source_pin_id
        join parameter_catalog.binding_history_events history on history.id=target.applied_history_event_id
        join project_parameter_files file on file.id=$2
        where target.request_id=$1 order by target.ordinal`, [approved.id, approvedFixture.fileId]);
      expect(applied.rows).toHaveLength(2);
      expect(applied.rows.map((row) => [row.ordinal, row.target_text, row.target_value]))
        .toEqual([[0, "<77>", parseDtsValue("iin_max", "<77>").value],
          [1, "<77>", parseDtsValue("iin_max", "<77>").value]]);
      expect(applied.rows.every((row) => row.applied_value_id === row.current_value_id
        && row.applied_value_id === row.pin_value_id
        && row.history_request_id === approved.id
        && row.applied_file_version_id === row.pin_file_version_id
        && row.applied_file_version_id === row.current_version_id
        && row.value_config_revision_id === row.pin_config_revision_id)).toBe(true);
      expect(await Promise.all(approvedFixture.preview.bindings!.map((binding) =>
        loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.bindingId)))).toEqual([null, null]);

      const rejectedFixture = await setup("rejected");
      const rejected = await submitFromPage(rejectedFixture, "DTS 浏览器驳回");
      const beforeRejection = await state(rejectedFixture);
      const rejectDetail = await reviewFromQueue("DTS 浏览器驳回");
      const rejectResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${rejected.id}/review`));
      await rejectDetail.getByRole("button", { name: "驳回全部 2 项" }).click();
      expect((await rejectResponse).status()).toBe(200);
      await expect(rejectDetail).toContainText("已驳回");
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已驳回");
      expect(await state(rejectedFixture)).toEqual(beforeRejection);

      const withdrawnFixture = await setup("withdrawn");
      const withdrawn = await submitFromPage(withdrawnFixture, "DTS 浏览器撤回");
      const beforeWithdrawal = await state(withdrawnFixture);
      const mine = page.getByRole("article", { name: "批量源文件请求详情" });
      const withdrawResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${withdrawn.id}/withdraw`));
      await mine.getByRole("button", { name: "撤回我的批量提交" }).click();
      expect((await withdrawResponse).status()).toBe(200);
      await expect(mine).toContainText("已撤回");
      await page.reload();
      await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("已撤回");
      expect(await state(withdrawnFixture)).toEqual(beforeWithdrawal);

      const staleFixture = await setup("stale");
      const stale = await submitFromPage(staleFixture, "DTS 浏览器来源漂移");
      const staleDetail = await reviewFromQueue("DTS 浏览器来源漂移");
      await expect(staleDetail.getByRole("button", { name: "批准全部 2 项" })).toBeEnabled();
      const oldVersion = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(
        "select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
        [staleFixture.versionId])).rows[0]!;
      const driftVersionId = randomUUID();
      await insertFileVersion(db, { id: driftVersionId, fileId: staleFixture.fileId,
        storageKey: oldVersion.storage_key, checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
        parsedIndex: oldVersion.parsed_index as Record<string, unknown>, origin: "upload",
        createdByUserId: acceptanceCast.xuYun.userId });
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1",
        [staleFixture.fileId, driftVersionId]);
      const beforeConflict = await state(staleFixture);
      const conflictResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${stale.id}/review`));
      await staleDetail.getByRole("button", { name: "批准全部 2 项" }).click();
      expect((await conflictResponse).status()).toBe(409);
      await expect(staleDetail.getByText(/来源或审核证明已变化/)).toBeVisible();
      await expect(staleDetail.getByRole("button", { name: "批准全部 2 项" })).toBeDisabled();
      expect(await state(staleFixture)).toEqual(beforeConflict);
      expect((await db.query<{ status: string }>(
        "select status from project_parameter_value_change_requests where id=$1", [stale.id]
      )).rows[0]!.status).toBe("pending");
      await staleDetail.getByText(/来源或审核证明已变化/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("b906-dts-stale-1440x900.png") });

      expect(browserErrors).toEqual([]);
      expect(network.filter((entry) => entry.startsWith("POST 201") && entry.endsWith("/batches"))).toHaveLength(4);
      expect(network.some((entry) => entry.startsWith("POST 409") && entry.endsWith(`/${stale.id}/review`))).toBe(true);
      await testInfo.attach("dts-batch-http-network.txt", {
        body: Buffer.from(network.join("\n")), contentType: "text/plain"
      });
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
