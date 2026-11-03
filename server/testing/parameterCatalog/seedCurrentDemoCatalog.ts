import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOwnedVendorCatalogSuccessor, VENDOR_OWNED_AGGREGATE_DIGEST, VENDOR_OWNED_RELEASE_ID } from "../../../scripts/compile-owned-vendor-catalog-release";
import { claimCatalogChildOwners } from "../../../scripts/catalog-claim-child-owners";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../../modules/catalog-kernel/install/currentPointer";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { publicationRegimeActive } from "../../modules/catalog-kernel/install/publicationActivation";
import { getRootPostgresPool, type Database } from "../../shared/database/client";
import { seedPublishedCatalog } from "./seedPublishedCatalog";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Fresh demo initialization only. Populated installations require the operator claim/publication workflow. */
export async function seedCurrentDemoCatalog(db: Database) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Current demo Catalog requires the root database.");
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind === "installed" && await publicationRegimeActive(pool)) return pointer.current;
  if (pointer.kind === "installed" && pointer.current.id === VENDOR_OWNED_RELEASE_ID
    && pointer.current.digest === VENDOR_OWNED_AGGREGATE_DIGEST) return pointer.current;

  // Refuse before even advancing the historical lineage of a populated database.
  const populated = await db.query<{ populated: boolean }>(`select
    exists(select 1 from parameter_catalog.organization_subject_registrations)
    or exists(select 1 from parameter_catalog.project_parameter_bindings)
    or exists(select 1 from parameter_catalog.parameter_observations) as populated`);
  if (populated.rows[0]?.populated) throw new Error("catalog-owned-seed-requires-empty-database: use the child-owner claim and publication workflow");

  const target = await compileOwnedVendorCatalogSuccessor(repoRoot);
  if (pointer.kind === "installed" && !target.bundle.releases.slice(0, -1).some(({ manifest }) =>
    manifest.release.id === pointer.current.id && manifest.release.digest === pointer.current.digest)) {
    throw new Error("catalog-owned-seed-unrecognized-predecessor");
  }
  await seedPublishedCatalog(pool);
  const schemasRoot = path.join(repoRoot, "schemas/dts");
  const claimOptions = { requireEmptyDemo: true, expectedReleaseId: target.predecessor.id };
  const preflight = await claimCatalogChildOwners(db, schemasRoot, false, claimOptions);
  if (!preflight.candidates.length || preflight.candidates.some((item) => item.status !== "ready" && item.status !== "already-claimed")) {
    throw new Error(`catalog-owned-seed-preflight:${JSON.stringify(preflight)}`);
  }
  const applied = await claimCatalogChildOwners(db, schemasRoot, true, claimOptions);
  if (applied.candidates.some((item) => item.status !== "claimed" && item.status !== "already-claimed")) {
    throw new Error(`catalog-owned-seed-claim:${JSON.stringify(applied)}`);
  }
  const installed = await installPublishedRelease(pool, {
    mode: "advance", source: jsonCatalogReleaseSource(target.bundle),
    expectedTargetDigest: target.compiled.aggregateDigest, expectedCurrent: target.predecessor,
  });
  if (!installed.ok) throw new Error(`catalog-owned-seed-${installed.error.kind}`);
  return target.compiled.release;
}
