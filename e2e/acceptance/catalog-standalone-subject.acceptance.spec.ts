import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { test, catalogAppUrl } from "./helpers/catalogFixtureRuntime";
import { acceptanceCast } from "./helpers/cast";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { catalogJson, catalogScreenshot, openCatalogAt, confirmGovernanceDialog, assertNoPageOverflow,
  CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { selectControlOption } from "./helpers/selectControl";
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

test.use({ viewport: { width: 1440, height: 900 }, catalogRuntimeScope: import.meta.url });
useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

test("#1412 creates a missing declaration-only driver through the single registry form and returns to its definition", async ({ page, catalogAcceptanceRuntime }, testInfo) => {
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
    await openCatalogAt(page, "org-admin");
    await page.getByRole("button", { name: "新增定义", exact: true }).click();
    await page.getByRole("dialog", { name: "向已发布主体新增定义", exact: true })
      .getByRole("button", { name: "创建缺少的主体", exact: true }).click();
    await expect(page).toHaveURL(/\/parameter-admin\/modules\?createSubject=1/);
    const dialog = page.getByRole("dialog", { name: "新增主体", exact: true });
    const compatible = `wiseeff,declaration-${Date.now().toString(36)}`;
    await dialog.getByLabel("compatible 标识", { exact: true }).fill(compatible);
    await expect(dialog.getByLabel("属性键", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "预览发布", exact: true })).toBeDisabled();
    await selectControlOption(dialog.getByRole("combobox", { name: "驱动性质" }), "physical-device");
    await selectControlOption(dialog.getByRole("combobox", { name: "实例基数" }), "multiple");
    await dialog.getByLabel("变更说明", { exact: true }).fill("先登记设备声明，再补充参数规范。");
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "standalone-subject-1440");
    await page.setViewportSize({ width: 1280, height: 800 });
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "standalone-subject-1280");
    const preview = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v2/catalog/publication-candidates");
    await dialog.getByRole("button", { name: "预览发布", exact: true }).click();
    await confirmGovernanceDialog(page, "确认预览");
    const candidateResponse = await preview;
    expect(candidateResponse.status()).toBe(201);
    const candidate = (await candidateResponse.json()).item;
    expect(candidate).toMatchObject({ capabilityContract: { revision: "catalog-capability/v5" },
      impactSummary: { addedDefinitionCount: 0, addedSubjectCount: 1 } });
    const subjectId = candidate.impactSummary.addedSubjectIds[0] as string;
    const publishing = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v2/catalog/publication-candidates/${candidate.id}/publish`);
    await dialog.getByRole("button", { name: "发布到目录", exact: true }).click();
    await confirmGovernanceDialog(page, "确认发布");
    expect((await publishing).status()).toBe(201);
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async (principalId) => createUserInvocation(await getAuthContext(db, principalId)),
      ownerId: "standalone-browser-manager" })).toBe("claimed");
    await expect(dialog.getByText(/目录发布已生效/)).toBeVisible();
    await expect(dialog.getByText(/正文已修改，旧预览已作废/)).toHaveCount(0);
    const subject = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${subjectId}`);
    expect(subject.body).toMatchObject({ item: { id: subjectId, canonicalName: compatible,
      definitionCounts: { active: 0 }, registration: { status: "unregistered" } } });
    await dialog.getByRole("button", { name: "新增参数定义", exact: true }).click();
    const definitionDialog = page.getByRole("dialog", { name: "向已发布主体新增定义", exact: true });
    await expect(definitionDialog).toBeVisible();
    await expect(definitionDialog.getByRole("combobox", { name: "已发布主体" })).toContainText(compatible);
    await expect(definitionDialog.getByLabel("属性键", { exact: true })).toBeVisible();
    await expect(definitionDialog.getByRole("radio")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await catalogScreenshot(page, testInfo, "standalone-return-to-definition");
    await definitionDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto(catalogAppUrl("/parameter-admin/modules"));
    await page.getByRole("button", { name: "新增主体", exact: true }).click();
    const schemaDialog = page.getByRole("dialog", { name: "新增主体", exact: true });
    await selectControlOption(schemaDialog.getByRole("combobox", { name: "主体类型" }), "configuration-schema");
    const schemaIdentity = `wiseeff.power-${Date.now().toString(36)}`;
    await schemaDialog.getByLabel("配置规范标识", { exact: true }).fill(schemaIdentity);
    await expect(schemaDialog.getByLabel("驱动性质", { exact: true })).toHaveCount(0);
    await expect(schemaDialog.getByLabel("实例基数", { exact: true })).toHaveCount(0);
    const schemaPreview = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v2/catalog/publication-candidates");
    await schemaDialog.getByRole("button", { name: "预览发布", exact: true }).click();
    await confirmGovernanceDialog(page, "确认预览");
    const schemaCandidateResponse = await schemaPreview;
    expect(schemaCandidateResponse.status()).toBe(201);
    const schemaCandidate = (await schemaCandidateResponse.json()).item;
    expect(schemaCandidate).toMatchObject({ capabilityContract: { revision: "catalog-capability/v5" },
      impactSummary: { addedDefinitionCount: 0, addedSubjectCount: 1 } });
    const schemaPublishing = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v2/catalog/publication-candidates/${schemaCandidate.id}/publish`);
    await schemaDialog.getByRole("button", { name: "发布到目录", exact: true }).click();
    await confirmGovernanceDialog(page, "确认发布");
    expect((await schemaPublishing).status()).toBe(201);
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async (principalId) => createUserInvocation(await getAuthContext(db, principalId)),
      ownerId: "standalone-schema-browser-manager" })).toBe("claimed");
    await expect(schemaDialog.getByText(/目录发布已生效/)).toBeVisible();
    await expect(schemaDialog.getByText(/正文已修改，旧预览已作废/)).toHaveCount(0);
    const schemaSubject = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${schemaCandidate.impactSummary.addedSubjectIds[0]}`);
    expect(schemaSubject.body).toMatchObject({ item: { type: "configuration-schema", canonicalName: schemaIdentity, definitionCounts: { active: 0 } } });
    await catalogScreenshot(page, testInfo, "standalone-configuration-schema");
  } finally {
    await db.close();
  }
});
