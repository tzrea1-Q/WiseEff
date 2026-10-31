import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { test, catalogAppUrl } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, dismissXiaozeHint, CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { signInBrowserAsUser, authHeadersForUser } from "./helpers/bearerAuth";
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
import { catalogDefinitionListResponseSchema } from "../../server/modules/contracts/dtoSchemas/parameterCatalog";

test.use({ catalogRuntimeScope: import.meta.url });
useBrowserDiagnostics(test, { expectedApiFailures: [...CATALOG_EXPECTED_API_FAILURES,
  { method: "POST", path: "/api/v2/catalog/definition-replacements", status: 503 },
  { method: "POST", path: "/api/v2/catalog/definition-replacements", status: 409 }] });

test("#1309 platform administrator corrects an unused identity and separately retires the old Definition", async ({ page, catalogAcceptanceRuntime }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { runtime, fixture } = catalogAcceptanceRuntime;
  const db = createPostgresDatabase(runtime.databaseUrl), pool = getRootPostgresPool(db)!;
  // This seeded person has actual admin and platform-admin bindings; the token
  // does not inject Catalog capabilities or a fabricated project.
  const person = acceptanceCast.xuYun, actor = createUserInvocation(await getAuthContext(db, person.userId));
  const headers = authHeadersForUser(person.userId, person.email, person.name);
  const activate = () => runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
    resolvePublisherActor: async principalId => createUserInvocation(await getAuthContext(db, principalId)), ownerId: "issue1309-browser-manager" });
  try {
    const verification = await pool.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1", [fixture.chain.pinF.id]);
    const adopted = await adoptPreexistingCatalog(pool, { expectedCurrent: fixture.chain.pinF, actorPrincipalId: person.userId,
      sourceBytes: Buffer.from(JSON.stringify(retiredPowerSubjectSuccessorBundle())), artifactDigest: fixture.chain.pinF.digest,
      evidenceKind: "synthetic-fixture", adoptionEvidence: { source_bundle_digest: fixture.chain.pinF.digest,
        verification_digest: verification.rows[0]!.compiled_fingerprint, data_mode: "fresh", collected_at: new Date().toISOString(), approved_by: person.userId } });
    expect(adopted.ok).toBe(true);
    const snapshot = await collectPublicationPolicyInstanceSnapshot(db);
    const enabled = await revisePublicationPolicy(db, { trustedActor: actor, publicationEnabled: true, lowRiskSingleActorPublish: true,
      capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION, mode: "execute", managedInstance: {
        confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION, expectedDatabaseOid: snapshot.databaseOid,
        expectedCurrentId: fixture.chain.pinF.id, expectedCurrentDigest: fixture.chain.pinF.digest,
        expectedPolicyRevision: snapshot.policyRevision, expectedFrozen: snapshot.frozen, expectedAdopted: snapshot.adopted } });
    expect(enabled.ok).toBe(true);
    const propertyKey = `unused_${Date.now().toString(36)}`, occupiedKey = `${propertyKey}_occupied`, correctedKey = `${propertyKey}_corrected`;
    const created = await catalogJson(page.request, "POST", "/api/v2/catalog/publication-candidates", {
      headers: { ...headers, "X-WiseEff-Catalog-Release": fixture.chain.pinF.id }, data: { changeSet: [propertyKey, occupiedKey].map(key => ({
        op: "create-definition", subjectId: fixture.chargerSubjectId, propertyKey: key,
        content: { displayName: "未使用的纠错定义", documentation: "零项目身份纠错", valueSchema: { type: "integer", minimum: 0 } } })) } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const candidateId = (created.body as { item: { id: string } }).item.id;
    expect((await catalogJson(page.request, "POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { ...headers, "X-WiseEff-Catalog-Release": fixture.chain.pinF.id }, data: { idempotencyKey: propertyKey } })).status).toBe(201);
    expect(await activate()).toBe("claimed");
    const listed = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${fixture.chargerSubjectId}/definitions`, { headers });
    const definition = catalogDefinitionListResponseSchema.parse(listed.body).items.find(item => item.propertyKey === propertyKey)!;
    expect(definition).toBeDefined();
    await signInBrowserAsUser(page, person.userId, person.email, person.name,
      catalogAppUrl(`/parameter-admin/specs?subjectId=${fixture.chargerSubjectId}&definitionId=${definition.id}`));
    await dismissXiaozeHint(page);
    const editor = page.getByRole("region", { name: "定义详情" }), key = editor.getByLabel("属性键");
    await expect(key).toHaveValue(propertyKey);
    await key.focus(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type(occupiedKey);
    await editor.getByLabel("修改原因").fill("纠正尚无项目引用的参数身份");
    await editor.getByRole("button", { name: "预演影响" }).click();
    await expect(editor.getByRole("alert")).toContainText("目标身份已存在");
    await expect(editor.getByRole("link", { name: "查看已有定义" })).toHaveAttribute("href", /definitionId=/u);
    await expect(key).toHaveValue(occupiedKey);
    await editor.getByRole("link", { name: "查看已有定义" }).scrollIntoViewIfNeeded();
    await catalogScreenshot(page, testInfo, "issue1309-identity-collision");
    await key.focus(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type(correctedKey);
    await editor.getByRole("button", { name: "预演影响" }).click();
    await expect(editor.getByRole("region", { name: "纠错影响预览" })).toContainText("全平台当前引用");
    await expect(editor.getByRole("table", { name: "项目迁移预览" })).toHaveCount(0);
    await editor.getByRole("region", { name: "纠错影响预览" }).scrollIntoViewIfNeeded();
    await catalogScreenshot(page, testInfo, "issue1309-zero-project-preview");
    await editor.getByRole("button", { name: "确认并执行纠错" }).click();
    const confirmation = page.getByRole("dialog", { name: "确认执行身份纠错", exact: true });
    await expect(confirmation).toContainText("无需迁移项目");
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await editor.getByRole("button", { name: "确认并执行纠错" }).click();
    const queued = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v2/catalog/definition-replacements");
    await confirmation.getByRole("button", { name: "确认执行", exact: true }).focus(); await page.keyboard.press("Enter");
    expect((await queued).status()).toBe(503);
    expect(await activate()).toBe("claimed");
    await expect(editor.getByRole("region", { name: "纠错执行结果" })).toContainText("旧定义保持有效", { timeout: 30_000 });
    await expect(editor.getByRole("button", { name: "单独退役旧定义" })).toBeVisible();
    await editor.getByRole("region", { name: "纠错执行结果" }).scrollIntoViewIfNeeded();
    const old = await catalogJson(page.request, "GET", `/api/v2/catalog/definitions/${definition.id}`, { headers });
    expect(old.body).toMatchObject({ item: { propertyKey, lifecycle: "active", currentRevision: { id: definition.currentRevision.id } } });
    await catalogScreenshot(page, testInfo, "issue1309-completed-independent-retirement");
    await editor.getByRole("button", { name: "单独退役旧定义" }).click();
    const retirement = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "退役参数定义", exact: true }) });
    await expect(retirement).toBeVisible();
    await retirement.getByLabel("原因", { exact: true }).fill("单独退役已纠正且全平台无当前引用的旧身份");
    await retirement.getByRole("button", { name: "预演影响" }).click();
    const retireConfirm = page.getByRole("dialog", { name: "确认退役", exact: true });
    await expect(retireConfirm).toBeVisible();
    const retiredQueue = page.waitForResponse(response => response.request().method() === "POST" && /\/publication-candidates\/[^/]+\/publish$/u.test(new URL(response.url()).pathname));
    await retireConfirm.getByRole("button", { name: "确认退役", exact: true }).click();
    expect((await retiredQueue).status()).toBe(201);
    expect(await activate()).toBe("claimed");
    await expect(retirement).toContainText("已生效", { timeout: 30_000 });
    expect((await catalogJson(page.request, "GET", `/api/v2/catalog/definitions/${definition.id}`, { headers })).body)
      .toMatchObject({ item: { propertyKey, lifecycle: "retired" } });
    await catalogScreenshot(page, testInfo, "issue1309-independent-retirement-applied");
  } finally { await db.close(); }
});
