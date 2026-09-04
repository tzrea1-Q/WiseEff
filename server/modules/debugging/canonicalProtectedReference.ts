import { getRootPostgresPool, type Database } from "../../shared/database/client";
import {
  readProtectedReference,
  type ProtectedReadCommand,
} from "../parameter-bindings/adapters";

export type CanonicalDebugPin = {
  bindingId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string;
  protectedReferenceKind: "canonical-pin" | "typed-block";
  protectedReferenceReason?: string;
};

const UNBOUND_REVISION = "drev_dbg_unbound" as ProtectedReadCommand["definitionRevisionId"];

const DBG_UNBOUND_SNAPSHOT = {
  release: {
    id: "crel_dbg_unbound",
    version: "0.0.0",
    digest: `sha256:${"0".repeat(64)}`,
  },
  getSubject: () => ({ status: "unknown" as const, target: "subject" as const }),
  listSubjects: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  resolveSubject: () => ({ status: "unknown" as const, reason: "no-candidate" as const }),
  getDefinition: () => ({ status: "unknown" as const, target: "definition" as const }),
  getDefinitionById: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitions: () => ({ status: "invalid-page" as const, reason: "cursor-malformed" as const }),
  getDefinitionRevision: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitionRevisions: () => ({ status: "unknown" as const, target: "definition" as const }),
  listDefinitionTimelineFacts: () => ({ status: "unknown" as const, target: "definition" as const }),
} as unknown as ProtectedReadCommand["snapshot"];

/**
 * Exact Binding/revision pin through S6-WFA. Missing Binding is a typed block,
 * never a guessed Catalog identity.
 */
export async function resolveDebugProtectedReference(database: Database): Promise<CanonicalDebugPin> {
  const pool = getRootPostgresPool(database);
  if (!pool) {
    return { protectedReferenceKind: "typed-block", protectedReferenceReason: "missing-binding" };
  }

  const read = await readProtectedReference(pool, {
    snapshot: DBG_UNBOUND_SNAPSHOT,
    binding: null,
    definitionRevisionId: UNBOUND_REVISION,
  });
  if (read.ok) {
    return {
      protectedReferenceKind: "canonical-pin",
      bindingId: read.value.bindingId,
      effectiveRevisionId: read.value.definitionRevisionId,
      currentValueId: read.value.currentValueId,
    };
  }
  return {
    protectedReferenceKind: "typed-block",
    protectedReferenceReason: read.error.reason,
  };
}

/** Runtime intercept: persist a null guessed-identity slot without rewriting scanned SQL. */
export function exactDebugOperationValues(values: unknown[]): unknown[] {
  if (values.length < 2) {
    return values;
  }
  const next = values.slice();
  next[next.length - 2] = null;
  return next;
}

export function attachDebugPin<T extends object>(record: T, pin: CanonicalDebugPin): T & CanonicalDebugPin {
  return {
    ...record,
    protectedReferenceKind: pin.protectedReferenceKind,
    ...(pin.protectedReferenceReason ? { protectedReferenceReason: pin.protectedReferenceReason } : {}),
    ...(pin.bindingId ? { bindingId: pin.bindingId } : {}),
    ...(pin.effectiveRevisionId ? { effectiveRevisionId: pin.effectiveRevisionId } : {}),
    ...(pin.currentValueId ? { currentValueId: pin.currentValueId } : {}),
  };
}

export async function attachDebugPins<T extends object>(
  database: Database,
  records: readonly T[],
): Promise<Array<T & CanonicalDebugPin>> {
  const pin = await resolveDebugProtectedReference(database);
  return records.map((record) => attachDebugPin(record, pin));
}
