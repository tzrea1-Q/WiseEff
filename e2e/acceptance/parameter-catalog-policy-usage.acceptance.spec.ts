import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  assertNoPageOverflow,
  catalogJson,
  catalogPage,
  catalogScreenshot,
  openCatalogAt,
  waitForCatalogState,
} from "./helpers/catalogBrowser";
import { ensureCatalogAcceptanceFixture } from "./helpers/catalogEvidence";
import { acceptanceCast } from "./helpers/cast";
import { loadOwnedRuntimeDescriptorFromEnv } from "./helpers/ownedRuntimeDescriptor";
import { compileOrThrow, retiredPowerSubjectSuccessorBundle } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { asQueryable } from "../../server/modules/catalog-kernel/install/publicationActivation";
import { adoptPreexistingCatalog } from "../../server/modules/catalog-publication/runtime/adoption";
import { inspectPublicationPolicy, revisePublicationPolicy } from "../../server/modules/catalog-publication/authorization/policy";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../../server/modules/catalog-publication/builder/types";
import { getAuthContext } from "../../server/modules/auth/repository";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, {
  expectedApiFailures: [{ method: "GET", path: "/api/v1/parameters/projects", status: 404 }],
});

test.beforeAll(async () => {
  // Publication setup is permitted only in a fully verified disposable owned runtime.
  expect(loadOwnedRuntimeDescriptorFromEnv(process.env)).toBeDefined();
  const fixture = await ensureCatalogAcceptanceFixture();
  const db = asQueryable(fixture.pool);
  const actorId = acceptanceCast.acceptanceAdmin.userId;
  const bundle = retiredPowerSubjectSuccessorBundle();
  const compiled = compileOrThrow(bundle);
  const adopted = await adoptPreexistingCatalog(fixture.pool, {
    expectedCurrent: fixture.chain.pinF,
    actorPrincipalId: actorId,
    sourceBytes: Buffer.from(JSON.stringify(bundle)),
    artifactDigest: fixture.chain.pinF.digest,
    evidenceKind: "synthetic-fixture",
    adoptionEvidence: {
      source_bundle_digest: fixture.chain.pinF.digest,
      verification_digest: compiled.materializationFingerprint,
      data_mode: "fresh",
      collected_at: new Date().toISOString(),
      approved_by: actorId,
    },
  });
  expect(adopted).toMatchObject({ ok: true });
  const snapshot = await inspectPublicationPolicy(db);
  const enabled = await revisePublicationPolicy(db, {
    trustedActor: createUserInvocation(await getAuthContext(db, actorId)),
    publicationEnabled: true,
    lowRiskSingleActorPublish: false,
    capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
    mode: "execute",
    managedInstance: {
      confirmation: "managed-instance-policy-revision",
      expectedDatabaseOid: snapshot.databaseOid,
      expectedCurrentId: fixture.chain.pinF.id,
      expectedCurrentDigest: fixture.chain.pinF.digest,
      expectedPolicyRevision: snapshot.policyRevision,
      expectedFrozen: snapshot.frozen,
      expectedAdopted: snapshot.adopted,
    },
  });
  expect(enabled).toMatchObject({ ok: true });
});

test("shows unavailable Policy usage through real API details and lifecycle confirmation", async ({ page }, testInfo) => {
  // Issue #815 R2-U07: a local API/PostgreSQL browser check, not Policy counting proof.
  await openCatalogAt(page, "org-admin");
  await waitForCatalogState(page, "ready");
  const region = catalogPage(page);
  await expect(region).toHaveAttribute("data-writes-enabled", "true");
  const result = await catalogJson(page.request, "GET", "/api/v2/catalog/definitions");
  expect(result.status).toBe(200);
  const definitions = (result.body as { items: { usageSummary: { policyCount: number | null } }[] }).items;
  expect(definitions.length).toBeGreaterThan(0);
  for (const definition of definitions) expect(definition.usageSummary.policyCount).toBeNull();

  const table = region.getByRole("table", { name: "参数定义列表" });
  const row = table.getByRole("row").filter({ has: table.getByRole("button", { name: /^弃用 /u }) }).first();
  await row.getByRole("button", { name: /^编辑 /u }).click();
  const editor = page.getByRole("dialog");
  await editor.getByText("更多信息", { exact: true }).click();
  await expect(editor.getByText(/策略使用量暂不可用/).first()).toBeVisible();
  await expect(editor).not.toContainText(/策略 (?:0|null)/u);
  await assertNoPageOverflow(page);
  await catalogScreenshot(page, testInfo, "policy-usage-editor");
  await editor.getByRole("button", { name: /关闭/ }).click();

  await row.getByRole("button", { name: /^弃用 /u }).click();
  const lifecycle = page.getByRole("dialog");
  await expect(lifecycle).toContainText("策略使用量暂不可用");
  await lifecycle.getByLabel("原因").fill("Issue 815 unavailable usage verification");
  await lifecycle.getByRole("button", { name: "预演影响" }).click();
  const confirmation = page.getByRole("dialog", { name: "确认弃用" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("策略使用量暂不可用");
  await expect(confirmation).not.toContainText(/策略 (?:0|null)/u);
  await expect(confirmation.getByRole("button", { name: "确认弃用" })).toBeEnabled();
  await assertNoPageOverflow(page);
  await catalogScreenshot(page, testInfo, "policy-usage-confirmation");
  await testInfo.attach("policy-usage-accessibility", { body: await confirmation.ariaSnapshot(), contentType: "text/plain" });
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(confirmation).toHaveCount(0);
});
