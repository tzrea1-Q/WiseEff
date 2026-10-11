import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { validCatalogReleaseBundle } from "./../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle.ts";
import { compileCatalogRelease } from "./../server/modules/catalog-kernel/compiler/index.ts";
import { installFirstCatalogRelease } from "./install-catalog-release.ts";
import { provisionPublicationRuntimeLogins } from "./../server/modules/catalog-publication/runtime/provisionRuntimeLogins.ts";
import { writeRuntimeLoginSecrets } from "./../server/modules/catalog-publication/runtime/runtimeLoginSecrets.ts";
import { adoptPreexistingCatalog, checkAdoptPreexistingCatalog } from "./../server/modules/catalog-publication/runtime/adoption.ts";
import { runCatalogPublicationOps } from "./catalog-publication-ops.ts";
import { createPostgresDatabase } from "./../server/shared/database/client.ts";
import { ensureIpLabAdmin } from "./../ops/self-hosted/scripts/provision-ip-lab.ts";
import { getAuthContext } from "./../server/modules/auth/repository.ts";
import { createUserInvocation } from "./../server/modules/auth/trustedInvocation.ts";
import { inspectPublicationPolicy, checkPublicationPolicyRevision, revisePublicationPolicy } from "./../server/modules/catalog-publication/authorization/policy.ts";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "./../server/modules/catalog-publication/authorization/types.ts";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "./../server/modules/catalog-publication/builder/types.ts";
import { createObjectStoreFromEnv } from "./../server/objectStoreFactory.ts";
import { loadServerEnv } from "./../server/config/env.ts";

const bootstrapUrl = process.env.WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL;
assert.ok(bootstrapUrl);
process.env.DATABASE_URL = bootstrapUrl;
const db = createPostgresDatabase(bootstrapUrl);
const pool = new pg.Pool({ connectionString: bootstrapUrl });
try {
  const actor = (await db.query("select user_id from user_password_credentials where username=$1", ["admin.ops"])).rows[0].user_id;
  const reviewer = await ensureIpLabAdmin(db, { username: "rehearsal.reviewer", password: randomBytes(24).toString("hex"), name: "Preserved rehearsal reviewer" });
  await ensureIpLabAdmin(db, { username: "rehearsal.account", password: randomBytes(24).toString("hex"), name: "Preserved rehearsal account" });
  const compatibilityRelations = [];
  for (const relation of ["parameter_definitions", "project_parameter_values"]) {
    const present = (await pool.query("select to_regclass($1) as active, to_regclass($2) as retired", [`public.${relation}`, `public.legacy_${relation}`])).rows[0];
    if (!present.active && present.retired) {
      await pool.query(`create table public.${relation} (like public.legacy_${relation} including all)`);
      compatibilityRelations.push(relation);
    }
  }
  const store = createObjectStoreFromEnv(loadServerEnv(process.env));
  for (const [fileName, contentType] of [["charging-foldback.log", "text/plain"], ["unsupported.bin", "application/octet-stream"]]) {
    const bytes = readFileSync(`/app/test-fixtures/logs/${fileName}`);
    const stored = await store.put({ organizationId: "org-chargelab", fileName, contentType, bytes });
    const original = (await pool.query("select storage_key, checksum_sha256 from log_file_objects where file_name=$1", [fileName])).rows;
    assert.ok(original.length > 0);
    assert.ok(original.every(row => row.storage_key === stored.storageKey && row.checksum_sha256 === stored.checksumSha256));
  }
  const bundle = validCatalogReleaseBundle();
  bundle.targetReleaseId = bundle.releases[0].manifest.release.id;
  bundle.releases = bundle.releases.slice(0, 1);
  const compiled = compileCatalogRelease(bundle);
  assert.equal(compiled.ok, true);
  assert.equal(Number((await pool.query("select count(*) from parameter_catalog.catalog_state")).rows[0].count), 0);
  await installFirstCatalogRelease(pool, bundle, compiled.value.aggregateDigest);
  const provisioned = await provisionPublicationRuntimeLogins(bootstrapUrl, { mode: "official" });
  writeRuntimeLoginSecrets({ directory: "/tmp/rehearsal-credentials", ...provisioned });
  const state = (await pool.query("select release.id, release.release_digest as digest from parameter_catalog.catalog_state state join parameter_catalog.catalog_releases release on release.id=state.current_catalog_release_id")).rows[0];
  const fingerprint = (await pool.query("select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1", [state.id])).rows[0].compiled_fingerprint;
  const manager = new pg.Pool({ connectionString: provisioned.managerUrl });
  try {
    const input = { expectedCurrent: state, actorPrincipalId: actor, sourceBytes: Buffer.from(JSON.stringify(bundle)), artifactDigest: state.digest, evidenceKind: "synthetic-fixture", adoptionEvidence: { source_bundle_digest: state.digest, verification_digest: fingerprint, data_mode: "fresh", collected_at: new Date().toISOString(), approved_by: actor } };
    assert.equal((await checkAdoptPreexistingCatalog(manager, input)).ok, true);
    assert.equal((await adoptPreexistingCatalog(manager, input)).ok, true);
  } finally {
    await manager.end();
  }
  for (const userId of [actor, reviewer.userId]) {
    for (const capability of ["catalog:author", "catalog:publish", "catalog:review-high-risk"]) {
      const result = await runCatalogPublicationOps({ name: "capabilities", action: "grant", userId, organizationId: "org-chargelab", capability });
      assert.equal(result.exitCode, 0);
    }
  }
  const snapshot = await inspectPublicationPolicy(db);
  const policyInput = { trustedActor: createUserInvocation(await getAuthContext(db, actor)), publicationEnabled: true, lowRiskSingleActorPublish: false, capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION, mode: "execute", managedInstance: { confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION, expectedDatabaseOid: snapshot.databaseOid, expectedCurrentId: snapshot.currentReleaseId, expectedCurrentDigest: snapshot.currentReleaseDigest, expectedPolicyRevision: snapshot.policyRevision, expectedFrozen: snapshot.frozen, expectedAdopted: true } };
  const checked = await checkPublicationPolicyRevision(db, policyInput);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.refusals, []);
  assert.equal((await revisePublicationPolicy(db, policyInput)).ok, true);
  assert.equal(Number((await pool.query("select count(*) from parameter_catalog.catalog_activation_receipts")).rows[0].count), 1);
  console.log(JSON.stringify({ actor, reviewer: reviewer.userId, adoption: state, receipts: 1, synthetic: true, compatibilityRelations, uploadedSeedLogObjects: 2 }));
} finally {
  await pool.end();
  await db.close();
}
