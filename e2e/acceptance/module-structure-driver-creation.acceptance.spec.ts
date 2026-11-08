import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { test } from "./helpers/catalogFixtureRuntime";
import { acceptanceCast } from "./helpers/cast";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { catalogJson, signInCatalogActor, CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { retiredPowerSubjectSuccessorBundle } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { adoptPreexistingCatalog } from "../../server/modules/catalog-publication/runtime/adoption";
import { revisePublicationPolicy } from "../../server/modules/catalog-publication/authorization/policy";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../../server/modules/catalog-publication/authorization/types";
import { collectPublicationPolicyInstanceSnapshot } from "../../server/modules/catalog-publication/authorization/instanceSnapshot";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../../server/modules/catalog-publication/builder/types";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { getAuthContext } from "../../server/modules/auth/repository";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { runPublicationManagerOnce } from "../../server/modules/catalog-publication/jobs/manager";
import { moduleStructureExportSchema, moduleStructureUpdateDocumentSchema } from "../../server/modules/contracts/dtoSchemas/moduleStructure";

const base = "/api/v2/organizations/org-chargelab/module-structure";
test.use({ viewport: { width: 1440, height: 900 }, catalogRuntimeScope: import.meta.url });
useBrowserDiagnostics(test, { expectedApiFailures: [...CATALOG_EXPECTED_API_FAILURES,
  { method: "POST", path: `${base}/previews`, status: 400 }] });

test("creates two drivers under new modules and resumes after publication without duplicating identities", async ({ page, catalogAcceptanceRuntime }, info) => {
  test.setTimeout(180_000);
  const { runtime, fixture } = catalogAcceptanceRuntime;
  const db = createPostgresDatabase(runtime.databaseUrl);
  const pool = getRootPostgresPool(db)!;
  const actorId = acceptanceCast.acceptanceAdmin.userId;
  const actor = createUserInvocation(await getAuthContext(db, actorId));
  try {
    const verification = await pool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1", [fixture.chain.pinF.id]);
    const adopted = await adoptPreexistingCatalog(pool, {
      expectedCurrent: fixture.chain.pinF, actorPrincipalId: actorId,
      sourceBytes: Buffer.from(JSON.stringify(retiredPowerSubjectSuccessorBundle())), artifactDigest: fixture.chain.pinF.digest,
      evidenceKind: "synthetic-fixture", adoptionEvidence: { source_bundle_digest: fixture.chain.pinF.digest,
        verification_digest: verification.rows[0]!.compiled_fingerprint, data_mode: "fresh",
        collected_at: new Date().toISOString(), approved_by: actorId },
    });
    expect(adopted.ok).toBe(true);
    const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    const enabled = await revisePublicationPolicy(db, { trustedActor: actor, publicationEnabled: true,
      lowRiskSingleActorPublish: false, capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
      mode: "execute", managedInstance: { confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
        expectedDatabaseOid: snapshot.databaseOid, expectedCurrentId: fixture.chain.pinF.id,
        expectedCurrentDigest: fixture.chain.pinF.digest, expectedPolicyRevision: snapshot.policyRevision,
        expectedFrozen: snapshot.frozen, expectedAdopted: snapshot.adopted } });
    expect(enabled.ok).toBe(true);

    const exported = await catalogJson(page.request, "POST", `${base}/exports`, { data: {} });
    expect(exported.status).toBe(200);
    const document = moduleStructureUpdateDocumentSchema.parse(exported.body);
    const suffix = Date.now().toString(36);
    const parentName = `Import battery ${suffix}`, childName = "Authentication";
    const compatibles = [`wiseeff,import-auth-${suffix}`, `wiseeff,import-service-${suffix}`];
    document.modules.push(
      { ref: "new-battery", operation: "upsert", name: parentName, parentRef: null, description: "", scope: "", sortOrder: 0, importance: "medium" },
      { ref: "new-auth", operation: "upsert", name: childName, parentRef: "new-battery", description: "", scope: "", sortOrder: 0, importance: "medium" },
    );
    document.newDrivers = [
      { ref: "auth-chip", compatible: compatibles[0]!, driverNature: "physical-device", instanceCardinality: "multiple", displayAlias: "Authentication chip",
        placement: { kind: "module", moduleRef: "new-auth" } },
      { ref: "auth-service", compatible: compatibles[1]!, driverNature: "logical-service", instanceCardinality: "singleton-per-project", displayAlias: "Authentication service",
        placement: { kind: "module", moduleRef: "new-auth" } },
    ];
    const uploaded = { name: "create-drivers.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) };
    await signInCatalogActor(page, "org-admin", "/parameter-admin/modules");
    await page.getByRole("button", { name: "导入结构", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入模块结构", exact: true });
    const invalid = structuredClone(document);
    invalid.newDrivers![0]!.compatible = "wiseeff,*";
    await dialog.getByLabel("JSON 文件").setInputFiles({ ...uploaded, buffer: Buffer.from(JSON.stringify(invalid)) });
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    const diagnostic = dialog.getByRole("region", { name: "导入错误诊断" });
    await expect(diagnostic).toContainText("document.newDrivers.0.compatible");
    await expect(diagnostic).toContainText("wiseeff,*");
    await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();

    await dialog.getByLabel("JSON 文件").setInputFiles(uploaded);
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    const declarations = dialog.getByRole("region", { name: "新增驱动预览" });
    await expect(declarations).toContainText(compatibles[0]!);
    await expect(declarations).toContainText(compatibles[1]!);
    await expect(declarations).toContainText(`${parentName} / ${childName}`);
    await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("module-structure-new-drivers-1440x900.png"), animations: "disabled" });
    await dialog.getByLabel("变更原因").fill("Create new driver declarations and their business categories");
    await dialog.getByRole("button", { name: "发布新驱动", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "发布新驱动？", exact: true });
    const confirm = confirmation.getByRole("button", { name: "确认发布新驱动", exact: true });
    await expect(confirm).toBeDisabled();
    const acknowledgement = confirmation.getByRole("checkbox", { name: "我已核对影响并确认发布到共享目录" });
    await acknowledgement.focus();
    await page.keyboard.press("Space");
    await expect(acknowledgement).toBeChecked();
    const publishing = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `${base}/driver-publications`);
    await confirm.click();
    const published = await publishing;
    expect(published.ok(), await published.text()).toBe(true);
    await expect(dialog.getByRole("status", { name: "驱动创建进度" })).toContainText("正在发布新驱动");
    expect((await pool.query("select id from parameter_modules where organization_id='org-chargelab' and name=$1", [parentName])).rowCount).toBe(0);

    // A new browser document loses all component-local state; the original file resumes the durable server mapping.
    page.once("dialog", prompt => { void prompt.accept(); });
    await page.reload();
    await prepareInteractionSurface(page);
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async principalId => createUserInvocation(await getAuthContext(db, principalId)),
      ownerId: "module-driver-import-browser-manager" })).toBe("claimed");
    await page.getByRole("button", { name: "导入结构", exact: true }).click();
    await dialog.getByLabel("JSON 文件").setInputFiles(uploaded);
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByRole("status", { name: "驱动创建进度" })).toContainText("驱动已发布，模块与归属尚未提交");
    await expect(dialog.getByRole("button", { name: "发布新驱动", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("module-structure-new-drivers-resume-1440x900.png"), animations: "disabled" });
    await dialog.getByLabel("变更原因").fill("Finish the reviewed module creation and registration");
    const applied = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `${base}/applies`);
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const appliedResponse = await applied;
    expect(appliedResponse.status(), await appliedResponse.text()).toBe(200);
    await expect(dialog.getByRole("status").filter({ hasText: "回执" })).toBeVisible();

    const after = await catalogJson(page.request, "POST", `${base}/exports`, { data: {} });
    expect(after.status).toBe(200);
    const result = moduleStructureExportSchema.parse(after.body);
    const parent = result.modules.find(entry => entry.name === parentName);
    expect(parent).toBeDefined();
    const child = result.modules.find(entry => entry.name === childName && entry.parentRef === parent!.ref);
    expect(child).toBeDefined();
    const created = result.subjects.filter(subject =>
      subject.recognition?.effective?.compatibles?.some(compatible => compatibles.includes(compatible)));
    expect(created).toHaveLength(2);
    expect(created).toEqual(expect.arrayContaining(compatibles.map(compatible => expect.objectContaining({ kind: "driver", state: "active",
      placement: { kind: "module", moduleRef: child!.ref }, recognition: expect.objectContaining({ effective: expect.objectContaining({ compatibles: [compatible] }) }) }))));
    const ids = created.map((subject: { subjectId: string }) => subject.subjectId);
    expect((await pool.query("select id from parameter_catalog.parameter_definitions where subject_id=any($1::text[])", [ids])).rowCount).toBe(0);

    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "导入结构", exact: true }).click();
    await dialog.getByLabel("JSON 文件").setInputFiles(uploaded);
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByText("没有领域数据变更。", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "发布新驱动", exact: true })).toHaveCount(0);
    expect((await pool.query("select subject_id from parameter_catalog.organization_subject_registrations where organization_id='org-chargelab' and subject_id=any($1::text[])", [ids])).rowCount).toBe(2);
  } finally {
    await db.close();
  }
});
