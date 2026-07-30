import type {
  ModuleImportance,
  ModuleMatchKind,
  ModuleOrigin,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";

export type CreateParameterModuleInput = {
  name: string;
  parentId?: string | null;
  description?: string;
  scope?: string;
  sortOrder?: number;
  importance?: ModuleImportance;
  kind?: "business" | "driver-group" | "instance" | "logical";
  origin?: "curated" | "auto";
  sourceKey?: string | null;
  compatibles?: string[];
};

export type UpdateParameterModuleInput = {
  name?: string;
  description?: string;
  scope?: string;
  parentId?: string | null;
  sortOrder?: number;
  importance?: ModuleImportance;
  kind?: "business" | "instance" | "logical";
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

export type DriverRegistryParseCoverage =
  | { covered: false }
  | {
      covered: true;
      pattern: string;
      driverId: string;
      source: string;
      scope: "platform" | "organization";
      shadowedBy?: Array<{
        pattern: string;
        driverId: string;
        source: string;
        scope: "platform" | "organization";
      }>;
      promoted?: boolean;
    };

export type DriverRegistryEntry = {
  moduleId: string;
  name: string;
  origin: ModuleOrigin;
  businessCategoryId: string | null;
  businessCategoryName: string | null;
  compatibles: string[];
  parameterCount: number;
  observed: boolean;
  notYetObserved: boolean;
  parseCoverages: Array<{ compatible: string; coverage: DriverRegistryParseCoverage }>;
};

export type RegisterOrClaimDriverInput = {
  displayName: string;
  businessCategoryId: string;
  compatibles: string[];
  notes?: string;
};

export type RegisterOrClaimDriverResult = {
  mode: "registered" | "claimed";
  item: {
    id: string;
    name: string;
    parentId: string | null;
    kind: "business" | "driver-group" | "instance" | "logical" | "unclassified";
    origin: ModuleOrigin;
    description?: string;
  };
};

export type OrganizationDriverSchemaValueShapeKind =
  | "u32-array"
  | "string-list"
  | "bool"
  | "mixed"
  | "unknown";

/**
 * Overlay properties link ParameterSpecs (definition library).
 * Either attach an existing row, or create one into the library via propertyKey+valueShape.
 */
export type CreateOrganizationDriverSchemaPropertyInput =
  | {
      parameterSpecId: string;
      propertyKey?: string;
    }
  | {
      propertyKey: string;
      valueShape: { kind: OrganizationDriverSchemaValueShapeKind };
      units?: string;
      constraints?: Record<string, unknown>;
      documentation?: string;
      copyFromParameterSpecId?: string;
    };

export type CreateOrganizationDriverSchemaInput = {
  compatible: string;
  displayName: string;
  notes?: string;
  properties: CreateOrganizationDriverSchemaPropertyInput[];
};

export type OrganizationDriverSchema = {
  id: string;
  compatible: string;
  displayName: string;
  notes: string;
  lifecycle: string;
  version: number;
  properties: Array<{
    id: string;
    parameterSpecId: string;
    propertyKey: string;
    valueShape: { kind: OrganizationDriverSchemaValueShapeKind } | Record<string, unknown>;
    units: string | null;
    documentation: string;
  }>;
};

export type ActivateOrganizationDriverSchemaResult = {
  schema: OrganizationDriverSchema;
  upgradedSpecIds: string[];
  resolvedReviewTaskIds: string[];
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
  listDriverRegistry(): Promise<{ items: DriverRegistryEntry[]; total: number }>;
  registerOrClaimDriver(input: RegisterOrClaimDriverInput): Promise<RegisterOrClaimDriverResult>;
  createOrganizationDriverSchema(
    input: CreateOrganizationDriverSchemaInput
  ): Promise<OrganizationDriverSchema>;
  activateOrganizationDriverSchema(
    schemaId: string
  ): Promise<ActivateOrganizationDriverSchemaResult>;
}
