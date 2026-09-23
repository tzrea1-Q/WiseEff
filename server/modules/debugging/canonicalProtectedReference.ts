import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import { createCatalogKernel } from "../catalog-kernel/interface";
import {
  CatalogReleaseId,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  ProjectValueId,
  SubjectRegistrationId
} from "../parameter-catalog-contract";
import type { Binding } from "../parameter-bindings/binding";
import { readProtectedReference } from "../parameter-bindings/adapters/readAdapter";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import type { CanonicalValueSourcePin } from "../parameter-bindings/values/types";
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

type BindingRow = {
  id: string;
  organization_id: string;
  catalog_release_id: string;
  project_id: string;
  logical_node_id: string | null;
  source_occurrence_id: string;
  registration_id: string;
  subject_id: string;
  definition_id: string;
  effective_revision_id: string;
  current_value_id: string;
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

function bindingFromRow(row: BindingRow, catalogRelease: Binding["catalogRelease"]): Binding {
  return {
    id: ParameterBindingId(row.id),
    organizationId: row.organization_id,
    projectId: row.project_id,
    logicalNodeId: row.logical_node_id,
    sourceOccurrenceId: row.source_occurrence_id,
    registrationId: SubjectRegistrationId(row.registration_id),
    subjectId: CatalogSubjectId(row.subject_id),
    definitionId: ParameterDefinitionId(row.definition_id),
    effectiveRevisionId: DefinitionRevisionId(row.effective_revision_id),
    currentValueId: ProjectValueId(row.current_value_id),
    catalogRelease
  };
}

function failureReason(error: unknown) {
  if (!error || typeof error !== "object") return "catalog-unavailable";
  const kind = "kind" in error && typeof error.kind === "string" ? error.kind : undefined;
  return kind ? `catalog-${kind}` : "catalog-unavailable";
}

async function loadCurrentBinding(
  queryable: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string; lock?: boolean }
): Promise<BindingRow | null> {
  const result = await queryable.query<BindingRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id,
            source_occurrence_id, registration_id, subject_id, definition_id,
            effective_revision_id, current_value_id
       from parameter_catalog.current_project_parameter_bindings
      where organization_id = $1 and project_id = $2 and id = $3
      limit 1${input.lock ? " for update" : ""}`,
    [input.organizationId, input.projectId, input.bindingId]
  );
  return result.rows[0] ?? null;
}

async function bindingExistsOutsideCurrentView(
  queryable: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string }
) {
  const result = await queryable.query<{ id: string }>(
    `select id
       from parameter_catalog.project_parameter_bindings
      where organization_id = $1 and project_id = $2 and id = $3
      limit 1`,
    [input.organizationId, input.projectId, input.bindingId]
  );
  return result.rows.length === 1;
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

  const row = await loadCurrentBinding(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId
  });
  if (!row) {
    return (await bindingExistsOutsideCurrentView(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: input.bindingId
    }))
      ? typedBlock("binding-replaced")
      : typedBlock("missing-binding");
  }
  if (row.organization_id !== auth.organization.id || row.project_id !== input.projectId) {
    return typedBlock("binding-owner-mismatch");
  }
  if (input.expectedEffectiveRevisionId && input.expectedEffectiveRevisionId !== row.effective_revision_id) {
    return typedBlock("revision-disagreement");
  }
  if (input.expectedCurrentValueId && input.expectedCurrentValueId !== row.current_value_id) {
    return typedBlock("version-drift");
  }

  const pool = getRootPostgresPool(db as Database);
  if (!pool) {
    return typedBlock("catalog-unavailable");
  }

  try {
    const kernel = createCatalogKernel(pool);
    const releasePin = await kernel.resolveCatalogReleasePin(CatalogReleaseId(row.catalog_release_id));
    if (!releasePin.ok) return typedBlock(failureReason(releasePin.error));
    const loaded = await kernel.loadPinnedCatalog(releasePin.value);
    if (!loaded.ok) return typedBlock(failureReason(loaded.error));
    const binding = bindingFromRow(row, loaded.value.release);
    const protectedRead = await readProtectedReference(pool, {
      snapshot: loaded.value,
      binding,
      definitionRevisionId: binding.effectiveRevisionId
    });
    if (!protectedRead.ok) {
      return typedBlock(protectedRead.error.reason);
    }

    const sourcePin = await loadOwnedProjectValueSourcePin(pool, {
      organizationId: auth.organization.id,
      projectId: row.project_id,
      bindingId: row.id,
      projectValueId: row.current_value_id
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
      projectId: row.project_id,
      definitionId: row.definition_id,
      effectiveRevisionId: row.effective_revision_id,
      currentValueId: row.current_value_id,
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
  const row = await loadCurrentBinding(tx, {
    organizationId: auth.organization.id,
    projectId: reference.projectId,
    bindingId: reference.bindingId,
    lock: true
  });
  if (
    !row ||
    row.definition_id !== reference.definitionId ||
    row.current_value_id !== reference.currentValueId ||
    row.effective_revision_id !== reference.effectiveRevisionId
  ) {
    throw new ApiError("CONFLICT", "Canonical debug binding changed before device I/O.", {
      reason: "version-drift",
      bindingId: reference.bindingId
    });
  }
  await tx.query(
    `select pin.id
       from parameter_catalog.project_value_source_pins pin
      where pin.id = $1 and pin.organization_id = $2 and pin.project_id = $3
      for share`,
    [reference.sourcePinId, auth.organization.id, reference.projectId]
  );
  const sourcePin = await loadOwnedProjectValueSourcePin(tx, {
    organizationId: auth.organization.id,
    projectId: reference.projectId,
    bindingId: reference.bindingId,
    projectValueId: reference.currentValueId
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
  const binding = await tx.query<{ id: string; definition_id: string; definition_revision_id: string }>(
    `select binding.id, binding.definition_id, value.definition_revision_id
       from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_parameter_values value
         on value.id = $4 and value.binding_id = binding.id
      where binding.id = $1 and binding.organization_id = $2 and binding.project_id = $3
      limit 1`,
    [pin.bindingId, auth.organization.id, pin.projectId, pin.currentValueId]
  );
  if (binding.rows.length !== 1) {
    throw new ApiError("CONFLICT", "Snapshot canonical debug binding is unavailable.", { reason: "missing-binding" });
  }
  if (
    binding.rows[0]?.definition_id !== pin.definitionId ||
    binding.rows[0]?.definition_revision_id !== pin.effectiveRevisionId
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
