import type { ParameterModuleMapping } from "./moduleRegistry";
import { driverGroupDisplayNameFromCompatible } from "./modulePlacement";

export type UnmappedCompatibleHint = {
  compatible: string;
  bindingCount: number;
  projectCount: number;
  suggestedGroupName: string;
};

export function mappedCompatibleValues(mappings: readonly ParameterModuleMapping[]): Set<string> {
  return new Set(
    mappings
      .filter((mapping) => mapping.matchKind === "compatible")
      .map((mapping) => mapping.matchValue.trim().toLocaleLowerCase()),
  );
}

export function filterUnmappedCompatibles(
  observedCompatibles: readonly UnmappedCompatibleHint[],
  mappings: readonly ParameterModuleMapping[],
): UnmappedCompatibleHint[] {
  const mapped = mappedCompatibleValues(mappings);
  return observedCompatibles.filter(
    (hint) => !mapped.has(hint.compatible.trim().toLocaleLowerCase()),
  );
}

export function toUnmappedCompatibleHint(input: {
  compatible: string;
  bindingCount: number;
  projectCount?: number;
  suggestedGroupName?: string;
}): UnmappedCompatibleHint {
  return {
    compatible: input.compatible,
    bindingCount: input.bindingCount,
    projectCount: input.projectCount ?? 0,
    suggestedGroupName:
      input.suggestedGroupName?.trim() ||
      driverGroupDisplayNameFromCompatible(input.compatible),
  };
}
