export type CanonicalDebugPin = {
  bindingId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string;
  protectedReferenceKind: "canonical-pin" | "typed-block";
  protectedReferenceReason?: string;
};

type StoredBindingRecord = {
  projectParameterBindingId?: string | null;
  bindingId?: string | null;
};

function storedBindingId(record: object): string | undefined {
  const stored = record as StoredBindingRecord;
  return stored.projectParameterBindingId ?? stored.bindingId ?? undefined;
}

/** Exact stored binding, or typed-block. Never a guessed Catalog identity. */
export function pinFromStoredBinding(bindingId: string | null | undefined): CanonicalDebugPin {
  if (!bindingId) {
    return { protectedReferenceKind: "typed-block", protectedReferenceReason: "missing-binding" };
  }
  return { protectedReferenceKind: "canonical-pin", bindingId };
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

export function attachDebugPins<T extends object>(records: readonly T[]): Array<T & CanonicalDebugPin> {
  return records.map((record) => attachDebugPin(record, pinFromStoredBinding(storedBindingId(record))));
}
