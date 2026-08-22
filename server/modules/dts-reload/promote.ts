import { randomUUID } from "node:crypto";

import {
  evaluateDtsReloadPromotionEligibility,
  type DtsReloadPromotionRejection
} from "../../../src/domain/dtsReload/promotionGuard";
import { writeMilestoneAudit } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canEditParameters } from "../parameter-kernel/policy";
import type { SensitiveWriteActorType } from "../parameter-kernel/sensitiveNode";
import { createBindingDraft as defaultCreateBindingDraft } from "../parameter-topology/service";
import type { CreateBindingDraftBody } from "../parameter-topology/schemas";
import type { CreateBindingDraftDeps } from "../parameter-topology/overlayWriteback";
import type { CreateBindingDraftServiceResult } from "../parameter-topology/service";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import { assertDtsReloadHumanActor, requireDtsReloadPromote } from "./policy";
import {
  getReloadCandidateRow,
  getReloadRunRow,
  listReloadRunTargets,
  type ReloadCandidateRow
} from "./repository";
import { resolveReloadValueShape, validateAuthoredDebugValue, type CandidateValueShape } from "./valueShape";
import type {
  ParameterVerificationOutcome,
  ReloadRunPurpose,
  ReloadRunStatus,
  ReloadSnapshotDto
} from "./types";

export type PromoteBindingDraftFn = (
  db: Database,
  auth: AuthContext,
  input: {
    projectId: string;
    bindingId: string;
  } & CreateBindingDraftBody,
  deps?: CreateBindingDraftDeps,
  context?: AuditCorrelationContext
) => Promise<CreateBindingDraftServiceResult>;

export type PromoteReloadRunToDraftsInput = {
  runId: string;
  bindingIds: string[];
  unverifiableAcknowledged?: boolean;
};

export type PromotedDraftItem = {
  bindingId: string;
  draftId: string;
  outcome: "created" | "updated" | "unchanged";
};

export type PromoteReloadRunToDraftsResult = {
  runId: string;
  status: ReloadRunStatus;
  drafts: PromotedDraftItem[];
  workbenchHref: string;
};

export type PromoteReloadRunToDraftsContext = AuditCorrelationContext & {
  actorType?: SensitiveWriteActorType;
  createBindingDraft?: PromoteBindingDraftFn;
  objectStore?: ObjectStore;
};

export function reloadPromoteWorkbenchHref(projectId: string): string {
  return `/parameters?project=${encodeURIComponent(projectId)}`;
}

export function encodePromoteDraftReason(input: {
  runId: string;
  baselineValue: string | null;
  debugValue: string;
  verification: ParameterVerificationOutcome | "unbound";
}): string {
  return `reload-promote sourceReloadRunId=${input.runId} baseline=${input.baselineValue ?? ""} debug=${input.debugValue} verification=${input.verification}`;
}

function uniqueBindingIds(bindingIds: string[]): string[] {
  return [...new Set(bindingIds.map((id) => id.trim()).filter(Boolean))];
}

function asReloadPurpose(value: unknown): ReloadRunPurpose {
  return value === "restore-baseline" ? "restore-baseline" : "ordinary";
}

function asValueShape(value: unknown): CandidateValueShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CandidateValueShape;
}

function verificationForBinding(snapshot: unknown, bindingId: string): ParameterVerificationOutcome | "unbound" {
  if (!snapshot || typeof snapshot !== "object") {
    return "unbound";
  }
  const outcomes = (snapshot as ReloadSnapshotDto).behaviouralVerification?.outcomes;
  const match = outcomes?.find((item) => item.bindingId === bindingId);
  return match?.outcome ?? "unbound";
}

function serverPromotionRejectionMessage(rejection: DtsReloadPromotionRejection): string {
  switch (rejection.reason) {
    case "restore-baseline":
      return "restore-baseline runs cannot be promoted; those values are already the library baseline.";
    case "unverifiable-ack-required":
      return "Unverifiable reload runs require unverifiableAcknowledged: true before promotion.";
    case "status-ineligible":
      return `Reload run status ${rejection.details.status} cannot be promoted to parameter drafts.`;
  }
}

function assertRunPromotionEligible(input: {
  status: ReloadRunStatus;
  purpose: ReloadRunPurpose;
  unverifiableAcknowledged?: boolean;
}): void {
  const eligibility = evaluateDtsReloadPromotionEligibility(input);
  if (eligibility.allowed) return;

  throw new ApiError(
    "CONFLICT",
    serverPromotionRejectionMessage(eligibility),
    eligibility.details
  );
}

async function listOpenDraftsForBinding(
  db: Queryable,
  input: { organizationId: string; bindingId: string }
): Promise<Array<{ id: string; targetValue: string; reason: string | null }>> {
  const result = await db.query<{ id: string; target_value: string; reason: string | null }>(
    `
    select id, target_value, reason
    from parameter_drafts
    where organization_id = $1
      and project_parameter_binding_id = $2
    `,
    [input.organizationId, input.bindingId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    targetValue: row.target_value,
    reason: row.reason
  }));
}

async function hasInFlightChangeRequest(
  db: Queryable,
  input: { organizationId: string; bindingId: string }
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_change_requests
    where organization_id = $1
      and project_parameter_binding_id = $2
      and status not in ('merged', 'rejected')
    limit 1
    `,
    [input.organizationId, input.bindingId]
  );
  return result.rows.length > 0;
}

function isIdempotentPromotion(
  draft: { targetValue: string; reason: string | null },
  runId: string,
  debugValue: string
): boolean {
  return (
    draft.targetValue === debugValue &&
    Boolean(draft.reason?.includes(`sourceReloadRunId=${runId}`))
  );
}

export async function promoteReloadRunToDrafts(
  db: Database,
  auth: AuthContext,
  input: PromoteReloadRunToDraftsInput,
  context: PromoteReloadRunToDraftsContext = {}
): Promise<PromoteReloadRunToDraftsResult> {
  const bindingIds = uniqueBindingIds(input.bindingIds);
  if (bindingIds.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "bindingIds must contain at least one binding.", {
      code: "reload-promote-empty-selection"
    });
  }

  requireDtsReloadPromote(auth);

  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId: input.runId });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Reload run was not found.", { runId: input.runId });
  }

  if (!canEditParameters(auth, row.project_id)) {
    throw new ApiError("FORBIDDEN", "Missing permission: parameter:edit.", { permission: "parameter:edit" });
  }

  await assertDtsReloadHumanActor(db, auth, {
    actorType: context.actorType,
    action: "promote",
    projectId: row.project_id,
    runId: row.id,
    requestId: context.requestId
  });

  const purpose = asReloadPurpose(row.purpose);
  assertRunPromotionEligible({
    status: row.status,
    purpose,
    unverifiableAcknowledged: input.unverifiableAcknowledged
  });

  const runTargets = await listReloadRunTargets(db, row.id);
  const targetByBinding = new Map(runTargets.map((target) => [target.bindingId, target]));
  const createDraft = context.createBindingDraft ?? defaultCreateBindingDraft;
  const drafts: PromotedDraftItem[] = [];

  for (const bindingId of bindingIds) {
    const runTarget = targetByBinding.get(bindingId);
    if (!runTarget) {
      throw new ApiError("VALIDATION_FAILED", "Selected binding is not a target of this reload run.", {
        code: "reload-promote-unknown-target",
        bindingId,
        runId: row.id
      });
    }

    const candidate = await getReloadCandidateRow(db, {
      organizationId: auth.organization.id,
      projectId: row.project_id,
      bindingId
    });
    if (!candidate) {
      throw new ApiError("CONFLICT", "Parameter binding is no longer available in the project.", {
        code: "reload-promote-binding-missing",
        bindingId
      });
    }
    assertNodePathUnchanged(candidate, runTarget.nodePath, bindingId);

    const resolvedShape = resolveReloadValueShape(asValueShape(candidate.value_shape), candidate.baseline_value);
    const validated = validateAuthoredDebugValue(candidate.property_key, runTarget.debugValue, resolvedShape);
    if (!validated.ok) {
      throw new ApiError("VALIDATION_FAILED", "Stored debug value no longer conforms to the current reload value shape.", {
        code: "reload-promote-value-shape",
        bindingId,
        debugValue: runTarget.debugValue
      });
    }

    if (await hasInFlightChangeRequest(db, { organizationId: auth.organization.id, bindingId })) {
      throw new ApiError("CONFLICT", "An in-flight change request already exists for this binding.", {
        code: "reload-promote-in-flight-cr",
        bindingId
      });
    }

    const openDrafts = await listOpenDraftsForBinding(db, {
      organizationId: auth.organization.id,
      bindingId
    });
    const idempotent = openDrafts.find((draft) => isIdempotentPromotion(draft, row.id, runTarget.debugValue));
    if (idempotent) {
      drafts.push({ bindingId, draftId: idempotent.id, outcome: "unchanged" });
      continue;
    }
    if (openDrafts.length > 0) {
      throw new ApiError("CONFLICT", "An open draft already exists for this binding.", {
        code: "reload-promote-open-draft",
        bindingId,
        draftId: openDrafts[0]!.id
      });
    }

    const baseRevisionId = candidate.config_revision_id;
    if (!baseRevisionId) {
      throw new ApiError("CONFLICT", "Binding has no current config revision to stage a draft against.", {
        code: "reload-promote-revision-missing",
        bindingId
      });
    }

    const verification = verificationForBinding(row.reload_snapshot, bindingId);
    const reason = encodePromoteDraftReason({
      runId: row.id,
      baselineValue: runTarget.baselineValue,
      debugValue: runTarget.debugValue,
      verification
    });

    const created = await createDraft(
      db,
      auth,
      {
        projectId: row.project_id,
        bindingId,
        baseRevisionId,
        targetValue: validated.parsed,
        action: "set",
        reason
      },
      context.objectStore ? { objectStore: context.objectStore } : {},
      { requestId: context.requestId }
    );
    drafts.push({
      bindingId,
      draftId: created.draftId,
      outcome: "created"
    });
  }

  const createdBindingIds = drafts.filter((item) => item.outcome === "created").map((item) => item.bindingId);
  if (createdBindingIds.length > 0) {
    await writeMilestoneAudit(
      db,
      auth,
      { requestId: context.requestId ?? randomUUID() },
      {
        app: "dts-reload",
        kind: "reload-value-promoted-to-draft",
        action: "promote",
        severity: "Medium",
        projectId: row.project_id,
        targetType: "dts-reload-run",
        targetId: row.id,
        actorType: context.actorType ?? "user",
        metadata: {
          runId: row.id,
          status: row.status,
          purpose,
          bindingIds: createdBindingIds,
          draftIds: drafts.filter((item) => item.outcome === "created").map((item) => item.draftId)
        }
      }
    );
  }

  return {
    runId: row.id,
    status: row.status,
    drafts,
    workbenchHref: reloadPromoteWorkbenchHref(row.project_id)
  };
}

function assertNodePathUnchanged(candidate: ReloadCandidateRow, recordedNodePath: string, bindingId: string) {
  if ((candidate.node_path ?? "") !== recordedNodePath) {
    throw new ApiError(
      "CONFLICT",
      "Selected target now resolves to a different device-tree node than when its debug value was written.",
      {
        code: "reload-promote-node-drift",
        bindingId,
        recordedNodePath,
        currentNodePath: candidate.node_path
      }
    );
  }
}
