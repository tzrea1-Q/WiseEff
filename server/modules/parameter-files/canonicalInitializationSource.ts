import { createHash, randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import { CatalogSubjectId, ParameterDefinitionId } from "../parameter-catalog-contract";
import {
  asValueClient,
  listObservedProperties,
  syncPublishedCatalogProjectValuesInTransaction,
} from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import {
  loadCanonicalSourceSnapshot,
  lockCanonicalSourceCohort,
  recordCanonicalPermissionRefusal,
  requireCanonicalUserInvocation,
  canonicalSourceConfigSetRole,
  canonicalSourceMemberMatchesCurrentFile,
} from "./canonicalSource";
import { insertConfigSet, setFileConfigSetMembership } from "./configSetRepository";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import { sanitizeFileName, type ObjectStore } from "../logs/objectStore";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember, ConfigRevisionMemberRole } from "../parameter-topology/types";
import type { InitializationSnapshotItemDto } from "../parameters/initializationTypes";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import { loadOwnedProjectValueSourcePin, loadSourceBindingCohort } from "../parameter-bindings/values";
import { canAdminParameters } from "../parameter-kernel/policy";

export type InitializationSourceContext = {
  requestId: string;
  invocation: TrustedInvocationContext;
  refusalSink: TrustedRefusalAuditSink;
  catalogSnapshot: CatalogSnapshot;
  /** Approval callback owns cleanup until its database transaction commits. */
  createdStorageKeys?: string[];
};

type LoadedSource = {
  item: InitializationSnapshotItemDto;
  source: Awaited<ReturnType<typeof loadCanonicalSourceSnapshot>>;
  binding: {
    definitionId: string;
    effectiveRevisionId: string;
    catalogReleaseId: string;
    currentValueId: string;
  };
};

type TargetMember = ConfigRevisionManifestMember & {
  sourceFileId: string;
  sourceFileVersionId: string;
};

type SourceGroup = {
  key: string;
  sourceProjectId: string;
  sourceConfigSetId: string;
  sourceConfigRevisionId: string;
  sources: LoadedSource[];
  manifest: LoadedSource["source"]["manifest"];
  files: LoadedSource["source"]["files"];
};

type TargetGroup = SourceGroup & {
  targetConfigSetId: string;
  targetRevisionId: string;
  targetMembers: TargetMember[];
  targetFileBySourceFileId: Map<string, { fileId: string; fileVersionId: string }>;
};

function roleForMembership(role: string): "base" | "overlay" | "charging" | "thermal" | "misc" {
  return canonicalSourceConfigSetRole(role);
}

function roleForRevision(role: string): ConfigRevisionMemberRole {
  if (role === "include") return role;
  return roleForMembership(role);
}

function targetFileName(configSetId: string, sourceName: string): string {
  const safe = sanitizeFileName(sourceName.replaceAll("/", "__"));
  return `initialization-${configSetId}-${safe}`;
}

/** Delete only objects confirmed as created by this approval attempt. */
export async function cleanupCanonicalInitializationObjects(
  objectStore: ObjectStore,
  storageKeys: readonly string[],
  originalError: unknown,
): Promise<void> {
  const uniqueKeys = [...new Set(storageKeys)];
  if (uniqueKeys.length === 0) return;
  const failedKeys: string[] = [];
  if (!objectStore.delete) {
    failedKeys.push(...uniqueKeys);
  } else {
    for (const storageKey of uniqueKeys) {
      try {
        await objectStore.delete(storageKey);
      } catch {
        failedKeys.push(storageKey);
      }
    }
  }
  if (failedKeys.length > 0) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Initialization database rollback could not remove every created source object.",
      {
        createdStorageKeys: uniqueKeys,
        cleanupFailedStorageKeys: failedKeys,
        originalError: originalError instanceof ApiError ? originalError.code : "unknown",
      },
    );
  }
}

async function assertCurrentSourceMembers(
  db: Queryable,
  manifest: LoadedSource["source"]["manifest"],
): Promise<void> {
  const currentMembers = await db.query<{
    id: string;
    current_version_id: string | null;
    config_set_role: string | null;
    config_set_sort_order: number;
    format: string;
  }>(
    `select id,current_version_id,config_set_role,config_set_sort_order,format
       from project_parameter_files
      where organization_id=$1 and project_id=$2 and config_set_id=$3
      order by id
      for update nowait`,
    [manifest.organizationId, manifest.projectId, manifest.configSetId],
  );
  if (
    currentMembers.rows.length !== manifest.members.length
    || currentMembers.rows.some((current) =>
      !manifest.members.some((member) => canonicalSourceMemberMatchesCurrentFile(member, current)),
    )
  ) {
    throw new ApiError("CONFLICT", "Configuration membership or file versions changed; refresh initialization choices.");
  }
}

async function loadSources(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  snapshots: InitializationSnapshotItemDto[],
): Promise<LoadedSource[]> {
  const loaded: LoadedSource[] = [];
  for (const item of snapshots) {
    if (!item.sourceProjectValueId) {
      throw new ApiError("VALIDATION_FAILED", "Initialization snapshot is missing its canonical source value id.", { snapshotId: item.id });
    }
    const bindingInput = {
      organizationId: auth.organization.id,
      projectId: item.sourceProjectId,
      bindingId: item.sourceProjectParameterBindingId,
      projectValueId: item.sourceProjectValueId,
    };
    const sourceIdentity = await loadOwnedProjectValueSourcePin(db, bindingInput);
    if (!sourceIdentity) {
      throw new ApiError("CONFLICT", "Initialization source value has no exact owned source pin.", { snapshotId: item.id });
    }
    await lockCanonicalSourceCohort(db, sourceIdentity);
    const sourceCohort = await loadSourceBindingCohort(db, {
      organizationId: bindingInput.organizationId,
      projectId: bindingInput.projectId,
      configSetId: sourceIdentity.configSetId,
    });
    const bindingPin = sourceCohort.find((candidate) =>
      candidate.bindingId === bindingInput.bindingId
      && candidate.oldValueId === bindingInput.projectValueId
      && candidate.sourcePinId === sourceIdentity.sourcePinId,
    );
    if (!bindingPin) {
      throw new ApiError("CONFLICT", "Initialization source value is no longer the current canonical value.", {
        bindingId: bindingInput.bindingId,
        projectValueId: bindingInput.projectValueId,
      });
    }
    const binding: LoadedSource["binding"] = {
      definitionId: bindingPin.definitionId,
      effectiveRevisionId: bindingPin.effectiveRevisionId,
      catalogReleaseId: bindingPin.catalogReleaseId,
      currentValueId: bindingPin.oldValueId,
    };
    if (binding.definitionId !== item.parameterSpecId || binding.effectiveRevisionId !== item.parameterSpecVersionId) {
      throw new ApiError("CONFLICT", "Initialization source definition changed after preview.", { snapshotId: item.id });
    }
    const source = await loadCanonicalSourceSnapshot(db, objectStore, bindingInput);
    await assertCurrentSourceMembers(db, source.manifest);
    if (source.manifest.projectValueId !== item.sourceProjectValueId
      || source.manifest.bindingId !== item.sourceProjectParameterBindingId
      || source.manifest.definitionId !== item.parameterSpecId
      || source.manifest.sourceOccurrenceId !== item.sourceOccurrenceId && item.sourceOccurrenceId !== undefined) {
      throw new ApiError("CONFLICT", "Initialization source pin no longer matches the approved snapshot.", { snapshotId: item.id });
    }
    loaded.push({ item, source, binding });
  }
  return loaded;
}

function groupSources(sources: LoadedSource[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const source of sources) {
    const manifest = source.source.manifest;
    const key = `${manifest.projectId}:${manifest.configSetId}:${manifest.configRevisionId}`;
    const current = groups.get(key);
    if (current) {
      if (current.manifest.members.length !== manifest.members.length
        || current.manifest.members.some((member) => !manifest.members.some((candidate) =>
          candidate.fileId === member.fileId && candidate.fileVersionId === member.fileVersionId
          && candidate.sourceName === member.sourceName && candidate.format === member.format))) {
        throw new ApiError("CONFLICT", "Initialization source values do not share one exact source manifest.");
      }
      current.sources.push(source);
      continue;
    }
    groups.set(key, {
      key,
      sourceProjectId: manifest.projectId,
      sourceConfigSetId: manifest.configSetId,
      sourceConfigRevisionId: manifest.configRevisionId,
      sources: [source],
      manifest,
      files: source.source.files,
    });
  }
  return [...groups.values()];
}

async function cloneSourceGroup(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  context: InitializationSourceContext,
  group: SourceGroup,
  targetProjectId: string,
  createdStorageKeys: string[],
): Promise<TargetGroup> {
  const targetConfigSetId = randomUUID();
  await insertConfigSet(db, {
    id: targetConfigSetId,
    organizationId: auth.organization.id,
    projectId: targetProjectId,
    name: `initialization-${targetConfigSetId.slice(0, 8)}`,
    description: `Canonical initialization copy of ${group.sourceConfigSetId}`,
    derivedFromId: undefined,
  });

  const targetFileBySourceFileId = new Map<string, { fileId: string; fileVersionId: string }>();
  const targetMembers: TargetMember[] = [];
  for (const member of group.manifest.members) {
    const file = group.files.find((candidate) => candidate.name === member.sourceName);
    if (!file) throw new ApiError("CONFLICT", "Canonical source manifest member content is missing.");
    const bytes = Buffer.from(file.content, "utf8");
    const stored = await objectStore.put({
      organizationId: auth.organization.id,
      fileName: targetFileName(targetConfigSetId, member.sourceName),
      contentType: member.format === "json" ? "application/json" : "text/plain",
      bytes,
    });
    createdStorageKeys.push(stored.storageKey);
    const fileId = randomUUID();
    await insertProjectParameterFile(db, {
      id: fileId,
      organizationId: auth.organization.id,
      projectId: targetProjectId,
      fileName: stored.fileName,
      format: member.format,
      enabled: true,
    });
    const fileVersionId = randomUUID();
    await insertFileVersion(db, {
      id: fileVersionId,
      fileId,
      versionNumber: 1,
      storageKey: stored.storageKey,
      checksum: stored.checksumSha256,
      sizeBytes: stored.fileSizeBytes,
      parsedIndex: member.format === "json" ? buildJsonParsedIndex(bytes) : buildDtsParsedIndex(file.content),
      origin: "upload",
      createdByUserId: auth.user.id,
      attribution: trustedDomainAttribution(context.invocation),
    });
    await setCurrentVersion(db, { fileId, versionId: fileVersionId });
    await setFileConfigSetMembership(db, {
      fileId,
      configSetId: targetConfigSetId,
      role: roleForMembership(member.role),
      sortOrder: member.sortOrder,
    });
    targetFileBySourceFileId.set(member.fileId, { fileId, fileVersionId });
    targetMembers.push({
      fileId,
      fileVersionId,
      fileName: stored.fileName,
      sourceName: member.sourceName,
      role: roleForRevision(member.role),
      sortOrder: member.sortOrder,
      content: file.content,
      format: member.format,
      sourceFileId: member.fileId,
      sourceFileVersionId: member.fileVersionId,
    });
  }

  const dtsMembers = targetMembers.filter((member) => member.format === "dts");
  let targetRevisionId = "";
  if (dtsMembers.length > 0) {
    if (!group.manifest.entryFile) {
      throw new ApiError("CONFLICT", "DTS initialization source has no immutable entry file.");
    }
    const manifest: ConfigRevisionManifest = {
      organizationId: auth.organization.id,
      projectId: targetProjectId,
      configSetId: targetConfigSetId,
      entryFile: group.manifest.entryFile,
      includeSearchPaths: group.manifest.includeSearchPaths,
      overlayOrder: group.manifest.overlayOrder,
      members: targetMembers,
    };
    const revision = await ingestConfigRevisionInTransaction(
      db,
      manifest,
      auth,
      { createdByUserId: auth.user.id, domain: trustedDomainAttribution(context.invocation) },
      { legacyProjection: "skip" },
    );
    if (revision.status !== "resolved" || !revision.manifestState || revision.manifestState === "needs_review") {
      throw new ApiError("CONFLICT", "Initialization DTS source could not be resolved exactly.");
    }
    targetRevisionId = revision.id;
  }
  return { ...group, targetConfigSetId, targetRevisionId, targetMembers, targetFileBySourceFileId };
}

async function targetDtsPropertyOccurrence(
  db: Queryable,
  source: LoadedSource,
  target: TargetGroup,
): Promise<string> {
  if (source.source.manifest.format !== "dts" || !target.targetRevisionId) {
    throw new ApiError("CONFLICT", "A DTS source value has no target resolved revision.", { snapshotId: source.item.id });
  }
  const sourceNode = await db.query<{ locator: string }>(
    `select logical.node_locator as locator
       from dts_occurrence_effects effect
       join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
      where effect.config_revision_id=$1 and effect.property_occurrence_id=$2
        and logical.logical_node_id=$3
      limit 1`,
    [source.source.manifest.configRevisionId,
      (source.source.manifest.locator as Record<string, unknown>).propertyOccurrenceId,
      source.source.manifest.logicalNodeId],
  );
  const propertyName = (source.source.manifest.locator as Record<string, unknown>).propertyName;
  if (sourceNode.rows.length !== 1 || typeof propertyName !== "string") {
    throw new ApiError("CONFLICT", "A DTS source value has no exact logical/property locator.", { snapshotId: source.item.id });
  }
  const targetFile = target.targetFileBySourceFileId.get(source.source.manifest.fileId);
  if (!targetFile) throw new ApiError("CONFLICT", "A target source member is missing.");
  const rows = await listObservedProperties(asValueClient(db), target.targetRevisionId);
  const matches = rows.filter((row) => row.locator === sourceNode.rows[0]!.locator
    && row.propertyKey === propertyName
    && row.fileId === targetFile.fileId
    && row.fileVersionId === targetFile.fileVersionId);
  if (matches.length !== 1) {
    throw new ApiError("CONFLICT", "A DTS source value did not map to one target property occurrence.", { snapshotId: source.item.id });
  }
  return matches[0]!.propertyOccurrenceId;
}

async function materializeDts(
  db: Queryable,
  context: InitializationSourceContext,
  auth: AuthContext,
  targetProjectId: string,
  target: TargetGroup,
): Promise<void> {
  const selected = target.sources.filter((source) => source.source.manifest.format === "dts");
  if (selected.length === 0) return;
  const propertyOccurrenceIds: string[] = [];
  for (const source of selected) propertyOccurrenceIds.push(await targetDtsPropertyOccurrence(db, source, target));
  const count = await syncPublishedCatalogProjectValuesInTransaction(asValueClient(db), context.catalogSnapshot, {
    organizationId: auth.organization.id,
    projectId: targetProjectId,
    configSetId: target.targetConfigSetId,
    configRevisionId: target.targetRevisionId,
    propertyOccurrenceIds,
  });
  if (count !== propertyOccurrenceIds.length) {
    throw new ApiError("CONFLICT", "Canonical DTS initialization did not materialize every selected source value.", {
      expected: propertyOccurrenceIds.length,
      actual: count,
    });
  }
}

async function materializeJson(
  db: Queryable,
  objectStore: ObjectStore,
  context: InitializationSourceContext,
  auth: AuthContext,
  targetProjectId: string,
  target: TargetGroup,
): Promise<void> {
  const selected = target.sources.filter((source) => source.source.manifest.format === "json");
  const groups = new Map<string, LoadedSource[]>();
  for (const source of selected) {
    const manifest = source.source.manifest;
    const locator = manifest.locator as Record<string, unknown>;
    if (!manifest.configurationSchemaSubjectId || typeof locator.pointer !== "string") {
      throw new ApiError("CONFLICT", "A JSON source value has no exact schema or pointer identity.", { snapshotId: source.item.id });
    }
    const targetFile = target.targetFileBySourceFileId.get(manifest.fileId);
    if (!targetFile) throw new ApiError("CONFLICT", "A target JSON source member is missing.");
    const key = `${targetFile.fileId}:${manifest.rootPointer ?? ""}:${manifest.configurationSchemaSubjectId}`;
    const list = groups.get(key) ?? [];
    list.push(source);
    groups.set(key, list);
  }
  let index = 0;
  for (const group of groups.values()) {
    const first = group[0]!;
    const manifest = first.source.manifest;
    const targetFile = target.targetFileBySourceFileId.get(manifest.fileId)!;
    const mappings = group.map((source) => {
      const pointer = (source.source.manifest.locator as Record<string, unknown>).pointer;
      if (typeof pointer !== "string") throw new ApiError("CONFLICT", "A JSON source pointer is missing.");
      return { definitionId: source.item.parameterSpecId, pointer };
    });
    const subject = context.catalogSnapshot.getSubject(CatalogSubjectId(manifest.configurationSchemaSubjectId!));
    if (subject.status !== "found" || subject.subject.kind !== "configuration-schema") {
      throw new ApiError("CONFLICT", "A JSON source schema is not the published canonical configuration schema.", {
        subjectId: manifest.configurationSchemaSubjectId,
      });
    }
    await registerCanonicalJsonSource(db, objectStore, auth, context.catalogSnapshot, {
      projectId: targetProjectId,
      configSetId: target.targetConfigSetId,
      fileId: targetFile.fileId,
      fileVersionId: targetFile.fileVersionId,
      configurationSchemaId: String(subject.subject.canonicalKey),
      rootPointer: manifest.rootPointer ?? "",
      mappings,
      invocation: context.invocation,
      requestId: `${context.requestId}:initialization-json:${index++}`,
      refusalSink: context.refusalSink,
    });
  }
}

/** Clone exact canonical source manifests and materialize only approved values. */
export async function cloneCanonicalInitializationSource(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { targetProjectId: string; snapshots: InitializationSnapshotItemDto[] },
  context: InitializationSourceContext,
): Promise<{ configSetIds: string[]; configRevisionIds: string[]; bindingCount: number }> {
  if (input.snapshots.length === 0) return { configSetIds: [], configRevisionIds: [], bindingCount: 0 };
  const operation = {
    projectId: input.targetProjectId,
    operation: "canonical initialization approval",
    targetType: "project-parameter-initialization-review",
    targetId: context.requestId,
  };
  if (!canAdminParameters(auth)) {
    await recordCanonicalPermissionRefusal(context, operation);
    throw new ApiError("FORBIDDEN", "Parameter file administration is required.");
  }
  const target = await db.query<{ id: string }>(
    `select id from projects where id=$1 and organization_id=$2 limit 1`,
    [input.targetProjectId, auth.organization.id],
  );
  if (target.rows.length !== 1) {
    throw new ApiError("NOT_FOUND", "Initialization target project was not found.", {
      projectId: input.targetProjectId,
    });
  }
  await requireCanonicalUserInvocation(auth, context, operation);
  if (!objectStore.delete) {
    throw new ApiError("INTERNAL_ERROR", "Initialization approval requires an object store with rollback cleanup.");
  }
  const createdStorageKeys = context.createdStorageKeys ?? [];
  const ownsCleanup = context.createdStorageKeys === undefined;
  try {
    const sources = await loadSources(db, objectStore, auth, input.snapshots);
    for (const source of sources) {
      const definition = context.catalogSnapshot.getDefinitionById(
        ParameterDefinitionId(source.item.parameterSpecId),
      );
      if (
        definition.status !== "found"
        || String(definition.definition.selectedRevision.id) !== source.item.parameterSpecVersionId
        || String(source.binding.catalogReleaseId) !== String(context.catalogSnapshot.release.id)
      ) {
        throw new ApiError("CONFLICT", "Catalog definition or release changed after preview; refresh initialization choices.", {
          snapshotId: source.item.id,
          definitionId: source.item.parameterSpecId,
          expectedRevisionId: source.item.parameterSpecVersionId,
        });
      }
      const sourceSubjectId = source.source.manifest.configurationSchemaSubjectId;
      if (sourceSubjectId && sourceSubjectId !== String(definition.definition.subjectId)) {
        throw new ApiError("CONFLICT", "Canonical source subject changed after preview; refresh initialization choices.", {
          snapshotId: source.item.id,
        });
      }
    }
    const groups = groupSources(sources);
    const targets: TargetGroup[] = [];
    for (const group of groups) {
      targets.push(await cloneSourceGroup(db, objectStore, auth, context, group, input.targetProjectId, createdStorageKeys));
    }
    for (const target of targets) {
      await materializeDts(db, context, auth, input.targetProjectId, target);
      await materializeJson(db, objectStore, context, auth, input.targetProjectId, target);
    }
    return {
      configSetIds: targets.map((target) => target.targetConfigSetId),
      configRevisionIds: targets.map((target) => target.targetRevisionId).filter(Boolean),
      bindingCount: input.snapshots.length,
    };
  } catch (error) {
    if (ownsCleanup) await cleanupCanonicalInitializationObjects(objectStore, createdStorageKeys, error);
    throw error;
  }
}
