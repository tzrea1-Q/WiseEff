/**
 * Typed binding edits → overlay write targets → draft + candidate config revision.
 *
 * Shared base files are never mutated; project differences land in overlay.
 * Writes target the binding's stable logical node (never first &ref / charging_core default).
 * Release/edit gates fail closed on unresolved mapping and schema constraints.
 */

import { randomUUID } from "node:crypto";

import {
  measureStatusSpelling,
  resolveEnablementWrite,
  type EnablementEditTarget,
  type StatusSpelling,
} from "../../../src/domain/parameter-topology/enablementEdit";
import type { AuthContext } from "../auth/types";
import type { DtsValue } from "../dts/types";
import { renderDtsValue } from "../dts/valueAst";
import {
  type DtsToolchainRunner,
} from "../parameter-files/dtsToolchain";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canEditParameters } from "../parameter-kernel/policy";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { ensurePreCutoverLinkedParameterValue } from "../parameter-kernel/legacyParameterIdentityAdapter";
import { assertSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import {
  upsertDraft,
  upsertEnablementDraft,
  listOpenBindingDraftsForUser,
  rebaseOpenBindingDraftCandidates,
} from "../parameter-drafts/repository";
import { upsertBindingRevisionValues } from "./bindingService";
import { assertCanPromoteCandidateToDraft } from "./candidateRevisionStateMachine";
import { normalizePersistedManifest } from "./configRevisionManifest";
import { ingestConfigRevisionInTransaction } from "./ingestService";
import {
  getConfigRevisionById,
  insertValidationDiagnostics,
  insertValidationRun,
  updateConfigRevisionStatus,
} from "./repository";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember, PersistedValidationDiagnostic } from "./types";
import { writeGovernanceAudit } from "./governanceAudit";
import {
  candidateGateError,
  checksumOf,
  ensureCandidateKeepStatus,
  ensureOverlayProperty,
  loadCandidateSemanticGateCounts,
  loadFileContentFromVersion,
  throwIfManifestNeedsReview,
  type BindingEditAction,
  type CreateBindingDraftDeps,
} from "./overlayWriteback";
import {
  loadBindingContext,
  loadLogicalNodeEnablementContext,
  resolveWriteTarget,
  type BindingDraftWriteTarget,
} from "./writeLock";

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
  const useSemantic = parameterIdentityMode() === "semantic";
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
