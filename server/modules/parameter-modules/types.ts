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
  effectiveImportance: ModuleImportance;
  parameterCount: number;
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
  path: string;
  parameter_count: string | number | null;
};

export type ParameterModuleMappingRow = {
  id: string;
  parameter_module_id: string;
  match_kind: ModuleMatchKind;
  match_value: string;
  priority: number;
};
