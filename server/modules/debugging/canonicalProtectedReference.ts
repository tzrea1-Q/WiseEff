import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import { createCatalogKernel } from "../catalog-kernel/interface";
import { readProtectedReference } from "../parameter-bindings/adapters";
import { readOwnedCurrentBinding, loadOwnedProjectValueSourcePin, readOwnedProjectValueIdentity, type CanonicalValueSourcePin } from "../parameter-bindings/values";
import { lockCanonicalSourceCohort } from "../parameter-files/canonicalSource";
import type { DebugNodeRecord } from "./types";

export type CanonicalDebugBindingInput = {
  projectId: string;
  bindingId: string;
  expectedEffectiveRevisionId?: string;
  expectedCurrentValueId?: string;
  sourcePinId?: string;
};

export type CanonicalDebugPin = {
  bindingId?: string;
  projectId?: string;
  definitionId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string;
  sourcePinId?: string;
  configRevisionId?: string;
  sourcePin?: CanonicalValueSourcePin;
  protectedReferenceKind: "canonical-pin" | "typed-block";
  protectedReferenceReason?: string;
};

export type CanonicalDebugReference = CanonicalDebugPin & {
  protectedReferenceKind: "canonical-pin";
  bindingId: string;
  projectId: string;
  definitionId: string;
  effectiveRevisionId: string;
  currentValueId: string;
  sourcePinId: string;
  configRevisionId: string;
  sourcePin: CanonicalValueSourcePin;
};

export type CanonicalDebugResolutionMode = "read" | "mutate" | "history";

type StoredBindingRecord = {
  projectParameterBindingId?: string | null;
  bindingId?: string | null;
};

const typedBlock = (protectedReferenceReason: string): CanonicalDebugPin => ({
  protectedReferenceKind: "typed-block",
  protectedReferenceReason
});

function storedBindingId(record: object): string | undefined {
  const stored = record as StoredBindingRecord;
  return stored.projectParameterBindingId ?? stored.bindingId ?? undefined;
}

function hasProjectScope(auth: AuthContext, projectId: string) {
  return auth.roles.some(
    (role) =>
      (role.roleId === "admin" ||
        role.roleId === "platform-admin" ||
        role.roleId === "hardware-user" ||
        role.roleId === "software-user" ||
        role.roleId === "hardware-committer" ||
        role.roleId === "software-committer") &&
      (role.projectId === null || role.projectId === projectId)
  );
}

function authorizedForProject(auth: AuthContext, projectId: string, mode: CanonicalDebugResolutionMode) {
  if (!auth.user.isActive || !hasProjectScope(auth, projectId)) {
    return false;
  }
  return mode === "mutate" ? canEditParameters(auth, projectId) : canViewParameters(auth);
}

/**
 * History/read listings must apply the same project role boundary as a live
 * canonical lookup.  This is deliberately exported for list endpoints: a
 * stored operation already contains its exact pin, so resolving the current
 * Binding again would turn a history read into a mutable-tip lookup.
 */
export function canViewCanonicalDebugProject(auth: AuthContext, projectId: string) {
  return authorizedForProject(auth, projectId, "history");
}

export function isCanonicalDebugHistoryVisible(auth: AuthContext, pin: CanonicalDebugPin) {
  if (pin.protectedReferenceReason === "canonical-history-pin-missing") return false;
  return pin.protectedReferenceKind !== "canonical-pin" || Boolean(pin.projectId && canViewCanonicalDebugProject(auth, pin.projectId));
}

function failureReason(error: unknown) {
  if (!error || typeof error !== "object") return "catalog-unavailable";
  const kind = "kind" in error && typeof error.kind === "string" ? error.kind : undefined;
  return kind ? `catalog-${kind}` : "catalog-unavailable";
}

/**
 * Resolve a stored node association through the existing Binding/DefinitionRevision/
 * ProjectValue/source-pin owners. A non-empty legacy id is deliberately never enough.
 */
export async function resolveDebugNodeCanonicalReference(
  db: Database | Queryable,
  auth: AuthContext,
  input: CanonicalDebugBindingInput & { mode: CanonicalDebugResolutionMode }
): Promise<CanonicalDebugPin> {
  if (!input.projectId.trim() || !input.bindingId.trim()) {
    return typedBlock("invalid-command");
  }
  if (!authorizedForProject(auth, input.projectId, input.mode)) {
    return typedBlock("project-scope");
  }

  const owned = await readOwnedCurrentBinding(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId
  });
  if (owned.status !== "current") {
    return typedBlock(owned.status === "replaced" ? "binding-replaced" : "missing-binding");
  }
  const row = owned.binding;
  if (row.organizationId !== auth.organization.id || row.projectId !== input.projectId) {
    return typedBlock("binding-owner-mismatch");
  }
  if (input.expectedEffectiveRevisionId && input.expectedEffectiveRevisionId !== row.effectiveRevisionId) {
    return typedBlock("revision-disagreement");
  }
  if (input.expectedCurrentValueId && input.expectedCurrentValueId !== row.currentValueId) {
    return typedBlock("version-drift");
  }

  const pool = getRootPostgresPool(db as Database);
  if (!pool) {
    return typedBlock("catalog-unavailable");
  }

  try {
    const kernel = createCatalogKernel(pool);
    const releasePin = await kernel.resolveCatalogReleasePin(row.catalogReleaseId);
    if (!releasePin.ok) return typedBlock(failureReason(releasePin.error));
    const loaded = await kernel.loadPinnedCatalog(releasePin.value);
    if (!loaded.ok) return typedBlock(failureReason(loaded.error));
    const binding = { ...row, catalogRelease: loaded.value.release };
    const protectedRead = await readProtectedReference(pool, {
      snapshot: loaded.value,
      binding,
      definitionRevisionId: binding.effectiveRevisionId
    });
    if (!protectedRead.ok) {
      return typedBlock(protectedRead.error.reason);
    }

    const sourcePin = await loadOwnedProjectValueSourcePin(db, {
      organizationId: auth.organization.id,
      projectId: row.projectId,
      bindingId: row.id,
      projectValueId: row.currentValueId
    });
    if (!sourcePin) {
      return typedBlock("missing-source-pin");
    }
    if (sourcePin.valueState !== "present") {
      return typedBlock("missing-current-value");
    }
    if (input.sourcePinId && input.sourcePinId !== sourcePin.sourcePinId) {
      return typedBlock("source-drift");
    }
    if (sourcePin.configRevisionId !== protectedRead.value.source.configRevisionId) {
      return typedBlock("source-drift");
    }

    return {
      protectedReferenceKind: "canonical-pin",
      bindingId: row.id,
      projectId: row.projectId,
      definitionId: row.definitionId,
      effectiveRevisionId: row.effectiveRevisionId,
      currentValueId: row.currentValueId,
      sourcePinId: sourcePin.sourcePinId,
      configRevisionId: sourcePin.configRevisionId,
      sourcePin
    };
  } catch {
    return typedBlock("catalog-unavailable");
  }
}

export async function resolveStoredDebugNodePin(
  db: Database | Queryable,
  auth: AuthContext,
  node: Pick<DebugNodeRecord, "canonicalBindingId" | "canonicalProjectId">,
  options: { mode?: CanonicalDebugResolutionMode } = {}
): Promise<CanonicalDebugPin> {
  if (!node.canonicalBindingId && !node.canonicalProjectId) {
    return typedBlock("missing-binding");
  }
  if (!node.canonicalBindingId || !node.canonicalProjectId) {
    return typedBlock("invalid-command");
  }
  return resolveDebugNodeCanonicalReference(db, auth, {
    mode: options.mode ?? "read",
    bindingId: node.canonicalBindingId,
    projectId: node.canonicalProjectId
  });
}

/** Hold the node row lock while a linked device operation is prepared/executed. */
export async function lockDebugNodeRow(tx: Queryable, auth: AuthContext, nodeId: string): Promise<void> {
  const result = await tx.query<{ id: string }>(
    `select id from debug_nodes where organization_id = $1 and id = $2 for update`,
    [auth.organization.id, nodeId]
  );
  if (result.rows.length !== 1) {
    throw new ApiError("NOT_FOUND", "Debug node was not found.", { nodeId });
  }
}

export async function lockDebugNodeCanonicalAssociation(
  tx: Queryable,
  auth: AuthContext,
  nodeId: string,
  reference: CanonicalDebugReference
): Promise<void> {
  const node = await tx.query<{ canonical_binding_id: string | null; canonical_project_id: string | null }>(
    `select canonical_binding_id, canonical_project_id
       from debug_nodes
      where organization_id = $1 and id = $2
      for update`,
    [auth.organization.id, nodeId]
  );
  const row = node.rows[0];
  if (!row || row.canonical_binding_id !== reference.bindingId || row.canonical_project_id !== reference.projectId) {
    throw new ApiError("CONFLICT", "Canonical debug node association changed before device I/O.", {
      reason: "association-drift",
      nodeId
    });
  }
}

/** Re-check the stored exact pin on the transaction connection immediately before device IO. */
export async function assertDebugNodeCanonicalReferenceCurrent(
  tx: Queryable,
  auth: AuthContext,
  reference: CanonicalDebugReference
): Promise<void> {
  await lockCanonicalSourceCohort(tx, reference.sourcePin);
  const owned = await readOwnedCurrentBinding(tx, {
    organizationId: auth.organization.id,
    projectId: reference.projectId,
    bindingId: reference.bindingId,
    lock: true
  });
  if (
    owned.status !== "current" ||
    owned.binding.definitionId !== reference.definitionId ||
    owned.binding.currentValueId !== reference.currentValueId ||
    owned.binding.effectiveRevisionId !== reference.effectiveRevisionId
  ) {
    throw new ApiError("CONFLICT", "Canonical debug binding changed before device I/O.", {
      reason: "version-drift",
      bindingId: reference.bindingId
    });
  }
  const sourcePin = await loadOwnedProjectValueSourcePin(tx, {
    organizationId: auth.organization.id,
    projectId: reference.projectId,
    bindingId: reference.bindingId,
    projectValueId: reference.currentValueId,
    lock: true
  });
  if (!sourcePin || sourcePin.sourcePinId !== reference.sourcePinId || sourcePin.configRevisionId !== reference.configRevisionId) {
    throw new ApiError("CONFLICT", "Canonical debug source pin changed before device I/O.", {
      reason: "source-drift",
      bindingId: reference.bindingId
    });
  }
}

/** Historical rollback checks identity only; it never relabels a historical pin as current. */
export async function assertDebugHistoryPin(
  tx: Queryable,
  auth: AuthContext,
  pin: CanonicalDebugPin | undefined
): Promise<CanonicalDebugReference | null> {
  if (!pin) return null;
  if (pin.protectedReferenceKind !== "canonical-pin") {
    throw new ApiError("CONFLICT", "Snapshot contains an unavailable canonical debug association.", {
      reason: pin.protectedReferenceReason ?? "typed-block"
    });
  }
  if (!pin.bindingId || !pin.projectId || !pin.definitionId || !pin.effectiveRevisionId || !pin.currentValueId || !pin.sourcePinId || !pin.configRevisionId || !pin.sourcePin) {
    throw new ApiError("CONFLICT", "Snapshot canonical debug pin is incomplete.", { reason: "invalid-command" });
  }
  if (!authorizedForProject(auth, pin.projectId, "history")) {
    throw new ApiError("FORBIDDEN", "Project parameter scope is required for canonical debug rollback.", {
      projectId: pin.projectId
    });
  }
  const identity = await readOwnedProjectValueIdentity(tx, {
    bindingId: pin.bindingId, organizationId: auth.organization.id,
    projectId: pin.projectId, projectValueId: pin.currentValueId
  });
  if (!identity) {
    throw new ApiError("CONFLICT", "Snapshot canonical debug binding is unavailable.", { reason: "missing-binding" });
  }
  if (
    identity.definitionId !== pin.definitionId ||
    identity.definitionRevisionId !== pin.effectiveRevisionId
  ) {
    throw new ApiError("CONFLICT", "Snapshot canonical debug definition revision is unavailable.", {
      reason: "revision-disagreement"
    });
  }
  const sourcePin = await loadOwnedProjectValueSourcePin(tx, {
    organizationId: auth.organization.id,
    projectId: pin.projectId,
    bindingId: pin.bindingId,
    projectValueId: pin.currentValueId
  });
  if (!sourcePin || sourcePin.sourcePinId !== pin.sourcePinId || sourcePin.configRevisionId !== pin.configRevisionId) {
    throw new ApiError("CONFLICT", "Snapshot canonical debug source pin is unavailable.", { reason: "missing-source-pin" });
  }
  return pin as CanonicalDebugReference;
}

/** Exact stored binding, or a typed-block. Never a guessed Catalog identity. */
export function pinFromStoredBinding(bindingId: string | null | undefined): CanonicalDebugPin {
  return bindingId ? typedBlock("legacy-binding-id") : typedBlock("missing-binding");
}

export function attachDebugPin<T extends object>(record: T, pin: CanonicalDebugPin): T & CanonicalDebugPin {
  return {
    ...record,
    protectedReferenceKind: pin.protectedReferenceKind,
    ...(pin.protectedReferenceReason ? { protectedReferenceReason: pin.protectedReferenceReason } : {}),
    ...(pin.bindingId ? { bindingId: pin.bindingId } : {}),
    ...(pin.projectId ? { projectId: pin.projectId } : {}),
    ...(pin.definitionId ? { definitionId: pin.definitionId } : {}),
    ...(pin.effectiveRevisionId ? { effectiveRevisionId: pin.effectiveRevisionId } : {}),
    ...(pin.currentValueId ? { currentValueId: pin.currentValueId } : {}),
    ...(pin.sourcePinId ? { sourcePinId: pin.sourcePinId } : {}),
    ...(pin.configRevisionId ? { configRevisionId: pin.configRevisionId } : {}),
    ...(pin.sourcePin ? { sourcePin: pin.sourcePin } : {})
  };
}

/** Remove storage-only association fields before returning a typed-block. */
export function redactCanonicalDebugRecord<T extends object>(record: T, reason: string): T & CanonicalDebugPin {
  const safe = { ...record } as T & Record<string, unknown>;
  for (const key of [
    "canonicalBinding",
    "canonicalBindingId",
    "canonicalProjectId",
    "canonicalPin",
    "bindingId",
    "projectId",
    "definitionId",
    "effectiveRevisionId",
    "currentValueId",
    "sourcePinId",
    "configRevisionId",
    "sourcePin",
    "protectedReferenceKind",
    "protectedReferenceReason"
  ]) {
    delete safe[key];
  }
  return attachDebugPin(safe as T, typedBlock(reason));
}

/**
 * HTTP never exposes the source-pin owner's internal row.  The immutable
 * source/config IDs remain available for display and exact history checks.
 */
export function projectCanonicalDebugPinForHttp(pin: CanonicalDebugPin): Omit<CanonicalDebugPin, "sourcePin"> {
  const { sourcePin: _sourcePin, ...flatPin } = pin;
  return flatPin;
}

export function attachDebugPins<T extends object>(records: readonly T[]): Array<T & CanonicalDebugPin> {
  return records.map((record) => attachDebugPin(record, pinFromStoredBinding(storedBindingId(record))));
}

export function pinFromOperation(record: {
  canonicalPin?: CanonicalDebugPin;
  canonicalBindingId?: string | null;
  canonicalProjectId?: string | null;
  projectParameterBindingId?: string | null;
}): CanonicalDebugPin {
  if ((record.canonicalBindingId || record.canonicalProjectId) && (
    record.canonicalPin?.protectedReferenceKind !== "canonical-pin" ||
    record.canonicalPin.bindingId !== record.canonicalBindingId ||
    record.canonicalPin.projectId !== record.canonicalProjectId
  )) return typedBlock("canonical-history-pin-missing");
  return record.canonicalPin ?? pinFromStoredBinding(record.projectParameterBindingId);
}
