/**
 * After M1 topology seed, sync canonical current bindings when a Catalog is
 * already published. Does not bootstrap Acme/vendor (catalog acceptance owns
 * lineage A). Does not archive the topology plane.
 */
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import type { AuthContext } from "../../auth/types";
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

  const pointer = await readCurrentCatalogPointer(pool);
  // Do not bootstrap Acme/vendor here. Catalog acceptance installs lineage A
  // on an empty pointer; a seeded vendor current makes that install
  // unsupported-lineage. Sync only when a Catalog is already published.

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
