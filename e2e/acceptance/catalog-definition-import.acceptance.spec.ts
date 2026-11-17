import "./helpers/loadAcceptanceEnvironment";
import { readFile } from "node:fs/promises";
import { expect } from "playwright/test";
import { catalogRuntimeTest as test } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, openCatalogAt, confirmGovernanceDialog,
  assertNoPageOverflow, CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { ACCEPTANCE_ORGANIZATION, acceptanceCast } from "./helpers/cast";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { firstAcmePredecessor } from "../../server/modules/catalog-publication/builder/predecessorHarness";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { installPublishedRelease, createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { adoptPreexistingCatalog } from "../../server/modules/catalog-publication/runtime/adoption";
import { revisePublicationPolicy } from "../../server/modules/catalog-publication/authorization/policy";
import { collectPublicationPolicyInstanceSnapshot } from "../../server/modules/catalog-publication/authorization/instanceSnapshot";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../../server/modules/catalog-publication/authorization/types";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../../server/modules/catalog-publication/builder/types";
import { runPublicationManagerOnce } from "../../server/modules/catalog-publication/jobs/manager";
import { CatalogReleaseDigest } from "../../server/modules/parameter-catalog-contract";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { getAuthContext } from "../../server/modules/auth/repository";
import type { CatalogMarkdownImportResponse, CatalogRegistrationResponse } from "../../src/infrastructure/http/parameterCatalogDtos";

test.use({ catalogRuntimeScope: import.meta.url, catalogRuntimeDatabaseUrl: process.env.TEST_DATABASE_URL,
  viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

test("imports an owned definition and explicitly registers its child without changing the registered driver", async ({ page, catalogRuntime }, testInfo) => {
  test.setTimeout(180_000);
  const db = createPostgresDatabase(catalogRuntime.databaseUrl), pool = getRootPostgresPool(db)!;
  const organizationId = ACCEPTANCE_ORGANIZATION.id, driverId = "csub_acme_power";
  const registrationPath = `/api/v2/organizations/${organizationId}/subject-registrations`;
  try {
    await seedAcceptanceRoleMatrix();
    const { bundle, compiled } = firstAcmePredecessor();
    const pin = { id: compiled.release.id, digest: CatalogReleaseDigest(compiled.aggregateDigest) };
    expect((await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest })).ok).toBe(true);
    const actorId = acceptanceCast.acceptanceAdmin.userId;
    const verification = await pool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1", [pin.id]);
    expect((await adoptPreexistingCatalog(pool, { expectedCurrent: pin, actorPrincipalId: actorId,
      sourceBytes: Buffer.from(JSON.stringify(bundle)), artifactDigest: pin.digest, evidenceKind: "synthetic-fixture",
      adoptionEvidence: { source_bundle_digest: pin.digest, verification_digest: verification.rows[0]!.compiled_fingerprint,
        data_mode: "fresh", collected_at: new Date().toISOString(), approved_by: actorId } })).ok).toBe(true);
    const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    expect((await revisePublicationPolicy(db, { trustedActor: createUserInvocation(await getAuthContext(db, actorId)),
      publicationEnabled: true, lowRiskSingleActorPublish: false, capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
      mode: "execute", managedInstance: { confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
        expectedDatabaseOid: snapshot.databaseOid, expectedCurrentId: pin.id, expectedCurrentDigest: pin.digest,
        expectedPolicyRevision: snapshot.policyRevision, expectedFrozen: snapshot.frozen, expectedAdopted: snapshot.adopted } })).ok).toBe(true);

    const moduleName = "定义导入回归业务分类";
    const module = await catalogJson(page.request, "POST", "/api/v1/parameter-modules", { data: { name: moduleName, kind: "business" } });
    expect(module.status, JSON.stringify(module.body)).toBe(201);
    const moduleId = (module.body as { item: { id: string } }).item.id;
    const registered = await catalogJson(page.request, "POST", registrationPath, {
      headers: { "X-WiseEff-Catalog-Release": pin.id, "Idempotency-Key": "definition-import-register-driver" },
      data: { subjectId: driverId, destinationModuleId: moduleId, placement: { mode: "use-default" }, reason: "Definition import browser fixture" }
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    const driverRegistration = (registered.body as CatalogRegistrationResponse).item;
    const readDriver = async () => (await pool.query(`select to_jsonb(registration) as registration, to_jsonb(placement) as placement
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement on placement.id=registration.current_placement_id
      where registration.organization_id=$1 and registration.subject_id=$2`, [organizationId, driverId])).rows;
    const driverBefore = await readDriver();
    expect(driverBefore).toHaveLength(1);

    await openCatalogAt(page, "org-admin");
    const entry = page.getByRole("button", { name: "批量导入定义", exact: true });
    await entry.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "批量导入定义", exact: true });
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("link", { name: "下载模板", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("定义导入模板.md");
    const template = await readFile((await download.path())!, "utf8");
    expect(template).toContain("属性键最多 64 字符");
    expect(template).toContain("parent 指定 Catalog 的固定所属驱动");
    expect(template).toContain("> parent: example,charger");
    expect(template).toContain("/parameter-admin/specs");
    await dialog.getByLabel("Markdown 文档", { exact: true }).fill([
      "# Driver `acme,power`", `## \`${"a".repeat(65)}\` 超长属性键`,
      "| 字段 | 值 |", "| --- | --- |", "| 类型 | integer |",
    ].join("\n"));
    const checkingLength = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v2/catalog/publication-candidates");
    await dialog.getByRole("button", { name: "解析并预览", exact: true }).click();
    expect((await checkingLength).status()).toBe(200);
    await expect(dialog.getByRole("table", { name: "导入结果" })).toContainText("属性键不能超过 64 个字符。");
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "definition-import-long-key-error-1440x900");
    const importedDocument = [
      "# NodeType `import-battery`", "parent: acme,power", "## `clear_water_intrused_flag_after_read` 长属性键示例",
      "| 字段 | 值 |", "| --- | --- |", "| 操作 | 新建 |", "| 类型 | integer |",
      "| 最小值 | 0 |", "| 最大值 | 1 |", "| 示例 | 1 |", "", "长属性键示例。"
    ].join("\n");
    const longName = `${"battery-".repeat(24)}.md`;
    let batchPreviewRequests = 0;
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/catalog/publication-candidates") batchPreviewRequests += 1;
    });
    await dialog.getByLabel("上传 .md 文件", { exact: true }).setInputFiles([
      { name: longName, mimeType: "text/markdown", buffer: Buffer.from(importedDocument) },
      { name: "second.md", mimeType: "text/markdown", buffer: Buffer.from(importedDocument) },
      { name: "errors.md", mimeType: "text/markdown", buffer: Buffer.from("# Driver `acme,power`\n## `iin_max` 错误与冲突\n| 字段 | 值 |\n| --- | --- |\n| 类型 | enum |\n| 未知 | x |") },
    ]);
    await expect(dialog.getByRole("button", { name: longName, exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "解析并预览", exact: true }).click();
    await expect(dialog.getByRole("table", { name: "导入结果" })).toContainText("second.md");
    await expect(dialog.getByRole("region", { name: "整批导入结果" })).toBeFocused();
    await expect(dialog.getByRole("region", { name: "整批导入结果" })).toContainText("已完成全部 3 个文件");
    await expect(dialog.getByRole("table", { name: "导入结果" })).toContainText("目录中已有此属性键");
    await expect(dialog.getByRole("table", { name: "导入结果" })).toContainText("暂不支持该字段");
    await expect(dialog.getByRole("button", { name: "解析并预览", exact: true })).toBeDisabled();
    expect(batchPreviewRequests).toBe(1);
    await expect(dialog.getByRole("button", { name: "发布到目录", exact: true })).toHaveCount(0);
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "definition-import-multiple-conflict-1440x900");
    await dialog.getByRole("button", { name: "移除 errors.md", exact: true }).click();
    await dialog.getByRole("button", { name: "second.md", exact: true }).click();
    await dialog.getByLabel("Markdown 文档", { exact: true }).fill(importedDocument.replace("clear_water_intrused_flag_after_read", "second_property"));
    const previewing = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v2/catalog/publication-candidates");
    await dialog.getByRole("button", { name: "解析并预览", exact: true }).click();
    const preview = await previewing;
    expect(preview.status()).toBe(201);
    const candidate = (await preview.json() as CatalogMarkdownImportResponse).item.candidate;
    expect(candidate).toMatchObject({ impactSummary: { addedDefinitionCount: 2, addedSubjectCount: 1 } });
    const childId = candidate!.impactSummary.addedSubjectIds![0]!;
    await expect(dialog.getByRole("table", { name: "导入结果" })).toContainText("clear_water_intrused_flag_after_read");
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "definition-import-preview-1440x900");
    const publishing = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v2/catalog/publication-candidates/${candidate!.id}/publish`);
    await dialog.getByRole("button", { name: "发布到目录", exact: true }).click();
    await confirmGovernanceDialog(page, "确认发布");
    expect((await publishing).status()).toBe(201);
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async principalId => createUserInvocation(await getAuthContext(db, principalId)),
      ownerId: "definition-import-browser-manager" })).toBe("claimed");
    await expect(dialog.getByRole("status", { name: "发布任务状态" })).toHaveAttribute("data-publication-status", "active", { timeout: 30_000 });
    const childBefore = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${childId}`);
    expect(childBefore.body).toMatchObject({ item: { id: childId, ownerSubjectId: driverId, registration: { status: "unregistered" } } });
    const readChild = async () => (await pool.query(`select registration.id, registration.status, registration.owner_subject_id, effective.module_id
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.registration_effective_module effective on effective.registration_id=registration.id
      where registration.organization_id=$1 and registration.subject_id=$2`, [organizationId, childId])).rows;
    const supplement = dialog.getByRole("button", { name: "补登记子节点：acme,power", exact: true });
    await supplement.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("dialog", { name: "补登记子节点", exact: true });
    await expect(confirmation).toContainText("import-battery");
    await expect(confirmation).toContainText(`业务归属：${moduleName}`);
    await expect(confirmation.getByRole("button", { name: "确认补登记", exact: true })).toBeDisabled();
    await expect(confirmation.getByRole("checkbox")).not.toBeChecked();
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "definition-import-child-confirm-1440x900");
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    expect(await readChild()).toEqual([]);
    expect(await readDriver()).toEqual(driverBefore);

    await supplement.focus();
    await page.keyboard.press("Enter");
    await expect(confirmation.getByRole("checkbox")).not.toBeChecked();
    await confirmation.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    const confirm = confirmation.getByRole("button", { name: "确认补登记", exact: true });
    await expect(confirm).toBeEnabled();
    const supplementing = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === registrationPath);
    await confirm.focus();
    await page.keyboard.press("Enter");
    const supplemented = await supplementing;
    expect(supplemented.status()).toBe(201);
    expect((await supplemented.json() as CatalogRegistrationResponse).item.id).toBe(driverRegistration.id);
    await expect(confirmation).not.toBeVisible();
    await expect(supplement).toHaveCount(0);
    const childAfter = await readChild();
    expect(childAfter).toEqual([{ id: expect.any(String), status: "active", owner_subject_id: null, module_id: moduleId }]);
    expect(await readDriver()).toEqual(driverBefore);
    const childSubject = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${childId}`);
    expect(childSubject.body).toMatchObject({ item: { id: childId, ownerSubjectId: driverId, registration: { status: "active" } } });
    await catalogScreenshot(page, testInfo, "definition-import-child-registered-1440x900");

    const submitted = supplemented.request(), headers = submitted.headers();
    expect(headers["idempotency-key"]).toBeTruthy();
    expect(headers["x-wiseeff-catalog-release"]).toBeTruthy();
    const replay = await catalogJson(page.request, "POST", registrationPath, {
      headers: { "Idempotency-Key": headers["idempotency-key"]!, "X-WiseEff-Catalog-Release": headers["x-wiseeff-catalog-release"]! },
      data: submitted.postDataJSON()
    });
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect((replay.body as CatalogRegistrationResponse).item.id).toBe(driverRegistration.id);
    await page.reload();
    await entry.click();
    await expect(dialog).toBeVisible();
    await expect(supplement).toHaveCount(0);
    expect(await readChild()).toEqual(childAfter);
    expect(await readDriver()).toEqual(driverBefore);
  } finally { await db.close(); }
});
