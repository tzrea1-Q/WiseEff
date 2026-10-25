import "./helpers/loadAcceptanceEnvironment";
import pg from "pg";
import { expect } from "playwright/test";
import { catalogAppUrl, catalogRuntimeTest as test } from "./helpers/catalogFixtureRuntime";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { selectControlOption } from "./helpers/selectControl";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { CATALOG_EXPECTED_API_FAILURES, catalogJson, catalogScreenshot } from "./helpers/catalogBrowser";
import { placementReplacementBundle, PLACEMENT_PEER_SUBJECT_ID } from "./helpers/placementReplacementFixture";
import { refreshReleaseSource, SUBJECT_ID } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler/index";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";

test.use({ viewport: { width: 1440, height: 900 }, catalogRuntimeScope: import.meta.url });
useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

test("removes and restores unregistered drivers with and without definitions in the current Organization", async ({ page, catalogRuntime }, testInfo) => {
  // @acceptance PCAT-UI-07
  // @operation PCAT-REGISTRATION-001
  const pool = new pg.Pool({ connectionString: catalogRuntime.databaseUrl });
  try {
    const bundle = placementReplacementBundle();
    const release = bundle.releases[0];
    release.documents = release.documents.filter(document => document.kind !== "definition" || document.content.subjectId !== PLACEMENT_PEER_SUBJECT_ID);
    refreshReleaseSource(release);
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest });
    expect(installed.ok).toBe(true);
    await signInBrowserAsRole(page, "admin", catalogAppUrl("/parameter-admin/modules"));
    for (const [subjectId, definitions] of [[SUBJECT_ID, 1], [PLACEMENT_PEER_SUBJECT_ID, 0]] as const) {
      const row = page.locator(`[data-canonical-subject-id="${subjectId}"]`);
      await expect(row).toContainText("未登记");
      await row.getByRole("button", { name: /^移除驱动：/ }).click();
      const dialog = page.getByRole("dialog", { name: "移除驱动", exact: true });
      await expect(dialog).toContainText(`目录中有 ${definitions} 个有效定义`);
      await expect(dialog).toContainText("平台共享定义及其他组织的登记不受影响");
      await dialog.getByRole("textbox", { name: "操作原因" }).fill("本组织不再使用此主体");
      const confirm = dialog.getByRole("button", { name: "确认移除", exact: true });
      await expect(confirm).toBeDisabled();
      await dialog.getByRole("checkbox").focus();
      await page.keyboard.press("Space");
      await catalogScreenshot(page, testInfo, `unregistered-removal-${definitions}-definitions`);
      const removing = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v2/organizations/org-chargelab/subject-registrations");
      await confirm.focus();
      await page.keyboard.press("Enter");
      const removed = await removing;
      expect(removed.status(), await removed.text()).toBe(201);
      expect(removed.request().postDataJSON()).toMatchObject({ subjectId, status: "retired" });
      const registration = (await removed.json()).item;
      expect(registration).toMatchObject({ status: "retired", placement: { parentPlacementId: null } });
      expect(registration.placement.moduleId ?? null).toBeNull();
      await expect(row).toHaveCount(0);
      await selectControlOption(page.getByRole("combobox", { name: "筛选登记状态" }), "retired");
      await row.getByRole("button", { name: /^恢复驱动：/ }).click();
      const restore = page.getByRole("dialog", { name: "恢复驱动", exact: true });
      await expect(restore).toContainText("恢复后请调整归属");
      await restore.getByRole("textbox", { name: "操作原因" }).fill("重新启用并分配模块");
      await restore.getByRole("checkbox").check();
      const restoring = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/${registration.id}/restore`));
      await restore.getByRole("button", { name: "确认恢复", exact: true }).click();
      expect((await restoring).status()).toBe(200);
      await selectControlOption(page.getByRole("combobox", { name: "筛选登记状态" }), "all");
      await expect(row).toContainText("未分配模块");
      await expect(row.getByRole("button", { name: /^调整归属：/ })).toBeEnabled();
      const reread = await catalogJson(page.request, "GET", `/api/v2/catalog/subjects/${subjectId}`, { headers: authHeadersForRole("admin") });
      expect(reread.status).toBe(200);
      expect(reread.body).toMatchObject({ item: { membership: { status: "active", catalogReleaseId: compiled.value.release.id },
        definitionCounts: { active: definitions }, registration: { status: "active", id: registration.id } } });
    }
  } finally {
    await pool.end();
  }
});
