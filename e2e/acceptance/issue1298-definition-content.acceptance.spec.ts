import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { test } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, openCatalogAt, CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { acceptanceCast } from "./helpers/cast";
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
import { catalogDefinitionListResponseSchema, catalogDefinitionResponseSchema } from "../../server/modules/contracts/dtoSchemas/parameterCatalog";

useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

test("#1298 administrator clears published optional content and reads it back after refresh", async ({ page, catalogAcceptanceRuntime }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { runtime, fixture } = catalogAcceptanceRuntime;
  const db = createPostgresDatabase(runtime.databaseUrl);
  const pool = getRootPostgresPool(db)!;
  const actorId = acceptanceCast.acceptanceAdmin.userId;
  const actor = createUserInvocation(await getAuthContext(db, actorId));
  const activate = () => runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
    resolvePublisherActor: async (principalId) => createUserInvocation(await getAuthContext(db, principalId)),
    ownerId: "issue1298-browser-manager" });
  try {
    // Only this fixture-owned database is adopted and enabled. Missing publication
    // capability is a setup failure, never a conditional pass or skip.
    const verification = await pool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1", [fixture.chain.pinF.id]);
    expect(verification.rows[0]?.compiled_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const adopted = await adoptPreexistingCatalog(pool, {
      expectedCurrent: fixture.chain.pinF, actorPrincipalId: actorId,
      sourceBytes: Buffer.from(JSON.stringify(retiredPowerSubjectSuccessorBundle())),
      artifactDigest: fixture.chain.pinF.digest, evidenceKind: "synthetic-fixture",
      adoptionEvidence: { source_bundle_digest: fixture.chain.pinF.digest,
        verification_digest: verification.rows[0]!.compiled_fingerprint, data_mode: "fresh",
        collected_at: new Date().toISOString(), approved_by: actorId },
    });
    expect(adopted.ok).toBe(true);
    const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    const enabled = await revisePublicationPolicy(db, { trustedActor: actor, publicationEnabled: true,
      lowRiskSingleActorPublish: true, capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
      mode: "execute", managedInstance: { confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
        expectedDatabaseOid: snapshot.databaseOid, expectedCurrentId: fixture.chain.pinF.id,
        expectedCurrentDigest: fixture.chain.pinF.digest, expectedPolicyRevision: snapshot.policyRevision,
        expectedFrozen: snapshot.frozen, expectedAdopted: snapshot.adopted } });
    expect(enabled.ok).toBe(true);
    await openCatalogAt(page, "org-admin");
    const surface = await catalogJson(page.request, "GET", "/api/v2/catalog/publication-surface");
    expect(surface.status).toBe(200);
    expect(surface.body).toMatchObject({ item: { authoringAllowed: true, publishingAllowed: true } });

    const propertyKey = `clear_content_${Date.now().toString(36)}`;
    const created = await catalogJson(page.request, "POST", "/api/v2/catalog/publication-candidates", {
      headers: { "X-WiseEff-Catalog-Release": fixture.chain.pinF.id },
      data: { changeSet: [{ op: "create-definition", subjectId: fixture.chargerSubjectId, propertyKey,
        content: { displayName: "可清空的电流定义", documentation: "原有说明", description: "保留的隐藏描述",
          unit: "mA", valueSchema: { type: "integer", minimum: 0 }, examples: [100, 200] } }] },
    });
    expect(created.status).toBe(201);
    const candidateId = (created.body as { item: { id: string } }).item.id;
    const published = await catalogJson(page.request, "POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { "X-WiseEff-Catalog-Release": fixture.chain.pinF.id }, data: { idempotencyKey: propertyKey },
    });
    expect(published.status).toBe(201);
    expect(await activate()).toBe("claimed");
    const listed = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${fixture.chargerSubjectId}/definitions`);
    expect(listed.status).toBe(200);
    const definition = catalogDefinitionListResponseSchema.parse(listed.body).items.find((item) => item.propertyKey === propertyKey);
    expect(definition).toBeDefined();
    const definitionId = definition!.id;
    const route = `?subjectId=${fixture.chargerSubjectId}&definitionId=${definitionId}`;
    await openCatalogAt(page, "org-admin", route);
    const editor = page.getByRole("region", { name: "定义详情" });
    await expect(editor.getByLabel("单位")).toHaveValue("mA");
    const examples = editor.getByLabel("示例（JSON 数组）");
    await expect(examples).toHaveValue("[100,200]");
    await examples.fill("[invalid");
    await editor.getByLabel("修改原因").fill("清除错误的单位与示例");
    await editor.getByRole("button", { name: "保存内容修订" }).click();
    await expect(editor.getByText("示例必须为有效的 JSON 数组，当前输入已保留。")).toBeVisible();
    await expect(examples).toHaveValue("[invalid");
    await editor.getByLabel("单位").focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await examples.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await expect(editor.getByText(/本次将移除：单位、示例/)).toBeVisible();
    await catalogScreenshot(page, testInfo, "issue1298-optional-content-removal-preview");
    const queued = page.waitForResponse((response) => response.request().method() === "POST" && /\/publication-candidates\/[^/]+\/publish$/u.test(new URL(response.url()).pathname));
    await editor.getByRole("button", { name: "保存内容修订" }).click();
    expect((await queued).status()).toBe(201);
    expect(await activate()).toBe("claimed");
    await expect(editor.getByRole("region", { name: "内容修订结果" })).toContainText("已生效", { timeout: 30_000 });
    await page.reload();
    await expect(editor.getByLabel("单位")).toHaveValue("");
    await expect(editor.getByLabel("示例（JSON 数组）")).toHaveValue("");
    const read = await catalogJson(page.request, "GET", `/api/v2/catalog/definitions/${definitionId}`);
    expect(read.status).toBe(200);
    const current = catalogDefinitionResponseSchema.parse(read.body).item;
    expect(current.currentRevision).toMatchObject({ revisionNumber: 2, unit: null, examples: [], documentation: "原有说明" });
    const history = await catalogJson(page.request, "GET", `/api/v2/catalog/definitions/${definitionId}/revisions/${definition!.currentRevision.id}`);
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ item: { revisionNumber: 1, unit: { symbol: "mA" }, examples: [100, 200] } });
    await catalogScreenshot(page, testInfo, "issue1298-optional-content-removal-reread");
  } finally {
    await db.close();
  }
});
