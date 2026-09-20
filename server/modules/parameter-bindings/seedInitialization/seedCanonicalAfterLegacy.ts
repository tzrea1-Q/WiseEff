/**
 * After M1 topology seed, publish the vendor Catalog (if empty) and sync
 * canonical current bindings onto existing config revisions.
 *
 * Does not archive the topology plane. Placement shortage still fail-closes.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import type { AuthContext } from "../../auth/types";
import {
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
  compileVendorCatalogSuccessor,
} from "../../../../scripts/compile-vendor-catalog-release";
import { firstReleaseBundle } from "../../../testing/parameterCatalog/cutoverPopulatedFixture";
import {
  getRootPostgresPool,
  type Database,
} from "../../../shared/database/client";
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";
import {
  ensureSeedSubjectRegistrations,
  observedSubjectsWithDefinitions,
} from "./registration";
import { SeedInitializationBlockedError } from "./plan";
import {
  asValueClient,
  listObservedProperties,
  loadPublishedCatalog,
  syncPublishedCatalogProjectValues,
} from "../catalogProjectValueSync";

const TARGET_PROJECTS = ["atlas", "aurora", "nebula"] as const;

export type CanonicalAfterLegacyResult = {
  readonly catalogReleaseId: string | null;
  readonly written: Readonly<Record<string, number>>;
  readonly skipped: readonly string[];
};

const repoRootFromHere = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function ensureCanonicalCatalogAfterLegacySeed(
  db: Database,
  auth: AuthContext,
  input: { readonly organizationId: string; readonly seedDigest: string },
): Promise<CanonicalAfterLegacyResult> {
  const pool = getRootPostgresPool(db);
  if (!pool) {
    throw new Error("Canonical seed sync requires the root database.");
  }

  await curateReviewedSeedPlacementCapacity(db, { organizationId: input.organizationId });

  let pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind === "empty") {
    const acmeBundle = firstReleaseBundle();
    const acmeCompiled = compileCatalogRelease(acmeBundle);
    if (!acmeCompiled.ok) {
      throw new Error(`Acme catalog compile failed: ${acmeCompiled.error.kind}`);
    }
    const bootstrapped = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(acmeBundle),
      expectedTargetDigest: acmeCompiled.value.release.digest,
    });
    if (!bootstrapped.ok) {
      throw new Error(`Acme catalog bootstrap failed: ${JSON.stringify(bootstrapped)}`);
    }
    const vendor = compileVendorCatalogSuccessor(repoRootFromHere());
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(vendor.bundle),
      expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      expectedCurrent: {
        id: FIRST_ACME_RELEASE_ID,
        digest: FIRST_ACME_RELEASE_DIGEST,
      } as never,
    });
    if (!advanced.ok) {
      throw new Error(`Vendor catalog advance failed: ${JSON.stringify(advanced)}`);
    }
    pointer = await readCurrentCatalogPointer(pool);
  }

  const snapshot = await loadPublishedCatalog(pool);
  if (!snapshot || pointer.kind !== "installed") {
    return { catalogReleaseId: null, written: {}, skipped: [...TARGET_PROJECTS] };
  }

  const written: Record<string, number> = {};
  const skipped: string[] = [];
  const blocks: Array<{ projectId: string; subjectId: string; reason: "missing-placement-module"; detail: string }> = [];
  const staged: Array<{ projectId: string; configSetId: string; revisionId: string }> = [];

  for (const projectId of TARGET_PROJECTS) {
    const revision = await db.query<{ id: string; config_set_id: string }>(
      `select id, config_set_id
         from dts_config_revisions
        where organization_id = $1
          and project_id = $2
          and status <> 'resolving'
        order by revision_number desc
        limit 1`,
      [input.organizationId, projectId],
    );
    const row = revision.rows[0];
    if (!row) {
      skipped.push(projectId);
      continue;
    }
    const observed = observedSubjectsWithDefinitions(
      snapshot,
      await listObservedProperties(asValueClient(pool), row.id),
    );
    const registration = await ensureSeedSubjectRegistrations(db, auth, {
      organizationId: input.organizationId,
      currentRelease: { id: snapshot.release.id, digest: snapshot.release.digest },
      subjects: observed,
      seedDigest: input.seedDigest,
      projectId,
    });
    for (const subjectId of registration.unregistered) {
      blocks.push({
        projectId,
        subjectId,
        reason: "missing-placement-module",
        detail: "Required Catalog subject has no free placement module of the correct kind; operator curation is required.",
      });
    }
    staged.push({ projectId, configSetId: row.config_set_id, revisionId: row.id });
  }

  if (blocks.length > 0) {
    throw new SeedInitializationBlockedError(blocks);
  }

  for (const entry of staged) {
    try {
      written[entry.projectId] = await syncPublishedCatalogProjectValues(pool, {
        organizationId: input.organizationId,
        projectId: entry.projectId,
        configSetId: entry.configSetId,
        configRevisionId: entry.revisionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("reviewed source change")) {
        skipped.push(entry.projectId);
        continue;
      }
      throw error;
    }
  }

  return {
    catalogReleaseId: pointer.current.id,
    written,
    skipped,
  };
}
