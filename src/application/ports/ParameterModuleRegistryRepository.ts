import type {
  ModuleImportance,
  ModuleMatchKind,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";

export type CreateParameterModuleInput = {
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  importance?: ModuleImportance;
};

export type UpdateParameterModuleInput = {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  importance?: ModuleImportance;
};

export type CreateModuleMappingInput = {
  moduleId: string;
  matchKind: ModuleMatchKind;
  matchValue: string;
  priority?: number;
};

export type RecomputeBindingModulesResult = {
  updated: number;
  conflicts: string[];
};

/**
 * Admin-maintained business-module registry (phase 1, additive).
 * Read path feeds the workbench grouping; write path is admin-only governance.
 */
export interface ParameterModuleRegistryRepository {
  getRegistry(): Promise<ParameterModuleRegistry>;
  createModule(input: CreateParameterModuleInput): Promise<ParameterModuleRegistry>;
  updateModule(moduleId: string, input: UpdateParameterModuleInput): Promise<ParameterModuleRegistry>;
  deleteModule(moduleId: string): Promise<ParameterModuleRegistry>;
  createMapping(input: CreateModuleMappingInput): Promise<ParameterModuleRegistry>;
  deleteMapping(mappingId: string): Promise<ParameterModuleRegistry>;
  /**
   * Admin remap recompute: rewrite persisted binding `module_id` from current mappings
   * (phase 2, §5.2). Optionally scoped to one project. Conflicts surface as an API error.
   */
  recomputeBindings(input?: { projectId?: string }): Promise<RecomputeBindingModulesResult>;
}
