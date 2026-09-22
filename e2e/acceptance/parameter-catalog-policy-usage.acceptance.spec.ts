import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import pg from "pg";
import type { CatalogDefinitionResponse } from "../../src/infrastructure/http/parameterCatalogDtos";
import type { CatalogReleaseBundle } from "../../server/modules/catalog-kernel/compiler/types";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  assertNoPageOverflow,
  catalogJson,
  catalogPage,
  catalogScreenshot,
  openCatalogAt,
  waitForCatalogState,
} from "./helpers/catalogBrowser";
import { catalogLaneConnectionString } from "./helpers/catalogAcceptanceEnvironment";
import { acceptanceCast } from "./helpers/cast";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { loadOwnedRuntimeDescriptorFromEnv } from "./helpers/ownedRuntimeDescriptor";
import { documentationOnlySuccessorBundle, installPublishedCatalogChain } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
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

let pool: pg.Pool;
test.afterAll(async () => { await pool?.end(); });
test.beforeAll(async () => {
  // Publication setup is permitted only in a fully verified disposable owned runtime.
  expect(loadOwnedRuntimeDescriptorFromEnv(process.env)).toBeDefined();
  pool = new pg.Pool({ connectionString: await catalogLaneConnectionString() });
  await seedAcceptanceRoleMatrix();
  // The generic OP-08 fixture retires this subject; lifecycle preview needs the active C fixture.
  const chain = await installPublishedCatalogChain(pool);
  const db = asQueryable(pool);
  const actorId = acceptanceCast.acceptanceAdmin.userId;
  const bundle = documentationOnlySuccessorBundle();
  const adopted = await adoptPreexistingCatalog(pool, {
    expectedCurrent: chain.pinC,
    actorPrincipalId: actorId,
    sourceBytes: Buffer.from(JSON.stringify(bundle)),
    artifactDigest: chain.pinC.digest,
    evidenceKind: "synthetic-fixture",
    adoptionEvidence: {
      source_bundle_digest: chain.pinC.digest,
      verification_digest: chain.compiledC.materializationFingerprint,
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
      expectedCurrentId: chain.pinC.id,
      expectedCurrentDigest: chain.pinC.digest,
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
  const definitions = (result.body as { items: CatalogDefinitionResponse["item"][] }).items;
  expect(definitions.length).toBeGreaterThan(0);
  for (const definition of definitions) expect(definition.usageSummary.policyCount).toBeNull();

  const table = region.getByRole("table", { name: "参数定义列表" });
  const definition = definitions.find((item) => item.propertyKey === "iin_max")!;
  expect(definition).toBeDefined();
  const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: "弃用 iin_max", exact: true }) });
  await row.getByRole("button", { name: /^编辑 /u }).click();
  const editor = page.getByRole("dialog");
  await editor.getByText("更多信息", { exact: true }).click();
  await expect(editor.getByText(/策略使用量暂不可用/).first()).toBeVisible();
  await editor.getByText(/策略使用量暂不可用/).first().scrollIntoViewIfNeeded();
  await expect(editor).not.toContainText(/策略 (?:0|null)/u);
  await assertNoPageOverflow(page);
  await catalogScreenshot(page, testInfo, "policy-usage-editor");
  await editor.getByRole("button", { name: /关闭/ }).click();

  await row.getByRole("button", { name: /^弃用 /u }).click();
  const lifecycle = page.getByRole("dialog");
  await expect(lifecycle).toContainText("策略使用量暂不可用");
  await lifecycle.getByLabel("原因").fill("Issue 815 unavailable usage verification");
  await expect(lifecycle.getByRole("button", { name: "预演影响" })).toBeEnabled();
  const previewResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/v2/catalog/publication-candidates");
  await lifecycle.getByRole("button", { name: "预演影响" }).click();
  const preview = await previewResponse;
  expect(preview.status()).toBe(201);
  const submitted = preview.request().postDataJSON();
  expect(submitted.changeSet).toHaveLength(1);
  expect(submitted.changeSet[0]).toMatchObject({
    op: "retire-definition",
    definitionId: definition.id,
    content: {
      displayName: definition.currentRevision.displayName,
      documentation: definition.currentRevision.documentation ?? "",
      unit: definition.currentRevision.unit?.symbol,
      valueSchema: definition.currentRevision.valueShape.schema,
    },
  });
  expect(submitted.changeSet[0].content.valueSchema).toEqual(definition.currentRevision.valueShape.schema);
  const candidate = await preview.json();
  const stored = await pool.query<{ artifact_bytes: Buffer }>(
    `select a.artifact_bytes from catalog_publication.candidates c
     join catalog_publication.release_artifacts a on a.id = c.artifact_id where c.id = $1`,
    [candidate.item.id],
  );
  expect(stored.rowCount).toBe(1);
  const bundle = JSON.parse(stored.rows[0]!.artifact_bytes.toString("utf8")) as CatalogReleaseBundle;
  const successor = bundle.releases.find((release) => release.manifest.release.id === bundle.targetReleaseId);
  const revised = successor?.documents.find((document) => document.kind === "definition" && document.content.id === definition.id);
  if (!revised || revised.kind !== "definition") throw new Error("Preview artifact is missing the target definition");
  expect(revised.content.revision.lifecycle).toBe("retired");
  expect(revised.content.revision.valueSchema).toEqual(definition.currentRevision.valueShape.schema);
  expect(revised.content.revision.unit).toBe(definition.currentRevision.unit?.symbol);
  expect(revised.content.revision.displayName).toBe(definition.currentRevision.displayName);
  expect(revised.content.revision.documentation).toBe(definition.currentRevision.documentation);
  await testInfo.attach("policy-usage-preview", {
    body: JSON.stringify({ status: preview.status(), request: submitted, response: candidate, storedRevision: revised.content.revision }, null, 2),
    contentType: "application/json",
  });
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
