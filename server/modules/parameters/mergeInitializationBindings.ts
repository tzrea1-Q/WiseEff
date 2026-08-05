export type InitializationBindingCandidate = {
  sourceProjectId: string;
  sourceBindingId: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  moduleId: string;
  risk: "High" | "Medium" | "Low" | null;
  effectiveValue: unknown;
  rawValue: string;
};

export type MergedInitializationBinding = InitializationBindingCandidate & {
  sourceRole: "primary" | "supplement";
  alternativeSourceBindingIds: string[];
  needsEffectiveValueConfirmation: boolean;
  currentValueState: "pending_project_confirmation";
};

function semanticKey(candidate: Pick<InitializationBindingCandidate, "parameterSpecId" | "moduleId">) {
  return `${candidate.parameterSpecId}::${candidate.moduleId}`;
}

function needsConfirmation(candidate: InitializationBindingCandidate) {
  return candidate.rawValue.trim().length === 0 || candidate.effectiveValue == null;
}

function toMerged(
  candidate: InitializationBindingCandidate,
  sourceRole: "primary" | "supplement",
  alternativeSourceBindingIds: string[]
): MergedInitializationBinding {
  return {
    ...candidate,
    sourceRole,
    alternativeSourceBindingIds,
    needsEffectiveValueConfirmation: needsConfirmation(candidate),
    currentValueState: "pending_project_confirmation"
  };
}

/**
 * Primary-source priority merge for project initialization snapshots.
 * Semantic key: parameter_spec_id + module_id (design v1).
 */
export function mergeInitializationBindingCandidates(input: {
  primary: InitializationBindingCandidate[];
  supplements: InitializationBindingCandidate[][];
}): MergedInitializationBinding[] {
  const alternativesByKey = new Map<string, string[]>();
  const allByKey = new Map<string, InitializationBindingCandidate[]>();

  const remember = (candidate: InitializationBindingCandidate) => {
    const key = semanticKey(candidate);
    const list = allByKey.get(key) ?? [];
    list.push(candidate);
    allByKey.set(key, list);
  };

  for (const candidate of input.primary) {
    remember(candidate);
  }
  for (const group of input.supplements) {
    for (const candidate of group) {
      remember(candidate);
    }
  }

  for (const [key, list] of allByKey) {
    alternativesByKey.set(
      key,
      list.slice(1).map((item) => item.sourceBindingId)
    );
  }

  const chosen = new Map<string, { candidate: InitializationBindingCandidate; role: "primary" | "supplement" }>();

  for (const candidate of input.primary) {
    const key = semanticKey(candidate);
    if (!chosen.has(key)) {
      chosen.set(key, { candidate, role: "primary" });
    }
  }

  for (const group of input.supplements) {
    for (const candidate of group) {
      const key = semanticKey(candidate);
      if (!chosen.has(key)) {
        chosen.set(key, { candidate, role: "supplement" });
      }
    }
  }

  const primaryOrder = input.primary.map((item) => semanticKey(item));
  const orderedKeys: string[] = [];
  for (const key of primaryOrder) {
    if (!orderedKeys.includes(key) && chosen.has(key)) {
      orderedKeys.push(key);
    }
  }
  for (const group of input.supplements) {
    for (const candidate of group) {
      const key = semanticKey(candidate);
      if (!orderedKeys.includes(key) && chosen.has(key)) {
        orderedKeys.push(key);
      }
    }
  }

  return orderedKeys.map((key) => {
    const entry = chosen.get(key)!;
    const alts = (alternativesByKey.get(key) ?? []).filter(
      (id) => id !== entry.candidate.sourceBindingId
    );
    return toMerged(entry.candidate, entry.role, alts);
  });
}
