/**
 * Issue #849 T1.3: materialize reviewed DTS and JSON seed sources into the three
 * target projects through the existing config-set / ingest / JSON-source owners.
 *
 * JSON is a config-set member with role `misc` (never overlay) so mixed membership
 * is complete for `registerCanonicalJsonSource`. JSON bindings are written only
 * after the all-project placement barrier. YAML/TOML/ENV stay TD-124.
 */
import { ApiError } from "../../../shared/http/errors";
import {
  createDatabase,
  getRootPostgresPool,
  isRootDatabase,
  type Database,
  type RootDatabase,
} from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import type { ObjectStore } from "../../logs/objectStore";
import { canEditParameters } from "../../parameter-kernel/policy";
import { addConfigSetFile, ensureDefaultConfigSet, listConfigSetFiles, removeConfigSetFile } from "../../parameter-files/configSetService";
import { refuseDeferredProjectSourceFormat, uploadProjectParameterFile } from "../../parameter-files/service";
import { parseJsonSource, readJsonSourceValue } from "../../parameter-files/jsonSource";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import type { ConfigSetRole } from "../../parameter-files/types";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { NormalizedConfigurationSchemaId, type CatalogSnapshot } from "../../catalog-kernel/interface";
import {
  asValueClient,
  listObservedProperties,
  loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction
} from "../catalogProjectValueSync";
import { SEED_JSON_POINTERS, SEED_POWER_CONFIG_SCHEMA_ID } from "./powerConfig";
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
  SEED_INITIALIZATION_SCOPE,
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

type SeedMaterializationInput = {
  organizationId: string;
  seedDigest: string;
  sources: readonly SeedProjectSources[];
};

const publishedConfigurationSchemaSubject = (
  snapshot: CatalogSnapshot | null,
): { readonly subjectId: string; readonly subjectKind: "configuration-schema" } | null => {
  if (!snapshot) return null;
  const matched = snapshot.resolveSubject({
    driverCompatibles: [],
    nodeTypeFallback: { kind: "absent" },
    configurationSchemaIds: [NormalizedConfigurationSchemaId(SEED_POWER_CONFIG_SCHEMA_ID)],
  });
  if (matched.status !== "matched" || matched.subject.kind !== "configuration-schema") return null;
  return { subjectId: matched.subject.id, subjectKind: "configuration-schema" };
};

/**
 * Keep the reviewed mixed source manifest stable when callers enumerate files
 * in a different order. Unknown DTS files retain their input order so partial
 * fixtures remain valid; the reviewed charging overlay and JSON member keep
 * their semantic positions.
 */
export const orderSeedSourceFiles = <T extends SeedSourceFile>(
  files: readonly T[],
): T[] => files
  .map((file, index) => ({ file, index }))
  .sort((left, right) => {
    const rank = (file: SeedSourceFile): number => {
      if (file.format === "json") return 2;
      if (file.name === "charging-thermal.dts") return 1;
      return 0;
    };
    return rank(left.file) - rank(right.file) || left.index - right.index;
  })
  .map(({ file }) => file);

const seedMemberRole = (
  file: SeedSourceFile,
  dtsSeen: { count: number },
): { role: ConfigSetRole; sortOrder: number } => {
  if (file.format === "json") {
    return { role: "misc", sortOrder: 100 + dtsSeen.count };
  }
  const sortOrder = dtsSeen.count;
  dtsSeen.count += 1;
  return { role: sortOrder === 0 ? "base" : "overlay", sortOrder };
};

export async function materializeSeedSources(
  root: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: SeedMaterializationInput,
): Promise<SeedMaterializationOutcome> {
  if (input.organizationId !== auth.organization.id) {
    throw new ApiError("FORBIDDEN", "Seed materialization cannot cross organizations.", {
      reason: "organization-mismatch"
    });
  }
  if (!isRootDatabase(root)) {
    throw new ApiError("INTERNAL_ERROR", "Seed materialization requires the root database.");
  }
  const pool = getRootPostgresPool(root);
  if (!pool) {
    throw new ApiError("INTERNAL_ERROR", "Seed materialization requires the root database.");
  }
  const lockClient = await pool.connect();
  let lockHeld = false;
  const lockKey = `${input.organizationId}:${SEED_INITIALIZATION_SCOPE}`;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
      [lockKey]
    );
    lockHeld = lock.rows[0]?.acquired === true;
    if (!lockHeld) {
      throw new ApiError("CONFLICT", "Seed materialization for this digest is already in progress.", {
        seedDigest: input.seedDigest
      });
    }
    return await materializeSeedSourcesLocked(
      root,
      createDatabase(lockClient),
      pool,
      objectStore,
      auth,
      input,
    );
  } finally {
    if (lockHeld) {
      await lockClient.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
        lockKey
      ]);
    }
    lockClient.release();
  }
}

async function materializeSeedSourcesLocked(
  root: RootDatabase,
  archiveDatabase: Database,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: SeedMaterializationInput,
): Promise<SeedMaterializationOutcome> {
  const plan = await resolveSeedInitializationPlan(root, {
    organizationId: input.organizationId,
    seedDigest: input.seedDigest
  });
  assertSeedInitializationPlanApplicable(plan);
  if (plan.targets.some((target) => !canEditParameters(auth, target.projectId))) {
    throw new ApiError("FORBIDDEN", "Parameter edit role is required to materialize seed sources.");
  }
  if (
    await seedInitializationRunIsComplete(root, {
      organizationId: input.organizationId,
      seedDigest: input.seedDigest
    })
  ) {
    return { status: "already-complete", seedDigest: input.seedDigest, projects: [] };
  }

  const plannedSources = plan.targets.map((target) => {
    const projectSources = input.sources.find((entry) => entry.projectId === target.projectId);
    if (!projectSources) {
      throw new ApiError("VALIDATION_FAILED", "Seed sources are missing for a planned target.", {
        projectId: target.projectId
      });
    }
    for (const file of projectSources.files) {
      refuseDeferredProjectSourceFormat(file.name);
      if (file.format !== "dts" && file.format !== "json") {
        throw new ApiError("VALIDATION_FAILED", "Seed sources must be DTS or JSON.", {
          projectId: target.projectId,
          fileName: file.name,
          format: file.format,
        });
      }
    }
    return { target, projectSources };
  });

  await recordSeedInitializationRun(root, {
    organizationId: input.organizationId,
    seedDigest: input.seedDigest,
    status: "running",
    targetProjectIds: plan.targets.map((target) => target.projectId),
    startedByUserId: auth.user.id
  });

  const snapshot = await loadPublishedCatalog(pool);
  const staged: Array<{
    target: (typeof plan.targets)[number];
    configSet: Awaited<ReturnType<typeof ensureDefaultConfigSet>>;
    revision: Awaited<ReturnType<typeof ingestConfigRevision>> | null;
    fileIds: string[];
    jsonFiles: Array<{ file: SeedSourceFile; fileId: string; fileVersionId: string }>;
    archive: Awaited<ReturnType<typeof captureProjectParameterPlane>>;
    registrationOutcome: SeedRegistrationOutcome;
  }> = [];

  // Stage and preflight every target before any canonical value sync. A blocker in
  // the last project must not leave earlier projects partially synchronized.
  for (const { target, projectSources } of plannedSources) {

    // Scope item 4: preserve the legacy parameter plane offline before the rebuild
    // touches it. Capture first, then require the guard to pass, so a truncated or
    // missing archive stops the rebuild instead of silently replacing data.
    const archive = await captureProjectParameterPlane(archiveDatabase, objectStore, auth, {
      projectId: target.projectId
    });
    await assertProjectParameterPlaneArchived(root, objectStore, {
      organizationId: input.organizationId,
      projectId: target.projectId,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest
    });

    const configSet = await ensureDefaultConfigSet(root, auth, target.projectId);
    const existing = await listConfigSetFiles(root, auth, {
      projectId: target.projectId,
      configSetId: configSet.id
    });
    // The verified archive retains old membership; the new revision must contain
    // exactly the reviewed sources, including when a legacy base has another name.
    const sourceNames = new Set(projectSources.files.map((file) => file.name));
    for (const member of existing) {
      if (!sourceNames.has(member.fileName)) {
        await removeConfigSetFile(root, auth, { configSetId: configSet.id, fileId: member.fileId });
      }
    }
    const fileIds: string[] = [];
    const members: ConfigRevisionManifest["members"][number][] = [];
    const dtsSeen = { count: 0 };
    const jsonFiles: Array<{ file: SeedSourceFile; fileId: string; fileVersionId: string }> = [];

    for (const file of orderSeedSourceFiles(projectSources.files)) {
      const uploaded = await uploadProjectParameterFile(root, objectStore, auth, {
        projectId: target.projectId,
        fileName: file.name,
        bytes: Buffer.from(file.content, "utf8")
      }, {}, { legacyProjection: "skip" });
      fileIds.push(uploaded.file.id);
      const { role, sortOrder } = seedMemberRole(file, dtsSeen);
      await addConfigSetFile(root, auth, {
        configSetId: configSet.id,
        fileId: uploaded.file.id,
        role,
        sortOrder
      });
      members.push({
        fileId: uploaded.file.id,
        fileVersionId: uploaded.version.id,
        fileName: file.name,
        role,
        sortOrder,
        content: file.content,
        format: file.format,
      });
      if (file.format === "json") {
        jsonFiles.push({ file, fileId: uploaded.file.id, fileVersionId: uploaded.version.id });
      }
    }

    const dtsMembers = members.filter((member) => member.format !== "json");
    const entryFile = dtsMembers[0]?.fileName;
    const overlayOrder = dtsMembers.slice(1).map((member) => member.fileName);
    const revision = entryFile
      ? await ingestConfigRevision(root, {
          organizationId: input.organizationId,
          projectId: target.projectId,
          configSetId: configSet.id,
          entryFile,
          includeSearchPaths: ["."],
          overlayOrder,
          members
        }, auth, { legacyProjection: "skip" })
      : null;

    const observed = snapshot && revision
      ? observedSubjectsWithDefinitions(
          snapshot,
          await listObservedProperties(asValueClient(pool), revision.id)
        )
      : [];
    const configurationSchema = publishedConfigurationSchemaSubject(snapshot);
    const subjects = configurationSchema
      ? [...observed, configurationSchema].sort((left, right) => left.subjectId.localeCompare(right.subjectId))
      : observed;

    const registrationOutcome = snapshot
      ? await ensureSeedSubjectRegistrations(root, auth, {
          organizationId: input.organizationId,
          currentRelease: { id: snapshot.release.id, digest: snapshot.release.digest },
          subjects,
          seedDigest: input.seedDigest,
          projectId: target.projectId
        })
      : { registered: [], unregistered: [], alreadyRegistered: [] };

    staged.push({ target, configSet, revision, fileIds, jsonFiles, archive, registrationOutcome });
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

  const jsonProjects = staged.filter((entry) => entry.jsonFiles.length > 0);
  if (jsonProjects.length > 0) {
    const configurationSchema = snapshot ? publishedConfigurationSchemaSubject(snapshot) : null;
    if (!snapshot || !configurationSchema) {
      throw new ApiError(
        "CONFLICT",
        "JSON seed materialization requires a published ConfigurationSchema wiseeff.power-config.",
      );
    }
    for (const mapping of SEED_JSON_POINTERS) {
      const definition = snapshot.getDefinition({
        subjectId: configurationSchema.subjectId as never,
        propertyKey: mapping.propertyKey as never,
      });
      if (definition.status !== "found") {
        throw new ApiError("CONFLICT", "JSON seed mapping is missing a published definition.", {
          propertyKey: mapping.propertyKey,
        });
      }
    }
    for (const entry of jsonProjects) {
      for (const jsonFile of entry.jsonFiles) {
        parseJsonSource(jsonFile.file.content);
        for (const mapping of SEED_JSON_POINTERS) {
          readJsonSourceValue(jsonFile.file.content, mapping.pointer);
        }
      }
    }
  }

  const projects: SeedMaterializedProject[] = [];
  for (const { target, configSet, revision, fileIds, jsonFiles, archive, registrationOutcome } of staged) {

    // The binding unit of work opens a SAVEPOINT, so it needs an open transaction;
    // a bare client made every write fail with "SAVEPOINT can only be used in
    // transaction blocks". One transaction per project keeps a partially
    // materialized project from being recorded as complete.
    const dtsBindingsWritten = snapshot && revision ? await root.transaction((tx) =>
      syncPublishedCatalogProjectValuesInTransaction(
        asValueClient(tx),snapshot,
        {
          organizationId: input.organizationId,
          projectId: target.projectId,
          configSetId: configSet.id,
          configRevisionId: revision.id
        }
      )
    ) : 0;

    let jsonBindingsWritten = 0;
    const configurationSchema = publishedConfigurationSchemaSubject(snapshot);
    if (snapshot && configurationSchema && jsonFiles.length > 0) {
      const refusalSink = createTrustedRefusalAuditSink(root);
      const invocation = createUserInvocation(auth);
      jsonBindingsWritten = await root.transaction(async (tx) => {
        let written = 0;
        for (const jsonFile of jsonFiles) {
          const mappings = SEED_JSON_POINTERS.map((pointer) => {
            const definition = snapshot.getDefinition({
              subjectId: configurationSchema.subjectId as never,
              propertyKey: pointer.propertyKey as never,
            });
            if (definition.status !== "found") {
              throw new ApiError("CONFLICT", "JSON seed mapping is missing a published definition.", {
                propertyKey: pointer.propertyKey,
              });
            }
            return { definitionId: String(definition.definition.id), pointer: pointer.pointer };
          });
          const registered = await registerCanonicalJsonSource(tx, objectStore, auth, snapshot, {
            projectId: target.projectId,
            configSetId: configSet.id,
            fileId: jsonFile.fileId,
            fileVersionId: jsonFile.fileVersionId,
            configurationSchemaId: SEED_POWER_CONFIG_SCHEMA_ID,
            rootPointer: "",
            mappings,
            invocation,
            requestId: `seed-json:${input.seedDigest}:${target.projectId}:${jsonFile.file.name}`,
            refusalSink,
          });
          written += registered.bindings.length;
        }
        return written;
      });
    }

    projects.push({
      projectId: target.projectId,
      configSetId: configSet.id,
      configRevisionId: revision?.id ?? "",
      fileIds,
      canonicalBindingsWritten: dtsBindingsWritten + jsonBindingsWritten,
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
