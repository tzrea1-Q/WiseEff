import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  createProtectedWorkflowAdapters,
  type ProtectedReadCommand,
  type ProtectedReferenceDto,
} from "../parameter-bindings/adapters";

export type CanonicalParameterPin = {
  bindingId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string;
};

export type CanonicalPinObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export const PRJ_UNQUERYABLE_FAILURE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

const UNBOUND_REVISION = "unbound";

export function workbenchCatalogSnapshot(): ProtectedReadCommand["snapshot"] {
  const snapshot = {
    release: {
      id: "catalog-unready",
      version: "0.0.0",
      digest: `sha256:${"0".repeat(64)}`,
    },
    getSubject: () => ({ status: "unknown" as const, target: "subject" as const }),
    listSubjects: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
    resolveSubject: () => ({ status: "unknown" as const, reason: "no-candidate" as const }),
    getDefinition: () => ({ status: "unknown" as const, target: "definition" as const }),
    getDefinitionById: () => ({ status: "unknown" as const, target: "definition" as const }),
    listDefinitions: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
    getDefinitionRevision: (input: { definitionId: string; revisionId: string }) => ({
      status: "revision-unavailable" as const,
      definitionId: input.definitionId,
      revisionId: input.revisionId,
      reason: "not-in-snapshot" as const,
    }),
    listDefinitionRevisions: () => ({ status: "unknown" as const, target: "definition" as const }),
    listDefinitionTimelineFacts: () => ({ status: "unknown" as const, target: "definition" as const }),
  };
  return snapshot as unknown as ProtectedReadCommand["snapshot"];
}

function pinFromDto(dto: ProtectedReferenceDto): CanonicalParameterPin & { valueDigest: string } {
  return {
    bindingId: dto.bindingId,
    effectiveRevisionId: dto.definitionRevisionId,
    currentValueId: dto.currentValueId,
    valueDigest: dto.valueDigest,
  };
}

/**
 * Read the canonical Binding pin through S6-WFA. Never forwards a spec identity.
 * Missing Binding is a typed block, not a spec-id fallback.
 */
export async function readCanonicalParameterPin(
  database: Queryable,
): Promise<CanonicalPinObservation> {
  const pool = getRootPostgresPool(database as Database);
  if (!pool) {
    return {
      status: "query-failure",
      code: PRJ_UNQUERYABLE_FAILURE_CODE,
      detail: "root-pool-missing",
    };
  }

  const adapters = createProtectedWorkflowAdapters(pool);
  const command = {
    snapshot: workbenchCatalogSnapshot(),
    binding: null,
    definitionRevisionId: UNBOUND_REVISION,
  } as unknown as ProtectedReadCommand;
  const result = await adapters.read(command);
  if (result.ok) {
    const pin = pinFromDto(result.value);
    return {
      status: "value",
      value: {
        kind: result.value.kind,
        bindingId: pin.bindingId,
        effectiveRevisionId: pin.effectiveRevisionId,
        currentValueId: pin.currentValueId,
        valueDigest: pin.valueDigest,
        source: result.value.source,
      },
    };
  }
  return {
    status: "value",
    value: {
      blocked: true,
      reason: result.error.reason,
    },
  };
}

export function mergeCanonicalPin<T extends CanonicalParameterPin>(
  record: T,
  pin: CanonicalParameterPin,
): T {
  return {
    ...record,
    ...(pin.bindingId ? { bindingId: pin.bindingId } : {}),
    ...(pin.effectiveRevisionId ? { effectiveRevisionId: pin.effectiveRevisionId } : {}),
    ...(pin.currentValueId ? { currentValueId: pin.currentValueId } : {}),
  };
}

export function attachBindingPinTo<T extends object>(
  record: T,
  bindingId: string | undefined,
): T & CanonicalParameterPin {
  if (!bindingId || parameterIdentityMode() !== "semantic") {
    return record;
  }
  return {
    ...record,
    bindingId,
    projectParameterBindingId: bindingId,
  };
}

export function attachSemanticBindingPin<T extends { id: string }>(record: T): T & CanonicalParameterPin {
  if (parameterIdentityMode() !== "semantic") {
    return record;
  }
  return {
    ...record,
    bindingId: record.id,
    projectParameterBindingId: record.id,
  };
}

export async function attachDraftCanonicalPins<T extends { id: string; projectParameterBindingId?: string }>(
  database: Queryable,
  drafts: readonly T[],
): Promise<Array<T & CanonicalParameterPin>> {
  if (drafts.length === 0) {
    return [];
  }
  const result = await database.query<{
    id: string;
    binding_revision_id: string | null;
    project_parameter_binding_id: string | null;
  }>(
    `
    select id, binding_revision_id, project_parameter_binding_id
    from parameter_drafts
    where id = any($1::text[])
    `,
    [drafts.map((draft) => draft.id)],
  );
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return drafts.map((draft) => {
    const row = byId.get(draft.id);
    const bindingId = draft.projectParameterBindingId ?? row?.project_parameter_binding_id?.trim() ?? undefined;
    const effectiveRevisionId = row?.binding_revision_id?.trim() || undefined;
    return {
      ...draft,
      ...(bindingId ? { bindingId, projectParameterBindingId: bindingId } : {}),
      ...(effectiveRevisionId ? { effectiveRevisionId } : {}),
    };
  });
}
