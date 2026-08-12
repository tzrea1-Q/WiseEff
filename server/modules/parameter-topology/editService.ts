/**
 * Typed binding edits → overlay write targets → draft + candidate config revision.
 *
 * Shared base files are never mutated; project differences land in overlay.
 * Writes target the binding's stable logical node (never first &ref / charging_core default).
 * Release/edit gates fail closed on unresolved mapping and schema constraints.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  measureStatusSpelling,
  resolveEnablementWrite,
  type EnablementEditTarget,
  type StatusSpelling,
} from "../../../src/domain/parameter-topology/enablementEdit";
import type { AuthContext } from "../auth/types";
import { parseDts, serializeDts, type DtsNodeCst, type DtsPropertyCst } from "../dts";
import { indentDtsRawValueForWriteback } from "../dts/rawValueWriteback";
import type { DtsValue } from "../dts/types";
import { parseDtsValue, renderDtsValue } from "../dts/valueAst";
import type { ObjectStore } from "../logs/objectStore";
import {
  type DtsToolchainRunner,
} from "../parameter-files/dtsToolchain";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { countOpenSpecReviewTasksForRevision } from "../parameter-specs/repository";
import { canEditParameters } from "../parameters/policy";
import { mustUseSemanticParameterIdentity } from "../parameters/semanticParameterReads";
import { ensurePreCutoverLinkedParameterValue } from "../parameters/legacyParameterIdentityAdapter";
import { assertSensitiveNodeWriteAllowed } from "../parameters/sensitiveNode";
import {
  upsertDraft,
  upsertEnablementDraft,
  listOpenBindingDraftsForUser,
  rebaseOpenBindingDraftCandidates,
} from "../parameters/repository";
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
import {
  getConfigRevisionById,
  insertValidationDiagnostics,
  insertValidationRun,
  updateConfigRevisionStatus,
} from "./repository";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember, PersistedValidationDiagnostic } from "./types";
import { writeGovernanceAudit } from "./governanceAudit";
import {
  loadBindingContext,
  loadLogicalNodeEnablementContext,
  loadRevisionMembers,
  resolveWriteTarget,
  verifyBindingWriteLock,
  verifyEnablementWriteLock,
  type BindingWriteLockContext,
  type EnablementWriteLockContext,
} from "./writeLock";

function throwIfManifestNeedsReview(revision: { id: string; manifestState?: string }): void {
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

export type BindingEditAction = "set" | "delete";

export type CreateBindingDraftInput = {
  bindingId: string;
  baseRevisionId: string;
  /** Required when action is "set" (default). */
  targetValue?: DtsValue;
  action?: BindingEditAction;
  reason: string;
  /**
   * @deprecated Schema enforcement is always on for the normal path.
   * Callers cannot disable it; this field is ignored when false.
   */
  enforceSchema?: boolean;
};

export type CreateBindingDraftDeps = {
  /** Injected for tests; production defaults to the real Task 8 runner. */
  toolchain?: DtsToolchainRunner;
  /** Preferred source of file bytes by version storage key. */
  objectStore?: ObjectStore;
  /** Test-only: skip semantic promotion gates after resolve/toolchain. */
  skipSemanticGates?: boolean;
};

export type BindingDraftWriteTarget = {
  /** `base` when the project-primary DTS is the sole config member; `overlay` for legacy base+overlay sets. */
  role: "base" | "overlay" | "project-occurrence";
  propertyKey: string;
  fileId?: string;
  fileName?: string;
  fileVersionId?: string;
  checksum?: string;
  nodeLocator?: string;
  occurrenceId?: string;
  occurrenceSpan?: { start: number; end: number };
  nodeSpan?: { start: number; end: number };
  targetRef?: string;
};

export type BindingDraftResult = {
  draftId: string;
  /** Identifier accepted by the submission API (binding id after cutover). */
  parameterId: string;
  writeTarget: BindingDraftWriteTarget;
  candidateRevisionId: string;
  workingCandidateRevisionId: string;
  rebasedDraftIds: string[];
  rawText: string;
  action: BindingEditAction;
  parameterSpecId: string;
  projectParameterBindingId: string;
  /** Base member content after draft (must equal pre-edit for shared-base protection). */
  baseContent: string;
  baseChecksumBefore: string;
  baseChecksumAfter: string;
  candidateOverlayContent: string;
  overlayFileId: string;
  overlayFileName: string;
};

export type CreateNodeEnablementDraftInput = {
  projectId: string;
  logicalNodeId: string;
  baseRevisionId: string;
  target: EnablementEditTarget;
  reason: string;
  acknowledgeNonstandard?: boolean;
  spellingOverride?: StatusSpelling;
};

export type NodeEnablementDraftResult = {
  draftId: string;
  candidateRevisionId: string;
  workingCandidateRevisionId: string;
  rebasedDraftIds: string[];
  action: BindingEditAction;
  rawText: string;
  logicalNodeId: string;
  writeTarget: BindingDraftWriteTarget;
  overlayFileId: string;
  overlayFileName: string;
  /** Previous effective status raw text (null when unstated). */
  previousRaw: string | null;
  target: EnablementEditTarget;
};

function requireCanEdit(auth: AuthContext) {
  if (!canEditParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter edit permission required.", 403);
  }
}

export function checksumOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function asConstraintNumber(constraints: unknown, key: "min" | "max"): number | undefined {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) return undefined;
  const value = (constraints as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cellIntegerValues(value: DtsValue): number[] {
  if (value.kind !== "cells") return [];
  const out: number[] = [];
  for (const group of value.groups) {
    for (const cell of group) {
      if (cell.kind === "integer") {
        const parsed = Number(cell.value);
        if (Number.isFinite(parsed)) out.push(parsed);
      }
    }
  }
  return out;
}

function cellGroupSizes(value: DtsValue): number[] {
  if (value.kind !== "cells") return [];
  return value.groups.map((group) => group.length);
}

function asConstraintCells(constraints: unknown): number | undefined {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) return undefined;
  const value = (constraints as Record<string, unknown>).cells;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assertSchemaAllows(value: DtsValue, constraints: unknown): void {
  const expectedCells = asConstraintCells(constraints);
  if (expectedCells !== undefined) {
    const sizes = cellGroupSizes(value);
    if (sizes.length === 0 || sizes.some((size) => size !== expectedCells)) {
      throw new ApiError("VALIDATION_FAILED", `cell count must be ${expectedCells}`, 400, {
        reason: "schema-failure",
        code: "SCHEMA_CELL_COUNT",
        expectedCells,
        actualCells: sizes,
      });
    }
  }

  const min = asConstraintNumber(constraints, "min");
  const max = asConstraintNumber(constraints, "max");
  if (min === undefined && max === undefined) return;

  for (const numeric of cellIntegerValues(value)) {
    if (min !== undefined && numeric < min) {
      throw new ApiError("VALIDATION_FAILED", "Value is below schema minimum.", 400, {
        reason: "schema-failure",
        min,
        value: numeric,
      });
    }
    if (max !== undefined && numeric > max) {
      throw new ApiError("VALIDATION_FAILED", "Value exceeds schema maximum.", 400, {
        reason: "schema-failure",
        max,
        value: numeric,
      });
    }
  }
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

/**
 * Initialization / suggestion helper — never treats exampleValue as enforced.
 * Prefer policyTarget, then schemaDefault; example is labeled separately.
 */
export function resolveInitializationSuggestion(input: {
  policyTarget?: unknown;
  schemaDefault?: unknown;
  exampleValue?: unknown;
}): {
  suggestion: unknown | null;
  exampleValue: unknown | null;
  exampleEnforced: false;
  source: "policyTarget" | "schemaDefault" | null;
} {
  if (input.policyTarget != null) {
    return {
      suggestion: input.policyTarget,
      exampleValue: input.exampleValue ?? null,
      exampleEnforced: false,
      source: "policyTarget",
    };
  }
  if (input.schemaDefault != null) {
    return {
      suggestion: input.schemaDefault,
      exampleValue: input.exampleValue ?? null,
      exampleEnforced: false,
      source: "schemaDefault",
    };
  }
  return {
    suggestion: null,
    exampleValue: input.exampleValue ?? null,
    exampleEnforced: false,
    source: null,
  };
}

export async function unchangedSourceBytes(draft: BindingDraftResult): Promise<boolean> {
  return draft.baseChecksumBefore === draft.baseChecksumAfter && draft.baseChecksumAfter === checksumOf(draft.baseContent);
}

async function carryForwardBindingRevisions(
  db: Queryable,
  input: { baseRevisionId: string; candidateRevisionId: string; excludeBindingId?: string },
): Promise<void> {
  const rows = await db.query<{
    binding_id: string;
    parameter_spec_version_id: string;
    typed_value: unknown;
    canonical_value: unknown;
    raw_value: string | null;
    schema_state: string | null;
    policy_state: string | null;
  }>(
    `
    select
      br.binding_id,
      br.parameter_spec_version_id,
      br.typed_value,
      br.canonical_value,
      br.raw_value,
      br.schema_state,
      br.policy_state
    from project_parameter_binding_revisions br
    where br.config_revision_id = $1
      and ($3::text is null or br.binding_id <> $3)
      and not exists (
        select 1
        from project_parameter_binding_revisions existing
        where existing.binding_id = br.binding_id
          and existing.config_revision_id = $2
      )
    `,
    [input.baseRevisionId, input.candidateRevisionId, input.excludeBindingId ?? null],
  );

  for (const row of rows.rows) {
    await db.query(
      `
      insert into project_parameter_binding_revisions (
        id, binding_id, config_revision_id, parameter_spec_version_id,
        typed_value, canonical_value, raw_value, schema_state, policy_state
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
      `,
      [
        randomUUID(),
        row.binding_id,
        input.candidateRevisionId,
        row.parameter_spec_version_id,
        JSON.stringify(row.typed_value),
        row.canonical_value === null || row.canonical_value === undefined
          ? null
          : JSON.stringify(row.canonical_value),
        row.raw_value,
        row.schema_state,
        row.policy_state,
      ],
    );
  }
}

/**
 * Create a typed binding draft that patches (or creates) a project overlay target,
 * stores a full candidate config revision (all members preserved), re-resolves +
 * toolchain-validates fail-closed, and writes semantic FKs on the draft row.
 */
export async function createBindingDraft(
  db: Database | Queryable,
  auth: AuthContext,
  input: CreateBindingDraftInput,
  deps: CreateBindingDraftDeps = {},
): Promise<BindingDraftResult> {
  requireCanEdit(auth);

  const action: BindingEditAction = input.action ?? "set";
  if (action === "set" && !input.targetValue) {
    throw new ApiError("VALIDATION_FAILED", "targetValue is required for set action.", 400);
  }

  const binding = await loadBindingContext(db, auth, input.bindingId);

  const openDrafts = await listOpenBindingDraftsForUser(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    userId: auth.user.id,
  });
  const openWorkingTips = [
    ...new Set(
      openDrafts
        .map((draft) => draft.candidateConfigRevisionId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (openWorkingTips.length > 1) {
    throw new ApiError(
      "CONFLICT",
      "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。",
      409,
      { reason: "mixed-working-tips" },
    );
  }
  const resolvedWorkingTip = openWorkingTips[0] ?? null;
  const sameBindingOpenDraft = openDrafts.find(
    (draft) =>
      draft.editSubjectKind === "binding" &&
      draft.projectParameterBindingId === binding.binding_id,
  );

  let effectiveBaseRevisionId = input.baseRevisionId;
  if (resolvedWorkingTip && input.baseRevisionId !== resolvedWorkingTip) {
    if (sameBindingOpenDraft) {
      effectiveBaseRevisionId = resolvedWorkingTip;
    } else {
      throw new ApiError(
        "CONFLICT",
        "请刷新后基于本轮最新工作版本继续编辑。",
        409,
        {
          reason: "stale-working-tip",
          bindingId: input.bindingId,
          baseRevisionId: input.baseRevisionId,
          workingCandidateRevisionId: resolvedWorkingTip,
        },
      );
    }
  }

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    revisionId: effectiveBaseRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale or missing.", 409, {
      reason: "stale-revision",
      bindingId: input.bindingId,
      baseRevisionId: input.baseRevisionId,
    });
  }

  throwIfManifestNeedsReview(revision);

  const bindingRevision = await db.query<{ id: string }>(
    `
    select id from project_parameter_binding_revisions
    where binding_id = $1 and config_revision_id = $2
    limit 1
    `,
    [input.bindingId, effectiveBaseRevisionId],
  );
  if (!bindingRevision.rows[0]) {
    throw new ApiError("CONFLICT", "Base config revision is stale for this binding.", 409, {
      reason: "stale-revision",
      bindingId: input.bindingId,
      baseRevisionId: input.baseRevisionId,
    });
  }

  if (revision.status === "needs_mapping") {
    throw new ApiError("CONFLICT", "Config revision has unresolved identity mapping.", 409, {
      reason: "unresolved-mapping",
      configRevisionId: revision.id,
    });
  }
  if (revision.status === "invalid") {
    throw new ApiError("CONFLICT", "Config revision is invalid and cannot accept edits.", 409, {
      reason: "invalid-revision",
      configRevisionId: revision.id,
    });
  }

  // Schema enforcement is ON by default; callers cannot turn it off for the normal path.
  if (action === "set" && input.targetValue) {
    assertSchemaAllows(input.targetValue, binding.constraints);
  }

  const {
    writeTarget,
    overlayMember,
    baseMember,
    members,
    targetRef,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
  } = await resolveWriteTarget(db, {
    configRevisionId: revision.id,
    logicalNodeId: binding.logical_node_id,
    propertyKey: binding.property_key,
    nodeLocator: binding.node_locator,
  });

  const memberContents = new Map<string, string>();
  for (const member of members) {
    try {
      const content = await loadFileContentFromVersion(db, member.file_version_id, deps.objectStore);
      memberContents.set(member.file_version_id, content);
    } catch (error) {
      throw new ApiError("CONFLICT", "Config set source text unavailable for typed edit.", 409, {
        reason: "missing-source-text",
        fileVersionId: member.file_version_id,
        fileName: member.file_name,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const baseContent = memberContents.get(baseMember.file_version_id)!;
  const overlayContent = memberContents.get(overlayMember.file_version_id)!;
  const baseChecksumBefore = checksumOf(baseContent);
  const rawText = action === "delete" ? "" : renderDtsValue(input.targetValue!, undefined);

  const candidateOverlayContent = ensureOverlayProperty(overlayContent, {
    propertyKey: binding.property_key,
    rawText: action === "delete" ? null : rawText,
    action,
    targetRef,
    expectedChecksum: overlayMember.checksum,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
  });

  const candidateOverlayVersionId = randomUUID();
  const overlayChecksum = checksumOf(candidateOverlayContent);
  let candidateStorageKey = `${auth.organization.id}/${overlayChecksum}-candidate-${overlayMember.file_name}`;

  if (deps.objectStore) {
    const stored = await deps.objectStore.put({
      organizationId: auth.organization.id,
      fileName: overlayMember.file_name,
      contentType: "text/plain",
      bytes: Buffer.from(candidateOverlayContent, "utf8"),
    });
    candidateStorageKey = stored.storageKey;
  }

  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    )
    select $1, $2, coalesce(max(version_number), 0) + 1, $3, $4, $5, $6::jsonb, 'writeback', $7
    from project_parameter_file_versions
    where file_id = $2
    `,
    [
      candidateOverlayVersionId,
      overlayMember.file_id,
      candidateStorageKey,
      overlayChecksum,
      Buffer.byteLength(candidateOverlayContent, "utf8"),
      JSON.stringify({ sourceText: candidateOverlayContent }),
      auth.user.id,
    ],
  );

  const overlayOrderFromMembers = members
    .filter((m) => m.role === "overlay")
    .sort((a, b) => a.sort_order - b.sort_order || a.file_name.localeCompare(b.file_name))
    .map((m) => m.file_name);

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

  // Reload persisted base revision manifest — never invent includeSearchPaths=["."] alone.
  const persistedIncludes = revision.includeSearchPaths;
  const persistedOverlays = revision.overlayOrder;
  const persistedEntry = revision.entryFile ?? baseMember.file_name;
  const normalizedManifest = normalizePersistedManifest({
    entryFile: persistedEntry,
    includeSearchPaths: persistedIncludes ?? ["."],
    overlayOrder:
      persistedOverlays && persistedOverlays.length > 0 ? persistedOverlays : overlayOrderFromMembers,
    members: candidateMembers,
  });
  if (!normalizedManifest.ok) {
    throw new ApiError("VALIDATION_FAILED", normalizedManifest.failure.message, 400, {
      reason: normalizedManifest.failure.code,
    });
  }

  const manifest: ConfigRevisionManifest = {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    configSetId: revision.configSetId,
    entryFile: normalizedManifest.manifest.entryFile,
    includeSearchPaths: normalizedManifest.manifest.includeSearchPaths,
    overlayOrder: normalizedManifest.manifest.overlayOrder,
    members: candidateMembers,
  };

  const ingested = await ingestConfigRevisionInTransaction(db, manifest, auth);
  const candidateRevisionId = ingested.id;

  await carryForwardBindingRevisions(db, {
    baseRevisionId: revision.id,
    candidateRevisionId,
    // Always exclude the edited binding — ingest match may attach a remapped
    // logical-node binding while this draft still keys the original binding id.
    excludeBindingId: binding.binding_id,
  });

  if (action === "set") {
    const baseBindingRevision = await db.query<{ parameter_spec_version_id: string }>(
      `
      select parameter_spec_version_id
      from project_parameter_binding_revisions
      where id = $1
      limit 1
      `,
      [bindingRevision.rows[0]!.id],
    );
    const parameterSpecVersionId = baseBindingRevision.rows[0]?.parameter_spec_version_id;
    if (!parameterSpecVersionId) {
      throw new ApiError("CONFLICT", "Base binding revision is missing a parameter spec version.", 409, {
        reason: "missing-spec-version",
        bindingId: binding.binding_id,
        bindingRevisionId: bindingRevision.rows[0]!.id,
      });
    }
    await upsertBindingRevisionValues(db, {
      bindingId: binding.binding_id,
      configRevisionId: candidateRevisionId,
      parameterSpecVersionId,
      values: {
        typedValue: input.targetValue!,
        canonicalValue: input.targetValue!,
        rawValue: rawText,
        schemaState: "valid",
        policyState: "not_applicable",
      },
    });
  }

  // Fail-closed before toolchain when ingest already left a blocked diagnosable status.
  // Never overwrite needs_mapping / invalid to draft.
  if (ingested.status === "invalid" || ingested.status === "needs_mapping") {
    const diagnostics = await loadRevisionDiagnostics(db, candidateRevisionId);
    const reason =
      ingested.status === "needs_mapping" ? "unresolved-mapping" : "resolve-failure";
    throw new ApiError(
      ingested.status === "needs_mapping" ? "CONFLICT" : "VALIDATION_FAILED",
      ingested.status === "needs_mapping"
        ? "Candidate config revision has unresolved identity mapping."
        : "Candidate config revision failed resolve.",
      ingested.status === "needs_mapping" ? 409 : 400,
      {
        reason,
        candidateRevisionId,
        candidateStatus: ingested.status,
        diagnostics,
      },
    );
  }

  const semanticCounts = await loadCandidateSemanticGateCounts(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    configRevisionId: candidateRevisionId,
  });

  const earlyGate = assertCanPromoteCandidateToDraft({
    status: ingested.status,
    ...semanticCounts,
    toolchainOk: true,
    toolchainFailureCode: null,
  });
  if (!earlyGate.ok) {
    await ensureCandidateKeepStatus(db, candidateRevisionId, earlyGate.keepStatus);
    throw candidateGateError(candidateRevisionId, earlyGate.reason, earlyGate.keepStatus);
  }

  const finalGate = assertCanPromoteCandidateToDraft({
    status: ingested.status,
    ...semanticCounts,
    toolchainOk: true,
    toolchainFailureCode: null,
  });
  if (!finalGate.ok) {
    await ensureCandidateKeepStatus(db, candidateRevisionId, finalGate.keepStatus);
    throw candidateGateError(candidateRevisionId, finalGate.reason, finalGate.keepStatus);
  }

  await updateConfigRevisionStatus(db, {
    id: candidateRevisionId,
    status: "draft",
  });

  // Post-cutover drafts key only on project_parameter_binding_id.
  // Pre-cutover still needs a linked PPV row for the legacy unique constraint —
  // that dual-write lives solely in the transitional adapter (unreachable post-cutover).
  const useSemantic = await mustUseSemanticParameterIdentity(db);
  let draftParameterId = binding.binding_id;
  if (!useSemantic) {
    const linked = await ensurePreCutoverLinkedParameterValue(db, auth, {
      projectId: binding.project_id,
      bindingId: binding.binding_id,
      parameterSpecId: binding.parameter_spec_id,
      propertyKey: binding.property_key,
      currentRaw: rawText,
    });
    draftParameterId = linked.id;
  }

  const persistedDraft = await upsertDraft(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    parameterId: draftParameterId,
    userId: auth.user.id,
    targetValue: rawText,
    reason: input.reason,
    origin: "manual",
    action,
    projectParameterBindingId: binding.binding_id,
    parameterSpecId: binding.parameter_spec_id,
    candidateConfigRevisionId: candidateRevisionId,
    writeLock: {
      baseConfigRevisionId: revision.id,
      bindingRevisionId: bindingRevision.rows[0]!.id,
      propertyOccurrenceId: writeTarget.occurrenceId ?? null,
      sourceFileVersionId: writeTarget.fileVersionId!,
      expectedChecksum: writeTarget.checksum!,
      occurrenceSpan: writeTarget.occurrenceSpan ?? null,
    },
  });
  const draftId = persistedDraft.id;

  const rebasedDraftIds = await rebaseOpenBindingDraftCandidates(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    userId: auth.user.id,
    candidateConfigRevisionId: candidateRevisionId,
    excludeDraftId: draftId,
  });

  await writeGovernanceAudit(db, auth, {
    action: "binding-edited",
    projectId: binding.project_id,
    targetType: "project-parameter-binding",
    targetId: binding.binding_id,
    metadata: {
      draftId,
      candidateRevisionId,
      propertyKey: binding.property_key,
      writeTargetRole: writeTarget.role,
      targetRef,
      action,
    },
  });

  const baseChecksumAfter = checksumOf(baseContent);

  return {
    draftId,
    parameterId: draftParameterId,
    writeTarget,
    candidateRevisionId,
    workingCandidateRevisionId: candidateRevisionId,
    rebasedDraftIds,
    rawText,
    action,
    parameterSpecId: binding.parameter_spec_id,
    projectParameterBindingId: binding.binding_id,
    baseContent,
    baseChecksumBefore,
    baseChecksumAfter,
    candidateOverlayContent,
    overlayFileId: overlayMember.file_id,
    overlayFileName: overlayMember.file_name,
  };
}

async function listRevisionStatusRawValues(
  db: Queryable,
  configRevisionId: string,
): Promise<Array<string | null>> {
  const result = await db.query<{ raw_text: string | null }>(
    `
    select po.raw_text
    from dts_occurrence_effects oe
    left join dts_property_occurrences po on po.id = oe.property_occurrence_id
    where oe.config_revision_id = $1
      and oe.property_name = 'status'
      and oe.effect_kind in ('set', 'override')
    `,
    [configRevisionId],
  );
  return result.rows.map((row) => row.raw_text);
}

/**
 * Create a node-enablement draft that patches (or deletes) `status` on a logical node.
 * Shares working tip / candidate revision coordination with binding drafts (ADR-0003).
 */
export async function createNodeEnablementDraft(
  db: Database | Queryable,
  auth: AuthContext,
  input: CreateNodeEnablementDraftInput,
  deps: CreateBindingDraftDeps = {},
): Promise<NodeEnablementDraftResult> {
  requireCanEdit(auth);

  const openDrafts = await listOpenBindingDraftsForUser(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    userId: auth.user.id,
  });
  const openWorkingTips = [
    ...new Set(
      openDrafts
        .map((draft) => draft.candidateConfigRevisionId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (openWorkingTips.length > 1) {
    throw new ApiError(
      "CONFLICT",
      "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。",
      409,
      { reason: "mixed-working-tips" },
    );
  }
  const resolvedWorkingTip = openWorkingTips[0] ?? null;
  const sameEnablementOpenDraft = openDrafts.find(
    (draft) =>
      draft.editSubjectKind === "node-enablement" &&
      draft.logicalNodeId === input.logicalNodeId,
  );

  let effectiveBaseRevisionId = input.baseRevisionId;
  if (resolvedWorkingTip && input.baseRevisionId !== resolvedWorkingTip) {
    if (sameEnablementOpenDraft) {
      effectiveBaseRevisionId = resolvedWorkingTip;
    } else {
      throw new ApiError(
        "CONFLICT",
        "请刷新后基于本轮最新工作版本继续编辑。",
        409,
        {
          reason: "stale-working-tip",
          logicalNodeId: input.logicalNodeId,
          baseRevisionId: input.baseRevisionId,
          workingCandidateRevisionId: resolvedWorkingTip,
        },
      );
    }
  }

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    revisionId: effectiveBaseRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale or missing.", 409, {
      reason: "stale-revision",
      logicalNodeId: input.logicalNodeId,
      baseRevisionId: input.baseRevisionId,
    });
  }

  throwIfManifestNeedsReview(revision);

  if (revision.status === "needs_mapping") {
    throw new ApiError("CONFLICT", "Config revision has unresolved identity mapping.", 409, {
      reason: "unresolved-mapping",
      configRevisionId: revision.id,
    });
  }
  if (revision.status === "invalid") {
    throw new ApiError("CONFLICT", "Config revision is invalid and cannot accept edits.", 409, {
      reason: "invalid-revision",
      configRevisionId: revision.id,
    });
  }

  const nodeContext = await loadLogicalNodeEnablementContext(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configRevisionId: revision.id,
    logicalNodeId: input.logicalNodeId,
  });

  await assertSensitiveNodeWriteAllowed(db, auth, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    nodePath: nodeContext.nodeLocator,
    compatible: nodeContext.compatible,
    actorType: "user",
  });

  const projectSpelling =
    input.spellingOverride ??
    measureStatusSpelling(await listRevisionStatusRawValues(db, revision.id));

  let writePlan: { action: BindingEditAction; rawText: string | null };
  try {
    writePlan = resolveEnablementWrite({
      target: input.target,
      currentRaw: nodeContext.currentRaw,
      projectSpelling,
      acknowledgeNonstandard: input.acknowledgeNonstandard,
    });
  } catch (error) {
    throw new ApiError(
      "VALIDATION_FAILED",
      error instanceof Error ? error.message : "Enablement write plan failed.",
      400,
      {
        reason: "nonstandard-status",
        currentRaw: nodeContext.currentRaw,
        logicalNodeId: input.logicalNodeId,
      },
    );
  }

  const {
    writeTarget,
    overlayMember,
    baseMember,
    members,
    targetRef,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
  } = await resolveWriteTarget(db, {
    configRevisionId: revision.id,
    logicalNodeId: input.logicalNodeId,
    propertyKey: "status",
    nodeLocator: nodeContext.nodeLocator,
  });

  const memberContents = new Map<string, string>();
  for (const member of members) {
    try {
      const content = await loadFileContentFromVersion(db, member.file_version_id, deps.objectStore);
      memberContents.set(member.file_version_id, content);
    } catch (error) {
      throw new ApiError("CONFLICT", "Config set source text unavailable for enablement edit.", 409, {
        reason: "missing-source-text",
        fileVersionId: member.file_version_id,
        fileName: member.file_name,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const overlayContent = memberContents.get(overlayMember.file_version_id)!;
  const rawText = writePlan.rawText ?? "";

  const candidateOverlayContent = ensureOverlayProperty(overlayContent, {
    propertyKey: "status",
    rawText: writePlan.rawText,
    action: writePlan.action,
    targetRef,
    expectedChecksum: overlayMember.checksum,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
  });

  const candidateOverlayVersionId = randomUUID();
  const overlayChecksum = checksumOf(candidateOverlayContent);
  let candidateStorageKey = `${auth.organization.id}/${overlayChecksum}-candidate-${overlayMember.file_name}`;

  if (deps.objectStore) {
    const stored = await deps.objectStore.put({
      organizationId: auth.organization.id,
      fileName: overlayMember.file_name,
      contentType: "text/plain",
      bytes: Buffer.from(candidateOverlayContent, "utf8"),
    });
    candidateStorageKey = stored.storageKey;
  }

  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    )
    select $1, $2, coalesce(max(version_number), 0) + 1, $3, $4, $5, $6::jsonb, 'writeback', $7
    from project_parameter_file_versions
    where file_id = $2
    `,
    [
      candidateOverlayVersionId,
      overlayMember.file_id,
      candidateStorageKey,
      overlayChecksum,
      Buffer.byteLength(candidateOverlayContent, "utf8"),
      JSON.stringify({ sourceText: candidateOverlayContent }),
      auth.user.id,
    ],
  );

  const overlayOrderFromMembers = members
    .filter((m) => m.role === "overlay")
    .sort((a, b) => a.sort_order - b.sort_order || a.file_name.localeCompare(b.file_name))
    .map((m) => m.file_name);

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

  const persistedIncludes = revision.includeSearchPaths;
  const persistedOverlays = revision.overlayOrder;
  const persistedEntry = revision.entryFile ?? baseMember.file_name;
  const normalizedManifest = normalizePersistedManifest({
    entryFile: persistedEntry,
    includeSearchPaths: persistedIncludes ?? ["."],
    overlayOrder:
      persistedOverlays && persistedOverlays.length > 0 ? persistedOverlays : overlayOrderFromMembers,
    members: candidateMembers,
  });
  if (!normalizedManifest.ok) {
    throw new ApiError("VALIDATION_FAILED", normalizedManifest.failure.message, 400, {
      reason: normalizedManifest.failure.code,
    });
  }

  const manifest: ConfigRevisionManifest = {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: revision.configSetId,
    entryFile: normalizedManifest.manifest.entryFile,
    includeSearchPaths: normalizedManifest.manifest.includeSearchPaths,
    overlayOrder: normalizedManifest.manifest.overlayOrder,
    members: candidateMembers,
  };

  const ingested = await ingestConfigRevisionInTransaction(db, manifest, auth);
  const candidateRevisionId = ingested.id;

  await carryForwardBindingRevisions(db, {
    baseRevisionId: revision.id,
    candidateRevisionId,
  });

  if (ingested.status === "invalid" || ingested.status === "needs_mapping") {
    const diagnostics = await loadRevisionDiagnostics(db, candidateRevisionId);
    const reason =
      ingested.status === "needs_mapping" ? "unresolved-mapping" : "resolve-failure";
    throw new ApiError(
      ingested.status === "needs_mapping" ? "CONFLICT" : "VALIDATION_FAILED",
      ingested.status === "needs_mapping"
        ? "Candidate config revision has unresolved identity mapping."
        : "Candidate config revision failed resolve.",
      ingested.status === "needs_mapping" ? 409 : 400,
      {
        reason,
        candidateRevisionId,
        candidateStatus: ingested.status,
        diagnostics,
      },
    );
  }

  const semanticCounts = await loadCandidateSemanticGateCounts(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configRevisionId: candidateRevisionId,
  });

  const earlyGate = assertCanPromoteCandidateToDraft({
    status: ingested.status,
    ...semanticCounts,
    toolchainOk: true,
    toolchainFailureCode: null,
  });
  if (!earlyGate.ok) {
    await ensureCandidateKeepStatus(db, candidateRevisionId, earlyGate.keepStatus);
    throw candidateGateError(candidateRevisionId, earlyGate.reason, earlyGate.keepStatus);
  }

  const finalGate = assertCanPromoteCandidateToDraft({
    status: ingested.status,
    ...semanticCounts,
    toolchainOk: true,
    toolchainFailureCode: null,
  });
  if (!finalGate.ok) {
    await ensureCandidateKeepStatus(db, candidateRevisionId, finalGate.keepStatus);
    throw candidateGateError(candidateRevisionId, finalGate.reason, finalGate.keepStatus);
  }

  await updateConfigRevisionStatus(db, {
    id: candidateRevisionId,
    status: "draft",
  });

  const persistedDraft = await upsertEnablementDraft(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    logicalNodeId: input.logicalNodeId,
    userId: auth.user.id,
    targetValue: rawText,
    reason: input.reason,
    origin: "manual",
    action: writePlan.action,
    candidateConfigRevisionId: candidateRevisionId,
    writeLock: {
      baseConfigRevisionId: revision.id,
      propertyOccurrenceId: writeTarget.occurrenceId ?? null,
      sourceFileVersionId: writeTarget.fileVersionId!,
      expectedChecksum: writeTarget.checksum!,
      occurrenceSpan: writeTarget.occurrenceSpan ?? null,
    },
  });
  const draftId = persistedDraft.id;

  const rebasedDraftIds = await rebaseOpenBindingDraftCandidates(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    userId: auth.user.id,
    candidateConfigRevisionId: candidateRevisionId,
    excludeDraftId: draftId,
  });

  await writeGovernanceAudit(db, auth, {
    action: "enablement-changed",
    projectId: input.projectId,
    targetType: "dts-logical-node",
    targetId: input.logicalNodeId,
    metadata: {
      draftId,
      candidateRevisionId,
      previousRaw: nodeContext.currentRaw,
      nextRaw: writePlan.rawText,
      target: input.target,
      reason: input.reason,
      writeTargetRole: writeTarget.role,
      targetRef,
      action: writePlan.action,
    },
  });

  return {
    draftId,
    candidateRevisionId,
    workingCandidateRevisionId: candidateRevisionId,
    rebasedDraftIds,
    action: writePlan.action,
    rawText,
    logicalNodeId: input.logicalNodeId,
    writeTarget,
    overlayFileId: overlayMember.file_id,
    overlayFileName: overlayMember.file_name,
    previousRaw: nodeContext.currentRaw,
    target: input.target,
  };
}

async function loadRevisionDiagnostics(
  db: Queryable,
  configRevisionId: string,
): Promise<
  Array<{
    code: string;
    severity: string;
    stage: string;
    message: string;
    fileName: string | null;
  }>
> {
  const result = await db.query<{
    code: string;
    severity: string;
    stage: string;
    message: string;
    file_name: string | null;
  }>(
    `
    select d.code, d.severity, d.stage, d.message, d.file_name
    from dts_validation_diagnostics d
    inner join dts_validation_runs r on r.id = d.validation_run_id
    where r.config_revision_id = $1
    order by d.created_at asc
    `,
    [configRevisionId],
  );
  return result.rows.map((row) => ({
    code: row.code,
    severity: row.severity,
    stage: row.stage,
    message: row.message,
    fileName: row.file_name,
  }));
}

async function loadCandidateSemanticGateCounts(
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

async function ensureCandidateKeepStatus(
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

function candidateGateError(
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

/** L2 Admin validate reuse; not invoked on merge/writeback hot path. */
export async function assertCandidateToolchainRelease(
  db: Queryable,
  auth: AuthContext,
  input: {
    candidateRevisionId: string;
    entryFile: string;
    includeSearchPaths: string[];
    overlayOrder: string[];
    files: Map<string, { content: string }>;
    toolchain: DtsToolchainRunner;
  },
): Promise<{ ok: true } | { ok: false; failureCode: string | null }> {
  const toolchainResult = await input.toolchain.validate(
    {
      entryFile: input.entryFile,
      includeSearchPaths: input.includeSearchPaths,
      overlayOrder: input.overlayOrder,
      files: input.files,
    },
    { mode: "release" },
  );

  const runId = randomUUID();
  await insertValidationRun(db, {
    id: runId,
    organizationId: auth.organization.id,
    configRevisionId: input.candidateRevisionId,
    stage: "toolchain",
    status: toolchainResult.ok ? "passed" : "failed",
  });

  const persisted: PersistedValidationDiagnostic[] = toolchainResult.diagnostics.map((diagnostic) => ({
    id: randomUUID(),
    code: (diagnostic.code ?? toolchainResult.failureCode ?? "compile-failed") as PersistedValidationDiagnostic["code"],
    severity: "error" as const,
    stage: diagnostic.stage ?? "toolchain",
    message: diagnostic.message,
    fileName: diagnostic.file,
    startLine: diagnostic.line,
  }));
  if (persisted.length > 0) {
    await insertValidationDiagnostics(db, runId, persisted);
  }

  if (toolchainResult.ok) {
    return { ok: true };
  }

  await updateConfigRevisionStatus(db, {
    id: input.candidateRevisionId,
    status: "invalid",
    resolvedAt: new Date().toISOString(),
  });

  throw new ApiError("VALIDATION_FAILED", "Candidate config revision failed toolchain validation.", 400, {
    reason: "toolchain-failure",
    candidateRevisionId: input.candidateRevisionId,
    failureCode: toolchainResult.failureCode,
    candidateStatus: "invalid",
    diagnostics: toolchainResult.diagnostics,
  });
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
