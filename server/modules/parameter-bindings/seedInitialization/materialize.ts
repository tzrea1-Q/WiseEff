/**
 * Issue #849 PU-04: materialize the reviewed seed sources into the three target
 * projects' source plane, through the existing config-set / file / ingest owners.
 *
 * Scope of this step, stated exactly:
 *   * ensures each target project's default config set,
 *   * uploads each reviewed DTS seed source as a real file version with its bytes
 *     in the object store,
 *   * makes it a config-set member and ingests a real config revision,
 *   * then asks the canonical project-value owner to sync bindings and values.
 *
 * It never creates a project, never invents an approval, and is a no-op when the
 * same seed digest already completed.
 *
 * BLOCKER RECORDED, NOT SILENTLY SKIPPED: a JSON project source cannot enter this
 * path. `ingestConfigRevision` is a DTS/config-revision resolver and there is no
 * JSON semantic path, so a JSON seed source is refused with an explicit error
 * rather than uploaded as a non-resolving member or dropped from the manifest.
 * The two JSON compatibility seeds therefore remain unmaterialized.
 */
import { ApiError } from "../../../shared/http/errors";
import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import type { ObjectStore } from "../../logs/objectStore";
import { addConfigSetFile, ensureDefaultConfigSet, listConfigSetFiles } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import {
  asValueClient,
  listObservedProperties,
  loadPublishedCatalog,
  syncPublishedCatalogProjectValues
} from "../catalogProjectValueSync";
import {
  assertProjectParameterPlaneArchived,
  captureProjectParameterPlane
} from "./archive";
import {
  ensureSeedSubjectRegistrations,
  observedSubjectsWithDefinitions,
  type SeedRegistrationOutcome
} from "./registration";
import {
  assertSeedInitializationPlanApplicable,
  recordSeedInitializationRun,
  resolveSeedInitializationPlan,
  seedInitializationRunIsComplete,
  SeedInitializationBlockedError,
  type SeedInitializationSubjectBlock
} from "./plan";

export type SeedSourceFile = {
  readonly name: string;
  readonly format: "dts" | "json";
  readonly content: string;
};

export type SeedProjectSources = {
  readonly projectId: string;
  readonly files: readonly SeedSourceFile[];
};

export type SeedMaterializedProject = {
  readonly projectId: string;
  readonly configSetId: string;
  readonly configRevisionId: string;
  readonly fileIds: readonly string[];
  readonly canonicalBindingsWritten: number;
  /** Offline archive of the parameter plane this rebuild replaced (scope item 4). */
  readonly archiveId: string;
  readonly archiveDigest: string;
  /** Subjects the sync can bind because a registration exists (B6). */
  readonly registeredSubjectIds: readonly string[];
  /** Subjects with no available module. Reported, never silently dropped. */
  readonly unregisteredSubjectIds: readonly string[];
};

export type SeedMaterializationOutcome = {
  readonly status: "already-complete" | "completed";
  readonly seedDigest: string;
  readonly projects: readonly SeedMaterializedProject[];
};

export async function materializeSeedSources(
  root: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    organizationId: string;
    seedDigest: string;
    sources: readonly SeedProjectSources[];
  },
): Promise<SeedMaterializationOutcome> {
  if (
    await seedInitializationRunIsComplete(root, {
      organizationId: input.organizationId,
      seedDigest: input.seedDigest
    })
  ) {
    return { status: "already-complete", seedDigest: input.seedDigest, projects: [] };
  }

  const plan = await resolveSeedInitializationPlan(root, {
    organizationId: input.organizationId,
    seedDigest: input.seedDigest
  });
  assertSeedInitializationPlanApplicable(plan);

  const pool = getRootPostgresPool(root);
  if (!pool) {
    throw new ApiError("INTERNAL_ERROR", "Seed materialization requires the root database.");
  }

  const plannedSources = plan.targets.map((target) => {
    const projectSources = input.sources.find((entry) => entry.projectId === target.projectId);
    if (!projectSources) {
      throw new ApiError("VALIDATION_FAILED", "Seed sources are missing for a planned target.", {
        projectId: target.projectId
      });
    }
    for (const file of projectSources.files) {
      if (file.format !== "dts") {
        throw new ApiError(
          "UNSUPPORTED_FORMAT",
          "Only DTS seed sources can be materialized into a config revision; JSON has no semantic ingest path yet.",
          {
            projectId: target.projectId,
            fileName: file.name,
            format: file.format,
            deferredTo: "TD-124-json-project-source-semantics"
          }
        );
      }
    }
    return { target, projectSources };
  });

  await recordSeedInitializationRun(root, {
    organizationId: input.organizationId,
    seedDigest: input.seedDigest,
    status: "running",
    targetProjectIds: plan.targets.map((target) => target.projectId)
  });

  const snapshot = await loadPublishedCatalog(pool);
  const staged: Array<{
    target: (typeof plan.targets)[number];
    configSet: Awaited<ReturnType<typeof ensureDefaultConfigSet>>;
    revision: Awaited<ReturnType<typeof ingestConfigRevision>>;
    fileIds: string[];
    archive: Awaited<ReturnType<typeof captureProjectParameterPlane>>;
    registrationOutcome: SeedRegistrationOutcome;
  }> = [];

  // Stage and preflight every target before any canonical value sync. A blocker in
  // the last project must not leave earlier projects partially synchronized.
  for (const { target, projectSources } of plannedSources) {

    // Scope item 4: preserve the legacy parameter plane offline before the rebuild
    // touches it. Capture first, then require the guard to pass, so a truncated or
    // missing archive stops the rebuild instead of silently replacing data.
    const archive = await captureProjectParameterPlane(root, objectStore, auth, {
      projectId: target.projectId
    });
    await assertProjectParameterPlaneArchived(root, {
      organizationId: input.organizationId,
      projectId: target.projectId
    });

    const configSet = await ensureDefaultConfigSet(root, auth, target.projectId);
    const existing = await listConfigSetFiles(root, auth, {
      projectId: target.projectId,
      configSetId: configSet.id
    });
    const memberNames = new Set(existing.map((member) => member.fileName));
    const fileIds: string[] = [];
    const members: ConfigRevisionManifest["members"][number][] = [];

    for (const [index, file] of projectSources.files.entries()) {
      const uploaded = await uploadProjectParameterFile(root, objectStore, auth, {
        projectId: target.projectId,
        fileName: file.name,
        bytes: Buffer.from(file.content, "utf8")
      });
      fileIds.push(uploaded.file.id);
      if (!memberNames.has(file.name)) {
        await addConfigSetFile(root, auth, {
          configSetId: configSet.id,
          fileId: uploaded.file.id,
          role: index === 0 ? "base" : "overlay",
          sortOrder: index
        });
      }
      members.push({
        fileId: uploaded.file.id,
        fileVersionId: uploaded.version.id,
        fileName: file.name,
        role: index === 0 ? "base" : "overlay",
        sortOrder: index,
        content: file.content
      });
    }

    const manifest: ConfigRevisionManifest = {
      organizationId: input.organizationId,
      projectId: target.projectId,
      configSetId: configSet.id,
      entryFile: projectSources.files[0]!.name,
      includeSearchPaths: ["."],
      overlayOrder: projectSources.files.slice(1).map((file) => file.name),
      members
    };
    const revision = await ingestConfigRevision(root, manifest, auth);

    // B6: the sync will not bind an unregistered subject. Register the subjects the
    // reviewed seed sources actually reference, using the automatic/trusted-system
    // path the governance contract pre-authorises, and report any subject with no
    // available module rather than dropping it quietly.
    const registrationOutcome = snapshot
      ? await ensureSeedSubjectRegistrations(root, auth, {
          organizationId: input.organizationId,
          currentRelease: { id: snapshot.release.id, digest: snapshot.release.digest },
          subjects: observedSubjectsWithDefinitions(
            snapshot,
            await listObservedProperties(asValueClient(pool), revision.id)
          ),
          seedDigest: input.seedDigest,
          projectId: target.projectId
        })
      : { registered: [], unregistered: [], alreadyRegistered: [] };

    staged.push({ target, configSet, revision, fileIds, archive, registrationOutcome });
  }

  const blocks: SeedInitializationSubjectBlock[] = staged.flatMap(({ target, registrationOutcome }) =>
    registrationOutcome.unregistered.map((subjectId) => ({
      projectId: target.projectId,
      subjectId,
      reason: "missing-placement-module" as const,
      detail:
        "Required Catalog subject has no free placement module of the correct kind; operator curation is required."
    }))
  );
  if (blocks.length > 0) {
    await recordSeedInitializationRun(root, {
      organizationId: input.organizationId,
      seedDigest: input.seedDigest,
      status: "failed",
      targetProjectIds: plan.targets.map((entry) => entry.projectId),
      blocked: blocks
    });
    throw new SeedInitializationBlockedError(blocks);
  }

  const projects: SeedMaterializedProject[] = [];
  for (const { target, configSet, revision, fileIds, archive, registrationOutcome } of staged) {

    // The binding unit of work opens a SAVEPOINT, so it needs an open transaction;
    // a bare client made every write fail with "SAVEPOINT can only be used in
    // transaction blocks". One transaction per project keeps a partially
    // materialized project from being recorded as complete.
    const canonicalBindingsWritten = await root.transaction((tx) =>
      syncPublishedCatalogProjectValues(
        pool,
        {
          organizationId: input.organizationId,
          projectId: target.projectId,
          configSetId: configSet.id,
          configRevisionId: revision.id
        },
        asValueClient(tx)
      )
    );

    projects.push({
      projectId: target.projectId,
      configSetId: configSet.id,
      configRevisionId: revision.id,
      fileIds,
      canonicalBindingsWritten,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
      registeredSubjectIds: [...registrationOutcome.registered, ...registrationOutcome.alreadyRegistered],
      unregisteredSubjectIds: registrationOutcome.unregistered
    });
  }

  await recordSeedInitializationRun(root, {
    organizationId: input.organizationId,
    seedDigest: input.seedDigest,
    status: "completed",
    targetProjectIds: plan.targets.map((target) => target.projectId)
  });

  return { status: "completed", seedDigest: input.seedDigest, projects };
}
