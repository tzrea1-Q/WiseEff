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

export type MappingApplyPreview = {
  affectedBindings: number;
  byProject: Array<{ projectId: string; count: number }>;
  fromModules: Array<{ moduleId: string; moduleName: string; count: number }>;
  toModuleId: string | null;
  emptiedModules: string[];
  conflicts: string[];
};

export type MappingMutationResult = {
  registry: ParameterModuleRegistry;
  apply: MappingApplyPreview;
};

export type RecomputeBindingModulesResult = {
  updated: number;
  conflicts: string[];
  dryRun?: boolean;
  preview?: MappingApplyPreview;
};

export type ModuleDiscoveryHint = {
  compatible: string;
  bindingCount: number;
  projectCount: number;
  suggestedGroupName: string;
};

export type ModuleDiscoveryHints = {
  compatibles: ModuleDiscoveryHint[];
  total: number;
};

/**
 * Admin-maintained business-module registry (phase 1, additive).
 * Read path feeds the workbench grouping; write path is admin-only governance.
 */
export interface ParameterModuleRegistryRepository {
  getRegistry(): Promise<ParameterModuleRegistry>;
  getDiscoveryHints(): Promise<ModuleDiscoveryHints>;
  dismissCompatible(input: { compatible: string; reason?: string }): Promise<ModuleDiscoveryHints>;
  restoreDismissedCompatible(compatible: string): Promise<ModuleDiscoveryHints>;
  createModule(input: CreateParameterModuleInput): Promise<ParameterModuleRegistry>;
  updateModule(moduleId: string, input: UpdateParameterModuleInput): Promise<ParameterModuleRegistry>;
  deleteModule(moduleId: string): Promise<ParameterModuleRegistry>;
  previewMapping(input: CreateModuleMappingInput): Promise<MappingApplyPreview>;
  createMapping(input: CreateModuleMappingInput): Promise<MappingMutationResult>;
  deleteMapping(mappingId: string): Promise<MappingMutationResult>;
  /**
   * Admin remap recompute: rewrite persisted binding `module_id` from current mappings
   * (phase 2, §5.2). Optionally scoped to one project. Conflicts surface as an API error.
   * Pass `dryRun: true` for an operations preview without writes.
   */
  recomputeBindings(input?: {
    projectId?: string;
    dryRun?: boolean;
  }): Promise<RecomputeBindingModulesResult>;
}
