export type ModuleMatchKind = "compatible" | "node-type";

export type ModuleImportance = "high" | "medium" | "low";

export type ModuleKind = "business" | "driver-group" | "node-type" | "unclassified";

export type ModuleOrigin = "curated" | "auto";

export type ParameterModuleDto = {
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
  /** Present for driver-group / node-type modules after attribution cutover. */
  attributionSubjectId: string | null;
  effectiveImportance: ModuleImportance;
  /** Subtree bindings (measured occurrences). */
  parameterCount: number;
  /** Distinct specs in the same subtree (definition count). */
  definitionCount: number;
};

export type ParameterModuleMappingDto = {
  id: string;
  moduleId: string;
  matchKind: ModuleMatchKind;
  matchValue: string;
  priority: number;
};

export type ParameterModuleRegistryDto = {
  modules: ParameterModuleDto[];
  mappings: ParameterModuleMappingDto[];
};

export type ParameterModuleRow = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  description: string;
  scope: string;
  importance: ModuleImportance;
  kind: ModuleKind;
  origin: ModuleOrigin;
  source_key: string | null;
  attribution_subject_id: string | null;
  path: string;
  parameter_count: string | number | null;
  definition_count?: string | number | null;
};

export type ParameterModuleMappingRow = {
  id: string;
  parameter_module_id: string;
  match_kind: ModuleMatchKind;
  match_value: string;
  priority: number;
};
