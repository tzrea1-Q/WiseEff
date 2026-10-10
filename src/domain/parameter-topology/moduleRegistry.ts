/**
 * Business-module registry contracts (phase 1, additive).
 *
 * A "module" is a business grouping (e.g. 充电策略 / 电池安全) that users think in.
 * Modules are mapped to DTS drivers / compatibles / device instances by admins.
 * This layer never changes binding/spec identity; it only assigns a display module.
 */

/** How a mapping rule matches a binding. Priority: node-type > compatible. */
export type ModuleMatchKind = "compatible" | "node-type";

export type ModuleImportance = "high" | "medium" | "low";

export type ModuleKind = "business" | "driver-group" | "node-type" | "unclassified";

export type ModuleOrigin = "curated" | "auto";

export type ParameterModule = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  description: string;
  scope: string;
  importance: ModuleImportance;
  kind: ModuleKind;
  origin: ModuleOrigin;
  sourceKey: string | null;
  /** Nearest ancestor business category importance (or own, when business). */
  effectiveImportance: ModuleImportance;
  /** Subtree bindings (measured occurrences). */
  parameterCount: number;
  /** Distinct specs in the same subtree (definition count). */
  definitionCount: number;
  /** Stable catalog identity for driver-group / node-type (ADR-0013). */
  attributionSubjectId?: string | null;
};

export type ParameterModuleMapping = {
  id: string;
  moduleId: string;
  matchKind: ModuleMatchKind;
  /** Case-insensitive match value against the binding's driver/compatible/instance. */
  matchValue: string;
  /** Higher wins when several rules of the same kind match. Range: 0–999. */
  priority: number;
};

export type ParameterModuleRegistry = {
  modules: ParameterModule[];
  mappings: ParameterModuleMapping[];
};

export const EMPTY_PARAMETER_MODULE_REGISTRY: ParameterModuleRegistry = {
  modules: [],
  mappings: []
};

/** Stable synthetic module id used when a binding falls back to its driver. */
export function driverFallbackModuleId(driverModule: string | null): string {
  return `driver:${driverModule ?? "unassigned"}`;
}

export type ModuleAssignment = {
  moduleId: string;
  moduleName: string;
  importance: ModuleImportance;
  sortOrder: number;
  /** True when the module came from an admin mapping rather than driver fallback. */
  mapped: boolean;
};

export type ModuleAssignmentInput = {
  driverModule: string | null;
  compatible: string | null;
  /** Bare node-type key (unit address stripped). Not a display path. */
  nodeType: string | null;
  /**
   * Optional v1-declared module on the binding/spec (phase-2 materialization).
   * Used after mapping rules, before driver fallback.
   */
  declaredModuleId?: string | null;
};

const UNCLASSIFIED_LABEL = "未分类";

function normalize(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().toLocaleLowerCase();
  return trimmed === "" ? null : trimmed;
}

function candidateValue(kind: ModuleMatchKind, input: ModuleAssignmentInput): string | null {
  switch (kind) {
    case "compatible":
      return normalize(input.compatible);
    case "node-type":
      return normalize(input.nodeType);
  }
}

/**
 * Describes the business module already assigned to a binding (DB `moduleId`, phase-2 §5.1
 * browse source of truth). This never substitutes a different
 * module than the persisted `moduleId` — it only decides whether an admin mapping explicitly
 * targets this module for display (`mapped`), and falls back to unclassified naming when the
 * module record is missing from the registry (e.g. registry still loading).
 */
export function describeModuleAssignment(
  moduleId: string,
  input: ModuleAssignmentInput,
  registry: ParameterModuleRegistry
): ModuleAssignment {
  const module = registry.modules.find((candidate) => candidate.id === moduleId);
  const mapped = registry.mappings.some((mapping) => {
    if (mapping.moduleId !== moduleId) return false;
    const value = candidateValue(mapping.matchKind, input);
    return value !== null && value === normalize(mapping.matchValue);
  });

  if (module) {
    return {
      moduleId,
      moduleName: module.name,
      importance: module.importance,
      sortOrder: module.sortOrder,
      mapped
    };
  }

  const driver = input.driverModule?.trim();
  return {
    moduleId,
    moduleName: driver && driver !== "" ? `${UNCLASSIFIED_LABEL} · ${driver}` : UNCLASSIFIED_LABEL,
    importance: "medium",
    sortOrder: Number.MAX_SAFE_INTEGER,
    mapped: false
  };
}

/**
 * Root→leaf display names for the assigned module, walking registry `parentId`.
 * When the module is missing (driver fallback / registry still loading), returns `[moduleName]`.
 */
export function resolveModulePathNames(
  moduleId: string,
  moduleName: string,
  registry: ParameterModuleRegistry
): string[] {
  const byId = new Map(registry.modules.map((module) => [module.id, module]));
  const leaf = byId.get(moduleId);
  if (!leaf) return [moduleName];

  const names: string[] = [];
  const seen = new Set<string>();
  let current: ParameterModule | undefined = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.length > 0 ? names : [moduleName];
}
