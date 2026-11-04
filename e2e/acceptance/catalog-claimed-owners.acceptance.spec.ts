import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import { expect, type Page } from "playwright/test";
import { catalogRuntimeTest as test } from "./helpers/catalogFixtureRuntime";
import { openCatalogAt, catalogScreenshot, CATALOG_EXPECTED_API_FAILURES } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { firstAcmePredecessor } from "../../server/modules/catalog-publication/builder/predecessorHarness";
import { refreshAuthoritativeSource } from "../../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { installPublishedRelease, createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { persistArtifact } from "../../server/modules/catalog-publication/persistence/store";
import { enablePublicationPolicy } from "../../server/modules/catalog-publication/authorization/testHarness";
import { runPublicationManagerOnce } from "../../server/modules/catalog-publication/jobs/manager";
import { CatalogArtifactId, CatalogReleaseDigest } from "../../server/modules/parameter-catalog-contract";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { getAuthContext } from "../../server/modules/auth/repository";

test.use({ catalogRuntimeScope: import.meta.url, viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [...CATALOG_EXPECTED_API_FAILURES,
  { method: "GET", path: "/api/v2/catalog/publication-candidates", status: 404 }] });

async function confirm(page: Page, action: "preview" | "publish") {
  const dialog = page.getByRole("dialog", { name: action === "preview" ? "确认预览发布候选" : "确认发布到目录" });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: action === "preview" ? "确认预览" : "确认发布" }).click();
}

test("publishes maintenance claims through the real UI, survives reload, and reports empty after activation", async ({ page, catalogRuntime }, testInfo) => {
  test.setTimeout(180_000);
  const db = createPostgresDatabase(catalogRuntime.databaseUrl), pool = getRootPostgresPool(db)!;
  const client = new pg.Client({ connectionString: catalogRuntime.databaseUrl });
  try {
    await client.connect();
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
    expect((await persistArtifact(db, { id: CatalogArtifactId("cart_claimed_owner_browser_base"),
      artifactDigest: compiled.value.aggregateDigest, artifactBytes: Buffer.from(JSON.stringify(bundle)), sourceKind: "repository-bundle",
      targetReleaseId: compiled.value.release.id, targetReleaseDigest: CatalogReleaseDigest(compiled.value.aggregateDigest),
      predecessorReleaseId: null, predecessorReleaseDigest: null, toolchain: { ...release.manifest.toolchain } })).ok).toBe(true);
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: false });
    await db.query("select parameter_catalog.claim_catalog_subject_owner('claimed_child','csub_acme_power')");

    await openCatalogAt(page, "org-admin");
    const entry = page.getByRole("button", { name: "发布已认领归属", exact: true });
    await entry.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "发布已认领归属", exact: true });
    await dialog.getByRole("button", { name: "预览待发布归属" }).click();
    await confirm(page, "preview");
    await expect(dialog.getByRole("table")).toContainText("claimed_child");
    await expect(dialog.getByRole("table")).toContainText("acme,power");
    await catalogScreenshot(page, testInfo, "claimed-owners-preview-desktop");

    await dialog.getByText("审核已有归属候选", { exact: true }).click();
    await dialog.getByLabel("候选编号").fill("ccand_missing");
    await dialog.getByRole("button", { name: "读取待审核候选" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认发布归属" })).toBeDisabled();
    await catalogScreenshot(page, testInfo, "claimed-owners-read-failure-desktop");
    await dialog.getByRole("button", { name: "预览待发布归属" }).click();
    await confirm(page, "preview");
    await expect(dialog.getByRole("button", { name: "确认发布归属" })).toBeEnabled();
    await dialog.getByRole("button", { name: "确认发布归属" }).click();
    await confirm(page, "publish");
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
    await confirm(page, "preview");
    await expect(dialog.getByText("没有待发布的已认领归属，无需创建新版本。")).toBeVisible();
  } finally { await client.end(); await db.close(); }
});
