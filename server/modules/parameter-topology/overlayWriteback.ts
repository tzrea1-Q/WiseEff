/**
 * Locked overlay writeback pipeline: patch or create a property via write
 * identity (checksum + occurrence/node CST span), load file bytes from the
 * object store, ingest a candidate config revision, and run semantic gates.
 * Shared base files are never mutated; project differences land in overlay.
 */

import { createHash, randomUUID } from "node:crypto";

import { parseDts, serializeDts, type DtsNodeCst, type DtsPropertyCst } from "../dts";
import { indentDtsRawValueForWriteback } from "../dts/rawValueWriteback";
import { parseDtsValue } from "../dts/valueAst";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { countOpenSpecReviewTasksForRevision } from "../parameter-specs/repository";
import {
  countBlockingIdentityMappingTasksForRevision,
  syncSingletonCardinalityBlockingTasks,
  upsertBindingRevisionValues,
} from "./bindingService";
import {
  assertCanPromoteCandidateToDraft,
  type CandidateGateFailureReason,
} from "./candidateRevisionStateMachine";
import {
  assertManifestStateReady,
  MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
  normalizePersistedManifest,
} from "./configRevisionManifest";
import { ingestConfigRevisionInTransaction } from "./ingestService";
import { listStructuralPropertyKeys } from "./parameterSurface";
import { getConfigRevisionById, updateConfigRevisionStatus } from "./repository";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember } from "./types";
import type { BindingEditAction, CreateBindingDraftDeps } from "./editService";
import {
  verifyBindingWriteLock,
  verifyEnablementWriteLock,
  loadRevisionMembers,
  type BindingWriteLockContext,
  type EnablementWriteLockContext,
} from "./writeLock";

export function throwIfManifestNeedsReview(revision: { id: string; manifestState?: string }): void {
  const gate = assertManifestStateReady(
    revision.manifestState as "complete" | "needs_review" | undefined,
  );
  if (!gate) {
    return;
  }
  throw new ApiError("CONFLICT", gate.message, 409, {
    reason: MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
    failureCode: MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
    configRevisionId: revision.id,
  });
}

export function checksumOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Prefer object-store bytes for the file version. Fall back to parsed_index.sourceText
 * only for fixtures that never wrote store objects.
 */
export async function loadFileContentFromVersion(
  db: Queryable,
  fileVersionId: string,
  objectStore?: ObjectStore,
): Promise<string> {
  const result = await db.query<{
    checksum: string;
    storage_key: string;
    parsed_index: unknown;
  }>(
    `
    select checksum, storage_key, parsed_index
    from project_parameter_file_versions
    where id = $1
    limit 1
    `,
    [fileVersionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "File version was not found for binding edit.", 404, { fileVersionId });
  }

  if (objectStore) {
    try {
      const bytes = await objectStore.get(row.storage_key);
      return bytes.toString("utf8");
    } catch {
      // Fall through to fixture sidecar when store miss (tests without put).
    }
  }

  if (row.parsed_index && typeof row.parsed_index === "object" && !Array.isArray(row.parsed_index)) {
    const source = (row.parsed_index as Record<string, unknown>).sourceText;
    if (typeof source === "string") return source;
  }

  throw new ApiError("CONFLICT", "File version content is unavailable for binding edit.", 409, {
    fileVersionId,
    storageKey: row.storage_key,
  });
}

function findAllOverlayNodesByRef(nodes: DtsNodeCst[], refName: string): DtsNodeCst[] {
  const matches: DtsNodeCst[] = [];
  const walk = (node: DtsNodeCst) => {
    if (node.refTarget === refName) matches.push(node);
    for (const child of node.children) {
      if (child.kind === "node") walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return matches;
}

function findPropertyByExactSpan(
  nodes: DtsNodeCst[],
  span: { start: number; end: number },
): { property: DtsPropertyCst; parent: DtsNodeCst } | null {
  for (const node of nodes) {
    for (const child of node.children) {
      if (
        child.kind === "property" &&
        child.span.start === span.start &&
        child.span.end === span.end
      ) {
        return { property: child, parent: node };
      }
      if (child.kind === "node") {
        const found = findPropertyByExactSpan([child], span);
        if (found) return found;
      }
    }
  }
  return null;
}

function findNodeByExactSpan(nodes: DtsNodeCst[], span: { start: number; end: number }): DtsNodeCst | null {
  for (const node of nodes) {
    if (node.span.start === span.start && node.span.end === span.end) return node;
    for (const child of node.children) {
      if (child.kind === "node") {
        const found = findNodeByExactSpan([child], span);
        if (found) return found;
      }
    }
  }
  return null;
}

function propertyStatementSpan(
  content: string,
  property: DtsPropertyCst,
  propertyKey: string,
  parent: DtsNodeCst,
): { start: number; end: number } {
  const searchFrom = Math.max(parent.span.start, 0);
  const nameStart = content.lastIndexOf(propertyKey, property.span.start);
  if (nameStart < searchFrom) {
    throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
      reason: "stale-span",
      propertyKey,
      span: property.span,
    });
  }
  const between = content.slice(nameStart + propertyKey.length, property.span.start);
  if (property.rawText.length > 0) {
    if (!/^\s*=\s*$/.test(between)) {
      throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
        reason: "stale-span",
        propertyKey,
        span: property.span,
      });
    }
  } else if (!/^\s*$/.test(between)) {
    throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
      reason: "stale-span",
      propertyKey,
      span: property.span,
    });
  }
  const semi = content.indexOf(";", property.span.end);
  if (semi < 0 || semi > parent.span.end) {
    throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
      reason: "stale-span",
      propertyKey,
      span: property.span,
    });
  }
  return { start: nameStart, end: semi + 1 };
}

function insertAfterNodeOpenBrace(content: string, node: DtsNodeCst, insertion: string): string {
  const openBrace = content.indexOf("{", node.span.start);
  if (openBrace < 0 || openBrace >= node.span.end) {
    throw new ApiError("CONFLICT", "Unable to locate overlay node body for write.", 409, {
      reason: "stale-span",
      nodeSpan: node.span,
    });
  }
  return `${content.slice(0, openBrace + 1)}\n${insertion}${content.slice(openBrace + 1)}`;
}

function resolveInsertTargetNode(
  docRoots: DtsNodeCst[],
  input: { targetRef: string; nodeSpan?: { start: number; end: number } },
): DtsNodeCst | null {
  if (input.nodeSpan) {
    const bySpan = findNodeByExactSpan(docRoots, input.nodeSpan);
    if (!bySpan) {
      throw new ApiError("CONFLICT", "Overlay node occurrence span is stale.", 409, {
        reason: "stale-span",
        nodeSpan: input.nodeSpan,
        targetRef: input.targetRef,
      });
    }
    return bySpan;
  }
  const matches = findAllOverlayNodesByRef(docRoots, input.targetRef);
  if (matches.length > 1) {
    throw new ApiError("CONFLICT", "Ambiguous overlay target ref for binding edit.", 409, {
      reason: "ambiguous-overlay-target",
      targetRef: input.targetRef,
      matchCount: matches.length,
    });
  }
  return matches[0] ?? null;
}

/**
 * Patch or create a property using write identity (checksum + occurrence/node CST span).
 * Never falls back to the first `&ref` match when an occurrence span is known.
 */
export function ensureOverlayProperty(
  content: string,
  input: {
    propertyKey: string;
    rawText: string | null;
    action: BindingEditAction;
    targetRef: string;
    expectedChecksum: string;
    occurrenceSpan?: { start: number; end: number };
    expectedRawText?: string | null;
    nodeSpan?: { start: number; end: number };
  },
): string {
  const { propertyKey, rawText, action, targetRef } = input;
  if (!targetRef.trim()) {
    throw new ApiError("CONFLICT", "Overlay write requires an explicit target ref.", 409, {
      reason: "missing-overlay-target-ref",
      propertyKey,
    });
  }

  if (checksumOf(content) !== input.expectedChecksum) {
    throw new ApiError("CONFLICT", "Overlay file checksum is stale for binding edit.", 409, {
      reason: "stale-checksum",
      propertyKey,
      expectedChecksum: input.expectedChecksum,
      actualChecksum: checksumOf(content),
    });
  }

  const doc = parseDts(content);

  if (input.occurrenceSpan) {
    const slice = content.slice(input.occurrenceSpan.start, input.occurrenceSpan.end);
    if (input.expectedRawText != null && slice !== input.expectedRawText) {
      throw new ApiError("CONFLICT", "Occurrence CST span is stale for binding edit.", 409, {
        reason: "stale-span",
        propertyKey,
        occurrenceSpan: input.occurrenceSpan,
      });
    }

    const located = findPropertyByExactSpan(doc.topLevel, input.occurrenceSpan);
    if (!located || located.property.name !== propertyKey) {
      throw new ApiError("CONFLICT", "Occurrence CST span is stale for binding edit.", 409, {
        reason: "stale-span",
        propertyKey,
        occurrenceSpan: input.occurrenceSpan,
      });
    }

    if (action === "delete") {
      const statement = propertyStatementSpan(content, located.property, propertyKey, located.parent);
      return (
        content.slice(0, statement.start) +
        `/delete-property/ ${propertyKey};` +
        content.slice(statement.end)
      );
    }

    located.property.rawText = indentDtsRawValueForWriteback(
      rawText ?? "",
      content,
      located.property.span.start,
      content.slice(located.property.span.start, located.property.span.end)
    );
    return serializeDts(doc);
  }

  // Base-only / no overlay occurrence: insert into the precise overlay node (by node span).
  const target = resolveInsertTargetNode(doc.topLevel, {
    targetRef,
    nodeSpan: input.nodeSpan,
  });

  if (action === "delete") {
    if (target) {
      const existingDelete = target.children.find(
        (child) => child.kind === "delete-property" && child.name === propertyKey,
      );
      if (existingDelete) return content;
      return insertAfterNodeOpenBrace(content, target, `\t/delete-property/ ${propertyKey};`);
    }
    return `${content.trimEnd()}\n&${targetRef} {\n\t/delete-property/ ${propertyKey};\n};\n`;
  }

  const assignment = `\t${propertyKey} = ${rawText};`;
  if (target) {
    const existing = target.children.find(
      (child): child is DtsPropertyCst => child.kind === "property" && child.name === propertyKey,
    );
    if (existing) {
      existing.rawText = indentDtsRawValueForWriteback(
        rawText ?? "",
        content,
        existing.span.start,
        content.slice(existing.span.start, existing.span.end)
      );
      return serializeDts(doc);
    }
    return insertAfterNodeOpenBrace(content, target, assignment);
  }
  return `${content.trimEnd()}\n&${targetRef} {\n${assignment}\n};\n`;
}

export async function loadCandidateSemanticGateCounts(
  db: Queryable,
  input: { organizationId: string; projectId: string; configRevisionId: string },
): Promise<{
  openIdentityMappings: number;
  openSpecReviews: number;
  unmatchedOccurrences: number;
  ambiguousBindings: number;
  resolverErrorDiagnostics: number;
}> {
  await syncSingletonCardinalityBlockingTasks(db, input);
  const openIdentityMappings = await countBlockingIdentityMappingTasksForRevision(db, input);

  // Structural DTS keys are not parameter-spec review material; exclude from candidate gates.
  const structuralKeys = listStructuralPropertyKeys();

  const openSpecReviews = await countOpenSpecReviewTasksForRevision(db, {
    ...input,
    excludePropertyKeys: structuralKeys,
  });

  const unmatchedOccurrences = await countOpenSpecReviewTasksForRevision(db, {
    ...input,
    excludePropertyKeys: structuralKeys,
    unmatchedOnly: true,
  });

  const resolverErrors = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from dts_validation_diagnostics d
    inner join dts_validation_runs r on r.id = d.validation_run_id
    where r.config_revision_id = $1
      and r.stage = 'resolve'
      and d.severity = 'error'
    `,
    [input.configRevisionId],
  );

  const openSpecReviewsCount = openSpecReviews;
  return {
    openIdentityMappings,
    openSpecReviews: openSpecReviewsCount,
    unmatchedOccurrences,
    ambiguousBindings: openIdentityMappings,
    resolverErrorDiagnostics: Number(resolverErrors.rows[0]?.count ?? 0),
  };
}

export async function ensureCandidateKeepStatus(
  db: Queryable,
  candidateRevisionId: string,
  keepStatus: "needs_mapping" | "invalid" | "resolved",
): Promise<void> {
  const current = await db.query<{ status: string }>(
    `select status from dts_config_revisions where id = $1`,
    [candidateRevisionId],
  );
  if (current.rows[0]?.status === keepStatus) {
    return;
  }
  // Never promote blocked statuses upward; only move resolved → invalid/needs_mapping when needed.
  if (current.rows[0]?.status === "needs_mapping" || current.rows[0]?.status === "invalid") {
    return;
  }
  await updateConfigRevisionStatus(db, {
    id: candidateRevisionId,
    status: keepStatus,
    resolvedAt: new Date().toISOString(),
  });
}

export function candidateGateError(
  candidateRevisionId: string,
  reason: CandidateGateFailureReason,
  keepStatus: string,
): ApiError {
  const conflictReasons = new Set([
    "needs-mapping",
    "unresolved-mapping",
    "open-spec-review",
    "unmatched-occurrence",
    "ambiguous-binding",
  ]);
  const isConflict = conflictReasons.has(reason);
  return new ApiError(
    isConflict ? "CONFLICT" : "VALIDATION_FAILED",
    `Candidate config revision failed semantic/toolchain gate (${reason}).`,
    isConflict ? 409 : 400,
    {
      reason,
      candidateRevisionId,
      candidateStatus: keepStatus,
    },
  );
}

export type ApplyLockedEnablementWritebackInput = {
  lock: EnablementWriteLockContext;
  mergedValue: string;
  action?: BindingEditAction;
};

export type ApplyLockedEnablementWritebackResult = {
  fileId: string;
  fileVersionId: string;
  versionNumber: number;
  candidateRevisionId: string;
};

export type ApplyLockedOverlayWritebackInput = {
  lock: BindingWriteLockContext;
  bindingId: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  mergedValue: string;
  action?: BindingEditAction;
};

export type ApplyLockedOverlayWritebackResult = {
  fileId: string;
  fileVersionId: string;
  versionNumber: number;
  candidateRevisionId: string;
  bindingRevisionId?: string;
};

/**
 * Patch the locked overlay file via CST span, ingest a candidate revision,
 * run semantic gates (L0), and upsert binding revision at the candidate.
 * L2 toolchain validate is not fail-closed on merge/writeback hot path.
 */
export async function applyLockedOverlayWriteback(
  db: Database | Queryable,
  auth: AuthContext,
  input: ApplyLockedOverlayWritebackInput,
  deps: CreateBindingDraftDeps = {},
): Promise<ApplyLockedOverlayWritebackResult> {
  await verifyBindingWriteLock(db, input.lock);

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    revisionId: input.lock.baseConfigRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale for writeback.", 409, {
      reason: "stale-revision",
      baseConfigRevisionId: input.lock.baseConfigRevisionId,
    });
  }

  throwIfManifestNeedsReview(revision);

  const members = await loadRevisionMembers(db, input.lock.baseConfigRevisionId);
  const baseMember = members.find((member) => member.role === "base");
  const overlayMember = members.find((member) => member.file_id === input.lock.overlayFileId);
  if (!baseMember || !overlayMember) {
    throw new ApiError("CONFLICT", "Config revision members missing for locked writeback.", 409, {
      reason: "missing-members",
      baseConfigRevisionId: input.lock.baseConfigRevisionId,
    });
  }

  const memberContents = new Map<string, string>();
  for (const member of members) {
    memberContents.set(
      member.file_version_id,
      await loadFileContentFromVersion(db, member.file_version_id, deps.objectStore),
    );
  }

  const overlayContent = memberContents.get(input.lock.sourceFileVersionId);
  if (overlayContent === undefined) {
    throw new ApiError("CONFLICT", "Locked overlay file version is not part of the base revision.", 409, {
      reason: "stale-file-version",
      sourceFileVersionId: input.lock.sourceFileVersionId,
    });
  }

  const action: BindingEditAction = input.action ?? "set";
  const rawText = action === "delete" ? null : input.mergedValue;
  const candidateOverlayContent = ensureOverlayProperty(overlayContent, {
    propertyKey: input.lock.propertyKey,
    rawText,
    action,
    targetRef: input.lock.targetRef,
    expectedChecksum: input.lock.expectedChecksum,
    occurrenceSpan: input.lock.occurrenceSpan ?? undefined,
    expectedRawText: input.lock.expectedRawText,
    nodeSpan: input.lock.nodeSpan,
  });

  const candidateOverlayVersionId = randomUUID();
  const overlayChecksum = checksumOf(candidateOverlayContent);
  let candidateStorageKey = `${auth.organization.id}/${overlayChecksum}-writeback-${overlayMember.file_name}`;

  if (deps.objectStore) {
    const stored = await deps.objectStore.put({
      organizationId: auth.organization.id,
      fileName: overlayMember.file_name,
      contentType: "text/plain",
      bytes: Buffer.from(candidateOverlayContent, "utf8"),
    });
    candidateStorageKey = stored.storageKey;
  }

  const nextVersion = await db.query<{ next: number }>(
    `
    select coalesce(max(version_number), 0) + 1 as next
    from project_parameter_file_versions
    where file_id = $1
    `,
    [overlayMember.file_id],
  );
  const versionNumber = Number(nextVersion.rows[0]?.next ?? 1);

  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'writeback', $8)
    `,
    [
      candidateOverlayVersionId,
      overlayMember.file_id,
      versionNumber,
      candidateStorageKey,
      overlayChecksum,
      Buffer.byteLength(candidateOverlayContent, "utf8"),
      JSON.stringify({ sourceText: candidateOverlayContent }),
      auth.user.id,
    ],
  );

  await db.query(
    `
    update project_parameter_files
    set current_version_id = $2, updated_at = now()
    where id = $1
    `,
    [overlayMember.file_id, candidateOverlayVersionId],
  );

  const overlayOrderFromMembers = members
    .filter((member) => member.role === "overlay")
    .sort((a, b) => a.sort_order - b.sort_order || a.file_name.localeCompare(b.file_name))
    .map((member) => member.file_name);

  const candidateMembers: ConfigRevisionManifestMember[] = members.map((member) => {
    const isEditedOverlay = member.file_id === overlayMember.file_id;
    const content = isEditedOverlay
      ? candidateOverlayContent
      : memberContents.get(member.file_version_id)!;
    return {
      fileId: member.file_id,
      fileVersionId: isEditedOverlay ? candidateOverlayVersionId : member.file_version_id,
      fileName: member.file_name,
      role: member.role,
      sortOrder: member.sort_order,
      content,
    };
  });

  const normalizedManifest = normalizePersistedManifest({
    entryFile: revision.entryFile ?? baseMember.file_name,
    includeSearchPaths: revision.includeSearchPaths ?? ["."],
    overlayOrder:
      revision.overlayOrder && revision.overlayOrder.length > 0
        ? revision.overlayOrder
        : overlayOrderFromMembers,
    members: candidateMembers,
  });
  if (!normalizedManifest.ok) {
    throw new ApiError("VALIDATION_FAILED", normalizedManifest.failure.message, 400, {
      reason: normalizedManifest.failure.code,
    });
  }

  const manifest: ConfigRevisionManifest = {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configSetId: revision.configSetId,
    entryFile: normalizedManifest.manifest.entryFile,
    includeSearchPaths: normalizedManifest.manifest.includeSearchPaths,
    overlayOrder: normalizedManifest.manifest.overlayOrder,
    members: candidateMembers,
  };

  const ingested = await ingestConfigRevisionInTransaction(db, manifest, auth);
  if (ingested.status === "invalid" || ingested.status === "needs_mapping") {
    throw new ApiError(
      ingested.status === "needs_mapping" ? "CONFLICT" : "VALIDATION_FAILED",
      ingested.status === "needs_mapping"
        ? "Writeback candidate revision has unresolved identity mapping."
        : "Writeback candidate revision failed resolve.",
      ingested.status === "needs_mapping" ? 409 : 400,
      {
        reason: ingested.status === "needs_mapping" ? "unresolved-mapping" : "resolve-failure",
        candidateRevisionId: ingested.id,
        candidateStatus: ingested.status,
      },
    );
  }

  const semanticCounts = await loadCandidateSemanticGateCounts(db, {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configRevisionId: ingested.id,
  });
  if (!deps.skipSemanticGates) {
    const earlyGate = assertCanPromoteCandidateToDraft({
      status: ingested.status,
      ...semanticCounts,
      toolchainOk: true,
      toolchainFailureCode: null,
    });
    if (!earlyGate.ok) {
      await ensureCandidateKeepStatus(db, ingested.id, earlyGate.keepStatus);
      throw candidateGateError(ingested.id, earlyGate.reason, earlyGate.keepStatus);
    }
  }

  if (!deps.skipSemanticGates) {
    const finalGate = assertCanPromoteCandidateToDraft({
      status: ingested.status,
      ...semanticCounts,
      toolchainOk: true,
      toolchainFailureCode: null,
    });
    if (!finalGate.ok) {
      await ensureCandidateKeepStatus(db, ingested.id, finalGate.keepStatus);
      throw candidateGateError(ingested.id, finalGate.reason, finalGate.keepStatus);
    }
  }

  await updateConfigRevisionStatus(db, {
    id: ingested.id,
    status: "compiled",
  });

  let bindingRevisionId: string | undefined;
  if (action === "set") {
    const mergedTypedValue = parseDtsValue(input.lock.propertyKey, input.mergedValue).value;
    const bindingRevision = await upsertBindingRevisionValues(db, {
      bindingId: input.bindingId,
      configRevisionId: ingested.id,
      parameterSpecVersionId: input.parameterSpecVersionId,
      values: {
        typedValue: mergedTypedValue,
        canonicalValue: mergedTypedValue,
        rawValue: input.mergedValue,
        schemaState: "valid",
        policyState: "not_applicable",
      },
    });
    bindingRevisionId = bindingRevision.id;
  }

  return {
    fileId: overlayMember.file_id,
    fileVersionId: candidateOverlayVersionId,
    versionNumber,
    candidateRevisionId: ingested.id,
    ...(bindingRevisionId ? { bindingRevisionId } : {}),
  };
}

/**
 * Patch the locked overlay file for node enablement, ingest a candidate revision,
 * and run semantic gates (L0). Does not upsert binding revisions.
 */
export async function applyLockedEnablementWriteback(
  db: Database | Queryable,
  auth: AuthContext,
  input: ApplyLockedEnablementWritebackInput,
  deps: CreateBindingDraftDeps = {},
): Promise<ApplyLockedEnablementWritebackResult> {
  await verifyEnablementWriteLock(db, input.lock);

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    revisionId: input.lock.baseConfigRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale for writeback.", 409, {
      reason: "stale-revision",
      baseConfigRevisionId: input.lock.baseConfigRevisionId,
    });
  }

  throwIfManifestNeedsReview(revision);

  const members = await loadRevisionMembers(db, input.lock.baseConfigRevisionId);
  const baseMember = members.find((member) => member.role === "base");
  const overlayMember = members.find((member) => member.file_id === input.lock.overlayFileId);
  if (!baseMember || !overlayMember) {
    throw new ApiError("CONFLICT", "Config revision members missing for locked writeback.", 409, {
      reason: "missing-members",
      baseConfigRevisionId: input.lock.baseConfigRevisionId,
    });
  }

  const memberContents = new Map<string, string>();
  for (const member of members) {
    memberContents.set(
      member.file_version_id,
      await loadFileContentFromVersion(db, member.file_version_id, deps.objectStore),
    );
  }

  const overlayContent = memberContents.get(input.lock.sourceFileVersionId);
  if (overlayContent === undefined) {
    throw new ApiError("CONFLICT", "Locked overlay file version is not part of the base revision.", 409, {
      reason: "stale-file-version",
      sourceFileVersionId: input.lock.sourceFileVersionId,
    });
  }

  const action: BindingEditAction = input.action ?? "set";
  const rawText = action === "delete" ? null : input.mergedValue;
  const candidateOverlayContent = ensureOverlayProperty(overlayContent, {
    propertyKey: input.lock.propertyKey,
    rawText,
    action,
    targetRef: input.lock.targetRef,
    expectedChecksum: input.lock.expectedChecksum,
    occurrenceSpan: input.lock.occurrenceSpan ?? undefined,
    expectedRawText: input.lock.expectedRawText,
    nodeSpan: input.lock.nodeSpan,
  });

  const candidateOverlayVersionId = randomUUID();
  const overlayChecksum = checksumOf(candidateOverlayContent);
  let candidateStorageKey = `${auth.organization.id}/${overlayChecksum}-writeback-${overlayMember.file_name}`;

  if (deps.objectStore) {
    const stored = await deps.objectStore.put({
      organizationId: auth.organization.id,
      fileName: overlayMember.file_name,
      contentType: "text/plain",
      bytes: Buffer.from(candidateOverlayContent, "utf8"),
    });
    candidateStorageKey = stored.storageKey;
  }

  const nextVersion = await db.query<{ next: number }>(
    `
    select coalesce(max(version_number), 0) + 1 as next
    from project_parameter_file_versions
    where file_id = $1
    `,
    [overlayMember.file_id],
  );
  const versionNumber = Number(nextVersion.rows[0]?.next ?? 1);

  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'writeback', $8)
    `,
    [
      candidateOverlayVersionId,
      overlayMember.file_id,
      versionNumber,
      candidateStorageKey,
      overlayChecksum,
      Buffer.byteLength(candidateOverlayContent, "utf8"),
      JSON.stringify({ sourceText: candidateOverlayContent }),
      auth.user.id,
    ],
  );

  await db.query(
    `
    update project_parameter_files
    set current_version_id = $2, updated_at = now()
    where id = $1
    `,
    [overlayMember.file_id, candidateOverlayVersionId],
  );

  const overlayOrderFromMembers = members
    .filter((member) => member.role === "overlay")
    .sort((a, b) => a.sort_order - b.sort_order || a.file_name.localeCompare(b.file_name))
    .map((member) => member.file_name);

  const candidateMembers: ConfigRevisionManifestMember[] = members.map((member) => {
    const isEditedOverlay = member.file_id === overlayMember.file_id;
    const content = isEditedOverlay
      ? candidateOverlayContent
      : memberContents.get(member.file_version_id)!;
    return {
      fileId: member.file_id,
      fileVersionId: isEditedOverlay ? candidateOverlayVersionId : member.file_version_id,
      fileName: member.file_name,
      role: member.role,
      sortOrder: member.sort_order,
      content,
    };
  });

  const normalizedManifest = normalizePersistedManifest({
    entryFile: revision.entryFile ?? baseMember.file_name,
    includeSearchPaths: revision.includeSearchPaths ?? ["."],
    overlayOrder:
      revision.overlayOrder && revision.overlayOrder.length > 0
        ? revision.overlayOrder
        : overlayOrderFromMembers,
    members: candidateMembers,
  });
  if (!normalizedManifest.ok) {
    throw new ApiError("VALIDATION_FAILED", normalizedManifest.failure.message, 400, {
      reason: normalizedManifest.failure.code,
    });
  }

  const manifest: ConfigRevisionManifest = {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configSetId: revision.configSetId,
    entryFile: normalizedManifest.manifest.entryFile,
    includeSearchPaths: normalizedManifest.manifest.includeSearchPaths,
    overlayOrder: normalizedManifest.manifest.overlayOrder,
    members: candidateMembers,
  };

  const ingested = await ingestConfigRevisionInTransaction(db, manifest, auth);
  if (ingested.status === "invalid" || ingested.status === "needs_mapping") {
    throw new ApiError(
      ingested.status === "needs_mapping" ? "CONFLICT" : "VALIDATION_FAILED",
      ingested.status === "needs_mapping"
        ? "Writeback candidate revision has unresolved identity mapping."
        : "Writeback candidate revision failed resolve.",
      ingested.status === "needs_mapping" ? 409 : 400,
      {
        reason: ingested.status === "needs_mapping" ? "unresolved-mapping" : "resolve-failure",
        candidateRevisionId: ingested.id,
        candidateStatus: ingested.status,
      },
    );
  }

  const semanticCounts = await loadCandidateSemanticGateCounts(db, {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configRevisionId: ingested.id,
  });
  if (!deps.skipSemanticGates) {
    const earlyGate = assertCanPromoteCandidateToDraft({
      status: ingested.status,
      ...semanticCounts,
      toolchainOk: true,
      toolchainFailureCode: null,
    });
    if (!earlyGate.ok) {
      await ensureCandidateKeepStatus(db, ingested.id, earlyGate.keepStatus);
      throw candidateGateError(ingested.id, earlyGate.reason, earlyGate.keepStatus);
    }
  }

  if (!deps.skipSemanticGates) {
    const finalGate = assertCanPromoteCandidateToDraft({
      status: ingested.status,
      ...semanticCounts,
      toolchainOk: true,
      toolchainFailureCode: null,
    });
    if (!finalGate.ok) {
      await ensureCandidateKeepStatus(db, ingested.id, finalGate.keepStatus);
      throw candidateGateError(ingested.id, finalGate.reason, finalGate.keepStatus);
    }
  }

  await updateConfigRevisionStatus(db, {
    id: ingested.id,
    status: "compiled",
  });

  return {
    fileId: overlayMember.file_id,
    fileVersionId: candidateOverlayVersionId,
    versionNumber,
    candidateRevisionId: ingested.id,
  };
}
