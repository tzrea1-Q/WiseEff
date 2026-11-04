import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { catalogRuntimeTest as test } from "./helpers/catalogFixtureRuntime";
import { openCatalogAt, catalogScreenshot, confirmGovernanceDialog, CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { firstAcmePredecessor } from "../../server/modules/catalog-publication/builder/predecessorHarness";
import { refreshAuthoritativeSource } from "../../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler";
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
import { acceptanceCast } from "./helpers/cast";

test.use({ catalogRuntimeScope: import.meta.url, viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [...CATALOG_EXPECTED_API_FAILURES,
  { method: "GET", path: "/api/v2/catalog/publication-candidates", status: 404 }] });

test("publishes maintenance claims through the real UI, survives reload, and reports empty after activation", async ({ page, catalogRuntime }, testInfo) => {
  test.setTimeout(180_000);
  const db = createPostgresDatabase(catalogRuntime.databaseUrl), pool = getRootPostgresPool(db)!;
  try {
    await seedAcceptanceRoleMatrix();
    const first = firstAcmePredecessor();
    const template = first.first.documents.find(document => document.kind === "subject")!;
    const release = { ...structuredClone(first.first), documents: [...first.first.documents,
      { ...template, kind: "subject" as const, content: { id: "claimed_child", kind: "node-type" as const,
        canonicalKey: "node-type:claimed_child", lifecycle: "active" as const,
        selector: { kind: "node-type-name" as const, value: "claimed_child", provenance: { source: "owner-publication-test" } },
        subtype: {}, tombstone: null } }] };
    refreshAuthoritativeSource(release as Parameters<typeof refreshAuthoritativeSource>[0]);
    const bundle = { ...first.bundle, releases: [release] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled));
    expect((await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest })).ok).toBe(true);
    const actorId = acceptanceCast.acceptanceAdmin.userId;
    const pin = { id: compiled.value.release.id, digest: CatalogReleaseDigest(compiled.value.aggregateDigest) };
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
    await db.query("select parameter_catalog.claim_catalog_subject_owner('claimed_child','csub_acme_power')");

    await openCatalogAt(page, "org-admin");
    const entry = page.getByRole("button", { name: "发布已认领归属", exact: true });
    await entry.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "发布已认领归属", exact: true });
    await dialog.getByRole("button", { name: "预览待发布归属" }).click();
    await confirmGovernanceDialog(page, "确认预览");
    await expect(dialog.getByRole("table")).toContainText("claimed_child");
    await expect(dialog.getByRole("table")).toContainText("acme,power");
    expect(await dialog.locator(".confirm-dialog__scroll").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await catalogScreenshot(page, testInfo, "claimed-owners-preview-desktop");

    await dialog.getByText("审核已有归属候选", { exact: true }).click();
    await dialog.getByLabel("候选编号").fill("ccand_missing");
    await dialog.getByRole("button", { name: "读取待审核候选" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认发布归属" })).toBeDisabled();
    await catalogScreenshot(page, testInfo, "claimed-owners-read-failure-desktop");
    await dialog.getByRole("button", { name: "预览待发布归属" }).click();
    await confirmGovernanceDialog(page, "确认预览");
    await expect(dialog.getByRole("button", { name: "确认发布归属" })).toBeEnabled();
    await dialog.getByRole("button", { name: "确认发布归属" }).click();
    await confirmGovernanceDialog(page, "确认发布");
    await expect(dialog.getByRole("status").filter({ hasText: /入队|排队/ })).toBeVisible();
    await expect(dialog.getByText(/归属发布已生效/)).toHaveCount(0);
    await page.reload();
    await entry.click();
    await expect(dialog.getByRole("status").filter({ hasText: /入队|排队/ })).toBeVisible();
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async principalId => createUserInvocation(await getAuthContext(db, principalId)),
      ownerId: "claimed-owners-browser-manager" })).toBe("claimed");
    await expect(dialog.getByText(/归属发布已生效/)).toBeVisible({ timeout: 30_000 });
    await catalogScreenshot(page, testInfo, "claimed-owners-effective-desktop");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await entry.click();
    await dialog.getByRole("button", { name: "预览待发布归属" }).click();
    await confirmGovernanceDialog(page, "确认预览");
    await expect(dialog.getByText("没有待发布的已认领归属，无需创建新版本。")).toBeVisible();
  } finally { await db.close(); }
});
