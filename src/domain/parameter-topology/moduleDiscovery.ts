import type { ParameterModuleMapping } from "./moduleRegistry";
import { driverGroupDisplayNameFromCompatible } from "./modulePlacement";

export type UnmappedDriverHint = {
  driverModule: string;
  bindingCount: number;
};

export type UnmappedCompatibleHint = {
  compatible: string;
  bindingCount: number;
  suggestedGroupName: string;
};

export function mappedDriverValues(mappings: readonly ParameterModuleMapping[]): Set<string> {
  return new Set(
    mappings
      .filter((mapping) => mapping.matchKind === "driver")
      .map((mapping) => mapping.matchValue.trim().toLocaleLowerCase()),
  );
}

export function mappedCompatibleValues(mappings: readonly ParameterModuleMapping[]): Set<string> {
  return new Set(
    mappings
      .filter((mapping) => mapping.matchKind === "compatible")
      .map((mapping) => mapping.matchValue.trim().toLocaleLowerCase()),
  );
}

export function filterUnmappedDrivers(
  observedDrivers: readonly UnmappedDriverHint[],
  mappings: readonly ParameterModuleMapping[],
): UnmappedDriverHint[] {
  const mapped = mappedDriverValues(mappings);
  return observedDrivers.filter(
    (hint) => !mapped.has(hint.driverModule.trim().toLocaleLowerCase()),
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
}): UnmappedCompatibleHint {
  return {
    compatible: input.compatible,
    bindingCount: input.bindingCount,
    suggestedGroupName: driverGroupDisplayNameFromCompatible(input.compatible),
  };
}
