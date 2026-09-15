/**
 * Canonical pending value drafts (Issue #849 C4).
 *
 * Creates, lists and removes pending canonical changes. Creating a draft must
 * leave the canonical current value, its history tip and the active config
 * revision untouched — that is the invariant this module exists to protect.
 *
 * Submission, approval and apply of these drafts are separate, not-yet-delivered
 * work; this module deliberately exposes no apply entry point.
 */
import { ApiError } from "../../../shared/http/errors";
import type { Database, Queryable } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { canEditParameters, canViewParameters } from "../../parameter-kernel/policy";
import { getProjectById } from "../../projects/repository";
import { renderDtsValue } from "../../dts/valueAst";
import type { DtsValue } from "../../dts/types";
import {
  deleteCanonicalValueDraft,
  listCanonicalValueDrafts,
  loadCanonicalBindingPins,
  upsertCanonicalValueDraft,
  type CanonicalValueDraftAction,
  type CanonicalValueDraftRow
} from "./repository";

export type CanonicalValueDraftDto = {
  id: string;
  bindingId: string;
  definitionId: string;
  effectiveRevisionId: string;
  currentValueId: string | null;
  targetValue: string;
  reason: string;
  updatedAt: string;
};

export type CreateCanonicalValueDraftInput = {
  projectId: string;
  bindingId: string;
  action?: CanonicalValueDraftAction;
  targetValue?: DtsValue;
  reason: string;
  /** Exact config-revision pin the caller edited against. */
  baseRevisionId: string;
  /** Exact canonical current-value pin the caller edited against. */
  baseCurrentValueId?: string;
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
  let rendered: string;
  try {
    rendered = renderDtsValue(row.target_value as DtsValue);
  } catch {
    rendered = JSON.stringify(row.target_value);
  }
  return {
    id: row.id,
    bindingId: row.binding_id,
    definitionId: row.definition_id,
    effectiveRevisionId: row.definition_revision_id,
    currentValueId: row.base_current_value_id ?? null,
    targetValue: rendered,
    reason: row.reason,
    updatedAt: row.updated_at
  };
}

export async function createCanonicalValueDraft(
  db: Database,
  auth: AuthContext,
  input: CreateCanonicalValueDraftInput
): Promise<CanonicalValueDraftDto> {
  await requireOwnedProject(db, auth, input.projectId);
  requireEditPermission(auth, input.projectId);

  const action: CanonicalValueDraftAction = input.action ?? "set";
  if (action === "set" && !input.targetValue) {
    throw new ApiError("VALIDATION_FAILED", "A pending value change requires a target value.");
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

  const row = await upsertCanonicalValueDraft(db, {
    organizationId: auth.organization.id,
    pins,
    action,
    // The pending target is stored as the typed DtsValue AST so the exact value
    // the editor proposed survives a reload and can be converted to the canonical
    // ProjectValue payload by the (separate) apply step.
    targetValue: action === "delete" ? { kind: "empty" } : input.targetValue!,
    reason,
    userId: auth.user.id
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

export async function removeCanonicalValueDraft(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; draftId: string }
): Promise<{ id: string }> {
  await requireOwnedProject(db, auth, input.projectId);
  requireEditPermission(auth, input.projectId);
  const removed = await deleteCanonicalValueDraft(db, {
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
  return { id: input.draftId };
}
