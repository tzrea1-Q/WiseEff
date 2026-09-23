/**
 * Canonical pending value drafts (Issue #849 C4).
 *
 * Creates, lists and removes pending canonical changes. Creating a draft must
 * leave the canonical current value, its history tip and the active config
 * revision untouched — that is the invariant this module exists to protect.
 *
 * Submission and approval are separate workflow steps; approval is owned by the
 * source-commit service and this module only prepares the immutable draft.
 */
import { randomUUID } from "node:crypto";
import { ApiError } from "../../../shared/http/errors";
import type { Database, Queryable } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import {
  assertTrustedInvocationMatchesAuth,
  createUserInvocation,
  type TrustedInvocationContext
} from "../../auth/trustedInvocation";
import { asAuditTx } from "../../audit/auditedWrite";
import type { TrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import type { ObjectStore } from "../../logs/objectStore";
import {
  canEditParameters,
  canReviewParameterStage,
  canReviewParameters,
  canViewParameters
} from "../../parameter-kernel/policy";
import { writeTrustedGovernanceAudit } from "../../parameter-topology/governanceAudit";
import { getProjectById } from "../../projects/repository";
import { hasCurrentCanonicalReviewRole } from "../../parameters/reviewWorkflowRepository";
import { renderDtsValue } from "../../dts/valueAst";
import type { DtsValue } from "../../dts/types";
import { parseJsonSource } from "../../parameter-files/jsonSource";
import { preparePinnedSourceChange } from "../../parameter-files/canonicalSource";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";
import {
  deleteCanonicalValueDraft,
  listCanonicalValueDrafts,
  listCanonicalValueDraftsForBinding,
  loadCanonicalBindingPins,
  upsertCanonicalValueDraft,
  type CanonicalValueDraftAction,
  type CanonicalValueDraftReviewRow,
  type CanonicalValueDraftRow
} from "./repository";

export type CanonicalValueDraftDto = {
  id: string;
  bindingId: string;
  definitionId: string;
  effectiveRevisionId: string;
  currentValueId: string | null;
  targetValue: string;
  sourceFormat: "dts" | "json";
  sourceTarget?: { format: "json"; sourceText: string };
  baseRevisionId: string;
  sourcePinId: string | null;
  candidateId: string | null;
  reason: string;
  updatedAt: string;
  action: CanonicalValueDraftAction;
};

/**
 * Reviewer projection for all authors' drafts on one canonical Binding.
 * Target values and reasons are intentionally omitted; review can inspect the
 * exact frozen identity/source pins and candidate digests before selecting a
 * draft through the existing request workflow.
 */
export type CanonicalValueDraftReviewerDto = {
  draftId: string;
  authorUserId: string | null;
  bindingId: string;
  definitionId: string;
  definitionRevisionId: string;
  catalogReleaseId: string;
  baseCurrentValueId: string;
  configRevisionId: string;
  sourceRef: string;
  sourcePinId: string | null;
  sourceFormat: "dts" | "json" | null;
  candidateId: string | null;
  candidateBaseDigest: string | null;
  candidateProposedDigest: string | null;
  candidateDiffDigest: string | null;
  stale: boolean;
  pendingRequestId: string | null;
};

export type CreateCanonicalValueDraftInput = {
  projectId: string;
  bindingId: string;
  action?: CanonicalValueDraftAction;
  targetValue?: DtsValue;
  sourceTarget?: { format: "json"; sourceText: string };
  reason: string;
  /** Exact config-revision pin the caller edited against. */
  baseRevisionId: string;
  /** Exact canonical current-value pin the caller edited against. */
  baseCurrentValueId?: string;
};

export type CanonicalValueDraftOptions = {
  objectStore?: ObjectStore;
  invocation?: TrustedInvocationContext;
  requestId?: string;
  refusalSink?: TrustedRefusalAuditSink;
};

/**
 * The canonical current-value source marker that means "this binding has no
 * concrete config-set source yet". A draft cannot be pinned without one.
 */
const NO_CONFIG_SOURCE = "canonical-binding-identity";

function requireEditPermission(auth: AuthContext, projectId: string) {
  if (!canEditParameters(auth) || !canEditParameters(auth, projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter edit role is required for this project.");
  }
}

async function requireOwnedProject(db: Queryable, auth: AuthContext, projectId: string) {
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", { projectId });
  }
}

function toDto(row: CanonicalValueDraftRow): CanonicalValueDraftDto {
  const jsonTarget = row.target_value && typeof row.target_value === "object" && (row.target_value as { kind?: unknown }).kind === "json-source"
    ? row.target_value as { value: ContractJsonValue } : null;
  let rendered: string;
  rendered = row.action === "delete" ? "" : typeof row.target_value === "object" && row.target_value !== null
    && (row.target_value as { kind?: unknown }).kind === "json-source"
    ? JSON.stringify((row.target_value as { value: unknown }).value)
    : (() => {
        try {
          return renderDtsValue(row.target_value as DtsValue);
        } catch {
          return JSON.stringify(row.target_value);
        }
      })();
  return {
    id: row.id,
    bindingId: row.binding_id,
    definitionId: row.definition_id,
    effectiveRevisionId: row.definition_revision_id,
    currentValueId: row.base_current_value_id ?? null,
    targetValue: rendered,
    sourceFormat: row.source_format,
    ...(row.action === "set" && jsonTarget ? { sourceTarget: { format: "json" as const,sourceText: serializeContract(jsonTarget.value) } } : {}),
    baseRevisionId: row.config_revision_id,
    sourcePinId: row.source_pin_id,
    candidateId: row.candidate_id,
    reason: row.reason,
    updatedAt: row.updated_at,
    action: row.action
  };
}

function toReviewerDto(row: CanonicalValueDraftReviewRow): CanonicalValueDraftReviewerDto {
  return {
    draftId: row.id,
    authorUserId: row.user_id,
    bindingId: row.binding_id,
    definitionId: row.definition_id,
    definitionRevisionId: row.definition_revision_id,
    catalogReleaseId: row.catalog_release_id,
    baseCurrentValueId: row.base_current_value_id,
    configRevisionId: row.config_revision_id,
    sourceRef: row.source_ref,
    sourcePinId: row.source_pin_id,
    sourceFormat: row.source_format,
    candidateId: row.candidate_id,
    candidateBaseDigest: row.candidate_base_digest,
    candidateProposedDigest: row.candidate_proposed_digest,
    candidateDiffDigest: row.candidate_diff_digest,
    stale: row.stale,
    pendingRequestId: row.pending_request_id
  };
}

export async function createCanonicalValueDraft(
  db: Database,
  auth: AuthContext,
  input: CreateCanonicalValueDraftInput,
  options: CanonicalValueDraftOptions = {}
): Promise<CanonicalValueDraftDto> {
  await requireOwnedProject(db, auth, input.projectId);
  requireEditPermission(auth, input.projectId);

  const action: CanonicalValueDraftAction = input.action ?? "set";
  if (action === "set" && ((!input.targetValue && !input.sourceTarget) || (input.targetValue && input.sourceTarget))) {
    throw new ApiError("VALIDATION_FAILED", "A pending value change requires exactly one typed target value.");
  }
  if (action === "delete" && (input.targetValue !== undefined || input.sourceTarget !== undefined)) {
    throw new ApiError("VALIDATION_FAILED", "A property deletion does not accept a replacement target.");
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new ApiError("VALIDATION_FAILED", "A pending value change requires a reason.");
  }

  const pins = await loadCanonicalBindingPins(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId
  });
  if (!pins) {
    throw new ApiError("NOT_FOUND", "Project parameter binding was not found for this project.", {
      projectId: input.projectId,
      bindingId: input.bindingId
    });
  }
  if (pins.sourceRef === NO_CONFIG_SOURCE) {
    throw new ApiError("CONFLICT", "Binding has no concrete config-set source to draft against.", {
      bindingId: input.bindingId,
      reason: "missing-config-source"
    });
  }
  if (input.baseRevisionId !== pins.configRevisionId) {
    throw new ApiError("CONFLICT", "Draft base revision is stale.", {
      bindingId: input.bindingId,
      reason: "stale-base-revision",
      expected: pins.configRevisionId,
      received: input.baseRevisionId
    });
  }
  if (input.baseCurrentValueId && input.baseCurrentValueId !== pins.currentValueId) {
    throw new ApiError("CONFLICT", "Draft base value is stale.", {
      bindingId: input.bindingId,
      reason: "stale-base-value",
      expected: pins.currentValueId,
      received: input.baseCurrentValueId
    });
  }

  if (!options.objectStore || !options.invocation || !options.requestId?.trim() || !options.refusalSink) {
    throw new ApiError("INTERNAL_ERROR", "Canonical source drafts require object storage and trusted invocation context.");
  }
  const sourceTarget = input.sourceTarget ?? {
    format: pins.sourceFormat,
    sourceText: action === "delete" ? "" : renderDtsValue(input.targetValue!)
  };
  let targetValue: DtsValue | { kind: "json-source"; value: ContractJsonValue } | "" = action === "delete" ? "" : input.targetValue!;
  if (input.sourceTarget) {
    try {
      targetValue = { kind: "json-source",value: parseJsonSource(input.sourceTarget.sourceText) as ContractJsonValue };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new ApiError("VALIDATION_FAILED", "JSON draft target is invalid or unsupported.");
    }
  }
  const row = await db.transaction(async (tx) => {
    const prepared = await preparePinnedSourceChange(tx, options.objectStore!, auth, {
      projectId: input.projectId,
      bindingId: input.bindingId,
      expectedValueId: pins.currentValueId,
      target: sourceTarget,
      action,
      invocation: options.invocation!,
      requestId: options.requestId!.trim(),
      refusalSink: options.refusalSink!
    });
    return upsertCanonicalValueDraft(tx, {
      organizationId: auth.organization.id,
      pins,
      action,
      targetValue,
      reason,
      userId: auth.user.id,
      sourcePinId: prepared.sourcePinId,
      candidateId: prepared.candidateId,
      candidateBaseDigest: prepared.baseDigest,
      candidateProposedDigest: prepared.proposedDigest,
      candidateDiffDigest: prepared.diffDigest,
      candidateMemberManifest: prepared.members,
      candidateBindingManifest: prepared.bindings
    });
  });
  return toDto(row);
}

export async function listCanonicalValueDraftsForUser(
  db: Database,
  auth: AuthContext,
  input: { projectId: string }
): Promise<CanonicalValueDraftDto[]> {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
  await requireOwnedProject(db, auth, input.projectId);
  const rows = await listCanonicalValueDrafts(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    userId: auth.user.id
  });
  return rows.map(toDto);
}

/**
 * Read every canonical draft for one Binding as the current project reviewer.
 * The role is checked both from the request context and current database state;
 * the latter closes the gap after a committed role revocation.
 */
export async function listCanonicalValueDraftsForReviewer(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; bindingId: string }
): Promise<CanonicalValueDraftReviewerDto[]> {
  await requireOwnedProject(db, auth, input.projectId);
  if (!canReviewParameters(auth) || !canReviewParameterStage(auth, input.projectId, "software_review")) {
    throw new ApiError("FORBIDDEN", "The software review role is required to inspect parameter drafts.");
  }
  const rows = await db.transaction(async (tx) => {
    if (!await hasCurrentCanonicalReviewRole(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      userId: auth.user.id
    })) {
      throw new ApiError("FORBIDDEN", "The software review role is required to inspect parameter drafts.");
    }
    return listCanonicalValueDraftsForBinding(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: input.bindingId
    });
  });
  return rows.map(toReviewerDto);
}

export async function removeCanonicalValueDraft(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; draftId: string },
  options: { invocation?: TrustedInvocationContext; requestId?: string } = {}
): Promise<{ id: string }> {
  await requireOwnedProject(db, auth, input.projectId);
  requireEditPermission(auth, input.projectId);

  const invocation = options.invocation
    ? assertTrustedInvocationMatchesAuth(auth, options.invocation, "canonical parameter draft delete")
    : createUserInvocation(auth);
  return db.transaction(async (tx) => {
    const removed = await deleteCanonicalValueDraft(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      userId: auth.user.id,
      draftId: input.draftId
    });
    if (!removed) {
      throw new ApiError("NOT_FOUND", "Pending value draft was not found.", {
        projectId: input.projectId,
        draftId: input.draftId
      });
    }

    await writeTrustedGovernanceAudit(
      asAuditTx(tx),
      invocation,
      {
        action: "value-draft-removed",
        organizationId: auth.organization.id,
        projectId: input.projectId,
        targetType: "project-parameter-value-draft",
        targetId: input.draftId,
        metadata: {
          draftId: input.draftId,
          writeTargetRole: "canonical-project-value-draft"
        }
      },
      options.requestId ?? randomUUID()
    );
    return { id: input.draftId };
  });
}
