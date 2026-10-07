export type InitializationBindingCandidate = {
  sourceProjectId: string;
  sourceBindingId: string;
  sourceProjectValueId: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  moduleId: string;
  risk: "High" | "Medium" | "Low" | null;
  effectiveValue: unknown;
  rawValue: string;
  sourceConfigSetId?: string;
  sourceConfigRevisionId?: string;
  sourceOccurrenceId?: string;
  sourceFormat?: "dts" | "json";
  sourceName?: string;
  sourceLocatorLabel?: string;
};

export type MergedInitializationBinding = InitializationBindingCandidate & {
  sourceRole: "primary" | "supplement";
  alternativeSourceBindingIds: string[];
  needsEffectiveValueConfirmation: boolean;
  currentValueState: "pending_project_confirmation";
  alternativeSourceValueIds: string[];
};

function semanticKey(candidate: Pick<InitializationBindingCandidate, "sourceProjectValueId">) {
  return candidate.sourceProjectValueId;
}

function needsConfirmation(candidate: InitializationBindingCandidate) {
  return candidate.rawValue.trim().length === 0 || candidate.effectiveValue == null;
}

function toMerged(
  candidate: InitializationBindingCandidate,
  sourceRole: "primary" | "supplement",
  alternativeSourceBindingIds: string[],
  alternativeSourceValueIds: string[]
): MergedInitializationBinding {
  return {
    ...candidate,
    sourceRole,
    alternativeSourceBindingIds,
    alternativeSourceValueIds,
    needsEffectiveValueConfirmation: needsConfirmation(candidate),
    currentValueState: "pending_project_confirmation"
  };
}

/**
 * Primary-source priority merge for project initialization snapshots.
 * Semantic key: immutable canonical source project value id. Definition/module
 * names are presentation fields and cannot identify a source instance.
 */
export function mergeInitializationBindingCandidates(input: {
  primary: InitializationBindingCandidate[];
  supplements: InitializationBindingCandidate[][];
}): MergedInitializationBinding[] {
  const alternativesByDefinition = new Map<string, InitializationBindingCandidate[]>();

  const remember = (candidate: InitializationBindingCandidate) => {
    const definitionList = alternativesByDefinition.get(candidate.parameterSpecId) ?? [];
    definitionList.push(candidate);
    alternativesByDefinition.set(candidate.parameterSpecId, definitionList);
  };

  for (const candidate of input.primary) {
    remember(candidate);
  }
  for (const group of input.supplements) {
    for (const candidate of group) {
      remember(candidate);
    }
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
    const alternatives = (alternativesByDefinition.get(entry.candidate.parameterSpecId) ?? [])
      .filter((item) => item.sourceBindingId !== entry.candidate.sourceBindingId);
    const alts = alternatives.map((item) => item.sourceBindingId);
    const valueAlternatives = alternatives
      .map((item) => item.sourceProjectValueId);
    return toMerged(entry.candidate, entry.role, alts, valueAlternatives);
  });
}
