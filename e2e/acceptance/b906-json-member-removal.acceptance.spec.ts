import { selectControlOption } from "./helpers/selectControl";
import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { insertFileVersion } from "../../server/modules/parameter-files/repository";
import type { ParsedIndex } from "../../server/modules/parameter-files/types";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { addConfigSetFile } from "../../server/modules/parameter-files/configSetService";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../../server/modules/parameter-bindings/binding/migrationAdapter";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../server/modules/parameter-topology/types";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { openWorkbenchFileActions } from "./helpers/runtime";
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
      catalog: "fixture-owned",
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
      const setup = async (suffix: string, memberCount = 2) => {
        const created = await request.post(api("/api/v1/projects/aurora/config-sets"), {
          headers: adminHeaders, data: { name: `B #906 ${suffix}` }
        });
        expect(created.ok(), await created.text()).toBe(true);
        const id = (await created.json()).item.id as string;
        const files = [];
        for (const [ordinal, name] of Array.from({ length: memberCount }, (_, index) => index === 0 ? "removed" : index === 1 ? "survivor" : `retained-${index}`).entries()) {
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
      const large = await setup("large-members", 22);
      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${large.id}&inspector=config-set`);
      const largeActions = await openWorkbenchFileActions(page, large.removed.name);
      await largeActions.getByRole("menuitem", { name: "申请从配置移除", exact: true }).click();
      const largeDialog = page.getByRole("dialog", { name: "申请从配置移除文件" });
      await largeDialog.getByText("查看 22 个配置文件", { exact: true }).click();
      await expect(largeDialog.getByRole("list", { name: "提交前文件概览" }).getByRole("listitem")).toHaveCount(22);
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(largeDialog.getByRole("button", { name: "提交移除审核", exact: true })).toBeVisible();
      await expect(largeDialog.getByRole("button", { name: "提交移除审核", exact: true })).toBeInViewport();
      await expect(largeDialog.getByRole("button", { name: "取消", exact: true })).toBeInViewport();
      await largeDialog.getByRole("textbox", { name: "移除原因" }).fill("核对长成员清单后的移除原因");
      const reviewer = largeDialog.getByRole("combobox", { name: "指定软件审核人" });
      await expect(reviewer).toContainText("选择软件审核人");
      await expect(reviewer).toHaveAttribute("data-value", "");
      expect((await reviewer.boundingBox())!.width).toBeGreaterThan(240);
      await expect(largeDialog.getByRole("textbox", { name: "移除原因" })).toHaveValue("核对长成员清单后的移除原因");
      await page.screenshot({ path: testInfo.outputPath("b906-member-22-submit-1280x800.png"), fullPage: false });
      await largeDialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 900 });

      const submitFromPage = async (set: Awaited<ReturnType<typeof setup>>, reason: string) => {
        await signInBrowserAsRole(page, "admin", `${runtime!.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${set.id}&inspector=config-set`);
        await dismissXiaozeHint(page);
        const actions = await openWorkbenchFileActions(page, set.removed.name);
        await expect(actions.getByRole("menuitem", { name: "申请从配置移除", exact: true })).toBeEnabled();
        await actions.getByRole("menuitem", { name: "申请从配置移除", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "申请从配置移除文件" });
        await dialog.getByText("查看 2 个配置文件", { exact: true }).click();
        await expect(dialog.getByRole("list", { name: "提交前文件概览" }).getByRole("listitem")).toHaveCount(2);
        await dialog.getByRole("textbox", { name: "移除原因" }).fill(reason);
        await selectControlOption(dialog.getByRole("combobox", { name: "指定软件审核人" }), acceptanceCast.sunMei.userId);
        const submitted = page.waitForResponse((response) => response.request().method() === "POST"
          && response.url().endsWith("/api/v2/projects/aurora/parameter-value-change-requests/member-removals"));
        await dialog.getByRole("button", { name: "提交移除审核" }).click();
        const response = await submitted;
        expect(response.status(), await response.text()).toBe(201);
        const item = (await response.json()).item as { id: string; proofDigest: string; status: string;
          frozenProof: { members: unknown[]; cohort: unknown[] } };
        expect(item.frozenProof.members).toHaveLength(2);
        expect(item.frozenProof.cohort).toHaveLength(2);
        await expect(page).toHaveURL(new RegExp(`/parameter-submissions\\?project=aurora&memberRequest=${item.id}`));
        await expect(page.getByRole("article", { name: "JSON 配置文件移除请求详情" })).toContainText(reason);
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
      const row = page.getByRole("table", { name: "审阅队列", exact: true }).locator(`[data-review-row-id="${rejected.id}"]`)
        .getByRole("button", { name: /查看 .+ 提交详情$/ });
      await expect(row).toBeVisible();
      await row.click();
      const detail = page.getByRole("article", { name: "JSON 配置文件移除请求详情" });
      await expect(detail.getByRole("list", { name: "冻结文件列表" }).getByRole("listitem")).toHaveCount(2);
      await detail.getByText("查看全部 2 项关联参数", { exact: true }).click();
      await expect(detail.getByRole("list", { name: "冻结关联参数" }).getByRole("listitem")).toHaveCount(2);
      await expect(detail).toContainText(reviewed.survivor.name);
      const rejectedResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${rejected.id}/review`));
      await detail.getByRole("button", { name: "驳回", exact: true }).click();
      const rejectDialog = page.getByRole("dialog", { name: `驳回「${reviewed.removed.name}」的移除申请`, exact: true });
      await expect(rejectDialog.getByRole("button", { name: "驳回申请", exact: true })).toBeDisabled();
      await rejectDialog.getByLabel("驳回原因", { exact: true }).fill("成员删除需要补充依据");
      await rejectDialog.getByRole("button", { name: "驳回申请", exact: true }).click();
      expect((await rejectedResponse).status()).toBe(200);
      await expect(detail).toContainText("已驳回");
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 配置文件移除请求详情" })).toContainText("已驳回");

      const withdrawn = await submitFromPage(reviewed, "浏览器撤回路径");
      const withdrawResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${withdrawn.id}/withdraw`));
      await page.getByRole("button", { name: "撤回申请", exact: true }).click();
      await page.getByRole("dialog", { name: "确认撤回移除申请", exact: true }).getByRole("button", { name: "撤回申请", exact: true }).click();
      expect((await withdrawResponse).status()).toBe(200);
      await expect(page.getByRole("article", { name: "JSON 配置文件移除请求详情" })).toContainText("已撤回");

      const staleRequest = await submitFromPage(stale, "浏览器来源漂移路径");
      const oldVersion = (await db.query<{ version_number: number; storage_key: string; checksum: string; size_bytes: number; parsed_index: ParsedIndex }>(
        "select version_number,storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index from project_parameter_file_versions where id=$1",
        [stale.removed.versionId])).rows[0]!;
      const driftVersionId = randomUUID();
      await insertFileVersion(db, { id: driftVersionId, fileId: stale.removed.id,
        versionNumber: oldVersion.version_number + 1,
        storageKey: oldVersion.storage_key, checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
        parsedIndex: oldVersion.parsed_index, origin: "upload",
        createdByUserId: acceptanceCast.xuYun.userId });
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [stale.removed.id, driftVersionId]);
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora&memberRequest=${staleRequest.id}`);
      const staleDetail = page.getByRole("article", { name: "JSON 配置文件移除请求详情" });
      await expect(staleDetail.getByRole("button", { name: "批准移除" })).toBeVisible();
      const conflictResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${staleRequest.id}/review`));
      await staleDetail.getByRole("button", { name: "批准移除" }).click();
      await page.getByRole("dialog", { name: "确认从配置移除文件", exact: true }).getByRole("button", { name: "批准移除", exact: true }).click();
      expect((await conflictResponse).status()).toBe(409);
      await expect(page.getByText(/来源过期或请求冲突（409）/)).toBeVisible();
      await expect(staleDetail).toContainText("待审核");
      await expect(staleDetail.getByRole("button", { name: "批准移除" })).toHaveCount(0);
      expect((await db.query<{ status: string }>(
        "select status from project_parameter_value_change_requests where id=$1", [staleRequest.id]
      )).rows[0]!.status).toBe("pending");
      expect((await db.query<{ count: number }>(`select count(*)::int as count
        from parameter_catalog.project_source_member_tombstones where file_id=$1`,
      [stale.removed.id])).rows[0]!.count).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("b906-member-stale-1440x900.png") });

      const approved = await submitFromPage(reviewed, "浏览器批准路径");
      await signInBrowserAsRole(page, "software-committer", `${runtime.frontendUrl}/parameter-review?project=aurora&memberRequest=${approved.id}`);
      const approveDetail = page.getByRole("article", { name: "JSON 配置文件移除请求详情" });
      const approvalResponse = page.waitForResponse((response) => response.request().method() === "POST"
        && response.url().endsWith(`/parameter-value-change-requests/${approved.id}/review`));
      await approveDetail.getByRole("button", { name: "批准移除" }).click();
      await page.getByRole("dialog", { name: "确认从配置移除文件", exact: true }).getByRole("button", { name: "批准移除", exact: true }).click();
      expect((await approvalResponse).status()).toBe(200);
      await approveDetail.getByText("溯源信息", { exact: true }).click();
      expect(JSON.parse((await approveDetail.getByLabel("完整溯源数据").textContent())!)["事务结果"].successorConfigRevisionId).toBeTruthy();
      await page.reload();
      await expect(page.getByRole("article", { name: "JSON 配置文件移除请求详情" })).toContainText("已批准");
      await page.screenshot({ path: testInfo.outputPath("b906-member-approved-1440x900.png") });
      const approvedRead = await request.get(api(`/api/v2/projects/aurora/parameter-value-change-requests/${approved.id}/member-removal`), {
        headers: reviewerHeaders
      });
      expect(approvedRead.ok()).toBe(true);
      const approvedItem = (await approvedRead.json()).item;
      expect(approvedItem.appliedSourceResult.tombstoneId).toBeTruthy();
      expect(approvedItem.appliedSourceResult.successorConfigRevisionId).toBeTruthy();
      await approveDetail.getByText("溯源信息", { exact: true }).click();
      await expect(approveDetail.locator("details").filter({ has: page.getByText("溯源信息", { exact: true }) }))
        .toContainText(approvedItem.appliedSourceResult.successorConfigRevisionId);
      expect(browserErrors).toEqual([]);
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});

for (const format of ["json", "dts"] as const) {
test(`#906 B previews canonical member actions for ${format} without mutation`, async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  let runtime: DisposablePostCutoverRuntime | undefined;
  let restore: RestoreDisposablePostCutoverRuntime | undefined;
  let outcome: "success" | "failure" = "failure";
  const network: string[] = [];
  const mutationRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
      catalog: "fixture-owned",
      label: `b906_member_limits_${format}`, markerPurpose: `b906-member-limits-${format}`
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
      if (format === "json") {
        await installConfigurationSourceFixture(db, admin, {
          subjectId: "csub_b906_member_limits_json", schemaId: "wiseeff.b906.member.limits"
        });
      } else {
        await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power",
          compatible: "acme,power", businessName: "B #906 member limits", driverName: "Acme power",
          idempotencyKey: "b906-member-limits-dts", reason: "DTS member limitation browser fixture" });
      }
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Published Catalog fixture unavailable");
      const created = await request.post(api("/api/v1/projects/aurora/config-sets"), {
        headers: adminHeaders, data: { name: `B #906 member limits ${format}` }
      });
      expect(created.status(), await created.text()).toBe(201);
      const setId = (await created.json()).item.id as string;
      const upload = async (name: string, content: string) => {
        const response = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
          headers: adminHeaders, data: { fileName: name, contentBase64: Buffer.from(content).toString("base64") }
        });
        expect(response.ok(), await response.text()).toBe(true);
        const body = await response.json() as { item: { id: string }; version: { id: string } };
        return { name, id: body.item.id, versionId: body.version.id, content };
      };
      const dtsSource = '/dts-v1/;\n/ { charger: device@0 { compatible = "acme,power"; iin_max = <36>; }; };\n';
      const memberContent = format === "json" ? '{"limit":36}\n' : dtsSource;
      const members: Awaited<ReturnType<typeof upload>>[] = [];
      for (let index = 0; index < 2; index += 1) {
        const member = await upload(`b906-limits-${format}-${index}.${format}`, memberContent);
        const added = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
          headers: adminHeaders, data: { fileId: member.id, role: index ? "overlay" : "base", sortOrder: index }
        });
        expect(added.ok(), await added.text()).toBe(true);
        members.push(member);
      }
      const ungrouped = await upload(`b906-limits-unassigned-${format}.${format}`, memberContent);
      if (format === "json") {
        for (const member of members) {
          await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
            projectId: "aurora", configSetId: setId, fileId: member.id, fileVersionId: member.versionId,
            configurationSchemaId: "wiseeff.b906.member.limits", rootPointer: "",
            mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
            invocation: createUserInvocation(admin), requestId: `register:${member.id}`,
            refusalSink: createTrustedRefusalAuditSink(db)
          }));
        }
      } else {
        const manifest: ConfigRevisionManifest = { organizationId: "org-chargelab", projectId: "aurora",
          configSetId: setId, entryFile: members[0]!.name, includeSearchPaths: ["."], overlayOrder: [],
          members: members.map((member, index) => ({ fileId: member.id, fileVersionId: member.versionId,
            fileName: member.name, sourceName: member.name, role: index ? "overlay" : "base",
            sortOrder: index, content: member.content })) };
        const revision = await ingestConfigRevision(db, manifest, admin);
        await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
          { organizationId: "org-chargelab", projectId: "aurora", configSetId: setId,
            configRevisionId: revision.id }));
      }
      const bindingIds = (await db.query<{ binding_id: string }>(
        `select distinct binding_id from parameter_catalog.project_value_source_pins
         where file_id=$1 order by binding_id`, [members[0]!.id]
      )).rows.map((row) => row.binding_id);
      expect(bindingIds.length).toBeGreaterThan(0);
      expect(await Promise.all(bindingIds.map((id) =>
        loadLegacyBindingIdentity(getRootPostgresPool(db)!, id)))).toEqual(bindingIds.map(() => null));
      const before = (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_value_change_requests where project_id='aurora'"
      )).rows[0]!.count;
      page.on("request", (browserRequest) => {
        const path = new URL(browserRequest.url()).pathname;
        if (path.includes(`/config-sets/${setId}/files`) || path.includes("/parameter-value-change-requests/member-removals")) {
          network.push(`${browserRequest.method()} ${path}`);
          if (browserRequest.method() !== "GET" && !path.endsWith("/removal-preview")) mutationRequests.push(`${browserRequest.method()} ${path}`);
        }
      });
      page.on("response", (response) => {
        if (response.request().method() === "GET" && response.url().includes("/source-workflow")) {
          network.push(`GET ${response.status()} ${new URL(response.url()).pathname}`);
        }
      });
      await signInBrowserAsRole(page, "admin", `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&inspector=config-set`);
      await dismissXiaozeHint(page);
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      const filePanel = page.getByRole("dialog", { name: "配置组成", exact: true });
      await expect(filePanel.getByRole("table", { name: "配置文件", exact: true })).toBeVisible();
      await expect(filePanel.getByRole("button", { name: "添加文件", exact: true })).toHaveCount(0);
      await expect(filePanel.getByRole("combobox", { name: "待加入文件", exact: true })).toHaveCount(0);
      await expect(filePanel.getByRole("combobox", { name: "文件用途", exact: true })).toHaveCount(0);
      await expect(filePanel.getByRole("spinbutton", { name: "文件顺序", exact: true })).toHaveCount(0);
      await expect(filePanel.getByRole("button", { name: "添加配置文件", exact: true })).toBeEnabled();
      const restriction = filePanel.getByText("此配置已登记来源。添加或移除文件均需预览并确认，项目文件及历史会保留。", { exact: true });
      await expect(restriction).toBeVisible();
      const initialActions = await openWorkbenchFileActions(page, members[0]!.name);
      const previewPath = `/api/v1/projects/aurora/config-sets/${setId}/files/${members[0]!.id}/removal-preview`;
      const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === previewPath && response.request().method() === "POST");
      await initialActions.getByRole("menuitem", { name: "预览移除影响", exact: true }).click();
      const preview = await previewResponse;
      const previewDialog = page.getByRole("dialog", { name: "预览移除影响", exact: true });
      if (format === "json") {
        expect(preview.status(), await preview.text()).toBe(200);
        await expect(previewDialog).toContainText("个当前参数");
      } else {
        expect(preview.status()).toBe(400);
        await expect(previewDialog.getByRole("alert")).toContainText("不能移除当前 DTS 根文件");
      }
      await expect(previewDialog.getByRole("button", { name: "确认移除", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      if (format === "json") {
        const memberRemove = (await openWorkbenchFileActions(page, members[0]!.name)).getByRole("menuitem", { name: "申请从配置移除", exact: true });
        await expect(memberRemove).toBeEnabled();
        await memberRemove.click();
        await expect(page.getByRole("dialog", { name: "申请从配置移除文件" })).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(page.getByRole("dialog", { name: "申请从配置移除文件" })).toHaveCount(0);
      }
      await filePanel.getByRole("button", { name: "关闭配置组成", exact: true }).click();
      const treeAssign = page.getByRole("button", { name: `加入 ${ungrouped.name}` });
      await expect(treeAssign).toBeDisabled();
      const treeReasonId = await treeAssign.getAttribute("aria-describedby");
      expect(treeReasonId).toBeTruthy();
      await expect(page.locator(`#${treeReasonId}`)).toHaveText("此配置的文件变更需要审核，当前不能直接加入文件。");
      const assignBox = await treeAssign.boundingBox();
      if (!assignBox) throw new Error("Restricted file assignment is not visible");
      await page.mouse.click(assignBox.x + assignBox.width / 2, assignBox.y + assignBox.height / 2);
      const scheme = page.getByRole("button", { name: "配置", exact: true });
      await scheme.focus();
      await page.keyboard.press("Enter");
      const schemeMenu = page.getByRole("menu");
      await expect(schemeMenu.getByRole("menuitem", { name: "配置组成", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(schemeMenu).toBeHidden();
      await expect(scheme).toBeFocused();
      const versionActions = await openWorkbenchFileActions(page, members[0]!.name);
      await versionActions.getByRole("menuitem", { name: "版本历史与下载", exact: true }).click();
      await expect(filePanel).toBeHidden();
      await expect(inspector.getByRole("region", { name: "版本历史" })).toBeVisible();
      await expect(inspector).toContainText(members[0]!.name);
      await expect(inspector.getByRole("button", { name: /从配置移除/ })).toHaveCount(0);
      const restoredActions = await openWorkbenchFileActions(page, members[0]!.name);
      if (format === "json") {
        await expect(restoredActions.getByRole("menuitem", { name: "申请从配置移除", exact: true })).toBeEnabled();
        await restoredActions.getByRole("menuitem", { name: "申请从配置移除", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "申请从配置移除文件" })).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(restoredActions.getByRole("menuitem", { name: "预览移除影响", exact: true })).toBeEnabled();
        await expect(restoredActions.getByRole("menuitem", { name: /从配置移除/ })).toHaveCount(0);
        await page.keyboard.press("Escape");
      }
      await expect(restriction).toBeVisible();
      await expect(page.getByRole("dialog", { name: "申请从配置移除文件" })).toHaveCount(0);
      expect(mutationRequests).toEqual([]);
      expect(network).toContain(`POST ${previewPath}`);
      expect(network.some((entry) => entry.startsWith("GET 200") && entry.endsWith(`/${members[0]!.id}/source-workflow`))).toBe(true);
      const after = (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_value_change_requests where project_id='aurora'"
      )).rows[0]!.count;
      expect(after).toBe(before);
      expect(pageErrors).toEqual([]);
      await filePanel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`b906-${format}-member-limits-1440x900.png`) });
      await testInfo.attach(`${format}-member-limits-network.txt`, {
        body: Buffer.from(network.join("\n")), contentType: "text/plain"
      });
      outcome = "success";
    } finally { await db.close(); }
  } finally { await restore?.(outcome); }
});
}
