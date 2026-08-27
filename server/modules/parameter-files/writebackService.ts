import { randomUUID } from "node:crypto";

import { writeTrustedAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { trustedAccountableUser, trustedDomainAttribution } from "../auth/trustedInvocation";
import type { ObjectStore } from "../logs/objectStore";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { parseDts, resolveDts, serializeDts, classifyDtsValue } from "../dts";
import { indentDtsRawValueForWriteback } from "../dts/rawValueWriteback";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import { getFileVersionById, getProjectParameterFileByName, insertFileVersion, setCurrentVersion } from "./repository";
import { isDtsStructuralIngestEnabled } from "./structuralFlag";
import { ingestDtsFileVersion } from "./structuralIngest";
import {
  assertTrustedSensitiveNodeWriteAllowed,
  assertTrustedSensitiveNodeWriteContext,
  type TrustedSensitiveNodeWriteContext
} from "../parameter-kernel/sensitiveNode";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { loadPreCutoverWritebackSource } from "../parameter-kernel/legacyParameterIdentityAdapter";
import { getChangeRequestEnablementWriteLock, getChangeRequestWriteLock } from "../parameter-drafts/repository";
import type { BindingWriteLockFields, EnablementWriteLockFields } from "../parameter-drafts/types";
import { type BindingEditAction } from "../parameter-topology/overlayWriteback";
import {
  applyLockedEnablementWriteback,
  applyLockedOverlayWriteback,
} from "../parameter-topology/overlayWriteback";
import {
  resolveBindingWriteLock,
  resolveEnablementWriteLock,
  type BindingWriteLockContext,
  type EnablementWriteLockContext,
} from "../parameter-topology/writeLock";
import { createDtsToolchainRunner } from "./dtsToolchain";
import type { ParameterFileFormat } from "./types";
import { loadPinnedSpecVersionId } from "../parameters/specVersionSelection";

type WritebackSource = {
  sourceFileName: string | null;
  sourceNodePath: string | null;
};

export type WritebackMergedParameterValueInput = {
  projectId: string;
  /**
   * Pre-cutover: parameter_definition id.
   * Post-cutover DTO compatibility: ignored when projectParameterBindingId is set.
   */
  parameterDefinitionId: string;
  mergedValue: string;
  action?: BindingEditAction;
  /** Semantic identity — required for post-cutover writeback. */
  projectParameterBindingId?: string;
  parameterSpecId?: string;
  /** Locked merge identity — required for post-cutover exact writeback. */
  writeLock?: BindingWriteLockFields;
  changeRequestId?: string;
};

export type WritebackMergedEnablementValueInput = {
  projectId: string;
  logicalNodeId: string;
  mergedValue: string;
  action?: BindingEditAction;
  changeRequestId?: string;
  writeLock?: EnablementWriteLockFields;
};

export type WritebackServiceContext = TrustedSensitiveNodeWriteContext & {
  objectStore?: ObjectStore;
  /**
   * Explicit toolchain runner injection for tests.
   * Production must omit this and use the pinned host runner.
   * There is no environment-variable bypass.
   */
  toolchain?: ReturnType<typeof createDtsToolchainRunner>;
  /** Test-only: skip semantic promotion gates after resolve/toolchain. */
  skipSemanticGates?: boolean;
};

/** Sensitive-policy-only preflight used before a user-owned merge record is written. */
export async function preflightMergedEnablementWriteback(
  db: Queryable,
  auth: AuthContext,
  input: WritebackMergedEnablementValueInput,
  context: WritebackServiceContext,
): Promise<void> {
  const trusted = assertTrustedSensitiveNodeWriteContext(auth, context, "enablement writeback preflight");
  const { lock } = await resolveLockedEnablementWritebackContext(db, auth, input);
  await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    nodePath: `${lock.sourceNodePath}/status`,
    sourceFileName: lock.overlayFileName,
    sourceFileVersionId: lock.sourceFileVersionId,
    sourcePath: { kind: "property-path", value: `${lock.sourceNodePath}/status` },
    invocation: trusted.invocation,
    requestId: trusted.requestId,
    refusalSink: trusted.refusalSink,
  });
}

/** Sensitive-policy-only parameter preflight; performs no object or domain write. */
export async function preflightMergedParameterWriteback(
  db: Queryable,
  auth: AuthContext,
  input: WritebackMergedParameterValueInput,
  context: WritebackServiceContext,
): Promise<void> {
  const trusted = assertTrustedSensitiveNodeWriteContext(auth, context, "parameter writeback preflight");
  if (parameterIdentityMode() === "semantic") {
    const { lock } = await resolveLockedWritebackContext(db, auth, input);
    await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      nodePath: `${lock.sourceNodePath}/${lock.propertyKey}`,
      sourceFileName: lock.overlayFileName,
      sourceFileVersionId: lock.sourceFileVersionId,
      sourcePath: { kind: "property-path", value: `${lock.sourceNodePath}/${lock.propertyKey}` },
      invocation: trusted.invocation,
      requestId: trusted.requestId,
      refusalSink: trusted.refusalSink,
    });
    return;
  }
  const source = await loadWritebackSource(db, auth, input);
  if (!source?.sourceFileName || !source.sourceNodePath) return;
  const file = await getProjectParameterFileByName(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    fileName: source.sourceFileName,
  });
  if (!file?.currentVersionId) {
    throw new ApiError("CONFLICT", "Project parameter file has no exact current version for writeback preflight.");
  }
  await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    nodePath: source.sourceNodePath,
    sourceFileName: source.sourceFileName,
    sourceFileVersionId: file.currentVersionId,
    invocation: trusted.invocation,
    requestId: trusted.requestId,
    refusalSink: trusted.refusalSink,
  });
}

function splitNodePath(nodePath: string) {
  return nodePath.split("/").map((segment) => segment.trim()).filter(Boolean);
}

function parseMergedValue(newValue: string): unknown {
  const trimmed = newValue.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return newValue;
  }
}

function setNestedJsonLeaf(target: Record<string, unknown>, pathSegments: string[], value: unknown) {
  if (pathSegments.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "Parameter source node path is empty.");
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];
    const next = cursor[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new ApiError("CONFLICT", "Cannot write back to non-object JSON path segment.", {
        segment,
        nodePath: pathSegments.join("/")
      });
    }
    cursor = next as Record<string, unknown>;
  }

  cursor[pathSegments[pathSegments.length - 1]] = value;
}

function patchByFormat(content: string, format: ParameterFileFormat, nodePath: string, newValue: string): Buffer {
  if (format === "json") {
    return patchJsonValue(content, nodePath, newValue);
  }
  if (format === "dts") {
    return patchDtsProperty(content, nodePath, newValue);
  }
  throw new ApiError("VALIDATION_FAILED", "Unsupported parameter file format for writeback.", { format });
}

function contentTypeForFormat(format: ParameterFileFormat) {
  return format === "json" ? "application/json" : "text/plain";
}

async function loadSemanticWritebackSource(
  db: Queryable,
  auth: AuthContext,
  input: Pick<WritebackMergedParameterValueInput, "projectId" | "projectParameterBindingId">
): Promise<WritebackSource | null> {
  if (!input.projectParameterBindingId) {
    return null;
  }

  const result = await db.query<{
    source_file_name: string | null;
    source_node_path: string | null;
  }>(
    `
    select
      ppf.file_name as source_file_name,
      case
        when lnr.node_locator is null then dps.property_key
        when lnr.node_locator like '/%' then ltrim(lnr.node_locator, '/') || '/' || dps.property_key
        else lnr.node_locator || '/' || dps.property_key
      end as source_node_path
    from project_parameter_bindings b
    inner join parameter_specs ps on ps.id = b.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join dts_logical_nodes ln on ln.id = b.logical_node_id
    left join lateral (
      select lnr.node_locator, lnr.config_revision_id
      from dts_logical_node_revisions lnr
      where lnr.logical_node_id = ln.id
      order by lnr.config_revision_id desc
      limit 1
    ) lnr on true
    left join lateral (
      select po.file_version_id
      from dts_occurrence_effects oe
      inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
      where oe.config_revision_id = lnr.config_revision_id
        and oe.property_name = dps.property_key
      order by oe.source_order desc
      limit 1
    ) occ on true
    left join project_parameter_file_versions pfv on pfv.id = occ.file_version_id
    left join project_parameter_files ppf on ppf.id = pfv.file_id
    where b.organization_id = $1
      and b.project_id = $2
      and b.id = $3
    limit 1
    `,
    [auth.organization.id, input.projectId, input.projectParameterBindingId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    sourceFileName: row.source_file_name,
    sourceNodePath: row.source_node_path
  };
}

async function loadWritebackSource(
  db: Queryable,
  auth: AuthContext,
  input: Pick<
    WritebackMergedParameterValueInput,
    "projectId" | "parameterDefinitionId" | "projectParameterBindingId"
  >
): Promise<WritebackSource | null> {
  if (parameterIdentityMode() === "semantic") {
    return loadSemanticWritebackSource(db, auth, input);
  }

  return loadPreCutoverWritebackSource(db, auth, {
    projectId: input.projectId,
    parameterDefinitionId: input.parameterDefinitionId
  });
}

async function resolveLockedWritebackContext(
  db: Queryable,
  auth: AuthContext,
  input: WritebackMergedParameterValueInput,
): Promise<{ lock: BindingWriteLockContext; parameterSpecVersionId: string }> {
  const persistedLock =
    input.writeLock ??
    (input.changeRequestId
      ? await getChangeRequestWriteLock(db, {
          organizationId: auth.organization.id,
          requestId: input.changeRequestId,
        })
      : null);

  if (!persistedLock) {
    throw new ApiError("CONFLICT", "Exact writeback requires locked merge identity.", {
      reason: "missing-write-lock",
      changeRequestId: input.changeRequestId,
      projectParameterBindingId: input.projectParameterBindingId,
    });
  }

  if (!input.projectParameterBindingId) {
    throw new ApiError("CONFLICT", "Semantic writeback requires project parameter binding.", {
      reason: "missing-binding",
    });
  }

  const resolved = await resolveBindingWriteLock(db, auth, {
    bindingId: input.projectParameterBindingId,
    baseRevisionId: persistedLock.baseConfigRevisionId,
  });

  if (
    resolved.bindingRevisionId !== persistedLock.bindingRevisionId ||
    resolved.sourceFileVersionId !== persistedLock.sourceFileVersionId ||
    resolved.expectedChecksum !== persistedLock.expectedChecksum
  ) {
    throw new ApiError("CONFLICT", "Persisted write lock no longer matches binding topology.", {
      reason: "stale-write-lock",
    });
  }

  const parameterSpecVersionId = await loadPinnedSpecVersionId(db, persistedLock.bindingRevisionId);
  if (!parameterSpecVersionId) {
    throw new ApiError("CONFLICT", "Parameter spec version missing for locked writeback.", {
      reason: "missing-spec-version",
      bindingRevisionId: persistedLock.bindingRevisionId,
      parameterSpecId: input.parameterSpecId,
    });
  }

  return {
    lock: {
      ...persistedLock,
      propertyKey: resolved.propertyKey,
      targetRef: resolved.targetRef,
      sourceNodePath: resolved.sourceNodePath,
      expectedRawText: resolved.expectedRawText,
      nodeSpan: resolved.nodeSpan,
      overlayFileId: resolved.overlayFileId,
      overlayFileName: resolved.overlayFileName,
      overlayFileVersionId: resolved.overlayFileVersionId,
      compatible: resolved.compatible,
    },
    parameterSpecVersionId,
  };
}

async function resolveLockedEnablementWritebackContext(
  db: Queryable,
  auth: AuthContext,
  input: WritebackMergedEnablementValueInput,
): Promise<{ lock: EnablementWriteLockContext }> {
  const persistedLock =
    input.writeLock ??
    (input.changeRequestId
      ? await getChangeRequestEnablementWriteLock(db, {
          organizationId: auth.organization.id,
          requestId: input.changeRequestId,
        })
      : null);

  if (!persistedLock) {
    throw new ApiError("CONFLICT", "Exact enablement writeback requires locked merge identity.", {
      reason: "missing-write-lock",
      changeRequestId: input.changeRequestId,
      logicalNodeId: input.logicalNodeId,
    });
  }

  const resolved = await resolveEnablementWriteLock(db, auth, {
    logicalNodeId: input.logicalNodeId,
    baseRevisionId: persistedLock.baseConfigRevisionId,
  });

  if (
    resolved.sourceFileVersionId !== persistedLock.sourceFileVersionId ||
    resolved.expectedChecksum !== persistedLock.expectedChecksum
  ) {
    throw new ApiError("CONFLICT", "Persisted enablement write lock no longer matches topology.", {
      reason: "stale-write-lock",
    });
  }

  return {
    lock: {
      ...persistedLock,
      propertyKey: "status",
      targetRef: resolved.targetRef,
      sourceNodePath: resolved.sourceNodePath,
      expectedRawText: resolved.expectedRawText,
      nodeSpan: resolved.nodeSpan,
      overlayFileId: resolved.overlayFileId,
      overlayFileName: resolved.overlayFileName,
      overlayFileVersionId: resolved.overlayFileVersionId,
      compatible: resolved.compatible,
    },
  };
}

async function createWritebackAudit(
  tx: AuditTx,
  auth: AuthContext,
  input: {
    projectId: string;
    parameterDefinitionId: string;
    nodePath: string;
    fileId: string;
    fileName: string;
    versionNumber: number;
    projectParameterBindingId?: string;
    parameterSpecId?: string;
    candidateRevisionId?: string;
    action: BindingEditAction;
  },
  context: WritebackServiceContext
) {
  await writeTrustedAuditEventInTx(tx, {
    invocation: context.invocation,
    ...(context.invocation.initiator === "system" ? { organizationId: auth.organization.id } : {}),
    app: "parameters",
    kind: "parameter-writeback-to-file",
    action: "writeback",
    severity: "Medium",
    projectId: input.projectId,
    targetType: "project-parameter-file",
    targetId: input.fileId,
    metadata: {
      fileName: input.fileName,
      parameterDefinitionId: input.parameterDefinitionId,
      projectParameterBindingId: input.projectParameterBindingId,
      parameterSpecId: input.parameterSpecId,
      sourceNodePath: input.nodePath,
      versionNumber: input.versionNumber,
      candidateRevisionId: input.candidateRevisionId,
      changeAction: input.action,
    },
    traceId: context.requestId
  });
}

export function patchJsonValue(content: string, nodePath: string, newValue: string): Buffer {
  const parsed = JSON.parse(content) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("VALIDATION_FAILED", "JSON parameter file root must be an object.");
  }

  const pathSegments = splitNodePath(nodePath);
  setNestedJsonLeaf(parsed as Record<string, unknown>, pathSegments, parseMergedValue(newValue));
  return Buffer.from(JSON.stringify(parsed, null, 2), "utf8");
}

/** Patch a DTS property via CST locate → replace rawText → lossless serialize. */
export function patchDtsProperty(content: string, nodePath: string, newValue: string): Buffer {
  const pathSegments = splitNodePath(nodePath);
  if (pathSegments.length < 2) {
    throw new ApiError("VALIDATION_FAILED", "DTS writeback requires module/property node path.", { nodePath });
  }

  const propertyName = pathSegments[pathSegments.length - 1];
  const targetNodePath = pathSegments.slice(0, -1).join("/");

  let doc;
  try {
    doc = parseDts(content);
  } catch (error) {
    throw new ApiError("VALIDATION_FAILED", "Failed to parse DTS content for writeback.", {
      nodePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  const resolved = resolveDts(doc);
  const node = resolved.nodes.find((entry) => entry.nodePath === targetNodePath);
  if (!node) {
    throw new ApiError("CONFLICT", "Unable to locate DTS module path for writeback.", {
      nodePath,
      missingSegment: targetNodePath
    });
  }

  const property = node.properties.find((entry) => entry.name === propertyName);
  if (!property) {
    throw new ApiError("CONFLICT", "Unable to locate DTS property for writeback.", {
      nodePath,
      propertyName
    });
  }

  if (property.valueType === "bool" || property.valueType === "empty") {
    throw new ApiError("CONFLICT", "Cannot write a value onto a boolean/empty DTS property.", {
      nodePath,
      propertyName,
      valueType: property.valueType
    });
  }

  const originalSpanText = content.slice(property.cst.span.start, property.cst.span.end);
  const writebackRawText = indentDtsRawValueForWriteback(
    newValue,
    content,
    property.cst.span.start,
    originalSpanText
  );
  const classified = classifyDtsValue(writebackRawText, propertyName);
  property.cst.rawText = writebackRawText;
  property.cst.valueType = classified.valueType;
  property.cst.normalizedValue = classified.normalizedValue;

  return Buffer.from(serializeDts(doc), "utf8");
}

export async function writebackMergedEnablementValue(
  db: AuditTx,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: WritebackMergedEnablementValueInput,
  context: WritebackServiceContext,
): Promise<
  | { skipped: true }
  | {
      skipped: false;
      fileId: string;
      versionId: string;
      versionNumber: number;
      candidateRevisionId?: string;
    }
> {
  const trustedContext = assertTrustedSensitiveNodeWriteContext(auth, context, "enablement writeback");
  const { lock } = await resolveLockedEnablementWritebackContext(db, auth, input);
  const nodePath = `${lock.sourceNodePath}/status`;

  await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    nodePath,
    sourceFileName: lock.overlayFileName,
    sourceFileVersionId: lock.sourceFileVersionId,
    sourcePath: { kind: "property-path", value: `${lock.sourceNodePath}/status` },
    invocation: trustedContext.invocation,
    requestId: trustedContext.requestId,
    refusalSink: trustedContext.refusalSink,
  });

  const applied = await applyLockedEnablementWriteback(
    db,
    auth,
    {
      lock,
      mergedValue: input.mergedValue,
      action: input.action ?? "set",
    },
    {
      objectStore,
      skipSemanticGates: trustedContext.skipSemanticGates,
      toolchain: trustedContext.toolchain ?? createDtsToolchainRunner(),
      createdByUserId: trustedAccountableUser(trustedContext.invocation)?.id ?? null,
      attribution: trustedDomainAttribution(trustedContext.invocation),
    },
  );

  await createWritebackAudit(
    db,
    auth,
    {
      projectId: input.projectId,
      parameterDefinitionId: input.logicalNodeId,
      nodePath,
      fileId: applied.fileId,
      fileName: lock.overlayFileName,
      versionNumber: applied.versionNumber,
      candidateRevisionId: applied.candidateRevisionId,
      action: input.action ?? "set",
    },
    trustedContext,
  );

  return {
    skipped: false,
    fileId: applied.fileId,
    versionId: applied.fileVersionId,
    versionNumber: applied.versionNumber,
    candidateRevisionId: applied.candidateRevisionId,
  };
}

export async function writebackMergedParameterValue(
  db: AuditTx,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: WritebackMergedParameterValueInput,
  context: WritebackServiceContext
): Promise<
  | { skipped: true }
  | {
      skipped: false;
      fileId: string;
      versionId: string;
      versionNumber: number;
      candidateRevisionId?: string;
      bindingRevisionId?: string;
    }
> {
  const trustedContext = assertTrustedSensitiveNodeWriteContext(auth, context, "parameter writeback");
  if (parameterIdentityMode() === "semantic") {
    if (!input.projectParameterBindingId) {
      throw new ApiError("CONFLICT", "Semantic writeback requires bound source file and occurrence.", {
        projectId: input.projectId,
        projectParameterBindingId: input.projectParameterBindingId,
      });
    }

    const { lock, parameterSpecVersionId } = await resolveLockedWritebackContext(db, auth, input);
    const nodePath = `${lock.sourceNodePath}/${lock.propertyKey}`;

    await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      nodePath,
      sourceFileName: lock.overlayFileName,
      sourceFileVersionId: lock.sourceFileVersionId,
      sourcePath: { kind: "property-path", value: `${lock.sourceNodePath}/${lock.propertyKey}` },
      invocation: trustedContext.invocation,
      requestId: trustedContext.requestId,
      refusalSink: trustedContext.refusalSink,
    });

    const applied = await applyLockedOverlayWriteback(
      db,
      auth,
      {
        lock,
        bindingId: input.projectParameterBindingId,
        parameterSpecId: input.parameterSpecId ?? input.parameterDefinitionId,
        parameterSpecVersionId,
        mergedValue: input.mergedValue,
        action: input.action ?? "set",
      },
      {
        objectStore,
        skipSemanticGates: trustedContext.skipSemanticGates,
        toolchain: trustedContext.toolchain ?? createDtsToolchainRunner(),
        createdByUserId: trustedAccountableUser(trustedContext.invocation)?.id ?? null,
        attribution: trustedDomainAttribution(trustedContext.invocation),
      },
    );

    await createWritebackAudit(
      db,
      auth,
      {
        projectId: input.projectId,
        parameterDefinitionId: input.parameterDefinitionId,
        nodePath,
        fileId: applied.fileId,
        fileName: lock.overlayFileName,
        versionNumber: applied.versionNumber,
        projectParameterBindingId: input.projectParameterBindingId,
        parameterSpecId: input.parameterSpecId,
        candidateRevisionId: applied.candidateRevisionId,
        action: input.action ?? "set",
      },
      trustedContext,
    );

    return {
      skipped: false,
      fileId: applied.fileId,
      versionId: applied.fileVersionId,
      versionNumber: applied.versionNumber,
      candidateRevisionId: applied.candidateRevisionId,
      ...(applied.bindingRevisionId ? { bindingRevisionId: applied.bindingRevisionId } : {}),
    };
  }

  const source = await loadWritebackSource(db, auth, input);
  if (!source) {
    throw new ApiError("NOT_FOUND", "Project parameter value for writeback was not found.", {
      projectId: input.projectId,
      parameterDefinitionId: input.parameterDefinitionId
    });
  }
  if (!source.sourceFileName || !source.sourceNodePath) {
    return { skipped: true };
  }

  const file = await getProjectParameterFileByName(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    fileName: source.sourceFileName
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Source project parameter file was not found for writeback.", {
      sourceFileName: source.sourceFileName
    });
  }
  if (!file.currentVersionId) {
    throw new ApiError("CONFLICT", "Project parameter file has no current version for writeback.", {
      fileId: file.id
    });
  }

  const currentVersion = await getFileVersionById(db, { versionId: file.currentVersionId });
  if (!currentVersion || currentVersion.fileId !== file.id) {
    throw new ApiError("NOT_FOUND", "Current project parameter file version was not found for writeback.", {
      versionId: file.currentVersionId
    });
  }

  await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    nodePath: source.sourceNodePath,
    sourceFileName: source.sourceFileName,
    sourceFileVersionId: currentVersion.id,
    sourcePath: { kind: "property-path", value: source.sourceNodePath },
    invocation: trustedContext.invocation,
    requestId: trustedContext.requestId,
    refusalSink: trustedContext.refusalSink
  });

  const currentBytes = await objectStore.get(currentVersion.storageKey);
  const patchedBytes = patchByFormat(currentBytes.toString("utf8"), file.format, source.sourceNodePath, input.mergedValue);
  const parsedIndex =
    file.format === "json"
      ? buildJsonParsedIndex(patchedBytes.toString("utf8"))
      : buildDtsParsedIndex(patchedBytes.toString("utf8"));
  const stored = await objectStore.put({
    organizationId: auth.organization.id,
    fileName: file.fileName,
    contentType: contentTypeForFormat(file.format),
    bytes: patchedBytes
  });

  const version = await insertFileVersion(db, {
    id: randomUUID(),
    fileId: file.id,
    versionNumber: (file.currentVersionNumber ?? 0) + 1,
    storageKey: stored.storageKey,
    checksum: stored.checksumSha256,
    sizeBytes: stored.fileSizeBytes,
    parsedIndex,
    origin: "writeback",
    createdByUserId: trustedAccountableUser(trustedContext.invocation)?.id ?? undefined,
    attribution: trustedDomainAttribution(trustedContext.invocation)
  });

  await setCurrentVersion(db, { fileId: file.id, versionId: version.id });
  if (file.format === "dts" && isDtsStructuralIngestEnabled()) {
    await ingestDtsFileVersion(db, version.id, patchedBytes.toString("utf8"));
  }
  await createWritebackAudit(
    db,
    auth,
    {
      projectId: input.projectId,
      parameterDefinitionId: input.parameterDefinitionId,
      nodePath: source.sourceNodePath,
      fileId: file.id,
      fileName: file.fileName,
      versionNumber: version.versionNumber,
      projectParameterBindingId: input.projectParameterBindingId,
      parameterSpecId: input.parameterSpecId,
      action: input.action ?? "set"
    },
    trustedContext
  );

  return {
    skipped: false,
    fileId: file.id,
    versionId: version.id,
    versionNumber: version.versionNumber
  };
}
